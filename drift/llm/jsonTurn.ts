import Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import { liveRng, computeModifier, type RNG, type EngineEvent } from "@/engine";
import { TurnRuntime } from "./engineBridge";
import { applyPlan, type ApplyCtx } from "./applyPlan";
import { openFightFromSkill, COMBAT_SKILLS } from "./openFight";
import { buildJsonSystem, buildContextSlice, retrieveEntities } from "./promptBuilder";
import { deepseekChat, deepseekChatStream, isDeepSeekModel, resolveModel } from "./deepseek";
import { sanitizeHistory, trimToLastSentence } from "./history";
import { NarrationExtractor } from "./jsonStream";
import {
  parseTurnPlan,
  repairTurnPlan,
  REPAIR_FALLBACK_NARRATION,
  type TurnPlan,
  type CheckSpec,
  type ChoiceOption,
} from "@/shared/turnPlan";
import { type SceneCard, type NpcRelations, type SceneMemory } from "@/shared/scene";
import { checkFromVerb, verbFromLabel, verbRolls, inferAttemptVerb } from "@/shared/actions";
import { dcForRisk, difficultyToRisk, type RiskTier } from "@/shared/risk";
import type { Character } from "@/shared/schemas";
import { extractDialogueNpcs, knownEntityNames } from "@/shared/npcExtract";
import { inferConsumableUse } from "@/shared/items";
import type { CombatState } from "@/shared/combat";
import type { Dossier } from "@/shared/multiplayer";
import type { Job } from "@/shared/quests";
import type { PlayerLedger } from "@/shared/ledger";
import { stripInlineMenu } from "@/shared/narration";
import { graduatedTutorialThisTurn, inTutorial, TUTORIAL_CHOICE_COUNT } from "@/shared/tutorial";

/**
 * Structured (JSON) narrator turn — the routine-path replacement for the
 * freeform tool loop, built for cheap-model discipline:
 *
 *  - The model returns a validated TurnPlan (narration + choice data + intents);
 *    prose menus are structurally impossible and the engine applies mechanics.
 *  - A clicked choice's attached check is PRE-ROLLED by the engine before the
 *    model is called: the dice are engine output shown to the player directly,
 *    the tick is awarded immediately, and the model just narrates a known result.
 *  - Validation failure → one retry with the specific error; then auto-repair.
 *
 * Combat set-pieces still use the tool loop in narrator.ts.
 */

export interface JsonTurnInput {
  state: CampaignState;
  history: Anthropic.MessageParam[];
  playerText: string;
  /** Check attached to the clicked choice — engine rolls it before narrating. */
  preCheck?: CheckSpec;
  /** Catalog id from a clicked "Use X" chip — the engine applies the consumable
   *  deterministically before narrating (a heal never depends on the model). */
  preUseItem?: string;
  /** A clicked "Repair hull" dock chip — the engine repairs before narrating. */
  preRepair?: boolean;
  /** A clicked "Rest up with <patron>" chip — the engine applies the free safety
   *  net (rest/stims/stipend/repair) before narrating (STARTER.md). */
  preRest?: boolean;
  /** A clicked "Hire <name>" chip (CREW.md) — the npc id; the engine instantiates
   *  the crew member deterministically before narrating. */
  preRecruit?: string;
  /** A clicked full-pack SWAP chip: drop this carried item to take the pending
   *  pickup. `"__decline__"` leaves the pending item behind (ITEMS.md slice B). */
  preSwap?: string;
  /** The action was a CLICKED choice (not typed). Its check is already decided and
   *  shown on the chip, so a checkless clicked choice must NOT get a surprise
   *  model-proposed roll — the badge is the contract (typed free text still can). */
  fromChoice?: boolean;
  focusIds?: string[];
  /** Shared per-scene tick-cap set ("charId:skill"); mutated in place. */
  tickedSet?: Set<string>;
  /** Scene working memory + NPC relations (CONTINUITY.md); mutated in place. */
  sceneCard?: SceneCard;
  npcRelations?: NpcRelations;
  /** Recent scene summaries for the PREVIOUSLY block (oldest→newest). */
  recentScenes?: SceneMemory[];
  /** Other players' reachable dossiers in this universe (cross-campaign cameos). */
  otherDossiers?: Dossier[];
  /** The active job board (QUESTS.md) — the active-jobs prompt section reads it. */
  jobs?: Job[];
  /** The owner's relationship ledger (MULTIPLAYER.md §2) — gates cross-player cameos. */
  ledger?: PlayerLedger;
  model?: string;
  rng?: RNG;
  apiKey?: string;
  onDelta?: (text: string) => void;
  /** Engine result lines (dice/ticks), emitted the moment they happen. */
  onEngine?: (lines: string[]) => void;
}

export interface JsonTurnResult {
  narration: string;
  choices: ChoiceOption[];
  /** Combat spawned this turn (the fight begins), or null. */
  combat: CombatState | null;
  /** Prefixed engine display lines shown this turn (for the transcript). */
  engineLines: string[];
  state: CampaignState;
  events: EngineEvent[];
  worldEvents: TurnRuntime["worldEvents"];
  sceneEnded: boolean;
  /** Title of the scene that closed this turn (model's, or the auto-close's). */
  sceneTitle: string | null;
  focusIds: string[];
  tutorialGraduated: boolean;
  model: string;
  promptDump: string;
  exchangeDump: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  telemetry: {
    latencyMs: number;
    rounds: number;
    toolCalls: string[];
    stopReason: string;
    fellBack: boolean;
    systemChars: number;
  };
}

/** JSON envelope + a ~90-word narration fits in ~400 tokens — but hybrid DeepSeek
 *  models sometimes THINK first (reasoning_content), and if the cap lands mid-
 *  thought the visible content comes back empty. Headroom lets a thinking pass
 *  finish AND emit the JSON; flash output is cheap ($0.28/M → ~0.04¢ worst case). */
const JSON_MAX_TOKENS = 1600;

/** The narrator produced nothing usable after retry + repair. The turn is
 *  ABORTED — the route surfaces a retryable error and persists NOTHING, so the
 *  player resumes exactly where they left off once the issue clears. */
export class TurnGenerationError extends Error {
  readonly retryable = true;
  constructor(detail: string) {
    super(detail);
    this.name = "TurnGenerationError";
  }
}

/**
 * Resolve every choice's check from its verb — the model's tag when present,
 * else INFERRED from the label's leading words ("Search the lockers" → loot).
 * The engine owns skill selection either way; untagged non-attempt labels stay
 * plain. This also makes the check badge deterministic on the client.
 *
 * RISK-TIER prebalancing: for a NON-COMBAT verb the DC is derived from the risk
 * the model chose (safe/risky/reckless) and THIS character's modifier, so the
 * success chance is consistent (~80/55/30%) instead of a fixed easy/normal/hard
 * DC that ignored the player's odds. A COMBAT verb keeps its verb-built DC (that
 * maps to enemy tier for the fight reroute — never risk-rebalanced).
 */
function resolveChoiceChecks(choices: TurnPlan["choices"], pc?: Character): TurnPlan["choices"] {
  return choices.map((c) => {
    if (c.check) return c; // model gave an explicit check — respect it as-is
    const verb = c.verb ?? verbFromLabel(c.label);
    if (!verb) return c;
    const built = checkFromVerb(verb, c.difficulty ?? undefined);
    if (!built) return { ...c, verb }; // free verb — stays check-free

    // Combat verbs (attack/smallArms/gunnery) resolve through the fight engine —
    // their DC encodes enemy toughness (dcToTier), so leave it untouched.
    if (built.combat) {
      return {
        ...c,
        verb,
        check: { skill: built.skill, dc: built.dc, stakes: built.stakes, hazardLevel: built.hazardLevel },
      };
    }

    // Non-combat: the engine sets the DC from the chosen risk and the PC's odds.
    const risk: RiskTier = c.risk ?? difficultyToRisk(c.difficulty) ?? "risky";
    const mod = pc ? computeModifier(pc, built.skill) : 0;
    const dc = dcForRisk(risk, mod);
    // A bolder gamble hurts more: bump a hazard verb's danger on a reckless push.
    const hazardLevel =
      built.hazardLevel != null && risk === "reckless"
        ? Math.min(5, built.hazardLevel + 1)
        : built.hazardLevel;
    return {
      ...c,
      verb,
      risk,
      check: { skill: built.skill, dc, stakes: built.stakes, hazardLevel, risk },
    };
  });
}

/** DeepSeek sometimes reproduces the PREVIOUS turn's narration verbatim, ignoring
 *  the player's new action (the "same answer 3 times" bug). Detect an echo: exact
 *  normalized match, or an identical long opening (a verbatim copy starts the same).
 *  Normalized to alphanumerics so punctuation/whitespace drift doesn't hide it. */
export function isEchoOfPrevious(current: string, previous: string): boolean {
  const norm = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = norm(current);
  const b = norm(previous);
  if (a.length < 40 || b.length < 40) return false; // too short to judge
  if (a === b) return true;
  const head = 120;
  return a.length >= head && b.length >= head && a.slice(0, head) === b.slice(0, head);
}

function defaultModel(): string {
  // Routine turns fill a JSON template — a fast CHAT model, not a reasoning one.
  // v4-pro burned its whole token budget on hidden reasoning and hit max_tokens
  // before emitting any JSON, so every turn fell back to a canned beat. The
  // engine owns the hard logic (verbs→skills, DCs, damage); flash writes prose.
  return resolveModel(process.env.NARRATOR_MODEL ?? "deepseek-v4-flash");
}

type RollResult = {
  breakdown?: string;
  tick?: string;
  tickCapped?: string;
  loot?: string;
  outcome?: string;
  critical?: boolean;
  criticalFailure?: boolean;
  damage?: number;
  downed?: boolean;
  died?: boolean;
  shipDamage?: number;
  shipHpAfter?: number;
  shipDisabled?: boolean;
  error?: string;
};

/** Player-facing lines, pre-prefixed for display. Dice, crit, and skill-tick are
 *  ONE compact line ("🎲 … · ✨ CRIT · ⬆ Mechanics 2→3/6"); damage stays its own
 *  line (it's the consequence, not the roll). */
function rollDisplayLines(res: RollResult): string[] {
  const lines: string[] = [];
  if (res.breakdown) {
    const bits = [`🎲 ${res.breakdown}`];
    if (res.criticalFailure) bits.push("💥 CRITICAL FAILURE (nat 1)");
    else if (res.critical) bits.push("✨ CRITICAL SUCCESS (nat 20)");
    if (res.tick) bits.push(`⬆ ${res.tick}`);
    else if (res.tickCapped) bits.push(`⬆ ${res.tickCapped}: already improved this scene (max 1/skill/scene)`);
    lines.push(bits.join(" · "));
  }
  if (res.loot) lines.push(res.loot);
  if (res.damage) {
    lines.push(`💥 Took ${res.damage} damage${res.died ? " — KILLED" : res.downed ? " — DOWNED" : ""}`);
  }
  if (res.shipDamage) {
    lines.push(`🛠 Hull took ${res.shipDamage}${res.shipDisabled ? " — DISABLED (adrift)" : ` — ${res.shipHpAfter} left`}`);
  }
  return lines;
}

/** Number-words the model reaches for when it dodges digits ("eighteen hundred
 *  credits"). Sorted longest-first so alternation prefers "seventeen" over the
 *  "seven" prefix inside it. */
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
].sort((a, b) => b.length - a.length);
const _WORD = `(?:${NUMBER_WORDS.join("|")})`;
const _WORD_PHRASE = `${_WORD}(?:[\\s-]+${_WORD})*`;
/** credit / credits / creds / cred — the currency word in any common spelling. */
const _CRED = "cred(?:it)?s?";
/** Number-WORDS immediately trailed by a currency token: "twelve hundred creds". */
const MONEY_WORDS_RE = new RegExp(`\\b${_WORD_PHRASE}\\s+(?:${_CRED}\\b|¢|c\\b)`, "gi");
/** ¢ glued to digits, either side: "¢450", "1,800¢". */
const MONEY_SIGN_RE = /¢\s*\d[\d,]*|\b\d[\d,]*\s*¢/g;
/** Digits + a currency word: "1,800 credits", "185 creds", "185cred". */
const MONEY_DIGITS_RE = new RegExp(`\\b\\d[\\d,]*\\s*${_CRED}\\b`, "gi");
/** Digits + a bare trailing 'c': "1800c" (the boundary stops "100cc"/"deck 4c"). */
const MONEY_SUFFIX_C_RE = /\b\d[\d,]*c\b/gi;

/**
 * Belt-and-suspenders safety net for the #1 economy error: the model stating a
 * credit figure in prose (job pay, a buyer's bid, a bribe, a price). The ENGINE
 * owns every number — a real figure only ever reaches the player on a 💰 system
 * line — so any amount the NARRATION states is fabricated and gets scrubbed to a
 * vague phrase. Catches BOTH digit forms ("1,800 credits", "¢450", "1800c") AND
 * number-word forms ("eighteen hundred credits", "two thousand creds"). Only a
 * number FOLLOWED BY a currency token is touched, so plain counts ("deck 4",
 * "3 guards", "twenty crates") survive untouched. Applied to the model's
 * narration ONLY — never to the engine's own 💰 lines.
 */
export function redactMoney(narration: string): string {
  if (!narration) return narration;
  return narration
    .replace(MONEY_WORDS_RE, "a fair sum")
    .replace(MONEY_SIGN_RE, "a fair sum")
    .replace(MONEY_DIGITS_RE, "a fair sum")
    .replace(MONEY_SUFFIX_C_RE, "a fair sum");
}

/**
 * The engine's ACTUAL combat roster, collapsed to a human list for the opening
 * re-narration (COMBAT alignment): identical foes group by base name so "Thug 1",
 * "Thug 2" reads as "2× Thug"; a named boss stays as itself. This is the ground
 * truth the narrator must match — the model narrated the fight BEFORE the engine
 * placed the foes (clamped to the net-worth band, capped at 5), so its prose drifts
 * ("two guards + a broker" while the engine spawned one "Thug"). Feeding the resolved
 * roster back makes the opening beat match the mechanics by construction.
 */
export function combatRoster(combat: CombatState): string {
  const groups = new Map<string, number>();
  for (const e of combat.enemies) {
    const base = e.name.replace(/\s+\d+$/, "").trim() || e.name; // "Thug 2" → "Thug"
    groups.set(base, (groups.get(base) ?? 0) + 1);
  }
  return [...groups.entries()].map(([name, n]) => (n > 1 ? `${n}× ${name}` : name)).join(", ");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The known NPCs who are the named actor RIGHT BEFORE a line of dialogue — the
 * "act, then speak" beat the strict speech-verb extractor misses ("Valis taps the
 * shard. 'You've got…'"). For each OPENING quote (a quote mark preceded by
 * whitespace, so contraction/possessive apostrophes don't count), the speaker is the
 * SUBJECT — the FIRST distinctive NPC name-token in the last complete sentence before
 * the quote. Taking the subject (not the nearest name) avoids attributing "Valis
 * warns you that Calvo is holed up… 'Watch yourself.'" to Calvo (who's off-screen).
 */
function speakersBeforeQuotes(narration: string, npcs: { id: string; name: string }[]): Set<string> {
  const out = new Set<string>();
  const openQuoteRe = /(^|[\s—–-])["'“‘]/g;
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = openQuoteRe.exec(narration)) !== null) positions.push(m.index + m[1].length);
  if (!positions.length) return out;
  // Distinctive name tokens (≥4 chars, so short common words can't false-match).
  const cands = npcs.flatMap((n) =>
    n.name.toLowerCase().split(/\s+/).filter((t) => t.length >= 4).map((tok) => ({ id: n.id, tok })),
  );
  for (const qp of positions) {
    // The last COMPLETE sentence before the quote (drop the trailing sentence-ender).
    const before = narration.slice(0, qp).trimEnd().replace(/[.!?]+$/, "");
    const enders = [before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "), before.lastIndexOf("\n")];
    const sentence = before.slice(Math.max(-1, ...enders) + 1).toLowerCase();
    let bestId = "";
    let bestPos = Infinity;
    for (const { id, tok } of cands) {
      const idx = sentence.indexOf(tok);
      if (idx >= 0 && idx < bestPos) {
        bestPos = idx;
        bestId = id;
      }
    }
    if (bestId) out.add(bestId);
  }
  return out;
}

/**
 * Which KNOWN NPCs the beat implies are PRESENT, beyond the model's own npcs[] and
 * the strict dialogue-speaker match (CONTINUITY presence — the "talking to Soren in
 * his office but he's in neither proximity bucket" bug). Two high-precision signals:
 *  1. the scene is set in THEIR space — a name token in `place`/`situation`
 *     ("Meridian Ring — Valis's office" → Soren Valis is here);
 *  2. they're the named actor right before a quote (`speakersBeforeQuotes`).
 * A bare off-screen MENTION (a target named as being elsewhere) matches neither.
 */
export function inferPresentNpcs(
  narration: string,
  place: string | undefined,
  situation: string | undefined,
  npcs: { id: string; name: string }[],
): Set<string> {
  const present = new Set<string>();
  const placeText = `${place ?? ""} ${situation ?? ""}`.toLowerCase();
  for (const n of npcs) {
    const inPlace = n.name
      .toLowerCase()
      .split(/\s+/)
      .some((tok) => tok.length >= 4 && new RegExp(`\\b${escapeRe(tok)}\\b`).test(placeText));
    if (inPlace) present.add(n.id);
  }
  for (const id of speakersBeforeQuotes(narration, npcs)) present.add(id);
  return present;
}

/**
 * A blunt, outcome-specific coda appended to the "narrate this result" directive so
 * the cheap model can't narrate a SUCCESS the engine just denied — the exact desync
 * that let a MISSED stealth kill read as a clean assassination, then flip-flop a
 * turn later when the "dead" guard shot back. Derived from the engine text (both the
 * structured roll line and the raw combat line pass through here as prose).
 */
export function outcomeDirective(engineText: string): string {
  const t = (engineText ?? "").toLowerCase();
  if (/\bkilled\b|\bdied\b|—\s*dead\b|☠/.test(t))
    return " The character's attempt FAILED and they were KILLED — this is their death. Do NOT narrate them succeeding or surviving; narrate the fatal outcome.";
  if (/\bdowned\b/.test(t))
    return " The character's attempt FAILED and they were DOWNED — dropped to 0 HP, out of the fight. Do NOT narrate them landing the blow or achieving their aim; show the attempt going wrong and them being hit and going down.";
  const missed = /→\s*miss\b/.test(t) || /→\s*(fail|failure)\b/.test(t) || /critical failure/.test(t);
  const hurt = /\btook?\s+\d+|\btakes?\s+\d+|\bdamage\b/.test(t);
  if (missed && hurt) return " The character MISSED and was HURT in return. Do NOT narrate a success — show the miss and the counterblow.";
  if (missed) return " The character's attempt did NOT succeed. Narrate the failure, never a success.";
  if (hurt) return " The character was HURT this beat — show concretely how they got hit.";
  return "";
}

/** One compact line summarizing a roll for the model's context. */
function engineContextLine(res: RollResult): string {
  const crit = res.criticalFailure
    ? " · CRITICAL FAILURE (nat 1 — make it cost)"
    : res.critical
      ? " · CRITICAL SUCCESS (nat 20 — make it shine)"
      : "";
  const dmg = res.damage
    ? ` · ${res.damage} damage${res.died ? " (KILLED)" : res.downed ? " (DOWNED)" : ""}`
    : "";
  const ship = res.shipDamage
    ? ` · hull -${res.shipDamage}${res.shipDisabled ? " (DISABLED, adrift)" : ` (${res.shipHpAfter} hull left)`}`
    : "";
  const loot = res.loot ? ` · ${res.loot} (narrate finding EXACTLY this — nothing more)` : "";
  return `ENGINE RESULT: ${res.breakdown ?? ""}${crit}${res.tick ? ` · ${res.tick}` : ""}${loot}${dmg}${ship}`;
}

export async function runJsonTurn(input: JsonTurnInput): Promise<JsonTurnResult> {
  const model = resolveModel(input.model ?? defaultModel());
  let activeModel = model;
  let fellBack = false;
  const startedAt = Date.now();
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const toolCalls: string[] = [];
  let rounds = 0;
  let lastStop = "end_turn";
  const rawResponses: string[] = [];

  const runtime = new TurnRuntime(input.state, input.rng ?? liveRng, {
    tickedThisScene: input.tickedSet,
    sceneCard: input.sceneCard,
    npcRelations: input.npcRelations,
  });
  // This turn counts against the scene (the auto-close backstop reads it).
  runtime.sceneCard.turnCount += 1;
  const pc = input.state.characters.find((c) => c.kind === "pc");
  // Accumulate every engine display line so the route can persist them to the
  // transcript (they're also streamed live via onEngine).
  const emitted: string[] = [];
  const emit = (lines: string[]) => {
    emitted.push(...lines);
    input.onEngine?.(lines);
  };

  // ── Pre-roll: the clicked choice carried a check — engine resolves it NOW. ──
  const engineLines: string[] = [];
  // Last resolved action check (skill + outcome) — shades payout rolls: a
  // successful negotiation this turn lands in the upper half of the band.
  let lastRoll: { skill: string; outcome?: string } | null = null;
  // Combat spawned this turn (via a gun-skill reroute or the model's combatStart).
  let combat: CombatState | null = null;

  // A gun skill (smallArms/gunnery) is an act of violence, not a skill check:
  // reroute it into the combat engine (openFight.ts). Thin wrapper that owns the
  // emit + engineLines side effects; the reroute logic itself is shared with the
  // mid-turn `roll` path below.
  const openFight = (skill: string, dc: number): CombatState | null => {
    const r = openFightFromSkill(runtime, input.state, input.playerText, skill, dc);
    engineLines.push(r.engineLine);
    emit(r.lines);
    return r.combat;
  };

  // Typed-action check inference: the model too often forgets to set `roll` on a
  // custom action, so a TYPED action (not a clicked chip) that READS as an attempt
  // gets a check inferred from the player's own words and PRE-ROLLED here — exactly
  // like a clicked choice — so the model narrates a KNOWN result in a single pass
  // (no post-hoc re-narration, no dice/prose desync). Pure dialogue / free verbs
  // infer nothing, so "I greet the bartender" never manufactures a false check.
  // Free-text consumable backstop: a TYPED "use stim"/"pop a medkit" for a heal
  // the player HOLDS resolves through the engine here (like the clicked chip), so
  // an out-of-combat heal never depends on the cheap model firing useItem — the
  // live "stims stopped working" bug (prose said patched, HP never moved). Only
  // when the player didn't click a chip and isn't mid-pre-roll from a choice.
  const impliedUseItemId: string | undefined =
    !input.preUseItem && !input.fromChoice && pc ? inferConsumableUse(input.playerText, pc) : undefined;

  const impliedCheck: CheckSpec | undefined = (() => {
    if (input.fromChoice || input.preCheck || impliedUseItemId) return undefined;
    const v = inferAttemptVerb(input.playerText);
    const vc = v ? checkFromVerb(v) : null;
    return v && vc ? ({ verb: v, dc: vc.dc, stakes: true } as CheckSpec) : undefined;
  })();
  const preCheck = input.preCheck ?? impliedCheck;

  // The clicked/inferred check's skill: verb-derived when tagged (engine owns the
  // mapping), else the explicit skill. A check with neither is skipped.
  const preVerb = preCheck?.verb ? checkFromVerb(preCheck.verb) : null;
  const preSkill = preVerb?.skill ?? preCheck?.skill ?? null;
  if (preCheck && preSkill && pc) {
    if (COMBAT_SKILLS.has(preSkill)) {
      toolCalls.push("combat_start");
      combat = openFight(preSkill, preCheck.dc);
    } else {
      toolCalls.push("roll_check");
      const res = runtime.execute("roll_check", {
        characterId: pc.id,
        skill: preSkill,
        dc: preCheck.dc,
        stakes: preCheck.stakes,
        failDamage: preCheck.failDamage,
        hazardLevel: preCheck.hazardLevel ?? preVerb?.hazardLevel,
        target: preCheck.target ?? undefined,
        // Scavenging IS the loot skill: a clicked choice's badge round-trips only the
        // skill (not the verb), so recover the loot intent from the skill itself —
        // else a successful "search the body" grants nothing and the narrator's
        // invented items get rejected downstream (the reported "loot doesn't apply").
        loot: preVerb?.loot || preSkill === "scavenging",
      }) as RollResult;
      if (res.breakdown) {
        lastRoll = { skill: preSkill, outcome: res.outcome };
        engineLines.push(engineContextLine(res));
        emit(rollDisplayLines(res));
      }
    }
  }

  // A clicked "Use X" consumable chip — OR a typed "use stim" the backstop resolved
  // (impliedUseItemId): the engine applies the item DETERMINISTICALLY (never depends
  // on the model firing useItem — the medkit-that-did-nothing / stims-stopped-working
  // bug), and the resulting line rides engineLines so the model narrates around it.
  const preItemId = input.preUseItem ?? impliedUseItemId;
  // Whether the item was already consumed here, so applyPlan must NOT apply the
  // model's echoed useItem again (double-spend / double-heal).
  let preAppliedItem = false;
  if (preItemId && pc) {
    toolCalls.push(input.preUseItem ? "use_item" : "use_item(typed)");
    const res = runtime.useItem(preItemId, pc.id) as { line?: string; error?: string };
    if (res.line) {
      engineLines.push(`ENGINE RESULT: ${res.line}`);
      emit([res.line]);
      preAppliedItem = true;
    } else if (res.error) {
      emit([`⚠ Can't use item: ${res.error}`]);
    }
  }
  // A clicked "Repair hull" dock chip — engine repairs deterministically (E-3).
  if (input.preRepair && pc) {
    toolCalls.push("repair_ship");
    const res = runtime.repairShip();
    if (res.line) {
      engineLines.push(`ENGINE RESULT: ${res.line}`);
      emit([res.line]);
    } else if (res.error) {
      emit([`⚠ ${res.error}`]);
    }
  }
  // A clicked "Rest up with <patron>" chip — the free early-game safety net (STARTER).
  if (input.preRest && pc) {
    toolCalls.push("rest_patron");
    const res = runtime.restWithPatron();
    if (res.line) {
      engineLines.push(`ENGINE RESULT: ${res.line}`);
      emit([res.line]);
    } else if (res.error) {
      emit([`⚠ ${res.error}`]);
    }
  }
  // A clicked "Hire <name>" chip — the engine signs the crew member on (CREW.md).
  if (input.preRecruit && pc) {
    toolCalls.push("recruit_crew");
    const res = runtime.recruitCrew(input.preRecruit);
    if (res.line) {
      engineLines.push(`ENGINE RESULT: ${res.line}`);
      emit([res.line]);
    } else if (res.error) {
      emit([`⚠ ${res.error}`]);
    }
  }
  // A clicked full-pack SWAP chip — drop-to-take (or leave it), engine-owned.
  if (input.preSwap && pc) {
    toolCalls.push("swap_item");
    const res = input.preSwap === "__decline__" ? runtime.declineSwap() : runtime.resolveSwap(input.preSwap);
    const r = res as { line?: string; error?: string };
    if (r.line) {
      engineLines.push(`ENGINE RESULT: ${r.line}`);
      emit([r.line]);
    } else if (r.error) {
      emit([`⚠ ${r.error}`]);
    }
  }

  // ── Prompt assembly ─────────────────────────────────────────────────────────
  const system = buildJsonSystem(input.state);
  // NPCs present in the CURRENT SCENE ride retrieval every turn — no re-naming
  // needed for someone standing in the room (CONTINUITY tier NOW).
  const focusWithPresent = [...new Set([...(input.focusIds ?? []), ...runtime.sceneCard.presentNpcIds])];
  const retrieved = retrieveEntities(input.state, input.playerText, focusWithPresent);
  const contextSlice = buildContextSlice(
    input.state,
    input.playerText,
    focusWithPresent,
    retrieved,
    true,
    {
      sceneCard: runtime.sceneCard,
      npcRelations: runtime.npcRelations,
      recentScenes: input.recentScenes ?? [],
    },
    input.otherDossiers,
    input.jobs,
    input.ledger,
  );
  const messages: Anthropic.MessageParam[] = [
    ...sanitizeHistory(input.history),
    {
      role: "user",
      content:
        `${contextSlice}\n\n---\nPLAYER: ${input.playerText}` +
        (engineLines.length
          ? `\n${engineLines.join("\n")}\nNarrate this result EXACTLY as the engine resolved it — the dice are authoritative and already shown to the player.${outcomeDirective(engineLines.join(" "))} Do not request another roll.`
          : input.fromChoice && !input.preCheck
            ? `\n(This is a pre-offered option with NO skill check — resolve its outcome FULLY in this one beat. Do NOT request a "roll"; it won't fire.)`
            : ""),
    },
  ];
  const promptDump = `=== SYSTEM ===\n${system.map((b) => b.text).join("\n\n")}\n\n=== MESSAGES ===\n${messages
    .map((m) => `[${m.role.toUpperCase()}]\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
    .join("\n\n")}`;

  // ── One model call (streaming narration out of the JSON when possible). ────
  async function call(stream: boolean): Promise<string> {
    rounds++;
    if (isDeepSeekModel(activeModel)) {
      const params = { model: activeModel, maxTokens: JSON_MAX_TOKENS, system, messages, jsonMode: true };
      const resp =
        stream && input.onDelta
          ? await deepseekChatStream({
              ...params,
              onDelta: (() => {
                const ex = new NarrationExtractor();
                return (t: string) => {
                  const text = ex.feed(t);
                  if (text) input.onDelta!(text);
                };
              })(),
            })
          : await deepseekChat(params);
      usage.inputTokens += resp.usage.input_tokens;
      usage.outputTokens += resp.usage.output_tokens;
      usage.cacheReadTokens += resp.usage.cache_read_input_tokens;
      lastStop = resp.stop_reason;
      return resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    }
    // Anthropic path (fallback or no DeepSeek key) — prompt-instructed JSON.
    const anthropic = new Anthropic({ apiKey: input.apiKey ?? process.env.ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: activeModel,
      max_tokens: JSON_MAX_TOKENS,
      system,
      messages,
    });
    usage.inputTokens += resp.usage.input_tokens;
    usage.outputTokens += resp.usage.output_tokens;
    usage.cacheReadTokens += resp.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += resp.usage.cache_creation_input_tokens ?? 0;
    lastStop = resp.stop_reason ?? "end_turn";
    return resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  }

  async function callWithFallback(stream: boolean): Promise<string> {
    try {
      return await call(stream);
    } catch (err) {
      if (fellBack || !isDeepSeekModel(activeModel) || !process.env.ANTHROPIC_API_KEY) throw err;
      console.error(`[jsonTurn] ${activeModel} failed, falling back to Haiku:`, err instanceof Error ? err.message : err);
      fellBack = true;
      activeModel = "claude-haiku-4-5-20251001";
      return await call(false);
    }
  }

  /** Call → parse; on invalid JSON, retry once with the specific error. */
  async function plannedCall(stream: boolean): Promise<TurnPlan> {
    const raw = await callWithFallback(stream);
    rawResponses.push(raw);
    const first = parseTurnPlan(raw);
    if (first.plan) return first.plan;
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `Your last response was not a valid turn (${first.error}). Respond again with ONLY the json object — narration, choices, and optional roll/worldEvent/sceneEnd fields.`,
    });
    const raw2 = await callWithFallback(false);
    rawResponses.push(raw2);
    const second = parseTurnPlan(raw2);
    if (second.plan) return second.plan;
    // Last resort: salvage what we can. If the repair produced ONLY the sentinel
    // stub (no real narration, no choices), the model gave us nothing — fail the
    // turn honestly instead of advancing the story on filler.
    const repaired = repairTurnPlan(raw2 || raw, { jsonOnly: true });
    if (repaired.narration === REPAIR_FALLBACK_NARRATION && repaired.choices.length === 0) {
      throw new TurnGenerationError(
        `narrator returned no usable turn (model=${activeModel}, stop=${lastStop}, ` +
          `raw lengths=${raw.length}/${raw2.length})`,
      );
    }
    return repaired;
  }

  let plan = await plannedCall(true);
  // ── Anti-echo: DeepSeek sometimes reproduces a RECENT narration verbatim,
  //    ignoring the player's new action (the "same answer 3 times" bug — and worse,
  //    re-firing that beat's payout, so the player gets paid for a done job twice).
  //    Check the last few turns, not just the immediately previous one (a repeat can
  //    reach back several beats). On a detected echo, regenerate ONCE with an
  //    advance-don't-repeat instruction. Only fires on a verbatim echo, so normal
  //    turns pay nothing.
  const recentNarrations = [...input.history]
    .filter((m) => m.role === "assistant" && typeof m.content === "string")
    .slice(-4)
    .map((m) => m.content as string);
  const echoes = (text: string) => recentNarrations.some((prev) => isEchoOfPrevious(text, prev));
  if (echoes(plan.narration)) {
    toolCalls.push("anti_repeat");
    messages.push({ role: "assistant", content: JSON.stringify({ narration: plan.narration }) });
    messages.push({
      role: "user",
      content:
        "You just repeated an EARLIER narration almost word-for-word (a beat that already happened). The player has taken a NEW action since — react to what they JUST did and move the moment forward. Write a fresh beat; do NOT restate a previous one, and do NOT re-award a payout/reward for a job you already resolved.",
    });
    const retry = await plannedCall(false);
    if (retry.narration.trim() && !echoes(retry.narration)) {
      plan = retry;
    }
  }
  // Resolve every choice's check up front — the model's verb tag, or a verb
  // INFERRED from the label ("Search the lockers" → loot) when it forgot to tag.
  plan = { ...plan, choices: resolveChoiceChecks(plan.choices, pc) };

  // ── Enforce at least one checked choice (the dice must always be on offer). ──
  // Runs AFTER verb/label resolution, so an inferred attempt already satisfies it
  // — the bounce-back to the model is the last resort, not the norm. A FREE verb
  // (go/talk/wait/take…) is check-free and must NOT satisfy the requirement.
  const wantsCheck = (p: TurnPlan) =>
    p.choices.length > 0 &&
    !p.choices.some((c) => c.check || verbRolls(c.verb)) &&
    !p.combatStart &&
    !p.sceneEnd &&
    !p.roll;
  if (!preCheck && wantsCheck(plan)) {
    toolCalls.push("enforce_check");
    messages.push({ role: "assistant", content: JSON.stringify({ narration: plan.narration, choices: plan.choices }) });
    messages.push({
      role: "user",
      content:
        "None of your options carried a skill check — every turn must offer at least one. Re-send the SAME json turn, keeping your narration WORD FOR WORD, but tag the single most consequential/uncertain option with an ATTEMPT \"verb\" (or a \"check\" {skill, dc, stakes:true}).",
    });
    const retry = await plannedCall(false);
    if (retry.choices.length) plan = { ...retry, choices: resolveChoiceChecks(retry.choices, pc) };
  }
  let narration = plan.narration;

  // ── Mid-turn roll: the model says the CURRENT action needs a check. A `verb`
  //    overrides the skill (engine owns the mapping). A gun/attack skill opens a
  //    fight instead (same reroute as a clicked check). ───────────────────────
  const rollVerb = plan.roll?.verb ? checkFromVerb(plan.roll.verb) : null;
  const rollSkill = rollVerb?.skill ?? plan.roll?.skill;
  // A CLICKED choice's stakes are fixed at offer time (the chip badge). If it came
  // with no check, the model can't bolt one on now — that's the "no indicator but
  // it rolled" bug. Typed free text stays unconstrained (no chip to contradict). An
  // explicit combatStart is still allowed (a deliberate ambush beat); only the
  // plan.roll skill/reroute path is gated here.
  if (plan.roll && rollSkill && !preCheck && !input.fromChoice && pc && !combat && COMBAT_SKILLS.has(rollSkill)) {
    toolCalls.push("combat_start");
    combat = openFight(rollSkill, plan.roll.dc);
    // The narration above described the player's INTENT and was written BEFORE the
    // engine resolved the opening exchange — which may have MISSED and hurt/downed
    // them. Re-narrate from the real result so the prose can't claim a kill the dice
    // denied (the reported "guard I'd killed came back and shot me" desync). Engine
    // lines are already shown; the client commits this replacement on `done`.
    const openingLine = engineLines[engineLines.length - 1];
    if (openingLine) {
      // Feed the RESOLVED roster too so the names/count match the engine, not just
      // the dice (COMBAT alignment — the prose is written before the foes are placed).
      const roster = combat ? combatRoster(combat) : "";
      messages.push({ role: "assistant", content: JSON.stringify({ narration: plan.narration }) });
      messages.push({
        role: "user",
        content: `${openingLine}\nThat is the ACTUAL outcome of the opening exchange — the dice are authoritative.${roster ? ` The engine placed EXACTLY these combatants: ${roster} — use these names and this exact count, no unnamed extras.` : ""} Re-narrate THIS beat to match it, REPLACING your previous narration.${outcomeDirective(openingLine)} Do not request another roll.`,
      });
      const outcome = await plannedCall(false);
      if (outcome.narration.trim()) {
        narration = outcome.narration;
        plan = { ...outcome, narration };
      }
    }
  } else if (plan.roll && rollSkill && !preCheck && !input.fromChoice && pc && !combat) {
    toolCalls.push("roll_check");
    const res = runtime.execute("roll_check", {
      characterId: pc.id,
      skill: rollSkill,
      dc: plan.roll.dc,
      stakes: plan.roll.stakes,
      failDamage: plan.roll.failDamage,
      hazardLevel: plan.roll.hazardLevel ?? rollVerb?.hazardLevel,
      target: plan.roll.target ?? undefined,
      // Scavenging IS the loot skill — loot even when the model gave only the skill
      // ("scavenging") and no loot verb, so a successful strip actually hauls.
      loot: rollVerb?.loot || rollSkill === "scavenging",
    }) as RollResult;
    if (res.breakdown) {
      lastRoll = { skill: rollSkill, outcome: res.outcome };
      emit(rollDisplayLines(res));
      messages.push({ role: "assistant", content: JSON.stringify({ narration: plan.narration }) });
      messages.push({
        role: "user",
        content: `${engineContextLine(res)}\nNarrate the outcome EXACTLY as the engine resolved it — the dice are authoritative — and provide choices.${outcomeDirective(engineContextLine(res))} Do not request another roll.`,
      });
      const outcome = await plannedCall(true);
      narration = `${plan.narration}\n\n${outcome.narration}`.trim();
      plan = { ...outcome, narration };
    }
  }

  // ── Danger: an unavoidable hazard the PC must survive this turn. The engine
  //    resolves the save + damage; the dice/HP drop show as system lines (the
  //    consequence is real even though the narration was already written). ────
  if (plan.danger && pc && !TurnRuntime.isDead(pc)) {
    toolCalls.push("roll_check");
    const res = runtime.execute("roll_check", {
      characterId: pc.id,
      skill: plan.danger.skill,
      dc: plan.danger.dc,
      stakes: true,
      failDamage: plan.danger.damage,
      hazardLevel: plan.danger.hazardLevel ?? undefined,
      hazard: true, // a danger is a physical hazard save — damage is legitimate on any skill
      target: plan.danger.target ?? undefined,
    }) as RollResult;
    if (res.breakdown) {
      engineLines.push(engineContextLine(res));
      emit(rollDisplayLines(res));
    }
  }

  // ── Apply the plan's mechanical intents through the engine (regions I + J):
  //    payout/offers, item use, shop buy/sell, dock repair, patron rest, body-mod,
  //    NPC registration + relations, gear items, scene card, world events, quest
  //    threads, clock advances, scene end, and combatStart. Pure engine calls —
  //    the whole block is unit-tested without a model call (applyPlan.test.ts). ──
  const combatBeforeApply = combat;
  // The engine already applied the consumable up front (chip or typed backstop);
  // drop any useItem the model echoed in its plan so it isn't spent twice.
  if (preAppliedItem && plan.useItem) plan = { ...plan, useItem: undefined };
  const applyCtx: ApplyCtx = { runtime, preState: input.state, pc, emit, toolCalls, lastRoll, combat, reconcile: [] };
  applyPlan(plan, applyCtx);
  combat = applyCtx.combat;

  // ── Engine-first combat opening (COMBAT alignment): the model's explicit
  //    combatStart just spawned the AUTHORITATIVE roster (count clamped to the
  //    net-worth band, names finalized). The narration was written BEFORE that, so
  //    it drifts — the "narrated two guards + a broker, engine placed one Thug" bug.
  //    Re-narrate the opening beat to MATCH the resolved roster exactly (same idiom
  //    as the reroute/roll re-narration above). One extra call, only when a fight
  //    opens this way; the gun-skill reroute already re-narrated with the roster. ──
  if (!combatBeforeApply && combat?.active && plan.combatStart) {
    const roster = combatRoster(combat);
    const openers = engineLines.slice(-2).join("\n"); // "⚔ Combat — …" + any surprise strike
    toolCalls.push("combat_open_realign");
    messages.push({ role: "assistant", content: JSON.stringify({ narration: plan.narration }) });
    messages.push({
      role: "user",
      content: `A fight just broke out. The engine placed EXACTLY these combatants: ${roster}.${openers ? `\n${openers}\nThat opening exchange is the authoritative result — honor it.` : ""}\nRe-narrate the opening beat to match this roster PRECISELY: use these names and this exact count — no more, no fewer, no unnamed extras. 2-3 vivid sentences, present tense; no dice, no options, no new roll. REPLACE your previous narration.`,
    });
    const outcome = await plannedCall(false);
    if (outcome.narration.trim()) narration = outcome.narration;
  }

  // ── Engine-first reconciliation (ITEMS alignment): a mechanical intent the prose
  //    leaned on was DENIED — a heal/item use that failed because the player doesn't
  //    hold it (incl. the model narrating an NPC patching them up from supplies the
  //    player doesn't own — the "Fingers heals you with a medkit you don't have, HP
  //    unchanged" desync). Re-narrate so the beat can't claim an effect that never
  //    happened. Skipped in combat (its own realign owns the prose). ──
  if (applyCtx.reconcile.length && !combat?.active) {
    toolCalls.push("intent_realign");
    messages.push({ role: "assistant", content: JSON.stringify({ narration }) });
    messages.push({
      role: "user",
      content: `The engine did NOT let the following happen:\n${applyCtx.reconcile.map((r) => `- ${r}`).join("\n")}\nRe-narrate this beat so it matches reality — the effect did NOT occur and the player's condition is UNCHANGED. An NPC may OFFER help, refuse, or point elsewhere, but do not describe any healing/recovery or item effect that didn't happen. Keep everything else, REPLACE your previous narration, do not request a roll.`,
    });
    const outcome = await plannedCall(false);
    if (outcome.narration.trim()) narration = outcome.narration;
  }

  // Reconcile the Dock debt thread with the wallet after every money move this
  // turn (repair, a purchase, scene-end wages, a payout) — a payout auto-clears
  // debt, a fresh shortfall opens the payoff loop (ECONOMY E-3).
  if (pc) runtime.syncDockDebt();

  // ── Final cleanup: belt-and-suspenders on the prose, clamp the choices. ────
  // redactMoney scrubs any credit figure the model states in prose — the engine
  // owns every number (real figures only ever ride 💰 system lines).
  narration = redactMoney(stripInlineMenu(narration.trim()));
  if (lastStop === "max_tokens") narration = trimToLastSentence(narration);

  // NPC backstop: register a figure the model forgot to declare ONLY when the
  // narration shows them in EXPLICIT DIALOGUE — a named or role speaker attributed
  // to a line of speech. This is deliberately precise: passing mentions and dialogue
  // CONTENT never create NPCs (an earlier broad name/role scrape turned words like
  // "Clean" from "'Clean. Payout's on the tab.'" into junk NPCs).
  if (!combat) {
    const known = knownEntityNames([
      ...runtime.state.npcs.map((n) => n.name),
      ...runtime.state.locations.map((l) => l.name),
      ...runtime.state.factions.map((f) => f.name),
      ...runtime.state.characters.map((c) => c.name),
      ...(runtime.state.ship ? [runtime.state.ship.name] : []),
      runtime.state.universe.name ?? "",
    ]);
    for (const speaker of extractDialogueNpcs(narration, known)) {
      toolCalls.push("register_npc(dialogue)");
      runtime.registerNpc(
        speaker.handle,
        speaker.role ? `${speaker.handle} the player is dealing with.` : `Spoke with the player.`,
        speaker.role,
      );
    }
    // Presence: mark a known NPC present when the beat clearly puts them in the scene,
    // even if the model forgot to list them — so whoever the player is dealing with
    // shows up in Here & now (the "talking to Soren in his office, but he's in neither
    // proximity bucket" bug). Signals: they SPOKE (dialogue speaker), the scene is set
    // in THEIR space ("Valis's office"), or they're the named actor right before a
    // quote (inferPresentNpcs). A bare off-screen MENTION (a target named as being
    // elsewhere) matches none of these, so it never drags an off-screen figure in.
    const lower = narration.toLowerCase();
    const metPlace = runtime.sceneCard.place?.trim();
    const spokeHandles = extractDialogueNpcs(narration, new Set(), 20).map((s) => s.handle.toLowerCase());
    const impliedPresent = inferPresentNpcs(narration, runtime.sceneCard.place, runtime.sceneCard.situation, runtime.state.npcs);
    for (const n of runtime.state.npcs) {
      const nm = n.name.toLowerCase();
      if (nm.length < 3) continue;
      const named = new RegExp(`\\b${escapeRe(nm)}\\b`).test(lower);
      const spoke = named && spokeHandles.some((h) => nm === h || nm.includes(h) || h.includes(nm));
      if (!spoke && !impliedPresent.has(n.id)) continue;
      runtime.markPresent(n.id);
      // Seed a relationship the FIRST time you actually deal with someone, so the
      // People panel isn't blank for a fixer/fence you've been talking to — the cheap
      // model rarely fills note/relationship for dialogue-introduced NPCs. Only when
      // ABSENT, so a real note the model set is never clobbered.
      if (!runtime.npcRelations[n.id]) {
        // A concrete first-meeting note (who they are + where) beats a bare "crossed
        // paths" line — the People panel's "what you know" reads as real memory.
        const who = n.role ? `the ${n.role}` : "them";
        runtime.updateNpcRelation(n.id, {
          relationship: n.role ? `a ${n.role}` : undefined,
          note: `You first dealt with ${who}${metPlace ? ` at ${metPlace}` : " here"}.`,
        });
      }
    }
    // Keep Here & now live: the cheap model rarely sets scene.situation, so it goes
    // stale. When it didn't set one THIS turn, derive it from the narration.
    if (!plan.scene?.situation?.trim()) runtime.refreshSituation(narration);
  }
  const cap = inTutorial(runtime.state) ? TUTORIAL_CHOICE_COUNT : 4;
  // Checks were resolved up front (resolveChoiceChecks) — tagged or label-inferred
  // verbs already carry their engine-built check into the client chips.
  // When combat begins, its action chips are generated by the route from the
  // fresh CombatState — the model's narrative choices are dropped.
  const choices = plan.sceneEnd || combat ? [] : plan.choices.slice(0, cap);
  if (plan.choices.length) toolCalls.push("offer_choices");

  const exchangeDump =
    rounds > 1 || engineLines.length
      ? [...engineLines, ...rawResponses.map((r, i) => `[RESPONSE ${i + 1}]\n${r}`)].join("\n\n")
      : "";

  return {
    narration,
    choices,
    combat,
    engineLines: emitted,
    state: runtime.state,
    events: runtime.events,
    worldEvents: runtime.worldEvents,
    sceneEnded: runtime.sceneEndReport !== null,
    sceneTitle:
      runtime.sceneEndReport === null ? null : plan.sceneEnd?.title?.trim() || "The scene moves on",
    focusIds: retrieved.namedNpcIds,
    tutorialGraduated: graduatedTutorialThisTurn(input.state, runtime.state),
    model: activeModel,
    promptDump,
    exchangeDump,
    usage,
    telemetry: {
      latencyMs: Date.now() - startedAt,
      rounds,
      toolCalls,
      stopReason: lastStop,
      fellBack,
      systemChars: system.reduce((n, b) => n + b.text.length, 0),
    },
  };
}
