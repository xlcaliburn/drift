import { NextRequest, NextResponse } from "next/server";
import { getSession, hasSupabase } from "@/lib/state";

export const runtime = "nodejs";

/** GET /api/state?campaignId=... — current state + event log for the sidebar. */
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  }
  const session = await getSession(campaignId);
  if (!session) {
    return NextResponse.json(
      { error: "Campaign not found. Create a character to begin." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    state: session.state,
    transcript: session.transcript,
    log: session.log.slice(-100),
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.DEEPSEEK_API_KEY),
    persistent: hasSupabase(),
  });
}
