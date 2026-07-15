import Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import { liveRng, computeModifier, type RNG, type EngineEvent } from "@/engine";
import { TurnRuntime } from "./engineBridge";
import { buildJsonSystem, buildContextSlice, retrieveEntities } from "./promptBuilder";
import { deepseekChat, deepseekChatStream, isDeepSeekModel, resolveModel } from "./deepseek";
import { sanitizeHistory, trimToLastSentence } from "./narrator";
import { NarrationExtractor } from "./jsonStream";
import {
  parseTurnPlan,
  repairTurnPlan,
  REPAIR_FALLBACK_NARRATION,
  type TurnPlan,
  type CheckSpec,
  type ChoiceOption,
} from "@/shared/turnPlan";
import { SCENE_TURN_CAP, type SceneCard, type NpcRelations, type SceneMemory } from "@/shared/scene";
import { checkFromVerb, verbFromLabel, verbRolls } from "@/shared/actions";
import { dcForRisk, difficultyToRisk, type RiskTier } from "@/shared/risk";
import type { Character } from "@/shared/schemas";
import { extractDialogueNpcs, knownEntityNames, isPlausibleNpcName } from "@/shared/npcExtract";
import { playerThreatTier, clampTier } from "@/shared/netWorth";
import type { CombatState } from "@/shared/combat";
import type { Dossier } from "@/shared/multiplayer";
import type { SpawnSpec, ShipClass } from "@/engine/combatEngine";
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

/** Default enemy ship class when the model gives only a tier for a ship fight. */
const TIER_TO_CLASS: Record<"T1" | "T2" | "T3", string> = { T1: "scout", T2: "fighter", T3: "gunship" };

/** Gun skills are acts of violence, not skill checks — invoking one opens a
 *  fight (see openFightFromSkill). smallArms → on-foot, gunnery → ship. */
const COMBAT_SKILLS = new Set(["smallArms", "gunnery"]);

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

/** A bare gun-skill check carries only a rough DC; read it as enemy toughness. */
function dcToTier(dc: number): "T1" | "T2" | "T3" {
  return dc >= 17 ? "T3" : dc >= 13 ? "T2" : "T1";
}

const FOE_NOUNS =
  "wrecker|guard|enforcer|goon|thug|mook|raider|soldier|merc|mercenary|gunman|gunhand|pirate|hostile|" +
  "attacker|assailant|cutter|heavy|heavies|bruiser|bandit|trooper|sentry|marauder|tough|brute|hitman|fighter|foe";
const FOE_NUM: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, couple: 2, pair: 2, few: 3, several: 4, handful: 4,
};
const FOE_COUNT_RE = new RegExp(
  `\\b(\\d+|two|three|four|five|couple|pair|few|several|handful)\\s+(?:\\w+\\s+){0,2}?(?:${FOE_NOUNS})s?\\b`,
  "gi",
);

/** How many foes the narration says are attacking ("two wreckers", "a couple of
 *  thugs", "3 guards"). The engine uses this to force the spawn to MATCH the fiction
 *  when the model under-fills combatStart (narrates two, spawns one). Capped at 5,
 *  0 when nothing is stated. */
function narratedFoeCount(narration: string): number {
  let max = 0;
  let m: RegExpExecArray | null;
  FOE_COUNT_RE.lastIndex = 0;
  while ((m = FOE_COUNT_RE.exec(narration)) !== null) {
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : FOE_NUM[m[1].toLowerCase()] ?? 0;
    if (n > max) max = n;
  }
  return Math.min(max, 5);
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
  // reroute it into the combat engine — spawn the target (you drew first, so a
  // surprise edge) and resolve the OPENING SHOT (roll-to-hit → damage), then the
  // beat continues as normal multi-turn combat. This guarantees gun skills run
  // through real attack/AC/damage math instead of a self-only roll_check.
  function openFightFromSkill(skill: string, dc: number): CombatState | null {
    // Net-worth ceiling: a gun-skill reroute never spawns tougher than the player's
    // band (an under-equipped rookie faces T1, not a professional).
    const tier = clampTier(dcToTier(dc), playerThreatTier(input.state));
    const useShip = skill === "gunnery" && !!input.state.ship;
    const started = useShip
      ? runtime.startShipCombat([{ shipClass: TIER_TO_CLASS[tier] as ShipClass, count: 1, tier }], "player")
      : runtime.startCombat([{ tier, count: 1 }] as SpawnSpec[], "player");
    const lines = [...started.lines];
    let cbt = started.combat;
    const firstEnemy = cbt.enemies.find((e) => e.hp > 0);
    if (cbt.active && firstEnemy) {
      const round = runtime.resolveCombatRound(cbt, { type: "attack", enemyId: firstEnemy.id });
      lines.push(...round.lines);
      cbt = round.combat;
    }
    engineLines.push(`ENGINE RESULT: ${lines.join(" · ")}`);
    emit(lines);
    return cbt.active ? cbt : null;
  }

  // The clicked check's skill: verb-derived when tagged (engine owns the mapping),
  // else the explicit skill. A check with neither is skipped (nothing to roll).
  const preVerb = input.preCheck?.verb ? checkFromVerb(input.preCheck.verb) : null;
  const preSkill = preVerb?.skill ?? input.preCheck?.skill ?? null;
  if (input.preCheck && preSkill && pc) {
    if (COMBAT_SKILLS.has(preSkill)) {
      toolCalls.push("combat_start");
      combat = openFightFromSkill(preSkill, input.preCheck.dc);
    } else {
      toolCalls.push("roll_check");
      const res = runtime.execute("roll_check", {
        characterId: pc.id,
        skill: preSkill,
        dc: input.preCheck.dc,
        stakes: input.preCheck.stakes,
        failDamage: input.preCheck.failDamage,
        hazardLevel: input.preCheck.hazardLevel ?? preVerb?.hazardLevel,
        target: input.preCheck.target ?? undefined,
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

  // A clicked "Use X" consumable chip: the engine applies the item DETERMINISTICALLY
  // (never depends on the model firing useItem — the medkit-that-did-nothing bug),
  // and the resulting line rides engineLines so the model narrates around it.
  if (input.preUseItem && pc) {
    toolCalls.push("use_item");
    const res = runtime.useItem(input.preUseItem, pc.id) as { line?: string; error?: string };
    if (res.line) {
      engineLines.push(`ENGINE RESULT: ${res.line}`);
      emit([res.line]);
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
  if (!input.preCheck && wantsCheck(plan)) {
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
  if (plan.roll && rollSkill && !input.preCheck && !input.fromChoice && pc && !combat && COMBAT_SKILLS.has(rollSkill)) {
    toolCalls.push("combat_start");
    combat = openFightFromSkill(rollSkill, plan.roll.dc);
    // The narration above described the player's INTENT and was written BEFORE the
    // engine resolved the opening exchange — which may have MISSED and hurt/downed
    // them. Re-narrate from the real result so the prose can't claim a kill the dice
    // denied (the reported "guard I'd killed came back and shot me" desync). Engine
    // lines are already shown; the client commits this replacement on `done`.
    const openingLine = engineLines[engineLines.length - 1];
    if (openingLine) {
      messages.push({ role: "assistant", content: JSON.stringify({ narration: plan.narration }) });
      messages.push({
        role: "user",
        content: `${openingLine}\nThat is the ACTUAL outcome of the opening exchange — the dice are authoritative. Re-narrate THIS beat to match it, REPLACING your previous narration.${outcomeDirective(openingLine)} Do not request another roll.`,
      });
      const outcome = await plannedCall(false);
      if (outcome.narration.trim()) {
        narration = outcome.narration;
        plan = { ...outcome, narration };
      }
    }
  } else if (plan.roll && rollSkill && !input.preCheck && !input.fromChoice && pc && !combat) {
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

  // ── Apply the plan's mechanical intents through the engine. ────────────────
  // A successful negotiation THIS turn shades money to the upper half of the
  // band (a failed one to the lower) — shared by both payouts and offers.
  const negotiationMood: "high" | "low" | undefined =
    lastRoll?.skill === "negotiation"
      ? lastRoll.outcome === "success"
        ? "high"
        : "low"
      : undefined;
  if (plan.payout && pc) {
    toolCalls.push("award_payout");
    const res = runtime.execute("award_payout", {
      tier: plan.payout.tier,
      reason: plan.payout.reason,
      mood: negotiationMood,
    }) as { amount?: number; tier?: string; error?: string };
    if (res.amount) emit([`💰 Payment: +¢${res.amount} (${plan.payout.tier})`]);
  }
  // OFFERS: bids/quotes the model presented (a job's pay, a rival buyer's counter).
  // The model names a TIER; the engine rolls the bounded figure and shows it as a
  // system line — the real number the player sees, never a re-call to the model.
  if (plan.offers?.length) {
    const offerLines: string[] = [];
    for (const offer of plan.offers.slice(0, 3)) {
      const amount = runtime.quoteOffer(offer.tier, negotiationMood);
      if (amount != null) offerLines.push(`💰 ${offer.from?.trim() || "Offer"}: ~¢${amount}`);
    }
    if (offerLines.length) {
      toolCalls.push("quote_offer");
      emit(offerLines);
    }
  }
  if (plan.useItem && pc) {
    toolCalls.push("use_item");
    const res = runtime.useItem(plan.useItem.itemId, pc.id) as { line?: string; error?: string };
    if (res.line) emit([res.line]);
    // Failed use (e.g. the model thinks they hold an item they don't) must be
    // VISIBLE — otherwise the narration claims a heal that never happened.
    else if (res.error) emit([`⚠ Can't use item: ${res.error}`]);
  }
  // Shop transactions (ITEMS.md slice E) — the engine owns the whole exchange:
  // shelf check, rep-adjusted price, credits, pack space. Failures are visible
  // for the same reason as useItem: a narrated deal that didn't happen must not
  // pass silently.
  if (plan.purchase && pc) {
    toolCalls.push("buy_item");
    const res = runtime.buyItem(plan.purchase.itemId, plan.purchase.qty ?? 1);
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ No sale: ${res.error}`]);
  }
  if (plan.sell && pc) {
    toolCalls.push("sell_item");
    const res = runtime.sellItem(plan.sell.name);
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ No sale: ${res.error}`]);
  }
  // Dock repair (ECONOMY E-3) — model-initiated ("patch me up at the dock").
  if (plan.repair && pc) {
    toolCalls.push("repair_ship");
    const res = runtime.repairShip(plan.repair.hp ?? undefined);
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ ${res.error}`]);
  }
  // Rook body-modification (Chrome's studio) — reshape appearance + story for ¢500.
  if (plan.bodyMod && pc) {
    toolCalls.push("body_mod");
    const res = runtime.bodyMod({
      appearance: plan.bodyMod.appearance ?? undefined,
      story: plan.bodyMod.story ?? undefined,
    });
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ ${res.error}`]);
  }
  // Persist any named NPCs the narrator introduced so the world remembers them
  // (continuity — recognized when the player returns), mark them present in the
  // scene, and apply relationship updates (disposition nudge / last-note / tie).
  if (plan.npcs?.length) {
    // A cheap narrator dumps junk into npcs — sentence fragments ("End", "You're"),
    // the ship's name, even the CHOICE VERBS ("Scavenge", "Search", "Tend"). Two
    // gates keep the cast clean: (1) a stopword / non-person-entity guard, and
    // (2) the name must actually appear in THIS turn's prose — a real figure is
    // named in the story; a choice verb or hallucinated label is not.
    const nonPersons = knownEntityNames([
      ...(runtime.state.ship ? [runtime.state.ship.name] : []),
      ...runtime.state.locations.map((l) => l.name),
      ...runtime.state.factions.map((f) => f.name),
    ]);
    const narrationText = plan.narration ?? "";
    for (const npc of plan.npcs.slice(0, 4)) {
      const nm = npc.name?.trim();
      if (!nm || !isPlausibleNpcName(nm, nonPersons)) continue;
      const bare = nm.replace(/['’]s$/i, "");
      if (!narrationText.includes(nm) && !narrationText.includes(bare)) continue;
      toolCalls.push("register_npc");
      const { id } = runtime.registerNpc(npc.name, npc.oneBreath ?? undefined);
      runtime.markPresent(id);
      const rel = runtime.updateNpcRelation(id, {
        disposition: npc.disposition ?? undefined,
        note: npc.note ?? undefined,
        relationship: npc.relationship ?? undefined,
      });
      if (rel.line) emit([rel.line]); // D-4: standing changes are visible, like ticks
    }
  }
  // Narrative item pickups/losses → real gear entries (persist in state/context).
  if (plan.items?.length) {
    for (const it of plan.items.slice(0, 4)) {
      toolCalls.push("gear_change");
      const line = runtime.applyGearChange(it.name, it.action ?? "gain", it.note ?? undefined);
      if (line) emit([line]);
    }
  }
  // Scene-card proposal: situation/place/dangers overwrite, beats append.
  if (plan.scene) {
    runtime.updateScene(
      plan.scene.situation ?? undefined,
      plan.scene.beats ?? undefined,
      plan.scene.place ?? undefined,
      plan.scene.dangers ?? undefined,
    );
  }
  if (plan.worldEvent) {
    toolCalls.push("log_world_event");
    runtime.execute("log_world_event", {
      headline: plan.worldEvent.headline,
      detail: plan.worldEvent.detail,
      factionIds: plan.worldEvent.factionIds,
    });
  }
  for (const adv of plan.clockAdvances) {
    toolCalls.push("advance_clock");
    runtime.execute("advance_clock", adv as unknown as Record<string, unknown>);
  }
  if (plan.sceneEnd && !plan.combatStart) {
    toolCalls.push("end_scene");
    runtime.execute("end_scene", plan.sceneEnd as Record<string, unknown>);
  } else if (
    !plan.combatStart &&
    runtime.sceneCard.turnCount >= SCENE_TURN_CAP &&
    runtime.sceneEndReport === null
  ) {
    // Auto-close backstop (CONTINUITY D-1): DeepSeek under-fires sceneEnd; without
    // a boundary the summary tier never activates. Force one after the cap.
    toolCalls.push("end_scene(auto)");
    runtime.execute("end_scene", { title: "The scene moves on" });
  }

  // ── Combat begins: the engine spawns enemies and takes over next turn.
  //    (Skipped if a gun-skill reroute already started the fight this turn.) ──
  if (plan.combatStart && pc && !combat) {
    toolCalls.push("combat_start");
    const cs = plan.combatStart;
    const surprise = cs.surprise ?? "none";
    // Ship-scale stays single-group (one enemy vessel/wolfpack); personal scale can
    // field several distinct foes/groups (a boss + his heavies) via cs.enemies.
    let started;
    if (cs.scale === "ship" && input.state.ship) {
      started = runtime.startShipCombat(
        [
          {
            shipClass: (cs.shipClass ?? TIER_TO_CLASS[cs.tier]) as ShipClass,
            count: cs.count ?? undefined,
            name: cs.name ?? undefined,
            tier: cs.tier,
          },
        ],
        surprise,
      );
    } else {
      // enemies[] when the model listed distinct foes; else the legacy single group.
      // Cap the TOTAL spawned at 5 (deterministic: clamp each group 1-4, then trim
      // group counts in order until the running total hits 5, dropping any overflow)
      // so a fight can't balloon regardless of what the model asks for.
      // Net-worth ceiling: clamp each GENERAL group's tier to what the player's
      // wealth/gear unlocks (a rookie faces T1, not T2). A `major` boss may exceed
      // the band as a flagged set-piece, so it's left alone.
      const ceiling = playerThreatTier(input.state);
      const rawGroups: SpawnSpec[] =
        cs.enemies?.length
          ? cs.enemies.map((g) => ({
              tier: g.major ? g.tier : clampTier(g.tier, ceiling),
              count: g.count ?? undefined,
              name: g.name ?? undefined,
              major: g.major ?? undefined, // named boss → engine gives 1.8× HP
            }))
          : [{ tier: clampTier(cs.tier, ceiling), count: cs.count ?? undefined, name: cs.name ?? undefined }];
      const MAX_TOTAL = 5;
      const specs: SpawnSpec[] = [];
      let total = 0;
      for (const g of rawGroups) {
        if (total >= MAX_TOTAL) break;
        const want = Math.max(1, Math.min(4, g.count ?? 1));
        const take = Math.min(want, MAX_TOTAL - total);
        specs.push({ tier: g.tier, count: take, name: g.name, major: g.major });
        total += take;
      }
      // Count backstop: the model narrated N foes but under-filled the spawn ("two
      // wreckers, one spawned"). Top up to match the narrated count (cap 5).
      let need = Math.min(narratedFoeCount(plan.narration), MAX_TOTAL) - total;
      for (const s of specs) {
        if (need <= 0) break;
        const room = 4 - (s.count ?? 1);
        const add = Math.min(room, need);
        s.count = (s.count ?? 1) + add;
        need -= add;
      }
      if (need > 0 && specs.length) specs.push({ tier: specs[0].tier, count: need, name: specs[0].name });
      started = runtime.startCombat(specs, surprise);
    }
    combat = started.combat.active ? started.combat : null; // a surprise volley could end it instantly
    if (started.lines.length) emit(started.lines);
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
    // Presence: mark present ANY known NPC actually named in THIS narration — so
    // whoever the player is dealing with (new, or continuing after a scene reset)
    // shows up in Here & now, not just the ones the model remembered to list.
    const lower = narration.toLowerCase();
    const metPlace = runtime.sceneCard.place?.trim();
    for (const n of runtime.state.npcs) {
      const nm = n.name.toLowerCase();
      if (nm.length < 3) continue;
      const re = new RegExp(`\\b${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (!re.test(lower)) continue;
      runtime.markPresent(n.id);
      // Seed a relationship the FIRST time you actually deal with someone, so the
      // People panel isn't blank for a fixer/fence you've been talking to — the cheap
      // model rarely fills note/relationship for dialogue-introduced NPCs. Only when
      // ABSENT, so a real note the model set is never clobbered.
      if (!runtime.npcRelations[n.id]) {
        runtime.updateNpcRelation(n.id, {
          relationship: n.role ? `a ${n.role}` : undefined,
          note: metPlace ? `First crossed paths at ${metPlace}.` : "First crossed paths with you.",
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
