import { NextRequest, NextResponse } from "next/server";
import { getSession, hasSupabase } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign, isDevUser } from "@/lib/auth";
import { getMonthUsage, checkBudget, recordTurnUsage } from "@/lib/usage";
import { recordAiCall } from "@/lib/audit";
import { retellStory } from "@/llm/summarizer";

export const runtime = "nodejs";

/**
 * "Story so far" (HANDOFF_PLAYTEST_POLISH_1.md decision 10).
 *
 * GET  — the deterministic scene-summary list. Free (no API call): every
 * scene is already persisted (CONTINUITY.md's background summarizer), this
 * just reads it back.
 * POST — a cheap-model second-person RETELLING composed from that same list.
 * Player-initiated only (a button click, never run automatically); metered
 * like an appeal.
 */

async function loadScenes(campaignId: string, limit: number) {
  if (!hasSupabase()) return [];
  const { getServiceClient, loadRecentScenes } = await import("@/db/queries");
  return loadRecentScenes(getServiceClient(), campaignId, limit);
}

export async function GET(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;

  const campaignId = req.nextUrl.searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });

  const session = await getSession(campaignId);
  if (!session) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (!canAccessCampaign(auth.user, session.state.campaign.playerId)) {
    return NextResponse.json({ error: "Not your campaign." }, { status: 403 });
  }

  const scenes = await loadScenes(campaignId, 200);
  return NextResponse.json({
    scenes: scenes.map((s) => ({ seq: s.seq, title: s.title, summary: s.summary })),
  });
}

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
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Story so far needs a persisted campaign (keyless mode has no scene history)." }, { status: 400 });
  }

  // Hard monthly budget: block BEFORE spending tokens (same gate the turn route uses).
  if (!isDevUser(auth.user)) {
    const month = await getMonthUsage(auth.user.id);
    const budget = checkBudget(auth.user, month);
    if (!budget.ok) {
      return NextResponse.json(
        { error: `Monthly budget reached (${budget.reason}). Ask the GM to raise your cap.` },
        { status: 402 },
      );
    }
  }

  const scenes = await loadScenes(campaignId, 200);
  if (scenes.length === 0) {
    return NextResponse.json({ error: "Nothing recorded yet — play a few scenes." }, { status: 400 });
  }
  const summaries = scenes.map((s) => `${s.title}: ${s.summary}`).join("\n");

  const startedAt = Date.now();
  const result = await retellStory(summaries, session.state.campaign.situation ?? "");
  const latencyMs = Date.now() - startedAt;

  await recordAiCall({
    userId: isDevUser(auth.user) ? null : auth.user.id,
    campaignId,
    kind: "summary",
    model: result.model,
    latencyMs,
    usage: result.usage,
    prompt: summaries.slice(0, 4000),
    response: result.text,
    error: result.text ? undefined : "empty retelling",
  });
  if (!isDevUser(auth.user)) {
    await recordTurnUsage({ userId: auth.user.id, campaignId, model: result.model, usage: result.usage });
  }

  if (!result.text) {
    return NextResponse.json({ error: "Couldn't compose a retelling right now — try again." }, { status: 502 });
  }
  return NextResponse.json({ text: result.text });
}
