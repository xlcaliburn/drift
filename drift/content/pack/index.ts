import type { Universe, Faction, Location, Npc } from "@/shared/schemas";
import { driftPack } from "./drift";
import type { ContentPack, PackNpc } from "./types";

/**
 * THE ACTIVE CONTENT PACK + its derived views. Consumers import from HERE (never
 * from a world file directly, never hardcoding a canon id) — so rebooting the
 * world is: author a new pack file, swap ONE line below. pack.test.ts validates
 * schema + referential integrity; canonLint.test.ts keeps ids from leaking back
 * into engine/shared/llm/app/components source.
 */
export const pack: ContentPack = driftPack;

// ── Base world rows (the shapes seedData used to export) ─────────────────────

export const UNIVERSE_ID = pack.universe.id;

export const universe: Universe = {
  id: pack.universe.id,
  name: pack.universe.name,
  ownerId: undefined,
  primer: pack.universe.primer,
  styleRules: pack.universe.styleRules,
};

export const factions: Faction[] = pack.factions.map((f) => ({
  id: f.id,
  universeId: UNIVERSE_ID,
  name: f.name,
  description: f.description,
  defaultRep: f.defaultRep,
}));

export const locations: Location[] = pack.locations.map((l) => ({
  id: l.id,
  universeId: UNIVERSE_ID,
  name: l.name,
  description: l.description,
  tags: l.tags,
  tier: l.tier,
}));

export const seedNpcs: Npc[] = pack.cast.map((n) => ({
  id: n.id,
  universeId: UNIVERSE_ID,
  name: n.name,
  oneBreath: n.oneBreath,
  ...(n.factionId ? { factionId: n.factionId } : {}),
  ...(n.locationId ? { locationId: n.locationId } : {}),
  ...(n.role ? { role: n.role } : {}),
}));

// ── Derived views (the shapes the old scattered constants had) ───────────────

/** Faction character for job coherence (QUESTS.md canOffer). */
export const FACTION_ALIGNMENT: Record<string, "official" | "underworld" | "neutral"> = Object.fromEntries(
  pack.factions.map((f) => [f.id, f.alignment]),
);

/** Where each faction's recruits start / its patron is based. */
export const FACTION_HOME: Record<string, string> = Object.fromEntries(
  pack.factions.map((f) => [f.id, f.homeLocationId]),
);

/** UI accent per faction (creation wizard emblems, badges). */
export const FACTION_COLORS: Record<string, string> = Object.fromEntries(
  pack.factions.map((f) => [f.id, f.color]),
);

/** Faction display names — prose highlighting, name-collision guards. */
export const FACTION_NAMES: string[] = pack.factions.map((f) => f.name);

/** Undirected named lanes keyed `${a}|${b}` (a < b) — shared/routes' table. */
export const NAMED_LANES: Record<string, { tendays: number; risk: "low" | "medium" | "high" }> =
  Object.fromEntries(
    pack.locations.flatMap((l) =>
      l.lanes.map((lane) => {
        const key = l.id < lane.to ? `${l.id}|${lane.to}` : `${lane.to}|${l.id}`;
        return [key, { tendays: lane.tendays, risk: lane.risk }] as const;
      }),
    ),
  );

/** Hand-placed map node positions + colors (MapTab layout). */
export const MAP_LAYOUT: Record<string, { x: number; y: number; color: string }> = Object.fromEntries(
  pack.locations.map((l) => [l.id, l.mapPos]),
);

/** The default starting/home location when a faction has none (first T1 hub). */
export const DEFAULT_HOME_LOCATION: string =
  pack.locations.find((l) => l.tier === "T1")?.id ?? pack.locations[0].id;

// ── Authored cast depth (STORY.md, HANDOFF_STORY_2.md Task A) ────────────────

export interface AuthoredCastDepth {
  /** The spoiler-safe hook — world.ts's `[hook: ...]` line prefers this over
   *  the generated fallback (shared/npcFlavor.generateBackstory). */
  backstory?: string;
  /** The gated reveal — rendered ONLY by promptSections/castReveals.ts, and
   *  only while this NPC's storyline chapter is active and they're present. */
  secret?: string;
  /** How they change across the season, one line per act (index 0 = act 1). */
  arc?: string[];
}

/** Pure builder (unit-testable without the live pack) — a cast id → depth map,
 *  keyed for anyone carrying at least one authored field. */
export function buildAuthoredCastDepth(cast: PackNpc[]): Record<string, AuthoredCastDepth> {
  return Object.fromEntries(
    cast
      .filter((n) => n.backstory !== undefined || n.secret !== undefined || n.arc !== undefined)
      .map((n) => [n.id, { backstory: n.backstory, secret: n.secret, arc: n.arc }]),
  );
}

/** Authored depth keyed by pack cast id, built once. This is the ONE read
 *  path for `backstory`/`secret`/`arc` — they are read LIVE from the pack at
 *  prompt-render time, NEVER persisted onto the state-level `Npc` record and
 *  NEVER sent to the client (the seed cast that DOES persist — `seedNpcs`
 *  above — deliberately does not carry these fields; see HANDOFF_STORY_2.md
 *  trap 1). Hot-editable: an owner edit to a cast member's depth in the pack
 *  applies on every campaign's very next turn, same as storyline content. */
const AUTHORED_CAST_DEPTH: Record<string, AuthoredCastDepth> = buildAuthoredCastDepth(pack.cast);

export function authoredCastDepth(npcId: string): AuthoredCastDepth | undefined {
  return AUTHORED_CAST_DEPTH[npcId];
}
