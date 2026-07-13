import { NextRequest, NextResponse, after } from "next/server";
import { CreationInput } from "@/shared/multiplayer";
import { buildCharacterFromCreation } from "@/engine";
import { finalizeCreation, quickCreationNotes } from "@/llm/creationFinalize";
import { buildNewCampaignState } from "@/lib/newCampaign";
import { getSession, setSession, persistSession, hasSupabase } from "@/lib/state";
import { buildOpeningHistory } from "@/shared/recap";
import { requireApprovedUser, isDevUser } from "@/lib/auth";
import { getServiceClient, getOwnedCampaign } from "@/db/queries";
import { recordAiCall } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * POST /api/create — validate creation answers, build the starting sheet, and
 * return IMMEDIATELY with the deterministic character + notes so the "meet your
 * character" review appears without waiting on the model.
 *
 * The heavy AI pass (personalized backstory, voice, invented flavor, and the
 * per-character opening quest) runs in the BACKGROUND via after(): the player
 * proceeds into play concurrently while the story is fleshed out and persisted.
 * newCampaign starts on the static faction opening; the background pass upgrades
 * it to the personalized one — but only if no turn has been taken yet, so it
 * never clobbers a player who has already started.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApprovedUser();
  if (auth.error) return auth.error;
  const user = auth.user;

  // One character per player (for now). Enforced here at the API so it can't be
  // bypassed by hitting the endpoint directly. Skipped in keyless dev (no owner)
  // and for admins (who may hold seeded/unowned worlds). A DB partial-unique
  // index on campaigns(player_id) backs this at the storage layer.
  if (hasSupabase() && !isDevUser(user) && user.role !== "admin") {
    const existing = await getOwnedCampaign(getServiceClient(), user.id);
    if (existing) {
      return NextResponse.json(
        {
          error: "You already have a character. Only one per player for now.",
          existingCampaignId: existing.id,
        },
        { status: 409 },
      );
    }
  }

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
  const playerId = isDevUser(user) ? undefined : user.id;
  const base = buildCharacterFromCreation(parsed.data, {
    id: `pc-${stamp}`,
    campaignId,
  });

  // Build state on the STATIC faction opening (generated opening arrives later).
  // Own the campaign. The keyless-dev stub id never reaches the DB.
  const state = buildNewCampaignState(base, playerId, undefined);
  // Seed the opening beat into history at creation so the player's first action
  // is grounded (prevents the narrator re-offering the just-accepted opening job).
  setSession(campaignId, {
    state,
    history: buildOpeningHistory(state),
    transcript: [],
    log: [],
    scenes: [],
    focusIds: [],
  });
  await persistSession(campaignId, state);

  // Background flesh-out: personalized backstory/voice/opening + audit. Runs
  // after the response is sent; the player is already in the review screen.
  after(async () => {
    let finalize;
    try {
      finalize = await finalizeCreation(parsed.data, base);
    } catch (e) {
      console.error("[create] background finalize threw:", e instanceof Error ? e.message : e);
      return;
    }

    // Re-read the live session: the player may have started playing already.
    const session = await getSession(campaignId);
    if (session) {
      const enriched = {
        ...base,
        backstory: finalize.backstory || base.backstory,
        moralCode: finalize.moralCode || base.moralCode,
        drives: finalize.moralCode || base.drives,
        voiceNotes: finalize.voiceNotes || base.voiceNotes,
      };
      if (session.transcript.length === 0) {
        // No turn yet (history is pre-seeded with the opening, so check the
        // transcript instead): safe to rebuild from scratch with the enriched
        // character + personalized opening, and re-seed history from it.
        session.state = buildNewCampaignState(enriched, playerId, finalize.opening);
        session.history = buildOpeningHistory(session.state);
      } else {
        // Play already in motion: patch only the character's narrative fields so
        // we don't overwrite HP/credits/threads mutated by turns taken meanwhile.
        const pc = session.state.characters.find((c) => c.id === base.id);
        if (pc) {
          pc.backstory = enriched.backstory;
          pc.moralCode = enriched.moralCode;
          pc.drives = enriched.drives;
          pc.voiceNotes = enriched.voiceNotes;
        }
      }
      setSession(campaignId, session);
      await persistSession(campaignId, session.state);
    }

    if (finalize.telemetry) {
      await recordAiCall({
        userId: playerId ?? null,
        campaignId,
        kind: "creation",
        model: finalize.telemetry.model,
        latencyMs: finalize.telemetry.latencyMs,
        usage: finalize.telemetry.usage,
        fellBack: finalize.telemetry.fellBack,
        systemChars: undefined,
        prompt: finalize.telemetry.prompt,
        response: finalize.telemetry.response,
        error: finalize.telemetry.error,
      });
    }
  });

  // Deterministic notes now (name-handle heuristic); the AI may add more, which
  // the review screen picks up if it polls /api/create/enrichment.
  return NextResponse.json({
    campaignId,
    characterId: base.id,
    character: base,
    notes: quickCreationNotes(parsed.data),
    enriching: true,
  });
}
