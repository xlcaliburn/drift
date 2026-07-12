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
    // Skip null and undefined. Postgres returns absent optional columns as null,
    // but the Zod schemas use `.optional()` (string | undefined), so a null would
    // fail validation on read — drop it and let the field be absent instead.
    if (v !== undefined && v !== null) out[fn(k)] = v;
  }
  return out;
}

export const toRow = (obj: Record<string, unknown>) => mapKeys(obj, toSnakeKey);
export const fromRow = (row: Record<string, unknown>) => mapKeys(row, toCamelKey);

// ── Clients ────────────────────────────────────────────────────────────────

/** Service-role client (server only — bypasses RLS). Never import in the browser. */
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Missing Supabase service env vars");
  return createClient(url, key, { auth: { persistSession: false } });
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

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  createdAt?: string;
}

/**
 * List a player's campaigns for the home page, newest first. Campaign `name`
 * is the character's name (set at creation), so this is enough for a picker
 * card. Admins pass includeUnowned to also see seeded/unclaimed campaigns
 * (player_id is null) until the claim UPDATE in 002_auth.sql runs.
 * Returns [] on error so the landing page degrades gracefully.
 */
export async function listCampaigns(
  db: SupabaseClient,
  playerId: string,
  opts: { includeUnowned?: boolean; limit?: number } = {},
): Promise<CampaignSummary[]> {
  let query = db
    .from("campaigns")
    .select("id,name,status,created_at")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  query = opts.includeUnowned
    ? query.or(`player_id.eq.${playerId},player_id.is.null`)
    : query.eq("player_id", playerId);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    status: String(r.status),
    createdAt: r.created_at ? String(r.created_at) : undefined,
  }));
}

/**
 * Cheap ownership lookup (indexed single-column select) so /play can check
 * access without loading the whole campaign state. Returns undefined for
 * unowned (seeded) campaigns, null when the campaign doesn't exist.
 */
export async function getCampaignOwner(
  db: SupabaseClient,
  campaignId: string,
): Promise<string | undefined | null> {
  const { data, error } = await db
    .from("campaigns")
    .select("player_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (error || !data) return null;
  return data.player_id ? String(data.player_id) : undefined;
}
