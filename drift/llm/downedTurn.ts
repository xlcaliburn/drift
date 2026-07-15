import Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import { liveRng, type RNG, type EngineEvent } from "@/engine";
import { usableConsumables } from "@/shared/items";
import { downedActions, interpretDownedText, type DownedAction } from "@/shared/death";
import { TurnRuntime } from "./engineBridge";
import { deepseekChat, deepseekChatStream, isDeepSeekModel, resolveModel } from "./deepseek";
import { sanitizeHistory } from "./history";
import { stripInlineMenu } from "@/shared/narration";
import type { ChoiceOption } from "@/shared/turnPlan";
import { graduatedTutorialThisTurn } from "@/shared/tutorial";
import type { NpcRelations, SceneCard } from "@/shared/scene";

/**
 * Bleeding Out turn handler (COMBAT.md). While the PC is Downed, the fight is
 * ENGINE-OWNED exactly like combat: the engine resolves the death save from the
 * player's desperate act, and the model only narrates the already-decided beat.
 * The chips are engine-generated (death.ts), so a cheap model can't wander a
 * life-or-death moment. Recovery / stabilise / death are all decided here.
 */

export interface DownedTurnInput {
  state: CampaignState;
  history: Anthropic.MessageParam[];
  /** A clicked Bleeding Out chip's action, or undefined → interpret playerText. */
  downedAction?: DownedAction;
  playerText?: string;
  sceneCard: SceneCard;
  npcRelations: NpcRelations;
  tickedSet?: Set<string>;
  model?: string;
  rng?: RNG;
  apiKey?: string;
  onDelta?: (text: string) => void;
  onEngine?: (lines: string[]) => void;
}

export interface DownedTurnResult {
  narration: string;
  choices: ChoiceOption[];
  combat: null;
  engineLines: string[];
  /** Terminal (dead) or scene-closing (stabilised/recovered) signals for the route. */
  outcome: "continue" | "stabilized" | "dead" | "recovered";
  state: CampaignState;
  events: EngineEvent[];
  worldEvents: TurnRuntime["worldEvents"];
  sceneEnded: boolean;
  sceneTitle: string | null;
  focusIds: string[];
  tutorialGraduated: boolean;
  model: string;
  promptDump: string;
  exchangeDump: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  telemetry: { latencyMs: number; rounds: number; toolCalls: string[]; stopReason: string; fellBack: boolean; systemChars: number };
}

const DOWNED_SYSTEM = `You are the DM narrating ONE beat of a character BLEEDING OUT — down, maybe seconds from death, clinging on. You are given the ENGINE RESULT of their desperate effort (a death save, a stim jammed home, stabilising, or dying). Write 2-3 raw, close, present-tense sentences from that result — the taste of blood, the cold, the edges going grey, hands that won't obey. Honor the result EXACTLY: never invent a recovery, a rescue, or a death the result doesn't show. Do NOT list options, ask questions, or write dice notation. Just the struggle.`;

export async function runDownedTurn(input: DownedTurnInput): Promise<DownedTurnResult> {
  const model = resolveModel(input.model ?? resolveModel(process.env.NARRATOR_MODEL ?? "deepseek-v4-flash"));
  let activeModel = model;
  let fellBack = false;
  const startedAt = Date.now();
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  const runtime = new TurnRuntime(input.state, input.rng ?? liveRng, { tickedThisScene: input.tickedSet });

  // Pressure: is someone hostile standing over you, or a live hazard in the scene?
  const hostilePresent = input.sceneCard.presentNpcIds.some(
    (id) => (input.npcRelations[id]?.disposition ?? 0) <= -2,
  );
  const hazardPresent = (input.sceneCard.dangers ?? []).length > 0;

  // 1. Resolve the death save in the engine (chip action wins; else read the text).
  const action = input.downedAction ?? interpretDownedText(input.playerText ?? "");
  const { lines, outcome } = runtime.resolveDeathSave(action, { hostilePresent, hazardPresent });
  input.onEngine?.(lines);

  const pc = runtime.state.characters.find((c) => c.kind === "pc");

  // 2. Narrate the beat from the engine result (model narrates only).
  const status =
    outcome === "dead"
      ? "They have died."
      : outcome === "stabilized" || outcome === "recovered"
        ? "They pull through — alive, barely."
        : "Still down, still fighting to stay conscious.";
  const messages: Anthropic.MessageParam[] = [
    ...sanitizeHistory(input.history),
    { role: "user", content: `BLEEDING OUT — ENGINE RESULT:\n${lines.join("\n")}\n\n${status}\nNarrate this beat.` },
  ];
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: DOWNED_SYSTEM }];
  const promptDump = `=== SYSTEM ===\n${DOWNED_SYSTEM}\n\n=== ENGINE ===\n${lines.join("\n")}\n${status}`;

  let raw = "";
  let stopReason = "end_turn";
  try {
    if (isDeepSeekModel(activeModel)) {
      const params = { model: activeModel, maxTokens: 800, system, messages };
      const resp = input.onDelta
        ? await deepseekChatStream({ ...params, onDelta: (t) => input.onDelta!(t) })
        : await deepseekChat(params);
      usage.inputTokens += resp.usage.input_tokens;
      usage.outputTokens += resp.usage.output_tokens;
      usage.cacheReadTokens += resp.usage.cache_read_input_tokens;
      stopReason = resp.stop_reason;
      raw = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    } else {
      const anthropic = new Anthropic({ apiKey: input.apiKey ?? process.env.ANTHROPIC_API_KEY });
      const resp = await anthropic.messages.create({ model: activeModel, max_tokens: 300, system, messages });
      usage.inputTokens += resp.usage.input_tokens;
      usage.outputTokens += resp.usage.output_tokens;
      stopReason = resp.stop_reason ?? "end_turn";
      raw = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    }
  } catch (err) {
    if (isDeepSeekModel(activeModel) && process.env.ANTHROPIC_API_KEY) fellBack = true;
    console.error("[downedTurn] narration failed:", err instanceof Error ? err.message : err);
    raw = status;
  }
  const narration = stripInlineMenu(raw.trim()) || status;

  // 3. Chips: still down → the desperate-act menu; recovered/stabilised → the
  //    route supplies fresh next moves; dead → none.
  const stillDown = outcome === "continue";
  const consumables = pc ? usableConsumables(pc, "personal") : [];
  const allyPresent = input.sceneCard.presentNpcIds.some(
    (id) => (input.npcRelations[id]?.disposition ?? 0) >= 1,
  );
  const choices: ChoiceOption[] = stillDown ? downedActions(consumables, allyPresent) : [];

  return {
    narration,
    choices,
    combat: null,
    engineLines: lines,
    outcome,
    state: runtime.state,
    events: runtime.events,
    worldEvents: runtime.worldEvents,
    // A pull-through (stabilise / self-rescue / rally) closes the Bleeding Out
    // scene; death is handled by the route's terminal path.
    sceneEnded: outcome === "stabilized" || outcome === "recovered",
    sceneTitle: outcome === "stabilized" || outcome === "recovered" ? "Bleeding out" : null,
    focusIds: [],
    tutorialGraduated: graduatedTutorialThisTurn(input.state, runtime.state),
    model: activeModel,
    promptDump,
    exchangeDump: [...lines, `[NARRATION]\n${raw}`].join("\n\n"),
    usage,
    telemetry: {
      latencyMs: Date.now() - startedAt,
      rounds: 1,
      toolCalls: ["death_save", `downed_${action.kind}`],
      stopReason,
      fellBack,
      systemChars: DOWNED_SYSTEM.length,
    },
  };
}
