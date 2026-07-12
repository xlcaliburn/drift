import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  Universe,
  Campaign,
  Character,
  Ship,
  Faction,
  FactionRep,
  Location,
  Npc,
  Clock,
  Thread,
  Contract,
  type CampaignState,
} from "@/shared/schemas";

/**
 * Row mapping: DB columns are snake_case, app types are camelCase. We convert
 * only TOP-LEVEL keys — jsonb columns (attributes, skills, gear, weapons,
 * milestones, action_modifiers) store the camelCase objects verbatim, so their
 * nested keys must not be touched.
 */
const toSnakeKey = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamelKey = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function mapKeys<T extends Record<string, unknown>>(
  obj: T,
  fn: (k: string) => string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[fn(k)] = v;
  }
  return out;
}

export const toRow = (obj: Record<string, unknown>) => mapKeys(obj, toSnakeKey);
export const fromRow = (row: Record<string, unknown>) => mapKeys(row, toCamelKey);

// ── Clients ────────────────────────────────────────────────────────────────

/** Service-role client (server only — bypasses RLS). Never import in the browser. */
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Anon client (browser-safe, RLS-enforced). */
export function getBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

// ── State assembly ───────────────────────────────────────────────────────────

/** Load and validate a full CampaignState from the database. */
export async function loadCampaignState(
  db: SupabaseClient,
  campaignId: string,
): Promise<CampaignState> {
  const campaignRes = await db.from("campaigns").select("*").eq("id", campaignId).single();
  if (campaignRes.error) throw campaignRes.error;
  const campaign = Campaign.parse(fromRow(campaignRes.data));

  const universeRes = await db.from("universes").select("*").eq("id", campaign.universeId).single();
  const universe = Universe.parse(fromRow(universeRes.data));

  const [chars, ship, facs, rep, locs, npcRows, clks, thr, con] = await Promise.all([
    db.from("characters").select("*").eq("campaign_id", campaignId),
    db.from("ships").select("*").eq("campaign_id", campaignId).maybeSingle(),
    db.from("factions").select("*").eq("universe_id", campaign.universeId),
    db.from("faction_rep").select("*").eq("campaign_id", campaignId),
    db.from("locations").select("*").eq("universe_id", campaign.universeId),
    db.from("npcs").select("*").eq("universe_id", campaign.universeId),
    db.from("clocks").select("*").eq("campaign_id", campaignId),
    db.from("threads").select("*").eq("campaign_id", campaignId),
    db.from("contracts").select("*").eq("campaign_id", campaignId),
  ]);

  return {
    universe,
    campaign,
    characters: (chars.data ?? []).map((r) => Character.parse(fromRow(r))),
    ship: ship.data ? Ship.parse(fromRow(ship.data)) : undefined,
    factions: (facs.data ?? []).map((r) => Faction.parse(fromRow(r))),
    factionRep: (rep.data ?? []).map((r) => FactionRep.parse(fromRow(r))),
    locations: (locs.data ?? []).map((r) => Location.parse(fromRow(r))),
    npcs: (npcRows.data ?? []).map((r) => Npc.parse(fromRow(r))),
    clocks: (clks.data ?? []).map((r) => Clock.parse(fromRow(r))),
    threads: (thr.data ?? []).map((r) => Thread.parse(fromRow(r))),
    contracts: (con.data ?? []).map((r) => Contract.parse(fromRow(r))),
  };
}

/** Persist the mutable slices of a CampaignState after a turn / scene end. */
export async function saveCampaignState(db: SupabaseClient, state: CampaignState): Promise<void> {
  await db.from("campaigns").upsert(toRow(state.campaign));
  await db.from("characters").upsert(state.characters.map((c) => toRow(c)));
  if (state.ship) await db.from("ships").upsert(toRow(state.ship));
  await db.from("faction_rep").upsert(state.factionRep.map((r) => toRow(r)));
  await db.from("clocks").upsert(state.clocks.map((c) => toRow(c)));
  await db.from("threads").upsert(state.threads.map((t) => toRow(t)));
}
