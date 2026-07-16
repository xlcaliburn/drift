import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
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
  WorldEvent,
  type CampaignState,
} from "@/shared/schemas";
import type { ChatEntry } from "@/shared/chat";
import type { EngineEvent } from "@/engine";
import type { CombatState } from "@/shared/combat";
import type { SceneCard, NpcRelations, SceneMemory } from "@/shared/scene";
import type { ChoiceOption } from "@/shared/turnPlan";
import type { Job } from "@/shared/quests";
import type { Dossier } from "@/shared/multiplayer";
import type { PlayerLedger } from "@/shared/ledger";

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
    // Only the CANONICAL SEED cast (the world's "constants") is shared into every
    // campaign — hand-authored NPCs have no origin_campaign_id. NPCs promoted FROM a
    // campaign (origin set) stay out of other players' casts: a campaign sees the seed
    // constants + its OWN generated NPCs (folded back from campaign_runtime.npcs), so
    // one player's fixers/patrons don't flood everyone else's game (the "Wren had 31
    // foreign NPCs" bleed). Cross-player CHARACTER cameos still ride the gated dossiers.
    db.from("npcs").select("*").eq("universe_id", campaign.universeId).is("origin_campaign_id", null),
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

/**
 * Promote generated NPCs into the UNIVERSE-scoped npcs table so every campaign in
 * the same world can meet them (shared narrative canon). Upsert-by-id, last-write
 * wins — two campaigns generating concurrently can't corrupt each other, they just
 * race on the same row. Per-player standing is NOT written here (it stays private
 * on campaign_runtime.npc_relations). No-op on an empty list.
 */
export async function upsertNpcs(db: SupabaseClient, npcs: Npc[]): Promise<void> {
  if (!npcs.length) return;
  await db.from("npcs").upsert(npcs.map((n) => toRow(n)));
}

/** Refresh a shared NPC's one-line identity (scene analyst — upgrading a thin or
 *  placeholder description once a scene has revealed who they really are). */
export async function updateNpcOneBreath(db: SupabaseClient, id: string, oneBreath: string): Promise<void> {
  await db.from("npcs").update({ one_breath: oneBreath }).eq("id", id);
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

// ── Admin editor: targeted deletes/clears an upsert-only persist can't express ─
// (saveCampaignState only UPSERTs, and toRow drops null/undefined — so removing an
// item from a state array or clearing a column leaves a stale row that resurrects
// on the next cold load. The admin campaign editor runs these AFTER persistSession.)

/** Hard-delete generated NPC rows from the universe cast (admin removal). Guarded
 *  to `npc-gen-`/`npc-rel-` ids so seed canon can never be deleted. No-op if empty. */
export async function deleteNpcsByIds(db: SupabaseClient, ids: string[]): Promise<void> {
  const safe = ids.filter((id) => id.startsWith("npc-gen-") || id.startsWith("npc-rel-"));
  if (!safe.length) return;
  await db.from("npcs").delete().in("id", safe);
}

/** Delete threads the admin removed from a campaign's story. No-op if empty. */
export async function deleteThreadsByIds(db: SupabaseClient, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.from("threads").delete().in("id", ids);
}

/** Delete clocks the admin removed from a campaign. No-op if empty. */
export async function deleteClocksByIds(db: SupabaseClient, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.from("clocks").delete().in("id", ids);
}

/** Explicitly NULL a character's death_saves column (a revive) — an upsert with
 *  `deathSaves: undefined` can't clear it because toRow drops the key. */
export async function clearCharacterDeathSaves(db: SupabaseClient, characterId: string): Promise<void> {
  await db.from("characters").update({ death_saves: null }).eq("id", characterId);
}

// ── Durable play-session runtime (M7) ────────────────────────────────────────

/** The live-session slices that aren't part of the mechanical CampaignState:
 *  the display transcript, the narrator's model history, the dice/event log, and
 *  the rolling entity focus. Snapshotted per campaign so a refresh/restart resumes
 *  the latest run instead of rebuilding just the opening recap. */
export interface CampaignRuntime {
  transcript: ChatEntry[];
  history: Anthropic.MessageParam[];
  log: EngineEvent[];
  focusIds: string[];
  /** Skills already ticked this scene ("characterId:skill" keys). */
  tickedThisScene: string[];
  /** Active multi-turn combat, or null. */
  combat: CombatState | null;
  /** Campaign-scoped NPCs (narrator-introduced + creation relations) — kept here,
   *  NOT in the universe-shared npcs table, so a player's cast stays private. */
  npcs: Npc[];
  /** Current scene's working memory (CONTINUITY.md tier NOW). */
  sceneCard: SceneCard | null;
  /** Player's standing per NPC id (CONTINUITY.md tier CANON). */
  npcRelations: NpcRelations;
  /** Last offered suggested actions, so a refresh restores the chips. */
  lastChoices: ChoiceOption[];
  /** The procedural job board — offered + active + recently-completed scores
   *  (QUESTS.md). Engine-owned; a session slice like npcs/sceneCard. */
  jobs: Job[];
  /** The relationship ledger — who this character has MET among other players'
   *  characters (MULTIPLAYER.md §2). A session slice like jobs/npcRelations. */
  playerLedger: PlayerLedger;
  updatedAt?: string;
}

/** Load a campaign's runtime snapshot, or null if none has been saved yet. */
export async function loadCampaignRuntime(
  db: SupabaseClient,
  campaignId: string,
): Promise<CampaignRuntime | null> {
  const { data, error } = await db
    .from("campaign_runtime")
    .select("transcript,history,log,focus_ids,ticked_this_scene,combat,npcs,scene_card,npc_relations,last_choices,jobs,player_ledger,updated_at")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    transcript: (data.transcript as ChatEntry[]) ?? [],
    history: (data.history as Anthropic.MessageParam[]) ?? [],
    log: (data.log as EngineEvent[]) ?? [],
    focusIds: (data.focus_ids as string[]) ?? [],
    tickedThisScene: (data.ticked_this_scene as string[]) ?? [],
    combat: (data.combat as CombatState | null) ?? null,
    npcs: (data.npcs as Npc[]) ?? [],
    sceneCard: (data.scene_card as SceneCard | null) ?? null,
    npcRelations: (data.npc_relations as NpcRelations) ?? {},
    lastChoices: (data.last_choices as ChoiceOption[]) ?? [],
    jobs: (data.jobs as Job[]) ?? [],
    playerLedger: (data.player_ledger as PlayerLedger) ?? {},
    updatedAt: data.updated_at ? String(data.updated_at) : undefined,
  };
}

/** Upsert a campaign's runtime snapshot (transcript, history, log, focus). */
export async function saveCampaignRuntime(
  db: SupabaseClient,
  campaignId: string,
  rt: Pick<
    CampaignRuntime,
    "transcript" | "history" | "log" | "focusIds" | "tickedThisScene" | "combat" | "npcs" | "sceneCard" | "npcRelations" | "lastChoices" | "jobs" | "playerLedger"
  >,
): Promise<void> {
  await db.from("campaign_runtime").upsert({
    campaign_id: campaignId,
    transcript: rt.transcript,
    history: rt.history,
    log: rt.log,
    focus_ids: rt.focusIds,
    ticked_this_scene: rt.tickedThisScene,
    combat: rt.combat,
    npcs: rt.npcs,
    scene_card: rt.sceneCard,
    npc_relations: rt.npcRelations,
    last_choices: rt.lastChoices,
    jobs: rt.jobs,
    player_ledger: rt.playerLedger,
    updated_at: new Date().toISOString(),
  });
}

// ── Scene summaries (CONTINUITY.md tier RECENT) ──────────────────────────────

/** Persist one compressed scene record. */
export async function saveScene(
  db: SupabaseClient,
  campaignId: string,
  scene: SceneMemory,
): Promise<void> {
  await db.from("scenes").upsert({
    id: `scene-${campaignId}-${scene.seq}`,
    campaign_id: campaignId,
    seq: scene.seq,
    title: scene.title,
    location_id: scene.locationId ?? null,
    summary: scene.summary,
    entity_refs: scene.entityRefs,
    ended_at: new Date().toISOString(),
  });
}

/** Load a campaign's most recent scene summaries, oldest→newest. */
export async function loadRecentScenes(
  db: SupabaseClient,
  campaignId: string,
  limit = 20,
): Promise<SceneMemory[]> {
  const { data, error } = await db
    .from("scenes")
    .select("seq,title,summary,entity_refs,location_id")
    .eq("campaign_id", campaignId)
    .order("seq", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data
    .map((r) => ({
      seq: Number(r.seq),
      title: String(r.title ?? ""),
      summary: String(r.summary ?? ""),
      entityRefs: (r.entity_refs as string[]) ?? [],
      locationId: r.location_id ? String(r.location_id) : undefined,
    }))
    .filter((s) => s.summary.length > 0)
    .reverse();
}

// ── Universe-shared PC dossiers (MULTIPLAYER.md) ─────────────────────────────

/**
 * Upsert a PC's public dossier into the UNIVERSE-scoped dossiers table so every
 * other campaign in the same world can read it (shared narrative canon — like the
 * npcs table). Keyed by campaign_id (one PC per campaign); last-write-wins, so a
 * rebuild each turn just refreshes the row. The full public projection rides in
 * the `data` jsonb column verbatim; universe_id + character_id are lifted out for
 * indexed cross-campaign reads. Stamps updated_at at write time.
 */
export async function upsertDossier(db: SupabaseClient, dossier: Dossier): Promise<void> {
  await db.from("dossiers").upsert({
    campaign_id: dossier.campaignId,
    character_id: dossier.characterId,
    universe_id: dossier.universeId,
    data: dossier,
    updated_at: new Date().toISOString(),
  });
}

/**
 * A campaign's most recent world_events (spillover it authored), newest first,
 * capped small. Fed into buildDossier so a dossier can surface the PC's notable
 * deeds. Returns [] on error so a dossier rebuild degrades to no-deeds, never throws.
 */
export async function loadWorldEventsBySource(
  db: SupabaseClient,
  sourceCampaignId: string,
  limit = 5,
): Promise<WorldEvent[]> {
  const { data, error } = await db
    .from("world_events")
    .select("*")
    .eq("source_campaign_id", sourceCampaignId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((r) => WorldEvent.parse(fromRow(r)));
}

/** Load every PC dossier in a universe (the `data` jsonb parsed as Dossier[]). */
export async function loadDossiersByUniverse(
  db: SupabaseClient,
  universeId: string,
): Promise<Dossier[]> {
  const { data, error } = await db
    .from("dossiers")
    .select("data")
    .eq("universe_id", universeId);
  if (error || !data) return [];
  return data.map((r) => r.data as Dossier);
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  createdAt?: string;
  /** World (universe) this campaign lives in. */
  universeName?: string;
  /** The PC's starting faction id (name resolved from content briefs). */
  factionId?: string;
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
    // Embeds ride the FKs: the world's name, and the PC's faction for the card.
    .select("id,name,status,created_at,universes(name),characters(kind,parent_faction_id)")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  query = opts.includeUnowned
    ? query.or(`player_id.eq.${playerId},player_id.is.null`)
    : query.eq("player_id", playerId);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r) => {
    const uni = r.universes as { name?: string } | { name?: string }[] | null;
    const chars = (r.characters as { kind?: string; parent_faction_id?: string }[] | null) ?? [];
    const pc = chars.find((c) => c.kind === "pc");
    return {
      id: String(r.id),
      name: String(r.name),
      status: String(r.status),
      createdAt: r.created_at ? String(r.created_at) : undefined,
      universeName: Array.isArray(uni) ? uni[0]?.name : uni?.name ?? undefined,
      factionId: pc?.parent_faction_id ? String(pc.parent_faction_id) : undefined,
    };
  });
}

/**
 * The player's canonical character (campaign), or null if they have none. Used
 * to enforce one-character-per-player: creation is blocked when this returns
 * non-null, and callers redirect the player to it.
 *
 * The keeper is the MOST-PROGRESSED campaign — most resolved quests, then most
 * in-game time (tendays_elapsed), then oldest as a stable final tiebreak. This
 * mirrors migration 005's corrected cleanup ranking exactly, so the row the UI
 * sends a player to is the same one the storage-layer cleanup keeps. After that
 * cleanup runs (partial unique index from 004) a player owns at most one
 * campaign, so the ranking below only ever matters for the pre-cleanup /
 * transient-duplicate case.
 */
export async function getOwnedCampaign(
  db: SupabaseClient,
  playerId: string,
): Promise<{ id: string; name: string } | null> {
  const { data: camps, error } = await db
    .from("campaigns")
    .select("id,name,tendays_elapsed,created_at")
    .eq("player_id", playerId)
    .neq("status", "deceased"); // a dead character no longer blocks a new one
  if (error || !camps || camps.length === 0) return null;
  if (camps.length === 1) return { id: String(camps[0].id), name: String(camps[0].name) };

  // Rare multi-campaign case (only before 004's cleanup, or a transient race):
  // rank by progress. Resolved-quest counts need a second query since they live
  // in the threads table; the campaign set here is tiny (a player's dupes).
  const ids = camps.map((c) => String(c.id));
  const { data: threadRows } = await db
    .from("threads")
    .select("campaign_id")
    .eq("status", "resolved")
    .in("campaign_id", ids);
  const resolved = new Map<string, number>();
  for (const t of threadRows ?? []) {
    const k = String((t as { campaign_id: string }).campaign_id);
    resolved.set(k, (resolved.get(k) ?? 0) + 1);
  }
  const keeper = [...camps].sort((a, b) => {
    const ra = resolved.get(String(a.id)) ?? 0;
    const rb = resolved.get(String(b.id)) ?? 0;
    if (rb !== ra) return rb - ra; // most resolved quests
    const ta = Number((a as { tendays_elapsed?: number }).tendays_elapsed ?? 0);
    const tb = Number((b as { tendays_elapsed?: number }).tendays_elapsed ?? 0);
    if (tb !== ta) return tb - ta; // most in-game time
    return String((a as { created_at?: string }).created_at ?? "").localeCompare(
      String((b as { created_at?: string }).created_at ?? ""),
    ); // oldest first
  })[0];
  return { id: String(keeper.id), name: String(keeper.name) };
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
