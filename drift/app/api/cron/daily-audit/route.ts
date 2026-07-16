import { NextRequest, NextResponse } from "next/server";
import { runNightlyAudits, auditCampaign } from "@/lib/auditRun";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
// The whole pass runs in one invocation, one campaign at a time — a strong-model
// read of a full transcript is ~30-60s each. Needs a plan that allows this
// (Vercel Pro; Hobby caps at 60s — split the schedule or trigger externally).
export const maxDuration = 300;

/**
 * GET/POST /api/cron/daily-audit — the nightly (~3am) continuity-audit pass.
 * Auth, either of:
 *   - `Authorization: Bearer ${CRON_SECRET}` — how Vercel Cron (or any external
 *     scheduler) calls it. Set CRON_SECRET in env; Vercel attaches it
 *     automatically to cron invocations when the env var exists.
 *   - a signed-in ADMIN session — manual trigger for testing
 *     (`?campaignId=camp-…` audits just that one).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization");
  const bySecret = !!secret && bearer === `Bearer ${secret}`;
  if (!bySecret) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
  }

  const campaignId = req.nextUrl.searchParams.get("campaignId");
  const results = campaignId ? [await auditCampaign(campaignId)] : await runNightlyAudits();

  const ok = results.filter((r) => r.ok).length;
  const cost = results.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  console.info(`[cron] daily-audit: ${ok}/${results.length} campaigns, $${cost.toFixed(3)}`);
  return NextResponse.json({ audited: ok, total: results.length, costUsd: cost, results });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
