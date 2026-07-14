import Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import { liveRng, type RNG, type EngineEvent } from "@/engine";
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
import { extractNpcNames, extractRoleNpcs, knownEntityNames, isPlausibleNpcName } from "@/shared/npcExtract";
import type { CombatState } from "@/shared/combat";
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

/**
 * Resolve every choice's check from its verb — the model's tag when present,
 * else INFERRED from the label's leading words ("Search the lockers" → loot).
 * The engine owns skill selection either way; untagged non-attempt labels stay
 * plain. This also makes the check badge deterministic on the client.
 */
function resolveChoiceChecks(choices: TurnPlan["choices"]): TurnPlan["choices"] {
  return choices.map((c) => {
    if (c.check) return c;
    const verb = c.verb ?? verbFromLabel(c.label);
    if (!verb) return c;
    const built = checkFromVerb(verb, c.difficulty ?? undefined);
    if (!built) return { ...c, verb }; // free verb — stays check-free
    return {
      ...c,
      verb,
      check: { skill: built.skill, dc: built.dc, stakes: built.stakes, hazardLevel: built.hazardLevel },
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
    const tier = dcToTier(dc);
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
        loot: preVerb?.loot,
      }) as RollResult;
      if (res.breakdown) {
        lastRoll = { skill: preSkill, outcome: res.outcome };
        engineLines.push(engineContextLine(res));
        emit(rollDisplayLines(res));
      }
    }
  }

  // ── Prompt assembly ─────────────────────────────────────────────────────────
  const system = buildJsonSystem(input.state);
  // NPCs present in the CURRENT SCENE ride retrieval every turn — no re-naming
  // needed for someone standing in the room (CONTINUITY tier NOW).
  const focusWithPresent = [...new Set([...(input.focusIds ?? []), ...runtime.sceneCard.presentNpcIds])];
  const retrieved = retrieveEntities(input.state, input.playerText, focusWithPresent);
  const contextSlice = buildContextSlice(input.state, input.playerText, focusWithPresent, retrieved, true, {
    sceneCard: runtime.sceneCard,
    npcRelations: runtime.npcRelations,
    recentScenes: input.recentScenes ?? [],
  });
  const messages: Anthropic.MessageParam[] = [
    ...sanitizeHistory(input.history),
    {
      role: "user",
      content:
        `${contextSlice}\n\n---\nPLAYER: ${input.playerText}` +
        (engineLines.length
          ? `\n${engineLines.join("\n")}\nNarrate this result. If the engine dealt DAMAGE or a CRITICAL FAILURE, show concretely HOW it went wrong and how they got hurt. Do not request another roll.`
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
  plan = { ...plan, choices: resolveChoiceChecks(plan.choices) };

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
    if (retry.choices.length) plan = { ...retry, choices: resolveChoiceChecks(retry.choices) };
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
      loot: rollVerb?.loot,
    }) as RollResult;
    if (res.breakdown) {
      lastRoll = { skill: rollSkill, outcome: res.outcome };
      emit(rollDisplayLines(res));
      messages.push({ role: "assistant", content: JSON.stringify({ narration: plan.narration }) });
      messages.push({
        role: "user",
        content: `${engineContextLine(res)}\nNarrate the outcome and provide choices. If damage or a critical failure landed, show HOW it went wrong and how they got hurt. Do not request another roll.`,
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
  if (plan.payout && pc) {
    toolCalls.push("award_payout");
    const mood =
      lastRoll?.skill === "negotiation"
        ? lastRoll.outcome === "success"
          ? "high"
          : "low"
        : undefined;
    const res = runtime.execute("award_payout", {
      tier: plan.payout.tier,
      reason: plan.payout.reason,
      mood,
    }) as { amount?: number; tier?: string; error?: string };
    if (res.amount) emit([`💰 Payment: +¢${res.amount} (${plan.payout.tier})`]);
  }
  if (plan.useItem && pc) {
    toolCalls.push("use_item");
    const res = runtime.useItem(plan.useItem.itemId, pc.id) as { line?: string; error?: string };
    if (res.line) emit([res.line]);
    // Failed use (e.g. the model thinks they hold an item they don't) must be
    // VISIBLE — otherwise the narration claims a heal that never happened.
    else if (res.error) emit([`⚠ Can't use item: ${res.error}`]);
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
    // Ship-scale needs a ship to fly; otherwise resolve on foot.
    const started =
      cs.scale === "ship" && input.state.ship
        ? runtime.startShipCombat(
            [
              {
                shipClass: (cs.shipClass ?? TIER_TO_CLASS[cs.tier]) as ShipClass,
                count: cs.count ?? undefined,
                name: cs.name ?? undefined,
                tier: cs.tier,
              },
            ],
            surprise,
          )
        : runtime.startCombat(
            [{ tier: cs.tier, count: cs.count ?? undefined, name: cs.name ?? undefined }] as SpawnSpec[],
            surprise,
          );
    combat = started.combat.active ? started.combat : null; // a surprise volley could end it instantly
    if (started.lines.length) emit(started.lines);
  }

  // ── Final cleanup: belt-and-suspenders on the prose, clamp the choices. ────
  narration = stripInlineMenu(narration.trim());
  if (lastStop === "max_tokens") narration = trimToLastSentence(narration);

  // NPC backstop: register named figures the narrator mentioned but forgot to
  // declare (Eddie's un-tracked "wrecker woman") so the scene's cast is complete
  // in Here & now. Filtered hard against everything already known.
  if (!combat) {
    const known = knownEntityNames([
      ...runtime.state.npcs.map((n) => n.name),
      ...runtime.state.locations.map((l) => l.name),
      ...runtime.state.factions.map((f) => f.name),
      ...runtime.state.characters.map((c) => c.name),
      ...(runtime.state.ship ? [runtime.state.ship.name] : []),
      runtime.state.universe.name ?? "",
    ]);
    for (const name of extractNpcNames(narration, known)) {
      toolCalls.push("register_npc(auto)");
      runtime.registerNpc(name, `Mentioned in the scene.`);
    }
    // Role backstop: register unnamed occupational figures ("the fixer", "the data
    // broker") so whoever the player is actually dealing with appears in the scene,
    // even before they get a name. Filter only against NON-person entities (ship,
    // locations, factions) so an existing role NPC still resolves + re-marks below.
    const nonPersons = knownEntityNames([
      ...runtime.state.locations.map((l) => l.name),
      ...runtime.state.factions.map((f) => f.name),
      ...(runtime.state.ship ? [runtime.state.ship.name] : []),
    ]);
    for (const handle of extractRoleNpcs(narration, nonPersons)) {
      toolCalls.push("register_npc(role)");
      runtime.registerNpc(handle, `${handle} the player is dealing with.`);
    }
    // Presence: mark present ANY known NPC actually named in THIS narration — so
    // whoever the player is dealing with (new, or continuing after a scene reset)
    // shows up in Here & now, not just the ones the model remembered to list.
    const lower = narration.toLowerCase();
    for (const n of runtime.state.npcs) {
      const nm = n.name.toLowerCase();
      if (nm.length < 3) continue;
      const re = new RegExp(`\\b${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (re.test(lower)) runtime.markPresent(n.id);
    }
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
