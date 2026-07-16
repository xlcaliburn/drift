import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { hasSupabase } from "@/lib/state";
import type { DailyAuditReport } from "@/llm/dailyAudit";

export const runtime = "nodejs";

export interface AuditRow {
  id: number;
  campaignId: string;
  campaignTitle: string | null;
  auditDate: string;
  model: string;
  report: DailyAuditReport;
  applied: { npcs: number; threads: number } | null;
  costUsd: number | null;
  createdAt: string;
}

/** GET /api/admin/audits?limit=&campaignId= — nightly audit reports, newest first. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!hasSupabase()) return NextResponse.json({ audits: [] });

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? 40)));
  const campaignId = sp.get("campaignId");

  const { getServiceClient } = await import("@/db/queries");
  const db = getServiceClient();
  let query = db
    .from("daily_audits")
    .select("id,campaign_id,audit_date,model,report,applied,cost_usd,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort campaign titles for the list header.
  const ids = [...new Set((data ?? []).map((r) => r.campaign_id as string))];
  const titles = new Map<string, string>();
  if (ids.length) {
    const { data: camps } = await db.from("campaigns").select("id,name").in("id", ids);
    for (const c of camps ?? []) titles.set(c.id as string, (c.name as string) ?? "");
  }

  const audits: AuditRow[] = (data ?? []).map((r) => ({
    id: r.id as number,
    campaignId: r.campaign_id as string,
    campaignTitle: titles.get(r.campaign_id as string) ?? null,
    auditDate: String(r.audit_date),
    model: r.model as string,
    report: r.report as DailyAuditReport,
    applied: (r.applied as { npcs: number; threads: number } | null) ?? null,
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
    createdAt: String(r.created_at),
  }));
  return NextResponse.json({ audits });
}
