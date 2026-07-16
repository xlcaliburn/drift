import type { Location } from "./schemas";
import type { RNG } from "@/engine/rng";

/**
 * Travel routes between canonical locations (the map feature). Two layers, same
 * pattern as shared/crew.ts's tier tables: a small HAND-AUTHORED set of named lanes
 * (the ones the map draws) with tendays/risk grounded in the universe primer's own
 * flavor text ("Rook Station ~3 days out", "Talos ~4 days through the Shear"), and a
 * tier/tag FORMULA fallback so every other pair still resolves to something sane
 * without a 45-row table to hand-maintain. Pure — no RNG in the lookup itself.
 */

export type RouteRisk = "low" | "medium" | "high";

export interface Route {
  tendays: number;
  risk: RouteRisk;
}

/** Undirected named lanes — the ones MapTab draws and the ones worth hand-tuning.
 *  Key is `${a}|${b}` with a < b lexicographically (see routeKey). */
const NAMED_LANES: Record<string, Route> = {
  "loc-meridian|loc-rook": { tendays: 3, risk: "low" }, // established trade lane between the two safe hubs
  "loc-meridian|loc-undertow": { tendays: 2, risk: "medium" },
  "loc-rook|loc-undertow": { tendays: 2, risk: "medium" },
  "loc-meridian|loc-shear": { tendays: 2, risk: "high" }, // the hazard field itself
  "loc-shear|loc-undertow": { tendays: 2, risk: "high" },
  "loc-shear|loc-talos": { tendays: 2, risk: "high" }, // meridian→shear→talos ≈ 4, matching the primer
  "loc-nest|loc-shear": { tendays: 1, risk: "high" }, // a short hop, but into a raider den
};

const TIER_NUM: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
const HAZARD_TAGS = new Set(["hazard", "raiders", "hidden", "lawless"]);

function routeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The formula fallback for any pair without a named lane: tendays scale with
 *  BOTH endpoints' danger tier (1–5 range); risk follows the more dangerous
 *  endpoint, bumped to high if either is tagged as an active hazard/raider zone. */
function formulaRoute(from: Location | undefined, to: Location | undefined): Route {
  const ta = TIER_NUM[from?.tier ?? "T1"] ?? 1;
  const tb = TIER_NUM[to?.tier ?? "T1"] ?? 1;
  const tendays = Math.max(1, Math.min(6, ta + tb - 1));
  const maxTier = Math.max(ta, tb);
  const flaggedHazard = [...(from?.tags ?? []), ...(to?.tags ?? [])].some((t) => HAZARD_TAGS.has(t));
  const risk: RouteRisk = flaggedHazard || maxTier >= 3 ? "high" : maxTier === 2 ? "medium" : "low";
  return { tendays, risk };
}

/** The route between two locations — a named lane if one's authored, else the
 *  tier/tag formula. Same-location (or missing data) resolves to a trivial local
 *  hop rather than throwing, so callers never need a null-check. */
export function routeBetween(fromId: string, toId: string, locations: Location[]): Route {
  if (fromId === toId) return { tendays: 0, risk: "low" };
  const named = NAMED_LANES[routeKey(fromId, toId)];
  if (named) return named;
  return formulaRoute(locations.find((l) => l.id === fromId), locations.find((l) => l.id === toId));
}

/** Chance a transit incident fires per risk tier — the "predefine risk for
 *  encounters" mechanic. Tune here (C-1-style: play-data-driven, not load-bearing
 *  math). */
const INCIDENT_CHANCE: Record<RouteRisk, number> = { low: 10, medium: 25, high: 45 };

/** Roll whether THIS trip hits a transit incident — engine-owned, seeded, so the
 *  risk tier is more than a color on a map. Returns the roll for an auditable line. */
export function rollTransitIncident(risk: RouteRisk, rng: RNG): { hit: boolean; roll: number; chance: number } {
  const chance = INCIDENT_CHANCE[risk];
  const roll = rng.int(1, 100);
  return { hit: roll <= chance, roll, chance };
}

/** UI color for a risk tier — the single source both the map and any future
 *  surface should read, so "high risk" always means the same red everywhere. */
export function riskColor(risk: RouteRisk): string {
  return risk === "high" ? "#d9584a" : risk === "medium" ? "#e8a33d" : "#5fa06a";
}

export function riskLabel(risk: RouteRisk): string {
  return risk === "high" ? "High risk" : risk === "medium" ? "Moderate risk" : "Low risk";
}
