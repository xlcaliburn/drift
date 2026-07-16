/**
 * Item catalog access + inventory helpers (ITEMS.md). The catalog is versioned
 * content JSON; effects are executed by the ENGINE (engineBridge), never narrated.
 * This module is pure data + selectors so both server (route/engine) and client
 * (PlayClient/Sidebar) compute the same inventory view.
 */
import itemsJson from "@/content/items.json";
import type { Character } from "./schemas";
import type { DamageType, StatusKind } from "./status";

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
  /** Weapons: damage dice ("2d6", "1d6+3"). */
  damage?: string;
  /** Weapons: damage TYPE — drives armor resist/vuln + the shock-vs-shields rule.
   *  Absent = kinetic. */
  damageType?: DamageType;
  /** Weapons: a status applied on a hit (independent of `damageType`). */
  onHit?: StatusKind;
  /** Weapons: ignores this much of the target's AC (armor-piercing). */
  armorPen?: number;
  /** Armor: AC bonus while carried (best single piece counts). */
  acBonus?: number;
  /** Armor: incoming damage of this type is HALVED. */
  resist?: DamageType;
  /** Armor: incoming damage of this type is increased by half. */
  vuln?: DamageType;
  /** Armor: the wearer can't be afflicted by these statuses. */
  statusGuard?: StatusKind[];
  /** Armor: heavy — the wearer loses the evasive/flee bonus (a tradeoff for the AC). */
  mobilityPenalty?: boolean;
  /** Lowest market tier that shelves this item (ITEMS.md slice E). Consumables
   *  without one are T1 (sold everywhere a market exists). */
  marketTier?: "T1" | "T2" | "T3";
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
 * The catalog id a gear entry resolves to — its explicit `itemId`, or a legacy
 * NAME match (so an unmapped "Medkit" / "Stimpack" still behaves as the catalog
 * item it clearly is). This is the single source of truth for "which catalog
 * item is this gear", used by itemCount AND the engine's consume path so they
 * can never disagree (the medkit-heal-that-did-nothing bug: counted by name,
 * consumed by id → heal without spend, or vice-versa).
 */
export function resolveGearItemId(g: { itemId?: string; name: string }): string | undefined {
  return g.itemId ?? legacyItemId(g.name);
}

/**
 * How many of a catalog item the character holds: gear stacks (by resolved id,
 * so unmapped legacy gear still counts) plus the legacy `stims` counter, which
 * stays authoritative for stim until the migration finishes (ITEMS.md IT-5).
 */
export function itemCount(c: Character, itemId: string): number {
  const inGear = (c.gear ?? [])
    .filter((g) => resolveGearItemId(g) === itemId)
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

/**
 * Out-of-combat "Use X" chips (ITEMS.md — deterministic item use). SHIP-DOWNTIME
 * items only: a hull patch when the ship is damaged, a missile reload when the rack
 * is below capacity. Personal HEALS (stim/medkit) are combat items — they surface
 * as combat chips (combatActions), never here, so the bar isn't cluttered with a
 * "Use stim" every idle turn. (Out of combat the player still heals by typing it —
 * the engine's useItem is name-resilient — or at a dock.) The chip carries
 * `useItemId`; the ENGINE applies the effect (see route → jsonTurn preUseItem).
 */
export function outOfCombatItemChips(
  c: Character,
  ship?: { hp: number; maxHp: number; weapons: { type: string; ammo?: number; count?: number }[] } | null,
): { label: string; useItemId: string }[] {
  const chips: { label: string; useItemId: string }[] = [];
  for (const it of allItems()) {
    if (it.type !== "consumable") continue;
    const n = itemCount(c, it.id);
    if (n <= 0) continue;
    const chip = { label: `${it.verb} ${it.name} (×${n})`, useItemId: it.id };
    if (it.effect?.kind === "healShip" && ship && ship.hp < ship.maxHp) chips.push(chip);
    else if (it.effect?.kind === "reloadMissiles" && ship?.weapons.some((w) => w.type === "missile" && (w.ammo ?? 0) < (w.count ?? 0)))
      chips.push(chip);
  }
  return chips;
}

/** Verbs in a TYPED action that signal intent to use a heal consumable on
 *  yourself right now. Tight on purpose — ordinary prose ("take the stairs",
 *  "hit the thruster") must not trigger a phantom heal. */
const USE_VERB_RE =
  /\b(use|using|used|pop|popped|inject|injects?|injected|jab|jabbed|apply|applies|applied|slam|slammed|crack|cracks?|cracked|thumb|thumbed|dose|administer|patch\s+(?:me|myself|up)|heal|stab)\b/i;
/** Phrasings that mean the player is DECLINING to use one — a conservative guard
 *  so the backstop never spends a consumable the player wanted to hold. */
const USE_NEGATION_RE = /\b(don'?t|do\s+not|without|no\s+need|save|saving|keep|not\s+use|hold\s+off)\b/i;
/** Match terms per heal consumable (catalog name + common freeform spellings).
 *  Multiword forms use a flexible space/hyphen so "med-kit"/"med kit" both hit. */
const HEAL_SYNONYMS: Record<string, string[]> = {
  stim: ["stim", "stims", "stimpack", "stim pack", "stimpak", "stimulant", "stimshot"],
  medkit: ["medkit", "med kit", "medpack", "med pack", "medical kit", "first aid", "medi gel", "medigel"],
};

/**
 * A held HEAL consumable a typed player action clearly asks to use — the free-text
 * counterpart to the "Use X" chip. Out of combat, personal heals aren't chips
 * (ITEMS.md — they'd clutter the bar), so the player heals by TYPING "use stim";
 * that leaned on the cheap model to fire `useItem`, and when it just narrated the
 * heal instead the engine never moved HP (the live "stims stopped working" bug —
 * six "use stim" turns, prose said patched, HP stayed at 1). This lets the ENGINE
 * apply the heal deterministically, same contract as the chip. Returns the catalog
 * id, or undefined when the text isn't a clear use-intent for something held.
 */
export function inferConsumableUse(text: string, c: Character): string | undefined {
  const norm = (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!norm) return undefined;
  if (USE_NEGATION_RE.test(text ?? "")) return undefined;
  const bare = norm.replace(/ /g, ""); // "use stim" → "usestim"; "stim" → "stim"
  for (const it of allItems()) {
    if (it.type !== "consumable" || it.effect?.kind !== "heal") continue;
    if (itemCount(c, it.id) <= 0) continue;
    const syns = HEAL_SYNONYMS[it.id] ?? [it.name.toLowerCase()];
    for (const s of syns) {
      const term = s.replace(/[\s-]+/g, " ").trim();
      const re = new RegExp(`\\b${term.replace(/ /g, "[\\s-]?")}\\b`);
      if (!re.test(norm)) continue;
      // Whole input IS the item ("Stim", "Stim.") → unambiguous use intent even
      // without a verb; otherwise require a use verb ("use/pop/inject … stim").
      if (bare === term.replace(/ /g, "") || USE_VERB_RE.test(text ?? "")) return it.id;
    }
  }
  return undefined;
}

/** How a weapon's damage type + on-hit status reads on the sheet ("thermal · burns"). */
const STATUS_BLURB: Record<StatusKind, string> = {
  burning: "burns (damage over time)",
  bleeding: "bleeds (stacking damage)",
  shocked: "shocks (skips their turn, drops shields)",
  corroded: "corrodes (melts armor / −AC)",
};

/** One-line effect description for the narrator/UI. */
export function describeEffect(i: CatalogItem): string {
  const e = i.effect;
  if (!e) {
    if (i.damage) {
      const bits = [`${i.damage} damage`];
      if (i.damageType && i.damageType !== "kinetic") bits.push(i.damageType);
      if (i.armorPen) bits.push(`armor-piercing ${i.armorPen}`);
      if (i.onHit) bits.push(STATUS_BLURB[i.onHit]);
      return bits.join(" · ");
    }
    if (i.acBonus) {
      const bits = [`+${i.acBonus} AC`];
      if (i.resist) bits.push(`resists ${i.resist}`);
      if (i.vuln) bits.push(`weak to ${i.vuln}`);
      if (i.statusGuard?.length) bits.push(`immune: ${i.statusGuard.join("/")}`);
      if (i.mobilityPenalty) bits.push("heavy (no evasion)");
      return bits.join(" · ");
    }
    return "no mechanical effect";
  }
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

// ── Legacy gear mapping (ITEMS.md IT-1 / slice W) ────────────────────────────

/** Freeform creation/loot gear names → catalog ids. The DISPLAY name is kept;
 *  the id brings price + slot cost (netWorth, shops, inventory). Grouped by what
 *  the item mechanically IS, not what it's called — a "Riot gun" prices like the
 *  2d6 rifle it fights as. */
const LEGACY_ALIASES: Record<string, string> = {
  // weapons
  "holdout pistol": "holdout",
  "dart pistol": "holdout",
  "combat rifle": "combatRifle",
  "riot gun": "combatRifle",
  "hunting rifle": "combatRifle",
  "marksman carbine": "marksmanRifle",
  "marksman rifle": "marksmanRifle",
  "smg": "machinePistol",
  "submachine gun": "machinePistol",
  "machine pistol": "machinePistol",
  "carbine": "serviceCarbine",
  "service carbine": "serviceCarbine",
  "burst rifle": "burstRifle",
  "assault rifle": "assaultRifle",
  "flamer": "incinerator",
  "flamethrower": "incinerator",
  "incinerator": "incinerator",
  "plasma rifle": "plasmaCarbine",
  "plasma gun": "plasmaCarbine",
  "ion pistol": "ionLance",
  "ion gun": "ionLance",
  "emp gun": "ionLance",
  "railgun": "railRifle",
  "rail gun": "railRifle",
  "gauss rifle": "railRifle",
  "combat knife": "lightBlade",
  "cutting tool": "lightBlade",
  "cutting torch": "lightBlade",
  "heavy wrench": "lightBlade",
  "serrated blade": "serratedBlade",
  "serrated knife": "serratedBlade",
  "machete": "serratedBlade",
  "acid gun": "corroder",
  "corroder": "corroder",
  "stun baton": "shockBaton",
  "shock baton": "shockBaton",
  // armor
  "heavy plate": "ballisticVest",
  "armored coat": "ballisticVest",
  "fine jacket": "paddedJacket",
  "scout armor": "paddedJacket",
  "patched coveralls": "paddedJacket",
  "fine clothes": "paddedJacket",
  "hardened vac suit": "paddedJacket",
  "combat armor": "combatArmor",
  "ablative plating": "ablativePlating",
  "ablative armor": "ablativePlating",
  "sealed hardsuit": "sealedHardsuit",
  "hardsuit": "sealedHardsuit",
  "powered carapace": "poweredCarapace",
  "powered armor": "poweredCarapace",
  "power armor": "poweredCarapace",
  // tools
  "sealed vac suit": "vacSuit",
  "salvage scanner": "scanner",
  "med scanner": "scanner",
  "lockpick set": "lockpicks",
  "grapnel line": "grapnel",
  // consumables under freeform names
  "stimpack": "stim",
  "stim pack": "stim",
  "med kit": "medkit",
};

/** Resolve a freeform gear name to a catalog id: exact catalog name/id match
 *  first, then the alias table. Undefined when it's genuinely flavor gear. */
export function legacyItemId(name: string): string | undefined {
  const norm = name.trim().toLowerCase().replace(/^(a|an|the)\s+/, "");
  const direct = allItems().find((it) => it.name.toLowerCase() === norm || it.id.toLowerCase() === norm);
  return direct?.id ?? LEGACY_ALIASES[norm];
}

type GearEntry = Character["gear"][number];

/** Attach catalog ids to a character's freeform gear (one-shot, idempotent —
 *  run on session load and at creation). Existing ids are never overwritten;
 *  names/damage/AC stay exactly as written, only the id is added. */
export function mapLegacyGear<T extends { gear: GearEntry[] }>(c: T): T {
  let changed = false;
  const gear = c.gear.map((g) => {
    if (g.itemId) return g;
    const id = legacyItemId(g.name);
    if (!id) return g;
    changed = true;
    return { ...g, itemId: id };
  });
  return changed ? { ...c, gear } : c;
}

// ── Inventory slots (ITEMS.md slice B) ───────────────────────────────────────

/** How many consumables share one slot. */
const STACK_PER_SLOT = 3;

/** Slot cost of one gear entry. Catalog items use their listed cost (consumables
 *  stack ×3 per slot); flavor gear is judged by what it is — a two-handed weapon
 *  2, a light one 1, armor 2, anything else 1. */
export function gearSlotCost(g: GearEntry): number {
  const qty = g.qty ?? 1;
  const cat = g.itemId ? catalogItem(g.itemId) : undefined;
  if (cat) {
    if (cat.type === "consumable") return Math.ceil(qty / STACK_PER_SLOT);
    return cat.slot * qty;
  }
  if (g.damage) {
    // Dice count is a decent one-hand/two-hand proxy: 2d6 rifle = 2, 1d8 pistol = 1.
    const dice = /^(\d+)\s*d/i.exec(g.damage);
    return (dice && Number(dice[1]) >= 2 ? 2 : 1) * qty;
  }
  if (g.acBonus) return 2 * qty;
  return qty;
}

/** Slots a character's carried gear occupies (legacy `stims` counter included,
 *  stacked like the catalog consumable it is). */
export function slotsUsed(c: Character): number {
  const gear = (c.gear ?? []).reduce((n, g) => n + gearSlotCost(g), 0);
  const legacyStims = c.stims ? Math.ceil(c.stims / STACK_PER_SLOT) : 0;
  return gear + legacyStims;
}

/** Carrying capacity — computed live (the stored slots/maxSlots fields are
 *  ignored; no backfill needed). 8 + might: a fresh loadout uses ~6, leaving
 *  room to pick things up. */
export function maxSlotsFor(c: Character): number {
  return 8 + Math.max(0, c.attributes?.might ?? 0);
}
