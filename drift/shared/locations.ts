/**
 * Location tiers (LOCATIONS.md / CANON.md) — a stable danger map over the CANONICAL
 * places, in the same T1/T2/T3 language as enemies and the item catalog. A location's
 * tier calibrates how dangerous/lawless it reads, and (Phase 2b/2c) drives loot-table
 * quality and a site's default enemy tier. Pure + content-free so it's unit-testable.
 */

export type LocationTier = "T1" | "T2" | "T3";

/** Tags that mark a place DEADLY (frontier / hazard / raider country) — highest wins. */
const T3_TAGS = ["hostile", "hazard", "raiders", "shear", "warzone", "deadly", "unexplored"];
/** Tags that mark a place ROUGH (lawless / contested / criminal). */
const T2_TAGS = ["lawless", "blackmarket", "contested", "frontier", "criminal", "smuggler"];
// Everything else (home / commerce / crown / secure hub) is T1.

/** Derive a danger tier from a location's tags — highest danger present wins. */
export function deriveLocationTier(tags: string[] = []): LocationTier {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => T3_TAGS.includes(x))) return "T3";
  if (t.some((x) => T2_TAGS.includes(x))) return "T2";
  return "T1";
}

/** A location's tier: an explicit hand-set `tier` wins, else it's derived from tags. */
export function locationTier(loc?: { tier?: LocationTier; tags?: string[] } | null): LocationTier {
  return loc?.tier ?? deriveLocationTier(loc?.tags);
}

const TIER_WORD: Record<LocationTier, string> = { T1: "secure", T2: "rough", T3: "deadly" };

/** Compact prompt/UI badge for a location's danger, e.g. "T2 · rough". */
export function locationDangerLabel(tier: LocationTier): string {
  return `${tier} · ${TIER_WORD[tier]}`;
}
