import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign } from "@/lib/auth";
import { runOpenSceneAnalyst } from "@/lib/analystRun";

export const runtime = "nodejs";
export const maxDuration = 45;

/**
 * POST /api/analyze — MANUAL re-sync. Runs the scene analyst on the CURRENT open
 * scene right now and folds its continuity updates (picked-up NPCs, refreshed
 * identities, relationship beats, flavor items) into the session — for when the
 * player notices the world isn't lining up and wants the memory reconciled without
 * waiting for the scene to close. Returns the freshened state for the sidebar.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const campaignId = (body.campaignId ?? "").toString();
  if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });

  const session = await getSession(campaignId);
  if (!session) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (!canAccessCampaign(auth.user, session.state.campaign.playerId)) {
    return NextResponse.json({ error: "Not your campaign." }, { status: 403 });
  }

  let changed = false;
  try {
    changed = await runOpenSceneAnalyst(campaignId);
  } catch (e) {
    console.error("[analyze] manual run failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Analysis failed — try again." }, { status: 502 });
  }

  const after = await getSession(campaignId);
  return NextResponse.json({
    ok: true,
    changed,
    state: after?.state,
    npcRelations: after?.npcRelations,
    sceneCard: after?.sceneCard,
  });
}
