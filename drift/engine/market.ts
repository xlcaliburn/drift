/**
 * Engine-owned markets (ITEMS.md slice E) — the credit sink. Pure + seeded:
 * stock is deterministic per (location, 30-day chunk), so every player at the
 * same station in the same window sees the same shelves (shared canon), and the
 * shelves rotate as the season wears on.
 *
 * Tier gating keeps the net-worth ratchet honest (COMBAT.md §1): a backwater
 * dock shelves T1 basics; commerce hubs reach T2; only a blackmarket shelves
 * the T3 hardware. Consumables sell everywhere a market exists.
 */
import type { Location, FactionRep, Faction, CampaignState } from "@/shared/schemas";
import { allItems, type CatalogItem } from "@/shared/items";
import { repairRatePerHp } from "@/shared/crew";
import { economy } from "@/content";
import { seededRng } from "./rng";
import { seedFromString } from "./creation";

export type MarketTier = "T1" | "T2" | "T3";
const TIER_ORDER: Record<MarketTier, number> = { T1: 1, T2: 2, T3: 3 };

/** Days per stock rotation (locked decision: ~30 in-game days). */
export const STOCK_ROTATION_DAYS = 30;

/** What a market shelves here, if any. Tags rule: blackmarket beats commerce;
 *  a hazard/hidden site has no market at all; any other named place has basics. */
export function marketTierFor(loc: Pick<Location, "tags"> | undefined): MarketTier | null {
  if (!loc) return null;
  const tags = loc.tags ?? [];
  if (tags.includes("hazard") || tags.includes("hidden")) return null;
  if (tags.includes("blackmarket")) return "T3";
  if (tags.includes("commerce")) return "T2";
  return "T1";
}

export interface StockEntry {
  item: CatalogItem;
  /** Catalog price — rep adjustment happens per-campaign at quote time. */
  price: number;
}

/** The shelves at a location for a given elapsed-days count. All consumables
 *  (they're the restock loop) + a seeded rotating pick of weapons/armor/tools
 *  at/below the market's tier. Deterministic: same location + same 30-day
 *  chunk → same stock for everyone. */
export function marketStock(
  loc: Pick<Location, "id" | "tags">,
  daysElapsed: number,
): StockEntry[] {
  const tier = marketTierFor(loc);
  if (!tier) return [];
  const chunk = Math.floor(Math.max(0, daysElapsed) / STOCK_ROTATION_DAYS);
  const rng = seededRng(seedFromString(`${loc.id}:market:${chunk}`));

  const items = allItems();
  const consumables = items.filter((i) => i.type === "consumable");
  const durable = (type: CatalogItem["type"]) =>
    items.filter(
      (i) => i.type === type && i.marketTier && TIER_ORDER[i.marketTier] <= TIER_ORDER[tier],
    );

  // Seeded picks without replacement — bigger markets shelve more hardware.
  const draw = <T>(pool: T[], n: number): T[] => {
    const rest = [...pool];
    const out: T[] = [];
    while (out.length < n && rest.length) out.push(rest.splice(rng.int(0, rest.length - 1), 1)[0]);
    return out;
  };
  const nWeapons = tier === "T1" ? 2 : 3;
  const nArmor = tier === "T1" ? 1 : 2;
  const picks = [
    ...draw(durable("weapon"), nWeapons),
    ...draw(durable("armor"), nArmor),
    ...draw(durable("tool"), 1),
  ];
  return [...consumables, ...picks].map((item) => ({ item, price: item.price }));
}

/** Buy-price factor from standing with the location's controlling faction:
 *  rep +5 → ×0.8, rep -5 → ×1.2 (±20%, ITEMS.md slice E). */
export function repPriceFactor(rep: number): number {
  const r = Math.max(-5, Math.min(5, rep));
  return 1 - 0.04 * r;
}

/** The player's rep with whoever controls this location, read from its tags
 *  (a location tagged "crown" belongs to the faction whose name contains it).
 *  0 — flat prices — when no tag matches a faction. */
export function localRep(
  loc: Pick<Location, "tags"> | undefined,
  factions: Pick<Faction, "id" | "name">[],
  factionRep: Pick<FactionRep, "factionId" | "rep">[],
): number {
  if (!loc) return 0;
  for (const tag of loc.tags ?? []) {
    const f = factions.find(
      (x) => x.name.toLowerCase().includes(tag.toLowerCase()) || x.id.toLowerCase().includes(tag.toLowerCase()),
    );
    if (f) return factionRep.find((r) => r.factionId === f.id)?.rep ?? 0;
  }
  return 0;
}

/** Sell rate — locked decision: flat 40% of value, no rep scaling. */
export const SELL_RATE = 0.4;

/** A dock's hull-repair quote (ECONOMY E-3): full patch at ¢12/HP (¢9 with an
 *  engineer aboard — CREW.md passive), offered only where there's a serviced dock
 *  (same tags a market needs) and the hull is actually damaged. Null when repair
 *  isn't available/needed. */
export function repairQuote(state: CampaignState): { hp: number; cost: number } | null {
  const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  if (!marketTierFor(loc)) return null;
  const s = state.ship;
  if (!s || s.hp >= s.maxHp) return null;
  const hp = s.maxHp - s.hp;
  return { hp, cost: hp * repairRatePerHp(state, economy.constants.repairCostPerHp) };
}
