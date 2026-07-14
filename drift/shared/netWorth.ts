/**
 * Net-worth-scaled combat (COMBAT.md §1). A character's NET WORTH — credits + the
 * value of their gear/guns/armor + any OWNED ship — gates how tough the enemies
 * they meet can be. A fresh, under-equipped character faces only T1 (winnable);
 * difficulty ramps as they arm up and bank credits. The engine clamps every
 * combatStart to this ceiling, so the model can't over-spawn.
 *
 * Pure: no DB, no randomness. Values are deliberately rough — this is a coarse
 * "how equipped are you" band, not an accounting ledger.
 */
import type { z } from "zod";
import type { CampaignState } from "./schemas";
import { GearItem } from "./schemas";
import { catalogItem } from "./items";
import { shipIsOwned } from "./recap";

type Gear = z.infer<typeof GearItem>;

export type ThreatTier = "T1" | "T2" | "T3";
const TIER_ORDER: Record<ThreatTier, number> = { T1: 1, T2: 2, T3: 3 };

/** Net-worth cutoffs → the toughest tier that may spawn. Tunable in play. */
export const THREAT_BANDS: { max: number; tier: ThreatTier }[] = [
  { max: 600, tier: "T1" }, // a fresh character (~450-550) sits here — T1 only
  { max: 2500, tier: "T2" },
  { max: Infinity, tier: "T3" },
];

/** Rough resale value of an OWNED ship by class. A loaner is worth 0 to net worth
 *  (it isn't theirs). */
const SHIP_VALUE: Record<string, number> = {
  scout: 1200,
  fighter: 2000,
  hauler: 2500,
  gunship: 3500,
  corvette: 5000,
};

/** Max total of a dice notation ("2d6" → 12, "1d8+2" → 10) — a weapon's rough
 *  worth scales with this. Flat numbers pass through. */
function maxDamage(notation: string): number {
  const m = /(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i.exec(notation);
  if (!m) {
    const flat = parseInt(notation, 10);
    return Number.isNaN(flat) ? 0 : flat;
  }
  const bonus = m[3] ? parseInt(m[3].replace(/\s/g, ""), 10) : 0;
  return Number(m[1]) * Number(m[2]) + bonus;
}

/** Value of one gear item. Catalog items use their real price; flavor gear (no
 *  catalog id) is valued by what it is — a weapon by its damage die, armor by its
 *  AC bonus, else a small nominal for kit. Calibrated so a starting loadout
 *  (a gun or two + light armor) plus ~120 credits lands under the T2 cutoff. */
export function gearValue(g: Gear): number {
  const qty = g.qty ?? 1;
  if (g.itemId) return (catalogItem(g.itemId)?.price ?? 0) * qty;
  if (g.acBonus) return g.acBonus * 80 * qty; // +2 vest → 160
  if (g.damage) return maxDamage(g.damage) * 12 * qty; // 1d8 → 96, 2d6 → 144, 2d8 → 192
  return 25 * qty; // misc kit
}

/** The player character's net worth: credits + gear + any owned ship. */
export function netWorth(state: CampaignState): number {
  const pc = state.characters.find((c) => c.kind === "pc");
  if (!pc) return 0;
  let worth = pc.credits ?? 0;
  for (const g of pc.gear ?? []) worth += gearValue(g);
  if (state.ship && shipIsOwned(state)) worth += SHIP_VALUE[state.ship.shipClass] ?? 0;
  return worth;
}

/** The toughest enemy tier a given net worth unlocks. */
export function maxThreatTier(worth: number): ThreatTier {
  return (THREAT_BANDS.find((b) => worth < b.max) ?? THREAT_BANDS[THREAT_BANDS.length - 1]).tier;
}

/** Convenience: the player's current spawn ceiling. */
export function playerThreatTier(state: CampaignState): ThreatTier {
  return maxThreatTier(netWorth(state));
}

/** Clamp a requested enemy tier down to what the player's net worth allows. */
export function clampTier(requested: ThreatTier, ceiling: ThreatTier): ThreatTier {
  return TIER_ORDER[requested] > TIER_ORDER[ceiling] ? ceiling : requested;
}
