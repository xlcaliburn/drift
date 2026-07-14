import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { CampaignState, Scene } from "@/shared/schemas";
import type { EngineEvent } from "@/engine";
import type { ChatEntry } from "@/shared/chat";
import type { CombatState } from "@/shared/combat";
import { freshSceneCard, type SceneCard, type NpcRelations, type SceneMemory } from "@/shared/scene";
import { mergeNpcs } from "@/shared/npcMerge";
import type { ChoiceOption } from "@/shared/turnPlan";

/** Campaign-scoped NPCs (narrator-introduced or creation relations) carry these id
 *  prefixes; universe-seed NPCs do not. Used to split the two for persistence. */
function isCampaignNpc(id: string): boolean {
  return id.startsWith("npc-gen-") || id.startsWith("npc-rel-");
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
              combat: runtime.combat,
              // Legacy runtimes (pre-012) have no card — start one at the current
              // transcript tail so the first summarized scene isn't the whole log.
              sceneCard:
                runtime.sceneCard ?? freshSceneCard(recentScenes.length + 1, runtime.transcript.length),
              npcRelations: runtime.npcRelations ?? {},
              recentScenes,
              lastChoices: runtime.lastChoices ?? [],
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
              npcRelations: {},
              recentScenes,
              lastChoices: [],
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
    const campaignNpcs = session.state.npcs.filter((n) => isCampaignNpc(n.id));
    // Promote them into the UNIVERSE-scoped npcs table so other campaigns in the
    // same world can meet them (shared canon). Stamp provenance if unset. Failure
    // to promote must not break the turn — the per-campaign runtime copy below is
    // still the durable fallback (mergeNpcs prefers the table row when both exist).
    try {
      await upsertNpcs(
        db,
        campaignNpcs.map((n) => (n.originCampaignId ? n : { ...n, originCampaignId: campaignId })),
      );
    } catch (e) {
      console.error(
        `[state] failed to promote NPCs for campaign ${campaignId}:`,
        e instanceof Error ? e.message : e,
      );
    }
    await saveCampaignRuntime(db, campaignId, {
      transcript: session.transcript,
      history: session.history,
      log: session.log,
      focusIds: session.focusIds,
      tickedThisScene: session.tickedThisScene,
      combat: session.combat,
      // Keep writing the campaign's OWN NPCs to the runtime snapshot too, for
      // back-compat: a campaign saved before 014's promotion still restores them.
      npcs: campaignNpcs,
      sceneCard: session.sceneCard,
      npcRelations: session.npcRelations,
      lastChoices: session.lastChoices,
    });
  } catch (e) {
    console.error(
      `[state] failed to persist campaign ${campaignId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}
