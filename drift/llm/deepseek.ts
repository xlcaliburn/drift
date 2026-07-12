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

export function isDeepSeekModel(model: string): boolean {
  return model.startsWith("deepseek");
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
    return "deepseek-chat";
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
}): Promise<NormalizedResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens,
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
      message: { content: string | null; tool_calls?: OAToolCall[] };
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
}): Promise<NormalizedResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens,
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
          delta?: { content?: string | null; tool_calls?: OAToolCallDelta[] };
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
