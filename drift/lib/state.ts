import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { CampaignState, Scene } from "@/shared/schemas";
import type { EngineEvent } from "@/engine";
import type { ChatEntry } from "@/shared/chat";
import { buildCampaignState, CAMPAIGN_ID } from "@/scripts/seedData";

/**
 * Server-side campaign store.
 *
 * If Supabase env vars are present it will (in a full deployment) load/save via
 * db/queries. Without them it falls back to an in-memory store seeded from the
 * ported save file — so the app runs locally with only an ANTHROPIC_API_KEY,
 * and the sheet renders even with no key at all.
 *
 * The in-memory store is process-local (fine for solo dev); production swaps in
 * loadCampaignState/saveCampaignState + a snapshot per scene.
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
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSession(campaignId: string): SessionData {
  let s = store.get(campaignId);
  if (!s) {
    s = {
      state: buildCampaignState(),
      history: [],
      transcript: [],
      log: [],
      scenes: [],
      focusIds: [],
    };
    store.set(campaignId, s);
  }
  return s;
}

export function setSession(campaignId: string, data: SessionData): void {
  store.set(campaignId, data);
}

export const DEFAULT_CAMPAIGN_ID = CAMPAIGN_ID;
