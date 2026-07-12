import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/create/enrichment?campaignId= — the current character's narrative
 * fields (backstory, voice, moral code). The "meet your character" review polls
 * this so the AI-personalized story fills in live once the background finalize
 * pass (see /api/create) has run and persisted — without ever blocking creation.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;

  const campaignId = req.nextUrl.searchParams.get("campaignId") ?? "";
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  }

  const session = await getSession(campaignId);
  if (!session) return NextResponse.json({ ready: false });
  if (!canAccessCampaign(auth.user, session.state.campaign.playerId)) {
    return NextResponse.json({ error: "Not your campaign." }, { status: 403 });
  }

  const pc = session.state.characters.find((c) => c.kind === "pc");
  return NextResponse.json({
    ready: true,
    backstory: pc?.backstory ?? "",
    voiceNotes: pc?.voiceNotes ?? "",
    moralCode: pc?.moralCode ?? "",
  });
}
