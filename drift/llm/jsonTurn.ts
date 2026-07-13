import Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import { liveRng, type RNG, type EngineEvent } from "@/engine";
import { TurnRuntime } from "./engineBridge";
import { buildJsonSystem, buildContextSlice, retrieveEntities } from "./promptBuilder";
import { deepseekChat, deepseekChatStream, isDeepSeekModel, resolveModel } from "./deepseek";
import { sanitizeHistory, trimToLastSentence } from "./narrator";
import { NarrationExtractor } from "./jsonStream";
import { parseTurnPlan, repairTurnPlan, type TurnPlan, type CheckSpec, type ChoiceOption } from "@/shared/turnPlan";
import type { CombatState } from "@/shared/combat";
import type { SpawnSpec } from "@/engine/combatEngine";
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
  focusIds?: string[];
  /** Shared per-scene tick-cap set ("charId:skill"); mutated in place. */
  tickedSet?: Set<string>;
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

/** JSON envelope + a ~90-word narration fits comfortably; the prose budget is
 *  enforced by the prompt (the 450-token spirit), the envelope needs headroom. */
const JSON_MAX_TOKENS = 600;

function defaultModel(): string {
  return resolveModel(process.env.NARRATOR_MODEL ?? "deepseek-chat");
}

type RollResult = {
  breakdown?: string;
  tick?: string;
  outcome?: string;
  damage?: number;
  downed?: boolean;
  died?: boolean;
  error?: string;
};

/** Player-facing lines (dice → tick → damage), pre-prefixed for display. */
function rollDisplayLines(res: RollResult): string[] {
  const lines: string[] = [];
  if (res.breakdown) lines.push(`🎲 ${res.breakdown}`);
  if (res.tick) lines.push(`⬆ ${res.tick}`);
  if (res.damage) {
    lines.push(`💥 Took ${res.damage} damage${res.died ? " — KILLED" : res.downed ? " — DOWNED" : ""}`);
  }
  return lines;
}

/** One compact line summarizing a roll for the model's context. */
function engineContextLine(res: RollResult): string {
  const dmg = res.damage
    ? ` · ${res.damage} damage${res.died ? " (KILLED)" : res.downed ? " (DOWNED)" : ""}`
    : "";
  return `ENGINE RESULT: ${res.breakdown ?? ""}${res.tick ? ` · ${res.tick}` : ""}${dmg}`;
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
  });
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
  if (input.preCheck && pc) {
    toolCalls.push("roll_check");
    const res = runtime.execute("roll_check", {
      characterId: pc.id,
      skill: input.preCheck.skill,
      dc: input.preCheck.dc,
      stakes: input.preCheck.stakes,
      failDamage: input.preCheck.failDamage,
    }) as RollResult;
    if (res.breakdown) {
      lastRoll = { skill: input.preCheck.skill, outcome: res.outcome };
      engineLines.push(engineContextLine(res));
      emit(rollDisplayLines(res));
    }
  }

  // ── Prompt assembly ─────────────────────────────────────────────────────────
  const system = buildJsonSystem(input.state);
  const retrieved = retrieveEntities(input.state, input.playerText, input.focusIds);
  const contextSlice = buildContextSlice(input.state, input.playerText, input.focusIds, retrieved, true);
  const messages: Anthropic.MessageParam[] = [
    ...sanitizeHistory(input.history),
    {
      role: "user",
      content:
        `${contextSlice}\n\n---\nPLAYER: ${input.playerText}` +
        (engineLines.length ? `\n${engineLines.join("\n")}\nNarrate this result — do not request another roll.` : ""),
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
    return second.plan ?? repairTurnPlan(raw2 || raw);
  }

  let plan = await plannedCall(true);
  let narration = plan.narration;

  // ── Mid-turn roll: the model says the CURRENT action needs a check. ────────
  if (plan.roll && !input.preCheck && pc) {
    toolCalls.push("roll_check");
    const res = runtime.execute("roll_check", {
      characterId: pc.id,
      skill: plan.roll.skill,
      dc: plan.roll.dc,
      stakes: plan.roll.stakes,
      failDamage: plan.roll.failDamage,
    }) as RollResult;
    if (res.breakdown) {
      lastRoll = { skill: plan.roll.skill, outcome: res.outcome };
      emit(rollDisplayLines(res));
      messages.push({ role: "assistant", content: JSON.stringify({ narration: plan.narration }) });
      messages.push({
        role: "user",
        content: `${engineContextLine(res)}\nNarrate the outcome of this roll and provide choices. Do not request another roll.`,
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
  }

  // ── Combat begins: the engine spawns enemies and takes over next turn. ─────
  let combat: CombatState | null = null;
  if (plan.combatStart && pc) {
    toolCalls.push("combat_start");
    const cs = plan.combatStart;
    const specs: SpawnSpec[] = [{ tier: cs.tier, count: cs.count ?? undefined, name: cs.name ?? undefined }];
    // Ship-scale combat is not built yet — resolve everything as personal for v1.
    const started = runtime.startCombat(specs, "personal", cs.surprise ?? "none");
    combat = started.combat.active ? started.combat : null; // a surprise volley could end it instantly
    if (started.lines.length) emit(started.lines);
  }

  // ── Final cleanup: belt-and-suspenders on the prose, clamp the choices. ────
  narration = stripInlineMenu(narration.trim());
  if (lastStop === "max_tokens") narration = trimToLastSentence(narration);
  const cap = inTutorial(runtime.state) ? TUTORIAL_CHOICE_COUNT : 4;
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
