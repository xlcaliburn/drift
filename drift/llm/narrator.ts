import Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import type { RNG } from "@/engine";
import { liveRng, type EngineEvent } from "@/engine";
import { tools } from "./tools";
import { buildSystem, buildContextSlice } from "./promptBuilder";
import { TurnRuntime } from "./engineBridge";
import { deepseekChat, deepseekChatStream, deepseekAvailable, isDeepSeekModel, resolveModel } from "./deepseek";

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
  /** When set, narration text is streamed here delta-by-delta as it generates
   *  (both providers). The final joined narration still comes back in the result. */
  onDelta?: (text: string) => void;
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
 * Guarantee the history we send to the model is structurally valid: every
 * tool_use is immediately followed by its tool_result, no orphan tool_results,
 * no trailing tool exchange left hanging, and the array starts on a user turn.
 *
 * This is defense-in-depth. The write path below no longer persists a dangling
 * tool_use, but sessions saved by older code did (a sink-terminal turn kept the
 * offer_choices tool_use with no tool_result) — sending that to Anthropic 400s
 * with "tool_use ids were found without tool_result blocks". Sanitizing on read
 * repairs those histories so a single bad turn can't wedge a campaign, and works
 * across providers (DeepSeek `call_*` ids and Anthropic `toolu_*` ids alike).
 */
export function sanitizeHistory(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const toolUses = m.content.filter(
        (b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use",
      );
      if (toolUses.length) {
        const next = history[i + 1];
        const resultIds = new Set<string>(
          next && Array.isArray(next.content)
            ? next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []))
            : [],
        );
        if (!toolUses.every((b) => resultIds.has(b.id))) {
          // A tool_use has no matching result → drop every tool_use, keep text.
          const text = m.content.filter((b) => b.type === "text");
          if (text.length) out.push({ role: "assistant", content: text });
          continue;
        }
      }
      out.push(m);
      continue;
    }
    if (m.role === "user" && Array.isArray(m.content)) {
      // Drop orphan tool_results (no matching tool_use in the previous kept msg).
      const prev = out[out.length - 1];
      const prevIds = new Set<string>(
        prev && prev.role === "assistant" && Array.isArray(prev.content)
          ? prev.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []))
          : [],
      );
      const kept = m.content.filter((b) => b.type !== "tool_result" || prevIds.has(b.tool_use_id));
      if (kept.length) out.push({ role: "user", content: kept });
      continue;
    }
    out.push(m);
  }
  // Unwind a trailing tool exchange with no assistant reply after it, so history
  // ends on an assistant turn and the appended player message never produces two
  // user messages in a row.
  for (;;) {
    const last = out[out.length - 1];
    const onlyToolResults =
      !!last &&
      last.role === "user" &&
      Array.isArray(last.content) &&
      last.content.length > 0 &&
      last.content.every((b) => b.type === "tool_result");
    if (!onlyToolResults) break;
    out.pop();
    const prev = out[out.length - 1];
    if (prev && prev.role === "assistant" && Array.isArray(prev.content)) {
      out.pop();
      const text = prev.content.filter((b) => b.type === "text");
      if (text.length) out.push({ role: "assistant", content: text });
    }
  }
  // Anthropic requires the first message to be a user turn.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

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
    ...sanitizeHistory(input.history),
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
    onDelta?: (text: string) => void,
  ): Promise<{ respContent: Anthropic.ContentBlockParam[]; stopReason: string }> {
    if (viaDeepSeek) {
      const resp = onDelta
        ? await deepseekChatStream({ model: m, maxTokens, system, tools, messages, onDelta })
        : await deepseekChat({ model: m, maxTokens, system, tools, messages });
      usage.inputTokens += resp.usage.input_tokens;
      usage.outputTokens += resp.usage.output_tokens;
      usage.cacheReadTokens += resp.usage.cache_read_input_tokens;
      return { respContent: resp.content as Anthropic.ContentBlockParam[], stopReason: resp.stop_reason };
    }
    anthropic ??= new Anthropic({ apiKey: input.apiKey ?? process.env.ANTHROPIC_API_KEY });
    setMessageCacheBreakpoint(messages);
    if (onDelta) {
      const stream = anthropic.messages.stream({ model: m, max_tokens: maxTokens, system, tools, messages });
      stream.on("text", (t) => onDelta(t));
      const msg = await stream.finalMessage();
      usage.inputTokens += msg.usage.input_tokens;
      usage.outputTokens += msg.usage.output_tokens;
      usage.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += msg.usage.cache_creation_input_tokens ?? 0;
      return { respContent: msg.content, stopReason: msg.stop_reason ?? "end_turn" };
    }
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

    // Wrap the caller's onDelta so we know if any text was streamed this round —
    // once deltas are out we can't cleanly fall back (it would double-narrate).
    let roundEmitted = false;
    const roundDelta = input.onDelta
      ? (t: string) => {
          roundEmitted = true;
          input.onDelta!(t);
        }
      : undefined;

    try {
      ({ respContent, stopReason } = await callRound(activeModel, activeDeepSeek, roundDelta));
    } catch (err) {
      // Runtime failure on the cheap provider (e.g. DeepSeek 402). Fall back to
      // Haiku once if an Anthropic key exists AND nothing was streamed yet, then
      // let the loop continue.
      const canFallBack =
        !fellBack && activeDeepSeek && Boolean(process.env.ANTHROPIC_API_KEY) && !roundEmitted;
      if (!canFallBack) throw err;
      console.error(
        `[narrator] ${activeModel} failed, falling back to Haiku:`,
        err instanceof Error ? err.message : err,
      );
      fellBack = true;
      activeModel = "claude-haiku-4-5-20251001";
      activeDeepSeek = false;
      ({ respContent, stopReason } = await callRound(activeModel, activeDeepSeek, roundDelta));
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
    // beat — narrate + offer_choices — and halves its API calls.
    const allSinks = toolUses.length > 0 && toolUses.every((b) => SINK_TOOLS.has(b.name));
    if (allSinks && narrationParts.length > 0) {
      // We're ending the turn without another model call, so the sink tool_result
      // is never sent. Do NOT persist the dangling tool_use into history — there'd
      // be no tool_result after it and the next turn would 400. Keep only the
      // assistant's text (the sink results are bookkeeping the narrator never
      // needs to see again).
      const idx = newMessages.length - 1; // the assistant message pushed above
      const textOnly = respContent.filter((b) => b.type === "text");
      if (textOnly.length) newMessages[idx] = { role: "assistant", content: textOnly };
      else newMessages.splice(idx, 1);
      break;
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
