import { NextRequest, NextResponse } from "next/server";
import { CreationInput } from "@/shared/multiplayer";
import { buildCharacterFromCreation } from "@/engine";
import { finalizeCreation } from "@/llm/creationFinalize";
import { buildNewCampaignState } from "@/lib/newCampaign";
import { setSession, persistSession } from "@/lib/state";
import { requireApprovedUser, isDevUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/create — validate creation answers, build the starting sheet, run
 * the AI finalize pass (personalized backstory + free-text sanity notes), store
 * the session owned by the signed-in player, and return the full character +
 * notes so the client can show the "meet your character" review before play.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;
  const user = auth.user;

  const body = await req.json().catch(() => null);
  const parsed = CreationInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid creation input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Random suffix: two players creating in the same millisecond must not collide.
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const campaignId = `camp-${stamp}`;
  const base = buildCharacterFromCreation(parsed.data, {
    id: `pc-${stamp}`,
    campaignId,
  });

  // AI pass: personalized backstory + voice, invented flavor for blanks, and
  // free-text validation notes.
  const finalize = await finalizeCreation(parsed.data, base);
  const character = {
    ...base,
    backstory: finalize.backstory || base.backstory,
    moralCode: finalize.moralCode || base.moralCode,
    drives: finalize.moralCode || base.drives,
    voiceNotes: finalize.voiceNotes || base.voiceNotes,
  };

  // Own the campaign. The keyless-dev stub id never reaches the DB
  // (persistSession is a no-op without Supabase).
  const state = buildNewCampaignState(
    character,
    isDevUser(user) ? undefined : user.id,
    finalize.opening,
  );

  // Initialise a fresh session (in-memory for this process) and persist the new
  // campaign + character to Supabase so /play can reload the real character even
  // if this process's memory is later lost.
  setSession(campaignId, { state, history: [], transcript: [], log: [], scenes: [], focusIds: [] });
  await persistSession(campaignId, state);

  return NextResponse.json({
    campaignId,
    characterId: character.id,
    character,
    notes: finalize.notes,
  });
}
