import Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import type { RNG } from "@/engine";
import { liveRng, type EngineEvent } from "@/engine";
import { tools } from "./tools";
import { buildSystem, buildContextSlice } from "./promptBuilder";
import { TurnRuntime } from "./engineBridge";
import { deepseekChat, deepseekAvailable, isDeepSeekModel, resolveModel } from "./deepseek";

export interface TurnInput {
  state: CampaignState;
  /** Prior conversation turns (already trimmed / summarized by the caller). */
  history: Anthropic.MessageParam[];
  playerText: string;
  /** Entity ids to force into context (from the previous scene's refs). */
  focusIds?: string[];
  /** Force the pricier "cinematic" model (Sonnet) for this turn. */
  cinematic?: boolean;
  model?: string;
  rng?: RNG;
  apiKey?: string;
}

export interface TurnResult {
  narration: string;
  state: CampaignState;
  events: EngineEvent[];
  worldEvents: TurnRuntime["worldEvents"];
  choices: string[];
  sceneEnded: boolean;
  model: string;
  /** Full assistant/user message pairs generated this turn, for history. */
  newMessages: Anthropic.MessageParam[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
}

const MAX_TOOL_ROUNDS = 12;

/**
 * Cheapest-first routing: DeepSeek is the routine narrator whenever its key is
 * configured; otherwise Haiku. Cinematic turns escalate to Sonnet (when an
 * Anthropic key exists — resolveModel degrades it back to DeepSeek if not).
 */
function defaultNarratorModel() {
  return (
    process.env.NARRATOR_MODEL ??
    (deepseekAvailable() ? "deepseek-chat" : "claude-haiku-4-5-20251001")
  );
}
function cinematicModel() {
  return process.env.CINEMATIC_MODEL ?? "claude-sonnet-5";
}

/** Cheap heuristic: does the player's action read like a combat / set-piece beat? */
export function isSetPiece(text: string): boolean {
  return /\b(attack|fire|shoot|shot|fight|ambush|board|ram|engage|kill|dogfight|combat|missile|open fire)\b/i.test(
    text,
  );
}

/**
 * Move the single message-level cache breakpoint to the last block of the last
 * message (Anthropic only — DeepSeek caches automatically server-side). During
 * the tool-use loop the conversation grows each round; caching the prefix makes
 * every round after the first a cache read (~10% cost) instead of full price.
 */
function setMessageCacheBreakpoint(messages: Anthropic.MessageParam[]) {
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if ("cache_control" in block) delete (block as { cache_control?: unknown }).cache_control;
      }
    }
  }
  const last = messages[messages.length - 1];
  if (!last) return;
  if (typeof last.content === "string") {
    last.content = [{ type: "text", text: last.content }];
  }
  const blocks = last.content as Anthropic.ContentBlockParam[];
  const tail = blocks[blocks.length - 1];
  if (tail && (tail.type === "text" || tail.type === "tool_result")) {
    (tail as { cache_control?: { type: "ephemeral" } }).cache_control = { type: "ephemeral" };
  }
}

/**
 * Run one player turn: assemble the prompt, call the narrator (DeepSeek or
 * Anthropic), and service its tool calls through the deterministic engine until
 * it stops. Cost levers: cheapest-model routing, prompt caching across
 * tool-loop rounds, model-scaled output caps, batched tool calls.
 */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const useCinematic = input.cinematic || isSetPiece(input.playerText);
  // Precedence: explicit override > cinematic escalation > campaign/env default,
  // then resolveModel degrades to whichever provider actually has a key.
  const routineModel = input.state.campaign.narratorModel ?? defaultNarratorModel();
  const model = resolveModel(input.model ?? (useCinematic ? cinematicModel() : routineModel));
  const useDeepSeek = isDeepSeekModel(model);
  // Sonnet gets more room for prose; cheap models stay tight (output is the priciest token).
  const maxTokens = model.includes("sonnet") || model.includes("opus") ? 1400 : 800;

  const runtime = new TurnRuntime(input.state, input.rng ?? liveRng);

  const system = buildSystem(input.state);
  const contextSlice = buildContextSlice(input.state, input.playerText, input.focusIds);

  const messages: Anthropic.MessageParam[] = [
    ...input.history,
    {
      role: "user",
      content: `${contextSlice}\n\n---\nPLAYER: ${input.playerText}`,
    },
  ];

  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const narrationParts: string[] = [];
  const newMessages: Anthropic.MessageParam[] = [];
  // Lazy — only constructed on the Anthropic path, so DeepSeek-only setups work.
  let anthropic: Anthropic | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let respContent: Anthropic.ContentBlockParam[];
    let stopReason: string;

    if (useDeepSeek) {
      const resp = await deepseekChat({ model, maxTokens, system, tools, messages });
      respContent = resp.content as Anthropic.ContentBlockParam[];
      stopReason = resp.stop_reason;
      usage.inputTokens += resp.usage.input_tokens;
      usage.outputTokens += resp.usage.output_tokens;
      usage.cacheReadTokens += resp.usage.cache_read_input_tokens;
    } else {
      anthropic ??= new Anthropic({ apiKey: input.apiKey ?? process.env.ANTHROPIC_API_KEY });
      setMessageCacheBreakpoint(messages);
      const resp = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools,
        messages,
      });
      respContent = resp.content;
      stopReason = resp.stop_reason ?? "end_turn";
      usage.inputTokens += resp.usage.input_tokens;
      usage.outputTokens += resp.usage.output_tokens;
      usage.cacheReadTokens += resp.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += resp.usage.cache_creation_input_tokens ?? 0;
    }

    for (const block of respContent) {
      if (block.type === "text") narrationParts.push(block.text);
    }

    const assistantMsg: Anthropic.MessageParam = { role: "assistant", content: respContent };
    messages.push(assistantMsg);
    newMessages.push(assistantMsg);

    if (stopReason !== "tool_use") break;

    // Service ALL tool_use blocks from this response (the model is prompted to
    // batch a combat round's calls, so this is often several at once).
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of respContent) {
      if (block.type === "tool_use") {
        const result = runtime.execute(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }
    const toolMsg: Anthropic.MessageParam = { role: "user", content: toolResults };
    messages.push(toolMsg);
    newMessages.push(toolMsg);
  }

  return {
    narration: narrationParts.join("\n\n").trim(),
    state: runtime.state,
    events: runtime.events,
    worldEvents: runtime.worldEvents,
    choices: runtime.choices,
    sceneEnded: runtime.sceneEndReport !== null,
    model,
    newMessages,
    usage,
  };
}
