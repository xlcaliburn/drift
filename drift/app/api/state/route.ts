import { NextRequest, NextResponse } from "next/server";
import { getSession, DEFAULT_CAMPAIGN_ID, hasSupabase } from "@/lib/state";

export const runtime = "nodejs";

/** GET /api/state?campaignId=... — current state + event log for the sidebar. */
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId") ?? DEFAULT_CAMPAIGN_ID;
  const session = getSession(campaignId);
  return NextResponse.json({
    state: session.state,
    transcript: session.transcript,
    log: session.log.slice(-100),
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.DEEPSEEK_API_KEY),
    persistent: hasSupabase(),
  });
}
