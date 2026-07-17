import { z } from "zod";

/**
 * THE CONTENT PACK SCHEMA — the single authored source of world truth. Everything
 * the engine/UI needs to know about a universe that ISN'T mechanics lives here:
 * the setting primer, factions (with the fields play taught us to require),
 * locations (with map placement + hand-tuned travel lanes), the canonical cast,
 * and the job-generation flavor pools.
 *
 * The point of the seam: rebooting the WORLD is authoring a new pack, not a
 * refactor. Canon ids must never be hardcoded outside content/ — the canon-lint
 * test enforces it, and pack.test.ts validates referential integrity so a typo'd
 * home/lane/faction id fails CI instead of silently breaking retrieval.
 */

export const RouteRiskZ = z.enum(["low", "medium", "high"]);

export const PackLane = z.object({
  /** Destination location id (lanes are undirected — author on either endpoint). */
  to: z.string(),
  tendays: z.number().int().min(1).max(9),
  risk: RouteRiskZ,
  /** Why this lane is what it is — authoring note, never shown. */
  note: z.string().optional(),
});

export const PackLocation = z.object({
  id: z.string().regex(/^loc-[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()),
  /** LOCATIONS.md danger band: T1 secure / T2 rough / T3 deadly. */
  tier: z.enum(["T1", "T2", "T3"]),
  /** Hand-placed map position + node color (the MapTab layout). */
  mapPos: z.object({ x: z.number(), y: z.number(), color: z.string() }),
  /** Hand-tuned named lanes FROM this location (formula covers the rest). */
  lanes: z.array(PackLane).default([]),
});
export type PackLocation = z.infer<typeof PackLocation>;

export const PackFaction = z.object({
  id: z.string().regex(/^f-[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  defaultRep: z.number().int().default(0),
  /** Job-coherence character (QUESTS.md): who can plausibly OFFER what work. */
  alignment: z.enum(["official", "underworld", "neutral"]),
  /** Where this faction's recruits start / its patron is based. */
  homeLocationId: z.string(),
  /** UI accent for this faction (creation wizard, badges). */
  color: z.string(),
});
export type PackFaction = z.infer<typeof PackFaction>;

/** A canonical cast member — every field a season of live drift taught us to pin:
 *  a home (set-once), a faction, a role handle, and a GM-truth oneBreath. */
export const PackNpc = z.object({
  id: z.string().regex(/^npc-[a-z0-9-]+$/),
  name: z.string().min(1),
  oneBreath: z.string().min(1),
  factionId: z.string().optional(),
  locationId: z.string().optional(),
  role: z.string().optional(),
});
export type PackNpc = z.infer<typeof PackNpc>;

export const ContentPack = z.object({
  universe: z.object({
    id: z.string().regex(/^uni-[a-z0-9-]+$/),
    name: z.string().min(1),
    /** The narrator's canon primer (rides the system prompt). */
    primer: z.string().min(1),
    styleRules: z.string().min(1),
    /** One-line setting frame for auxiliary model calls (creation finalize etc.). */
    settingLine: z.string().min(1),
  }),
  factions: z.array(PackFaction).min(1),
  locations: z.array(PackLocation).min(1),
  cast: z.array(PackNpc),
  /** Job-generation flavor pools (QUESTS.md `fill()` placeholders). */
  jobFlavor: z.object({
    cargo: z.array(z.string()).min(3),
    targets: z.array(z.string()).min(3),
    complications: z.array(z.string()).min(3),
  }),
  /** Where world services live (engine-gated features pinned to a place). */
  services: z.object({
    /** The body-modification / respec parlor's location id. */
    bodyMod: z.string(),
  }),
});
export type ContentPack = z.infer<typeof ContentPack>;

/** Validate a pack BEYOND the schema: referential integrity across ids. Returns
 *  human-readable problems (empty = valid). Run by pack.test.ts on the live pack. */
export function validatePack(pack: ContentPack): string[] {
  const problems: string[] = [];
  const locIds = new Set(pack.locations.map((l) => l.id));
  const facIds = new Set(pack.factions.map((f) => f.id));

  const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of dupes(pack.locations.map((l) => l.id))) problems.push(`duplicate location id: ${d}`);
  for (const d of dupes(pack.factions.map((f) => f.id))) problems.push(`duplicate faction id: ${d}`);
  for (const d of dupes(pack.cast.map((n) => n.id))) problems.push(`duplicate npc id: ${d}`);

  for (const f of pack.factions) {
    if (!locIds.has(f.homeLocationId)) problems.push(`faction ${f.id}: home ${f.homeLocationId} is not a location`);
  }
  for (const l of pack.locations) {
    for (const lane of l.lanes) {
      if (!locIds.has(lane.to)) problems.push(`location ${l.id}: lane to unknown ${lane.to}`);
      if (lane.to === l.id) problems.push(`location ${l.id}: lane to itself`);
    }
  }
  for (const n of pack.cast) {
    if (n.factionId && !facIds.has(n.factionId)) problems.push(`npc ${n.id}: unknown faction ${n.factionId}`);
    if (n.locationId && !locIds.has(n.locationId)) problems.push(`npc ${n.id}: unknown location ${n.locationId}`);
    // Factions must never be seeded as people (the live "Sable Chain the NPC" bug).
    if (pack.factions.some((f) => f.name.toLowerCase() === n.name.toLowerCase()))
      problems.push(`npc ${n.id}: name collides with a faction name (${n.name})`);
  }
  if (!locIds.has(pack.services.bodyMod)) problems.push(`services.bodyMod: unknown location ${pack.services.bodyMod}`);
  return problems;
}
