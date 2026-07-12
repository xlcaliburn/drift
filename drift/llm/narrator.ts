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
  /** Observability: what actually happened this turn, for the audit log. */
  telemetry: {
    /** Wall-clock ms from first model call to loop exit. */
    latencyMs: number;
    /** How many model round-trips the tool loop actually made. */
    rounds: number;
    /** Tool names invoked, in order (repeats included). */
    toolCalls: string[];
    /** Stop reason of the final model response. */
    stopReason: string;
    /** True if the cheap provider errored and we fell back to Haiku mid-turn. */
    fellBack: boolean;
    /** Size of the system prompt in chars (cached prefix; logged, not stored). */
    systemChars: number;
  };
}

const MAX_TOOL_ROUNDS = 12;

/**
 * "Sink" tools whose result is a bare acknowledgement the narrator never needs to
 * react to (offer_choices → {offered}, log_world_event → {logged}). When a model
 * response's ONLY tool calls are sinks, calling the model again just to consume a
 * useless ack is a wasted round-trip — the dominant source of "double API calls"
 * on routine beats. We execute them and end the turn instead. Every other tool
 * (roll_check, resolve_attack, advance_clock milestones, adjust_rep's shipSeized,
 * end_scene's checklist, …) can return consequences the narrator must voice, so
 * those still trigger another round.
 */
const SINK_TOOLS = new Set(["offer_choices", "log_world_event"]);

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
  // Active model can change mid-turn if the primary (DeepSeek) errors at runtime
  // — e.g. a 402 balance failure — and an Anthropic key is available to take over.
  let activeModel = model;
  let activeDeepSeek = isDeepSeekModel(model);
  let fellBack = false;
  // Output is the priciest AND slowest token, so cap it hard: a routine beat is a
  // few sentences (~90 words ≈ 130 tokens). Cinematic (Sonnet/Opus) gets more room
  // for genuine set pieces. These caps are a backstop; the prompt asks for concision.
  const maxTokens = model.includes("sonnet") || model.includes("opus") ? 900 : 450;

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
  // Telemetry accumulated across the tool loop, surfaced for the audit log.
  const toolCalls: string[] = [];
  let rounds = 0;
  let lastStopReason = "end_turn";
  const startedAt = Date.now();
  // Lazy — only constructed on the Anthropic path, so DeepSeek-only setups work.
  let anthropic: Anthropic | null = null;

  // One model call for the current round. Reads the growing `messages` array and
  // accumulates usage; provider is chosen by the caller so a mid-turn fallback
  // can flip it. Messages stay in Anthropic shape on both paths, so swapping
  // DeepSeek → Anthropic between rounds needs no conversion.
  async function callRound(
    m: string,
    viaDeepSeek: boolean,
  ): Promise<{ respContent: Anthropic.ContentBlockParam[]; stopReason: string }> {
    if (viaDeepSeek) {
      const resp = await deepseekChat({ model: m, maxTokens, system, tools, messages });
      usage.inputTokens += resp.usage.input_tokens;
      usage.outputTokens += resp.usage.output_tokens;
      usage.cacheReadTokens += resp.usage.cache_read_input_tokens;
      return { respContent: resp.content as Anthropic.ContentBlockParam[], stopReason: resp.stop_reason };
    }
    anthropic ??= new Anthropic({ apiKey: input.apiKey ?? process.env.ANTHROPIC_API_KEY });
    setMessageCacheBreakpoint(messages);
    const resp = await anthropic.messages.create({ model: m, max_tokens: maxTokens, system, tools, messages });
    usage.inputTokens += resp.usage.input_tokens;
    usage.outputTokens += resp.usage.output_tokens;
    usage.cacheReadTokens += resp.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += resp.usage.cache_creation_input_tokens ?? 0;
    return { respContent: resp.content, stopReason: resp.stop_reason ?? "end_turn" };
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let respContent: Anthropic.ContentBlockParam[];
    let stopReason: string;

    try {
      ({ respContent, stopReason } = await callRound(activeModel, activeDeepSeek));
    } catch (err) {
      // Runtime failure on the cheap provider (e.g. DeepSeek 402). Fall back to
      // Haiku once if an Anthropic key exists, then let the loop continue.
      const canFallBack = !fellBack && activeDeepSeek && Boolean(process.env.ANTHROPIC_API_KEY);
      if (!canFallBack) throw err;
      console.error(
        `[narrator] ${activeModel} failed, falling back to Haiku:`,
        err instanceof Error ? err.message : err,
      );
      fellBack = true;
      activeModel = "claude-haiku-4-5-20251001";
      activeDeepSeek = false;
      ({ respContent, stopReason } = await callRound(activeModel, activeDeepSeek));
    }
    rounds++;
    lastStopReason = stopReason;

    for (const block of respContent) {
      if (block.type === "text") narrationParts.push(block.text);
    }

    const assistantMsg: Anthropic.MessageParam = { role: "assistant", content: respContent };
    messages.push(assistantMsg);
    newMessages.push(assistantMsg);

    if (stopReason !== "tool_use") break;

    // Service ALL tool_use blocks from this response (the model is prompted to
    // batch a combat round's calls, so this is often several at once).
    const toolUses = respContent.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      toolCalls.push(block.name);
      const result = runtime.execute(block.name, block.input as Record<string, unknown>);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    // Round-trip elimination: if every tool this round was a sink (its result is a
    // bare ack) and we already have narration to return, stop here instead of
    // calling the model again just to consume acks. This is the common routine
    // beat — narrate + offer_choices — and halves its API calls. We keep the
    // narration text; we simply don't feed the useless results back.
    const allSinks = toolUses.length > 0 && toolUses.every((b) => SINK_TOOLS.has(b.name));
    if (allSinks && narrationParts.length > 0) break;

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
    model: activeModel,
    newMessages,
    usage,
    telemetry: {
      latencyMs: Date.now() - startedAt,
      rounds,
      toolCalls,
      stopReason: lastStopReason,
      fellBack,
      systemChars: system.reduce((n, b) => n + b.text.length, 0),
    },
  };
}
