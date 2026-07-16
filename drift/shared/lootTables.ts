import type { RNG } from "@/engine/rng";
import type { LootDrop } from "@/engine/loot";

/**
 * LOOT TABLES (LOCATIONS.md Phase 2b) — authored CONSTANTS keyed archetype × tier,
 * so what a place yields is engine-owned: a wreck gives salvage, a lab gives chems
 * and data, a cache gives money — and a "data core" can only turn up where a table
 * says one can, never narrator-conjured. Tiers use the same T1/T2/T3 language as
 * enemies, the catalog, and location danger. `rollTableLoot` mirrors the rhythm of
 * engine/loot.ts generateScavengeLoot (credits + one common find; a CRIT reaches the
 * useful pool and sometimes a real catalog consumable) so the two paths feel alike.
 * Pure + seeded; self-contained so it can't collide with concurrent engine work.
 */

export type LootArchetype = "field" | "wreck" | "derelict" | "lab" | "lockup" | "cache" | "anchorage";
export type LootTier = "T1" | "T2" | "T3";

export interface LootTable {
  /** Credits band rolled once (twice on a crit). */
  credits: [number, number];
  /** Flavor scrap — one always turns up. */
  common: string[];
  /** Better flavor finds — reached on a crit. */
  useful: string[];
  /** Catalog consumable ids a crit can yield (1-in-3, uniform pick). */
  consumables: string[];
}

const T = (credits: [number, number], common: string[], useful: string[], consumables: string[]): LootTable => ({
  credits,
  common,
  useful,
  consumables,
});

/** The constants. Keyed `${archetype}-${tier}`. */
export const LOOT_TABLES: Record<string, LootTable> = {
  // ── field: generic area scavenge (the default path, tiered by location) ──────
  "field-T1": T([8, 30], ["a coil of frayed cabling", "a dented power cell", "a half-eaten ration pack", "a worn cred chip", "a handful of spent casings"], ["a working comm bead", "a fresh ammo mag", "a sealed medpatch"], ["stim"]),
  "field-T2": T([20, 60], ["a scorched circuit board", "a cracked visor", "a length of salvage wire", "a dog-eared ID card"], ["a spare charge pack", "a data shard, contents unknown", "a compact grappling line"], ["stim", "smoke"]),
  "field-T3": T([50, 140], ["a shattered rifle stock", "a burned uniform patch, insignia unknown", "a fistful of hull bolts", "a vial of leaking coolant"], ["a sealed courier tube", "an intact targeting module", "a strongbox key, lock unknown"], ["medkit", "frag"]),

  // ── wreck: a broken ship's bones — plating, parts, ship stores ────────────────
  "wreck-T1": T([10, 35], ["a strip of hull plating", "a fused junction box", "a coil of mooring line", "a cracked thruster vane"], ["an intact relay board", "a drained shield capacitor", "a nav beacon, still blinking"], ["hullPatch"]),
  "wreck-T2": T([25, 75], ["a buckled cargo strut", "a scorched engine cowl", "a bundle of intact fuel line", "a pilot's cracked helmet"], ["a serviceable thruster assembly", "a sealed parts crate", "an undamaged sensor cluster"], ["hullPatch", "shieldCell"]),
  "wreck-T3": T([60, 160], ["a blast-warped bulkhead panel", "a melted weapons mount", "a black-streaked escape-pod door"], ["an intact drive core component", "a military-grade relay stack", "a flight recorder, encrypted"], ["shieldCell", "missileReload", "medkit"]),

  // ── derelict: a dead ship's interior — personal effects, logs, the quiet dead ─
  "derelict-T1": T([8, 30], ["a crew locker's odds and ends", "a corroded mess tray", "a family holo, cracked", "a bundle of old flight logs"], ["a working hand lamp", "a sealed ration case", "a crewman's multitool"], ["stim"]),
  "derelict-T2": T([20, 65], ["a captain's empty strongbox", "a torn manifest ledger", "a dead comm console's face-plate"], ["a personal log chip, intact", "a medbay case, half-stocked", "a master keycard, ship unknown"], ["medkit", "stim"]),
  "derelict-T3": T([50, 150], ["a sealed quarantine notice", "a scorched airlock crank", "a child's shoe, drifting"], ["the captain's log, intact", "a vault chit with a Reclaimer mark", "a pristine pre-Shear star chart"], ["medkit", "breach"]),

  // ── lab: chems, data, delicate instruments ────────────────────────────────────
  "lab-T1": T([12, 40], ["a rack of cracked sample vials", "a burned-out centrifuge coil", "a stained lab coat"], ["a sealed chem vial, unlabeled", "a working diagnostic wand", "a data shard of test results"], ["stim"]),
  "lab-T2": T([30, 85], ["a shattered isolation hood", "a tray of spent reagent cartridges", "a cracked specimen jar"], ["an intact data core", "a case of stabilized reagents", "a prototype injector, unmarked"], ["stim", "medkit"]),
  "lab-T3": T([70, 180], ["a melted server rack", "a biohazard seal, broken from inside", "a researcher's shattered slate"], ["a black-project data core", "a sealed experimental compound", "an intact cryo-sample case"], ["medkit", "breach"]),

  // ── lockup: stored goods, contraband, someone's property ─────────────────────
  "lockup-T1": T([15, 50], ["a pallet of low-grade machine parts", "a crate of counterfeit dock tags", "a tarp-wrapped bundle of scrap"], ["a case of untaxed liquor", "a sealed goods crate", "a ledger of storage fees"], ["stim"]),
  "lockup-T2": T([40, 100], ["a strongbox, pried and empty", "a rack of impounded tools", "a bolt of smuggled fabric"], ["a crate of contraband stims", "an unregistered gun case, empty", "a bundle of clean transit papers"], ["stim", "smoke", "frag"]),
  "lockup-T3": T([90, 220], ["a syndicate seal, cut through", "an emptied weapons rack", "a burned account book"], ["a sealed contraband consignment", "a case of blank ID slates", "a locked courier satchel"], ["frag", "breach", "medkit"]),

  // ── cache: a hidden stash — money-heavy, someone will miss it ─────────────────
  "cache-T1": T([25, 70], ["a buried lockbox, jimmied open", "a wad of worn small-denomination chits"], ["a pouch of clean cred chips", "a keepsake worth fencing"], ["stim"]),
  "cache-T2": T([60, 140], ["a false-bottomed crate", "a stash wrapped in vac-cloth"], ["a roll of high-denomination chits", "a small case of trade metals", "a debt ledger with names worth knowing"], ["smoke", "medkit"]),
  "cache-T3": T([120, 300], ["an armored strongbox, cracked", "a courier case with a broken cuff"], ["a bearer-bond chit, untraceable", "a velvet roll of cut stones", "a syndicate payroll pouch"], ["medkit", "breach"]),

  // ── anchorage: a raider dock — fuel, munitions, stolen goods ──────────────────
  "anchorage-T1": T([10, 40], ["a drum of skimmed fuel", "a pile of stripped hull fittings", "a raider's patched vac-suit"], ["a crate of stolen rations", "a working cutting torch head", "a boarding hook, well-used"], ["smoke"]),
  "anchorage-T2": T([30, 90], ["a rack of mismatched ammunition", "a half-stripped engine block", "a tally wall of hulls taken"], ["a case of boarding charges", "a stolen cargo manifest", "a keg of engine-grade solvent"], ["frag", "smoke"]),
  "anchorage-T3": T([70, 190], ["a captured naval pennant", "a bloodstained boarding ramp plate", "a chained cargo pod, marked for ransom"], ["a crate of military munitions", "a prize-ship's title chit", "a wall-safe of raid shares"], ["frag", "missileReload", "medkit"]),
};

/** Every archetype × tier is authored — no silent holes (unit-enforced). */
export const LOOT_ARCHETYPES: LootArchetype[] = ["field", "wreck", "derelict", "lab", "lockup", "cache", "anchorage"];
export const LOOT_TIERS: LootTier[] = ["T1", "T2", "T3"];

const pick = <T,>(rng: RNG, arr: T[]): T => arr[rng.int(0, arr.length - 1)];

/**
 * Roll a table's loot — same shape and rhythm as generateScavengeLoot, but the POOL
 * and the MONEY come from the archetype × tier constants. `crit` doubles the credits
 * roll and reaches the useful pool (1-in-3: a real catalog consumable instead).
 */
export function rollTableLoot(
  rng: RNG,
  archetype: LootArchetype,
  tier: LootTier,
  opts: { crit?: boolean } = {},
): LootDrop {
  const table = LOOT_TABLES[`${archetype}-${tier}`];
  const [lo, hi] = table.credits;
  const drop: LootDrop = { gear: [], consumables: [], credits: rng.int(lo, hi), line: "" };
  const found: string[] = [];
  if (drop.credits > 0) found.push(`¢${drop.credits}`);

  const scrap = pick(rng, table.common);
  drop.gear.push({ name: scrap, detail: "scavenged" });
  found.push(scrap);

  if (opts.crit) {
    drop.credits += rng.int(lo, hi);
    if (table.consumables.length && rng.int(1, 3) === 1) {
      const id = pick(rng, table.consumables);
      drop.consumables.push(id);
      found.push(id);
    } else {
      const useful = pick(rng, table.useful);
      drop.gear.push({ name: useful, detail: "scavenged" });
      found.push(useful);
    }
  }

  drop.line = `🎒 Scavenged: ${found.join(", ")}`;
  return drop;
}
