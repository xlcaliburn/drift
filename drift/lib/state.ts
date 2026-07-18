import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { CampaignState, Scene } from "@/shared/schemas";
import type { EngineEvent } from "@/engine";
import type { ChatEntry } from "@/shared/chat";
import type { CombatState } from "@/shared/combat";
import { freshSceneCard, type SceneCard, type NpcRelations, type SceneMemory } from "@/shared/scene";
import { mergeNpcs } from "@/shared/npcMerge";
import { isShareableNpcName, isPlausibleNpcName } from "@/shared/npcExtract";
import { mapLegacyGear } from "@/shared/items";
import { normalizeFrozenShip2 } from "@/shared/ship2";
import { ensureStartingGun, ensurePatronSeed } from "@/engine/creation";
import type { ChoiceOption } from "@/shared/turnPlan";
import type { Job } from "@/shared/quests";
import type { PlayerLedger } from "@/shared/ledger";
import type { Fact } from "@/shared/facts";
import { freshStorylineState, type StorylineState } from "@/shared/storyline";
import type { Dossier } from "@/shared/multiplayer";
import type { CampaignRuntime } from "@/db/queries";

/** Campaign-scoped NPCs (narrator-introduced or creation relations) carry these id
 *  prefixes; universe-seed NPCs do not. Used to split the two for persistence. */
function isCampaignNpc(id: string): boolean {
  return (
    id.startsWith("npc-gen-") ||
    id.startsWith("npc-rel-") ||
    id.startsWith("npc-patron-") ||
    // Quest cast members (HANDOFF_NPC_CANON Task D — shared/quests.ts materializeJobCast).
    id.startsWith("npc-job-")
  );
}

/**
 * Server-side campaign store.
 *
 * Sessions live in a process-local in-memory cache (fine for solo dev), backed
 * by Supabase when configured (loadCampaignState/saveCampaignState + a snapshot
 * per scene). There is NO demo/seed fallback: every campaign is created at
 * runtime from character creation, so an unknown id resolves to null.
 */
export interface SessionData {
  state: CampaignState;
  history: Anthropic.MessageParam[];
  /** Display-ready narration transcript (survives client refresh). */
  transcript: ChatEntry[];
  log: EngineEvent[];
  scenes: Scene[];
  /** Rolling entity focus carried from the previous scene's refs. */
  focusIds: string[];
  /** Skills already ticked this scene ("characterId:skill") — per-scene cap. */
  tickedThisScene: string[];
  /** Active multi-turn combat, or null when not fighting. */
  combat: CombatState | null;
  /** Current scene's working memory (CONTINUITY.md tier NOW). */
  sceneCard: SceneCard;
  /** Player's standing per NPC id (CONTINUITY.md tier CANON). */
  npcRelations: NpcRelations;
  /** Recent scene summaries, oldest→newest (CONTINUITY.md tier RECENT). */
  recentScenes: SceneMemory[];
  /** Last offered suggested actions, restored on refresh. */
  lastChoices: ChoiceOption[];
  /** The procedural job board (QUESTS.md) — offered + active + completed scores. */
  jobs: Job[];
  /** The relationship ledger (MULTIPLAYER.md §2) — who this character has MET among
   *  other players' characters; gates cross-player cameos. */
  playerLedger: PlayerLedger;
  /** The FACTS LEDGER (CONTINUITY.md v2) — durable standing facts (deal terms,
   *  appointments, bans, debts), engine-capped + deduped. */
  facts: Fact[];
  /** The authored main-questline progress (STORY.md, HANDOFF_STORY_1.md Task C)
   *  — chapter/beat/choice POINTERS only, never pack content (dormant while
   *  the live pack ships zero chapters). */
  storyline: StorylineState;
  /** The `campaign_runtime` row's `updated_at` AS LAST SEEN by this session —
   *  the optimistic-concurrency baseline `persistSession` compares against on
   *  write (CHECKS.md §0 "campaign_runtime CAS"). Undefined for a session that
   *  hasn't round-tripped the DB yet (fresh creation, or keyless dev mode). */
  runtimeUpdatedAt?: string;
}

const store = new Map<string, SessionData>();

export function hasSupabase(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

/**
 * Resolve a session: in-memory cache first, then Supabase for persisted
 * campaigns. Returns null when the campaign exists in neither — there is no demo
 * fallback, so callers should surface a "not found / create a character" state.
 */
export async function getSession(campaignId: string): Promise<SessionData | null> {
  const cached = store.get(campaignId);
  if (cached) return cached;

  if (hasSupabase()) {
    try {
      const { getServiceClient, loadCampaignState, loadCampaignRuntime, loadRecentScenes } = await import("@/db/queries");
      const db = getServiceClient();
      const [state, runtime, recentScenes] = await Promise.all([
        loadCampaignState(db, campaignId),
        loadCampaignRuntime(db, campaignId),
        loadRecentScenes(db, campaignId),
      ]);
      // Restore the durable runtime snapshot (transcript, history, dice log) so a
      // cold load resumes the latest run. Only fall back to a freshly-seeded
      // opening beat when nothing has been persisted yet (a legacy pre-M7 campaign).
      const { buildOpeningHistory } = await import("@/shared/recap");
      // Fold the campaign's private NPCs (persisted on the runtime) back into the
      // universe-seed cast so narrator-introduced NPCs survive a cold reload.
      if (runtime?.npcs?.length) state.npcs = mergeNpcs(state.npcs, runtime.npcs);
      // On load: attach catalog ids to freeform gear (ITEMS.md IT-1), then GUARANTEE
      // every PC has a gun — a legacy character whose old background gave no firearm
      // gets their faction sidearm. Both idempotent (mapped gear + already-armed PCs
      // pass through); they persist on the next save.
      state.characters = state.characters.map((c) => ensureStartingGun(mapLegacyGear(c)));
      // Backstop the faction PATRON (STARTER.md) for campaigns created before patrons
      // existed — so the free early-game safety net reaches legacy players too. The
      // relation is seeded onto the restored npcRelations below (once it's resolved).
      const patronSeed = ensurePatronSeed(state);
      if (patronSeed) state.npcs = [...state.npcs, patronSeed.npc];
      const session: SessionData =
        runtime && runtime.history.length
          ? {
              state,
              history: runtime.history,
              transcript: runtime.transcript,
              log: runtime.log,
              scenes: [],
              focusIds: runtime.focusIds,
              tickedThisScene: runtime.tickedThisScene,
              // system normalization (Modularity M5, HANDOFF_COMBAT_V2_1 Task B):
              // combat loads as RAW jsonb (no Zod parse), so a fight persisted
              // before this deploy has no `system` — spread order matters, a
              // STORED system (once ship2 exists) must win over the default.
              // The frozen ship2 profile gets the same treatment (mount `key`s
              // arrived in HANDOFF_COMBAT_V2_3 Task A — normalizeFrozenShip2).
              combat: runtime.combat
                ? {
                    system: "classic" as const,
                    ...runtime.combat,
                    ...(runtime.combat.ship2 ? { ship2: normalizeFrozenShip2(runtime.combat.ship2) } : {}),
                  }
                : null,
              // Legacy runtimes (pre-012) have no card — start one at the current
              // transcript tail so the first summarized scene isn't the whole log.
              sceneCard:
                runtime.sceneCard ?? freshSceneCard(recentScenes.length + 1, runtime.transcript.length),
              npcRelations: {
                ...(runtime.npcRelations ?? {}),
                // Seed the backstopped patron's warm standing, but never clobber an
                // existing one (a campaign that already has the relation keeps it).
                ...(patronSeed && !runtime.npcRelations?.[patronSeed.id]
                  ? { [patronSeed.id]: patronSeed.relation }
                  : {}),
              },
              recentScenes,
              lastChoices: runtime.lastChoices ?? [],
              // Legacy-shape guard: jobs load as RAW jsonb (no Zod parse), so a
              // job persisted before the cast-manifest deploy has NO `cast` —
              // normalize here or every `j.cast.length` read crashes the turn
              // (at review time, 100% of live campaigns carried cast-less jobs).
              jobs: (runtime.jobs ?? []).map((j) => ({ ...j, cast: j.cast ?? [] })),
              playerLedger: runtime.playerLedger ?? {},
              facts: runtime.facts ?? [],
              // storyline loads as RAW jsonb (no Zod parse) — a legacy row (pre-
              // migration default, or simply never touched) carries `{}`, which
              // has no `chapters` map. Normalize to a fresh state rather than
              // let every `storyline.chapters[...]` read crash the turn.
              storyline: runtime.storyline?.chapters ? runtime.storyline : freshStorylineState(),
              // CAS baseline (CHECKS.md §0): the version of campaign_runtime this
              // session was loaded from — persistSession compares against it.
              runtimeUpdatedAt: runtime.updatedAt,
            }
          : {
              state,
              history: buildOpeningHistory(state),
              transcript: [],
              log: [],
              scenes: [],
              focusIds: [],
              tickedThisScene: [],
              combat: null,
              sceneCard: freshSceneCard(),
              npcRelations: patronSeed ? { [patronSeed.id]: patronSeed.relation } : {},
              recentScenes,
              lastChoices: [],
              jobs: [],
              playerLedger: {},
              facts: [],
              storyline: freshStorylineState(),
              // No prior runtime row (legacy pre-M7 campaign) — first save is a
              // plain upsert (persistSession passes no expectedUpdatedAt).
              runtimeUpdatedAt: undefined,
            };
      store.set(campaignId, session);
      return session;
    } catch (e) {
      console.error(
        `[state] failed to load campaign ${campaignId} from DB:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return null;
}

export function setSession(campaignId: string, data: SessionData): void {
  store.set(campaignId, data);
}

/**
 * Persist a campaign to Supabase: the mechanical CampaignState AND the durable
 * runtime snapshot (transcript, narrator history, dice log, focus) so a later
 * cold load resumes the latest run. No-op without Supabase. Errors are logged,
 * not thrown — a failed write must not break a turn (the in-memory session is
 * still authoritative for the round).
 */
export async function persistSession(campaignId: string, session: SessionData): Promise<void> {
  if (!hasSupabase()) return;
  try {
    const { getServiceClient, saveCampaignState, saveCampaignRuntime, upsertNpcs } = await import("@/db/queries");
    const db = getServiceClient();
    await saveCampaignState(db, session.state);
    // NPCs this campaign generated (narrator-introduced + creation relations).
    // Junk-named entries a past extraction let through ("Distant" from "Distant
    // shouts echo…") are dropped here so they neither promote to the shared world
    // NOR persist in the runtime cast — a warm session carrying one self-heals on
    // its next save (isPlausibleNpcName now rejects such names).
    // This campaign's OWN generated NPCs only. `isCampaignNpc` is id-prefix based and
    // campaign-BLIND (npc-patron-/npc-rel-/npc-gen- from ANY campaign match), so a
    // foreign NPC that flooded in via the old universe-wide load would otherwise get
    // re-persisted into this runtime and accrete forever. Gate on provenance too: keep
    // only NPCs with no origin (legacy own) or this campaign's origin — never another
    // campaign's (the Wren bleed). Seed NPCs (no npc-gen/rel/patron prefix) are shared,
    // not campaign-local, so they're excluded here by design.
    const campaignNpcs = session.state.npcs.filter(
      (n) =>
        isCampaignNpc(n.id) &&
        isPlausibleNpcName(n.name) &&
        (!n.originCampaignId || n.originCampaignId === campaignId),
    );
    // Promote them into the UNIVERSE-scoped npcs table so other campaigns in the
    // same world can meet them (shared canon). Stamp provenance if unset. Failure
    // to promote must not break the turn — the per-campaign runtime copy below is
    // still the durable fallback (mergeNpcs prefers the table row when both exist).
    // Only genuinely-named individuals leak to the shared world: a collective mob
    // ("Two heavies") or a bare role ("Guard") stays campaign-local, else every
    // campaign's nameless extras would collapse into one shared "NPC".
    try {
      await upsertNpcs(
        db,
        campaignNpcs
          .filter((n) => isShareableNpcName(n.name))
          .map((n) => (n.originCampaignId ? n : { ...n, originCampaignId: campaignId })),
      );
    } catch (e) {
      console.error(
        `[state] failed to promote NPCs for campaign ${campaignId}:`,
        e instanceof Error ? e.message : e,
      );
    }
    // OPTIMISTIC CONCURRENCY (CHECKS.md §0): writers on campaign_runtime have
    // multiplied (the live turn, background scene compression, the mid-scene
    // analyst, degraded repair, manual re-sync), so this write is a
    // compare-and-swap against the row's `updated_at` AS LAST SEEN by this
    // session, not a blind upsert. On CONFLICT, fold the other writer's
    // background-owned slices (facts/npcs/recentScenes) into ours and retry
    // ONCE; a second conflict force-writes (never let bookkeeping block a turn).
    // `runtimeNpcs`/`facts` are mutable locals so a conflict-merge can update
    // what the retry writes without touching `session` until we know it stuck.
    let runtimeNpcs = campaignNpcs;
    let facts = session.facts ?? [];
    const runtimePayload = () => ({
      transcript: session.transcript,
      history: session.history,
      log: session.log,
      focusIds: session.focusIds,
      tickedThisScene: session.tickedThisScene,
      combat: session.combat,
      // Keep writing the campaign's OWN NPCs to the runtime snapshot too, for
      // back-compat: a campaign saved before 014's promotion still restores them.
      npcs: runtimeNpcs,
      sceneCard: session.sceneCard,
      npcRelations: session.npcRelations,
      lastChoices: session.lastChoices,
      jobs: session.jobs ?? [],
      playerLedger: session.playerLedger ?? {},
      facts,
      storyline: session.storyline ?? freshStorylineState(),
    });

    let result = await saveCampaignRuntime(db, campaignId, runtimePayload(), {
      expectedUpdatedAt: session.runtimeUpdatedAt,
    });

    if (result.conflict) {
      let fresh: CampaignRuntime | null = null;
      try {
        const { loadCampaignRuntime, loadRecentScenes } = await import("@/db/queries");
        const { mergeFactsOnConflict, mergeNpcsOnConflict, mergeRecentScenesOnConflict } = await import(
          "@/shared/runtimeMerge"
        );
        const [freshRuntime, freshScenes] = await Promise.all([
          loadCampaignRuntime(db, campaignId),
          loadRecentScenes(db, campaignId),
        ]);
        fresh = freshRuntime;
        if (fresh) {
          facts = mergeFactsOnConflict(fresh.facts, facts);
          runtimeNpcs = mergeNpcsOnConflict(fresh.npcs, runtimeNpcs);
          session.recentScenes = mergeRecentScenesOnConflict(freshScenes, session.recentScenes);
        }
      } catch (e) {
        console.error(
          `[state] conflict-merge reload failed for campaign ${campaignId}:`,
          e instanceof Error ? e.message : e,
        );
      }
      result = fresh
        ? await saveCampaignRuntime(db, campaignId, runtimePayload(), { expectedUpdatedAt: fresh.updatedAt })
        : { conflict: true, updatedAt: session.runtimeUpdatedAt ?? new Date().toISOString() };

      if (result.conflict) {
        // Two conflicts in a row (or the reload itself failed) — stop trying to
        // be clever and just land the write. Rare at playtest scale; a stuck
        // turn is worse than a rare overwrite of a meanwhile-superseded pass.
        console.warn(`[state] campaign_runtime CAS conflicted twice for ${campaignId} — force-writing`);
        result = await saveCampaignRuntime(db, campaignId, runtimePayload());
      }
    }
    // Reflect what actually landed, and advance the CAS baseline so the NEXT
    // persist on this (in-memory-cached) session object compares against what
    // we just wrote, not a stale version.
    session.facts = facts;
    session.runtimeUpdatedAt = result.updatedAt;
    // Build this PC's PUBLIC dossier and promote it into the UNIVERSE-scoped
    // dossiers table so other campaigns in the same world can cameo the character
    // (shared canon — mirrors the NPC promotion above). Recent world_events feed
    // the deeds. Guarded on its own so a failure here NEVER breaks the turn.
    try {
      const { buildDossier } = await import("@/shared/dossier");
      const { loadWorldEventsBySource, upsertDossier } = await import("@/db/queries");
      const worldEvents = await loadWorldEventsBySource(db, campaignId, 5);
      const dossier = { ...buildDossier(session.state, worldEvents), updatedAt: new Date().toISOString() };
      await upsertDossier(db, dossier);
    } catch (e) {
      console.error(
        `[state] failed to promote dossier for campaign ${campaignId}:`,
        e instanceof Error ? e.message : e,
      );
    }
  } catch (e) {
    console.error(
      `[state] failed to persist campaign ${campaignId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Every PC dossier reachable from this campaign — all dossiers in the same
 * universe EXCEPT the caller's own. This is the read-surface a turn pulls to
 * cameo other players' characters as NPCs (shared narrative canon). Cross-campaign
 * play needs the DB, so keyless/in-memory mode returns [] rather than crashing.
 * Errors are logged and degrade to [] — a dossier read must never break a turn.
 */
export async function loadReachableDossiers(
  universeId: string,
  selfCampaignId: string,
): Promise<Dossier[]> {
  if (!hasSupabase()) return [];
  try {
    const { getServiceClient, loadDossiersByUniverse } = await import("@/db/queries");
    const db = getServiceClient();
    const all = await loadDossiersByUniverse(db, universeId);
    return all.filter((d) => d.campaignId !== selfCampaignId);
  } catch (e) {
    console.error(
      `[state] failed to load reachable dossiers for universe ${universeId}:`,
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}
