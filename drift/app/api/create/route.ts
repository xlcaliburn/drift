import { NextRequest, NextResponse, after } from "next/server";
import { CreationInput } from "@/shared/multiplayer";
import { buildCharacterFromCreation, buildBackstoryNpcs, buildPatronNpc } from "@/engine";
import { finalizeCreation, quickCreationNotes } from "@/llm/creationFinalize";
import { buildNewCampaignState } from "@/lib/newCampaign";
import { getSession, setSession, persistSession, hasSupabase } from "@/lib/state";
import { buildOpeningHistory } from "@/shared/recap";
import { freshSceneCard } from "@/shared/scene";
import { requireApprovedUser, isDevUser } from "@/lib/auth";
import { getServiceClient, getOwnedCampaign } from "@/db/queries";
import { recordAiCall } from "@/lib/audit";
import { takePrewarm } from "@/lib/creationPrewarm";

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
  // Seed the faction PATRON (STARTER.md) — a safe-harbor helper at the home
  // location who keeps a struggling rookie afloat (rest, stims, stipend) and hands
  // out safe starter work until they climb out of the T1 net-worth band.
  const patron = buildPatronNpc({ campaignId, universeId: state.universe.id, factionId: base.parentFactionId });
  state.npcs = [...state.npcs, patron.npc];
  // Seed the opening beat into history at creation so the player's first action
  // is grounded (prevents the narrator re-offering the just-accepted opening job).
  const session0 = {
    state,
    history: buildOpeningHistory(state),
    transcript: [],
    log: [],
    scenes: [],
    focusIds: [],
    tickedThisScene: [],
    combat: null,
    sceneCard: freshSceneCard(),
    npcRelations: { [patron.id]: patron.relation },
    recentScenes: [],
    lastChoices: [],
    jobs: [], // the board seeds on first load (QUESTS.md)
    playerLedger: {}, // no cross-player contacts met yet (MULTIPLAYER.md §2)
  };
  setSession(campaignId, session0);
  await persistSession(campaignId, session0);

  // Background flesh-out: personalized backstory/voice/opening + audit. Runs
  // after the response is sent; the player is already in the review screen.
  after(async () => {
    // Reuse the background prewarm if the player warmed one on the questionnaire→
    // signature step (keyed on story-driving fields, so a differing signature still
    // matches). On any prewarm issue, fall back to a fresh finalize; only if THAT
    // also fails do we abandon the flesh-out, as before.
    const warmed = takePrewarm(user.id, parsed.data);
    let finalize;
    try {
      finalize = warmed ? await warmed : await finalizeCreation(parsed.data, base);
    } catch {
      try {
        finalize = await finalizeCreation(parsed.data, base);
      } catch (e) {
        console.error("[create] background finalize threw:", e instanceof Error ? e.message : e);
        return;
      }
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
        // Rebuild dropped the patron (added in the sync path above) — re-seed it so
        // the safe-harbor helper survives the background flesh-out.
        const p = buildPatronNpc({ campaignId, universeId: session.state.universe.id, factionId: enriched.parentFactionId });
        if (!session.state.npcs.some((n) => n.id === p.id)) session.state.npcs = [...session.state.npcs, p.npc];
        session.npcRelations[p.id] = session.npcRelations[p.id] ?? p.relation;
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
      // Seed people named in the backstory as real, universe-shared NPC entities
      // so the narrator can pull them into play AND other campaigns in this world
      // can meet them (they're promoted to the npcs table on persist). Each gets a
      // role + a location; each tie pre-fills the relationship overlay (CONTINUITY.md
      // tier CANON) with an inferred disposition ("old nemesis" → cold) so the tie
      // renders on their context line from day one. Deterministic from the campaign
      // seed. They are NOT marked present — they exist in the world, not the room.
      const seeds = buildBackstoryNpcs({
        relations: finalize.relations ?? [],
        universeId: session.state.universe.id,
        campaignId,
        characterName: enriched.name,
        ambition: enriched.ambition,
        locationIds: session.state.locations.map((l) => l.id),
        existingNames: session.state.npcs.map((n) => n.name),
      });
      for (const s of seeds) {
        session.state.npcs = [...session.state.npcs, s.npc];
        session.npcRelations[s.id] = s.relation;
      }

      setSession(campaignId, session);
      await persistSession(campaignId, session);
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
