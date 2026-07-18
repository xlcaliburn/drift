import { NextRequest, NextResponse } from "next/server";
import { getSession, setSession, persistSession, hasSupabase } from "@/lib/state";
import { requireApprovedUser, canAccessCampaign } from "@/lib/auth";
import { refreshBoard } from "@/shared/quests";
import { liveRng } from "@/engine/rng";
import { revalidateChoices } from "@/shared/choices";
import { freshStorylineState } from "@/shared/storyline";

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

  // Seed the job board on first read so the Jobs tab has offers before the player's
  // first turn (QUESTS.md). Only when empty — an existing board is never disturbed.
  // The turn loop keeps it topped up thereafter; this write mirrors the same safe
  // getSession → mutate → persist path (a warm re-save won't clobber it).
  if (!session.jobs?.length) {
    const seeded = refreshBoard(session.state, session.jobs ?? [], liveRng, session.state.campaign.tendaysElapsed ?? 0);
    if (seeded.length) {
      const updated = { ...session, jobs: seeded };
      setSession(campaignId, updated);
      await persistSession(campaignId, updated);
      session.jobs = seeded;
    }
  }

  return NextResponse.json({
    state: session.state,
    transcript: session.transcript,
    log: session.log.slice(-100),
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.DEEPSEEK_API_KEY),
    persistent: hasSupabase(),
    isAdmin: auth.user.role === "admin",
    combat: session.combat,
    npcRelations: session.npcRelations,
    sceneCard: session.sceneCard,
    // Prune any ENGINE chip whose precondition no longer holds (item spent, patron
    // no longer eligible, job no longer offered…) — a stale click on a refresh must
    // never be the game's first impression. Skipped while a fight/downed sequence
    // owns the chip set (it regenerates its own every round).
    lastChoices:
      session.combat?.active || !session.lastChoices
        ? session.lastChoices
        : revalidateChoices(session.lastChoices, {
            state: session.state,
            sceneCard: session.sceneCard,
            npcRelations: session.npcRelations,
            jobs: session.jobs ?? [],
          }),
    jobs: session.jobs ?? [],
    playerLedger: session.playerLedger ?? {},
    facts: session.facts ?? [],
    // The main-questline progress (STORY.md, HANDOFF_STORY_1.md Task C) — the
    // Story tab cross-references pack.storyline.chapters (bundled client-side,
    // same pattern as MapTab/RemakeEditor) for titles/objectives.
    storyline: session.storyline ?? freshStorylineState(),
  });
}

/**
 * POST /api/state — set the player's own AIM for this campaign (campaign.directive).
 * Player-editable free text (empty clears it). Persists immediately so the next
 * turn's narrator context picks it up.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const campaignId = (body.campaignId ?? "").toString();
  if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  if (typeof body.directive !== "string") {
    return NextResponse.json({ error: "directive (string) is required" }, { status: 400 });
  }
  const directive = body.directive.trim().slice(0, 400);

  const session = await getSession(campaignId);
  if (!session) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (!canAccessCampaign(auth.user, session.state.campaign.playerId)) {
    return NextResponse.json({ error: "Not your campaign." }, { status: 403 });
  }

  // Empty string clears the aim (undefined → no directive line in the prompt).
  const updated = {
    ...session,
    state: { ...session.state, campaign: { ...session.state.campaign, directive: directive || undefined } },
  };
  setSession(campaignId, updated);
  await persistSession(campaignId, updated);
  return NextResponse.json({ directive: directive || null });
}
