import { NextRequest, NextResponse } from "next/server";
import { CreationInput } from "@/shared/multiplayer";
import { buildCharacterFromCreation } from "@/engine";
import { buildNewCampaignState } from "@/lib/newCampaign";
import { setSession, getSession } from "@/lib/state";

export const runtime = "nodejs";

/**
 * POST /api/create — validate creation answers, build the starting sheet + a
 * fresh shared-world campaign, and store the session. Returns the new
 * campaignId for the client to open.
 *
 * In-memory for now; tomorrow's Supabase wiring persists the character, dossier,
 * ledger, and campaign, and associates them with the logged-in player.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreationInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid creation input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const stamp = Date.now().toString(36);
  const campaignId = `camp-${stamp}`;
  const character = buildCharacterFromCreation(parsed.data, {
    id: `pc-${stamp}`,
    campaignId,
  });

  const state = buildNewCampaignState(character);

  // Initialise a fresh session for this campaign.
  const session = getSession(campaignId);
  setSession(campaignId, { ...session, state, history: [], transcript: [], log: [], scenes: [], focusIds: [] });

  return NextResponse.json({ campaignId, characterId: character.id });
}
