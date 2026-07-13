/**
 * Item catalog access + inventory helpers (ITEMS.md). The catalog is versioned
 * content JSON; effects are executed by the ENGINE (engineBridge), never narrated.
 * This module is pure data + selectors so both server (route/engine) and client
 * (PlayClient/Sidebar) compute the same inventory view.
 */
import itemsJson from "@/content/items.json";
import type { Character } from "./schemas";

export type ItemEffectKind =
  | "heal"
  | "aoe"
  | "autoFlee"
  | "autoCheck"
  | "restoreShield"
  | "healShip"
  | "reloadMissiles";

export interface ItemEffect {
  kind: ItemEffectKind;
  /** Dice for heal/aoe/healShip, e.g. "1d6+2", "2d6". */
  dice?: string;
  /** Flat amount for reloadMissiles. */
  amount?: number;
  /** Medkit: healing also clears the Downed injury (stabilize). */
  clearsDowned?: boolean;
}

export interface CatalogItem {
  id: string;
  name: string;
  type: "consumable" | "weapon" | "armor" | "tool";
  scale: "personal" | "ship";
  slot: number;
  price: number;
  /** Usable as a combat action (surfaced as an engine-generated chip). */
  combat: boolean;
  /** Chip verb — "Use", "Throw", "Pop", "Divert". */
  verb: string;
  effect?: ItemEffect;
}

const CATALOG: Record<string, CatalogItem> = Object.fromEntries(
  Object.entries(itemsJson.items).map(([id, v]) => [id, { id, ...(v as Omit<CatalogItem, "id">) }]),
);

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG[id];
}

export function allItems(): CatalogItem[] {
  return Object.values(CATALOG);
}

/**
 * How many of a catalog item the character holds: gear stacks (`itemId`/`qty`)
 * plus the legacy `stims` counter, which stays authoritative for stim until the
 * migration finishes (ITEMS.md IT-5). One item lives in exactly one of the two.
 */
export function itemCount(c: Character, itemId: string): number {
  const inGear = (c.gear ?? [])
    .filter((g) => g.itemId === itemId)
    .reduce((n, g) => n + (g.qty ?? 1), 0);
  const legacyStim = itemId === "stim" ? (c.stims ?? 0) : 0;
  return inGear + legacyStim;
}

export interface UsableConsumable {
  itemId: string;
  name: string;
  count: number;
  verb: string;
}

/** Combat-usable consumables the character currently holds at the given scale —
 *  the source list for combat action chips (rendered by shared/combat). */
export function usableConsumables(c: Character, scale: "personal" | "ship"): UsableConsumable[] {
  return allItems()
    .filter((it) => it.type === "consumable" && it.combat && it.scale === scale)
    .map((it) => ({ itemId: it.id, name: it.name, count: itemCount(c, it.id), verb: it.verb }))
    .filter((u) => u.count > 0);
}

/** One-line effect description for the narrator/UI. */
export function describeEffect(i: CatalogItem): string {
  const e = i.effect;
  if (!e) return "no mechanical effect";
  switch (e.kind) {
    case "heal":
      return `heal ${e.dice}${e.clearsDowned ? ", can stabilize a downed ally" : ""}`;
    case "aoe":
      return `${e.dice} to every enemy (combat)`;
    case "autoFlee":
      return "break off and auto-escape a fight (combat)";
    case "autoCheck":
      return "auto-succeed one forced-entry check";
    case "restoreShield":
      return "restore ship shields (ship combat)";
    case "healShip":
      return `repair ${e.dice} hull`;
    case "reloadMissiles":
      return `+${e.amount} missiles`;
    default:
      return "special";
  }
}

/** Compact "id — Name: effect" catalog of consumables, for the narrator prompt. */
export function itemReference(): string {
  return allItems()
    .filter((i) => i.type === "consumable")
    .map((i) => `${i.id} — ${i.name}: ${describeEffect(i)}`)
    .join("\n");
}
