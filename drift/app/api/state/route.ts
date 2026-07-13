import { NextRequest, NextResponse } from "next/server";
import { getSession, hasSupabase } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/state?campaignId=... — current state + event log for the sidebar. */
export async function GET(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;

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
  if (!canAccessCampaign(auth.user, session.state.campaign.playerId)) {
    return NextResponse.json({ error: "Not your campaign." }, { status: 403 });
  }
  return NextResponse.json({
    state: session.state,
    transcript: session.transcript,
    log: session.log.slice(-100),
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.DEEPSEEK_API_KEY),
    persistent: hasSupabase(),
    isAdmin: auth.user.role === "admin",
  });
}
