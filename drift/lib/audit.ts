import "server-only";
import { hasSupabase } from "@/lib/state";
import { estimateCostUsd, type TokenUsage } from "@/lib/pricing";

/**
 * Per-call AI audit log. Every model call routes through recordAiCall so the AI
 * path is inspectable — latency, tokens, cost, tools, round-trips, fallback, and
 * TRUNCATED prompt/response previews. Two sinks, both best-effort (never throw —
 * an audit hiccup must not break a turn):
 *   1. A one-line structured console log (works with no Supabase — shows in
 *      Vercel function logs).
 *   2. An insert into ai_calls when Supabase is configured.
 */

/**
 * Capture full prompts/responses by default (storage isn't a concern yet and the
 * audit log is admin-only). Set AI_AUDIT_TRUNCATE=1 to cap each field at
 * AUDIT_PREVIEW_CHARS instead — the knob is kept for when volume grows.
 */
export const AUDIT_PREVIEW_CHARS = 2000;
export const AUDIT_TRUNCATE = process.env.AI_AUDIT_TRUNCATE === "1";

export type AiCallKind = "turn" | "creation" | "summary";

export interface AiCallEntry {
  /** Real profile id, or null for dev/keyless callers (no FK row exists). */
  userId?: string | null;
  campaignId?: string;
  kind: AiCallKind;
  model: string;
  latencyMs: number;
  usage: TokenUsage;
  /** Turn-loop specifics (omit for single-call kinds). */
  rounds?: number;
  toolCalls?: string[];
  stopReason?: string;
  fellBack?: boolean;
  /** Size of the system prompt in chars (stored as a number, not verbatim). */
  systemChars?: number;
  /** Raw player/user input and model output — truncated before storage. */
  prompt?: string;
  response?: string;
  /** Set when the call itself failed. */
  error?: string;
}

/** Full text by default; truncated only when AI_AUDIT_TRUNCATE=1. */
function capture(s: string | undefined, n = AUDIT_PREVIEW_CHARS): string | undefined {
  if (s == null) return undefined;
  if (!AUDIT_TRUNCATE) return s;
  return s.length > n ? `${s.slice(0, n)}…[+${s.length - n} chars]` : s;
}

export async function recordAiCall(entry: AiCallEntry): Promise<void> {
  const costUsd = estimateCostUsd(entry.model, entry.usage);

  // 1. Console baseline — always, so the AI path is auditable even without a DB.
  console.info(
    `[ai] ${entry.kind} ${entry.model} ${entry.latencyMs}ms` +
      ` in=${entry.usage.inputTokens} out=${entry.usage.outputTokens}` +
      (entry.usage.cacheReadTokens ? ` cached=${entry.usage.cacheReadTokens}` : "") +
      ` $${costUsd.toFixed(5)}` +
      (entry.rounds != null ? ` rounds=${entry.rounds}` : "") +
      (entry.toolCalls?.length ? ` tools=[${entry.toolCalls.join(",")}]` : "") +
      (entry.stopReason ? ` stop=${entry.stopReason}` : "") +
      (entry.fellBack ? " FELLBACK" : "") +
      (entry.error ? ` ERROR=${entry.error}` : ""),
  );

  // 2. Durable row when Supabase is on. Best-effort; log and swallow failures.
  if (!hasSupabase()) return;
  try {
    const { getServiceClient } = await import("@/db/queries");
    const { error } = await getServiceClient().from("ai_calls").insert({
      user_id: entry.userId ?? null,
      campaign_id: entry.campaignId ?? null,
      kind: entry.kind,
      model: entry.model,
      latency_ms: Math.round(entry.latencyMs),
      input_tokens: entry.usage.inputTokens,
      output_tokens: entry.usage.outputTokens,
      cache_read_tokens: entry.usage.cacheReadTokens,
      cache_write_tokens: entry.usage.cacheWriteTokens,
      cost_usd: costUsd,
      rounds: entry.rounds ?? null,
      tool_calls: entry.toolCalls ?? null,
      stop_reason: entry.stopReason ?? null,
      fell_back: entry.fellBack ?? false,
      system_chars: entry.systemChars ?? null,
      prompt_preview: capture(entry.prompt) ?? null,
      response_preview: capture(entry.response) ?? null,
      error: entry.error ?? null,
    });
    if (error) console.error("recordAiCall failed", error);
  } catch (err) {
    console.error("recordAiCall failed", err);
  }
}
