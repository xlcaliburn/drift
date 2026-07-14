import type Anthropic from "@anthropic-ai/sdk";

/**
 * DeepSeek adapter — OpenAI-compatible chat-completions API, translated to and
 * from the Anthropic message shapes the narrator loop already speaks. This
 * keeps ONE tool loop (narrator.ts) and one engine bridge regardless of
 * provider; adding another cheap provider later is just another adapter.
 *
 * Notes:
 * - DeepSeek context caching is automatic server-side; `cache_control` fields
 *   are stripped (they're an Anthropic concept).
 * - usage.prompt_cache_hit_tokens maps onto our cacheRead accounting.
 */

const FALLBACK_ANTHROPIC = "claude-haiku-4-5-20251001";

// DeepSeek repeats itself far more than Claude — verbatim duplicated paragraphs
// and re-stated choice menus. A frequency penalty discourages reusing the same
// tokens/lines; a light presence penalty nudges it to move on rather than loop.
const FREQUENCY_PENALTY = 0.5;
const PRESENCE_PENALTY = 0.3;

// DeepSeek defaults to ~1.0, which encourages the wandering / multi-beat
// over-generation we keep fighting. Nudge it down for tighter, more on-format
// turns while keeping enough warmth for prose. Tunable via env for playtesting.
const TEMPERATURE = Number(process.env.NARRATOR_TEMPERATURE ?? 0.8);

export function isDeepSeekModel(model: string): boolean {
  return model.startsWith("deepseek");
}

/**
 * Pull the first COMPLETE, balanced JSON object out of a blob of text — used to
 * rescue a turn the model drafted inside its "thinking" channel. Brace-depth scan
 * that respects strings/escapes; returns null if there's no finished object
 * (e.g. the thinking was truncated at max_tokens mid-draft), so a thinking-only
 * response never surfaces raw chain-of-thought as narration.
 */
export function extractJsonObject(text: string | null | undefined): string | null {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // unbalanced → truncated draft, no usable object
}

export function deepseekAvailable(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

/**
 * Swap to whatever provider actually has a key configured. Requested model wins
 * when its key exists; otherwise degrade gracefully instead of erroring.
 */
export function resolveModel(requested: string): string {
  if (isDeepSeekModel(requested) && !process.env.DEEPSEEK_API_KEY) {
    return FALLBACK_ANTHROPIC;
  }
  if (
    !isDeepSeekModel(requested) &&
    !process.env.ANTHROPIC_API_KEY &&
    process.env.DEEPSEEK_API_KEY
  ) {
    return "deepseek-v4-flash";
  }
  return requested;
}

// ── OpenAI-wire types (minimal) ─────────────────────────────────────────────

interface OAToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OAToolCall[];
  tool_call_id?: string;
}

export interface NormalizedResponse {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: "tool_use" | "end_turn" | "max_tokens";
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
  };
}

// ── Conversion ──────────────────────────────────────────────────────────────

function systemToString(system: Anthropic.TextBlockParam[]): string {
  return system.map((b) => b.text).join("\n\n");
}

function messagesToOpenAI(messages: Anthropic.MessageParam[]): OAMessage[] {
  const out: OAMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      let text = "";
      const toolCalls: OAToolCall[] = [];
      for (const b of m.content) {
        if (b.type === "text") text += b.text;
        else if (b.type === "tool_use") {
          toolCalls.push({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          });
        }
      }
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // user message: tool_result blocks become role:"tool" replies (must
      // directly follow the assistant tool_calls message), text becomes user.
      const texts: string[] = [];
      for (const b of m.content) {
        if (b.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: b.tool_use_id,
            content:
              typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""),
          });
        } else if (b.type === "text") {
          texts.push(b.text);
        }
      }
      if (texts.length) out.push({ role: "user", content: texts.join("\n\n") });
    }
  }
  return out;
}

function toolsToOpenAI(tools: Anthropic.Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── The call ────────────────────────────────────────────────────────────────

export async function deepseekChat(params: {
  model: string;
  maxTokens: number;
  system: Anthropic.TextBlockParam[];
  tools?: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  /** Force a single JSON object response (DeepSeek json_object mode). */
  jsonMode?: boolean;
}): Promise<NormalizedResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens,
    temperature: TEMPERATURE,
    frequency_penalty: FREQUENCY_PENALTY,
    presence_penalty: PRESENCE_PENALTY,
    ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: systemToString(params.system) },
      ...messagesToOpenAI(params.messages),
    ],
  };
  if (params.tools?.length) body.tools = toolsToOpenAI(params.tools);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: { content: string | null; reasoning_content?: string | null; tool_calls?: OAToolCall[] };
      finish_reason: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_cache_hit_tokens?: number;
    };
  };

  const choice = data.choices?.[0];
  const content: NormalizedResponse["content"] = [];
  if (choice?.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  } else if (choice?.message?.reasoning_content) {
    // Hybrid models sometimes spend the whole budget "thinking" and leave content
    // empty. Salvage ONLY a complete JSON object drafted inside the thinking —
    // never the raw reasoning prose, which would leak the model's chain-of-thought
    // ("We need to generate a JSON response…") to the player as narration. If no
    // finished object is in there, surface nothing → the caller treats it as a
    // failed turn (honest error + retry) instead of showing the thinking.
    const salvaged = extractJsonObject(choice.message.reasoning_content);
    if (salvaged) content.push({ type: "text", text: salvaged });
  }
  for (const tc of choice?.message?.tool_calls ?? []) {
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: safeParseArgs(tc.function.arguments),
    });
  }

  const stop_reason =
    choice?.finish_reason === "tool_calls"
      ? "tool_use"
      : choice?.finish_reason === "length"
        ? "max_tokens"
        : "end_turn";

  return {
    content,
    stop_reason,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: data.usage?.prompt_cache_hit_tokens ?? 0,
    },
  };
}

// ── Streaming call ───────────────────────────────────────────────────────────

interface OAToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Streaming twin of deepseekChat over the OpenAI-compatible SSE protocol. Text
 * deltas are forwarded to onDelta as they arrive (so the UI can render the
 * narration progressively); tool-call fragments are accumulated by index and
 * the final NormalizedResponse is identical in shape to the non-streaming path.
 */
export async function deepseekChatStream(params: {
  model: string;
  maxTokens: number;
  system: Anthropic.TextBlockParam[];
  tools?: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  onDelta?: (text: string) => void;
  /** Force a single JSON object response (DeepSeek json_object mode). */
  jsonMode?: boolean;
}): Promise<NormalizedResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens,
    temperature: TEMPERATURE,
    frequency_penalty: FREQUENCY_PENALTY,
    presence_penalty: PRESENCE_PENALTY,
    ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: systemToString(params.system) },
      ...messagesToOpenAI(params.messages),
    ],
  };
  if (params.tools?.length) body.tools = toolsToOpenAI(params.tools);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let finishReason = "";
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  let usage = { prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0 };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep the trailing partial line for next chunk
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      let chunk: {
        choices?: Array<{
          delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: OAToolCallDelta[] };
          finish_reason?: string | null;
        }>;
        usage?: typeof usage;
      };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue; // skip a malformed/partial event
      }
      const choice = chunk.choices?.[0];
      const content = choice?.delta?.content;
      if (content) {
        text += content;
        params.onDelta?.(content);
      }
      // Hybrid-model thinking: accumulate silently (never streamed to the player);
      // used as fallback text if the visible content comes back empty.
      const reasoningDelta = choice?.delta?.reasoning_content;
      if (reasoningDelta) reasoning += reasoningDelta;
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        toolAcc.set(idx, cur);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) usage = chunk.usage;
    }
  }

  const content: NormalizedResponse["content"] = [];
  if (text) content.push({ type: "text", text });
  else {
    // Thinking-only response: salvage a finished JSON object from the reasoning,
    // never the raw chain-of-thought (which would stream to the player as prose).
    const salvaged = extractJsonObject(reasoning);
    if (salvaged) content.push({ type: "text", text: salvaged });
  }
  for (const [, tc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
    content.push({ type: "tool_use", id: tc.id, name: tc.name, input: safeParseArgs(tc.args) });
  }

  const stop_reason: NormalizedResponse["stop_reason"] =
    finishReason === "tool_calls" ? "tool_use" : finishReason === "length" ? "max_tokens" : "end_turn";

  return {
    content,
    stop_reason,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      cache_read_input_tokens: usage.prompt_cache_hit_tokens ?? 0,
    },
  };
}
