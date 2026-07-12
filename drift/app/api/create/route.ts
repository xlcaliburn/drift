import { NextRequest, NextResponse } from "next/server";
import { CreationInput } from "@/shared/multiplayer";
import { buildCharacterFromCreation } from "@/engine";
import { finalizeCreation } from "@/llm/creationFinalize";
import { buildNewCampaignState } from "@/lib/newCampaign";
import { setSession, persistSession } from "@/lib/state";

export const runtime = "nodejs";

/**
 * POST /api/create — validate creation answers, build the starting sheet, run
 * the AI finalize pass (personalized backstory + free-text sanity notes), store
 * the session, and return the full character + notes so the client can show the
 * "meet your character" review before entering play.
 *
 * In-memory for now; the Supabase wiring persists the character, dossier,
 * ledger, and campaign, and associates them with the logged-in player. The
 * characters table already has every column this character sets (see the
 * add_creation_metadata_columns migration).
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

  const state = buildNewCampaignState(character);

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
