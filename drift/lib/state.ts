import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { CampaignState, Scene } from "@/shared/schemas";
import type { EngineEvent } from "@/engine";
import type { ChatEntry } from "@/shared/chat";

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
      const { getServiceClient, loadCampaignState } = await import("@/db/queries");
      const state = await loadCampaignState(getServiceClient(), campaignId);
      const { buildOpeningHistory } = await import("@/shared/recap");
      // Seed the opening beat into history so a cold-loaded campaign (in-memory
      // history is not persisted — M7) still grounds the model's first turn and
      // doesn't re-narrate the opening job.
      const session: SessionData = {
        state,
        history: buildOpeningHistory(state),
        transcript: [],
        log: [],
        scenes: [],
        focusIds: [],
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
 * Persist a campaign's durable state to Supabase. No-op without Supabase.
 * Errors are logged, not thrown — a failed write must not break a turn (the
 * in-memory session is still authoritative for the round).
 */
export async function persistSession(campaignId: string, state: CampaignState): Promise<void> {
  if (!hasSupabase()) return;
  try {
    const { getServiceClient, saveCampaignState } = await import("@/db/queries");
    await saveCampaignState(getServiceClient(), state);
  } catch (e) {
    console.error(
      `[state] failed to persist campaign ${campaignId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}
