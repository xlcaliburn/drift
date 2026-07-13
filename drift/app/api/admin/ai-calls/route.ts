import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { hasSupabase } from "@/lib/state";

export const runtime = "nodejs";

export interface AiCallUser {
  id: string;
  email: string;
}

export interface AiCallRow {
  id: string;
  createdAt: string;
  email: string | null;
  campaignId: string | null;
  kind: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  rounds: number | null;
  toolCalls: string[];
  stopReason: string | null;
  fellBack: boolean;
  systemChars: number | null;
  promptPreview: string | null;
  responsePreview: string | null;
  error: string | null;
}

/**
 * GET /api/admin/ai-calls?limit=&kind=&campaignId= — recent AI calls, newest
 * first, joined to the caller's email. This is the audit surface for inspecting
 * what was sent/returned and why a call was slow.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!hasSupabase()) return NextResponse.json({ calls: [] });

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit") ?? 100)));
  const kind = sp.get("kind");
  const campaignId = sp.get("campaignId");
  const userId = sp.get("userId");

  const { getServiceClient } = await import("@/db/queries");
  const db = getServiceClient();

  let query = db
    .from("ai_calls")
    .select(
      "id,created_at,user_id,campaign_id,kind,model,latency_ms,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd,rounds,tool_calls,stop_reason,fell_back,system_chars,prompt_preview,response_preview,error",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (kind) query = query.eq("kind", kind);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  if (userId) query = query.eq("user_id", userId);

  // The player roster for the filter dropdown (independent of the current filter).
  const usersRes = await db.from("profiles").select("id,email").order("email");
  const users: AiCallUser[] = (usersRes.data ?? []).map((p) => ({
    id: String(p.id),
    email: String(p.email),
  }));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve emails in one round-trip.
  const userIds = [...new Set((data ?? []).map((r) => r.user_id).filter(Boolean))];
  const emails = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles } = await db.from("profiles").select("id,email").in("id", userIds);
    for (const p of profiles ?? []) emails.set(String(p.id), String(p.email));
  }

  const calls: AiCallRow[] = (data ?? []).map((r) => ({
    id: String(r.id),
    createdAt: String(r.created_at),
    email: r.user_id ? emails.get(String(r.user_id)) ?? String(r.user_id) : null,
    campaignId: r.campaign_id ? String(r.campaign_id) : null,
    kind: String(r.kind),
    model: String(r.model),
    latencyMs: Number(r.latency_ms ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    cacheReadTokens: Number(r.cache_read_tokens ?? 0),
    cacheWriteTokens: Number(r.cache_write_tokens ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
    rounds: r.rounds == null ? null : Number(r.rounds),
    toolCalls: Array.isArray(r.tool_calls) ? (r.tool_calls as string[]) : [],
    stopReason: r.stop_reason ? String(r.stop_reason) : null,
    fellBack: Boolean(r.fell_back),
    systemChars: r.system_chars == null ? null : Number(r.system_chars),
    promptPreview: r.prompt_preview ? String(r.prompt_preview) : null,
    responsePreview: r.response_preview ? String(r.response_preview) : null,
    error: r.error ? String(r.error) : null,
  }));

  return NextResponse.json({ calls, users });
}
