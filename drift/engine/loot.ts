/**
 * Engine-owned salvage generation (ITEMS.md — loot is earned, never authored).
 *
 * The player declares an ATTEMPT to loot/scavenge; the engine rolls the check and,
 * on success, calls this to decide what is actually found. The player never names
 * their own prize — "I find a rocket launcher" turns up scrap and small money like
 * any other pick through a wreck. Deliberately unglamorous; a CRIT reaches a more
 * useful oddment and, rarely, a real stim. Pure + seeded, like the rest of the engine.
 */
import type { RNG } from "./rng";

export interface LootDrop {
  /** Flavor gear entries added to inventory (name + "scavenged" detail). */
  gear: { name: string; detail: string }[];
  /** Catalog consumables granted by id (mechanical — e.g. a scavenged "stim"). */
  consumables: string[];
  /** Credits found. */
  credits: number;
  /** One display line summarising the haul ("🎒 Scavenged: …"). */
  line: string;
}

const SCRAP = [
  "a coil of frayed cabling",
  "a dented power cell",
  "a fistful of hull bolts",
  "a cracked visor",
  "a half-eaten ration pack",
  "a scorched circuit board",
  "a length of salvage wire",
  "a bent multitool",
  "a worn cred chip",
  "a dog-eared ID card",
  "a vial of leaking coolant",
  "a handful of spent casings",
];

const USEFUL = [
  "a spare charge pack",
  "a data shard, contents unknown",
  "a working comm bead",
  "a compact grappling line",
  "a sealed medpatch",
  "a fresh ammo mag",
];

function pick<T>(rng: RNG, arr: T[]): T {
  return arr[rng.int(0, arr.length - 1)];
}

/**
 * Roll salvage for a successful loot attempt. `band` scales the money to the
 * context (a tougher foe's body carries more); `crit` upgrades the haul.
 */
export function generateScavengeLoot(
  rng: RNG,
  opts: { crit?: boolean; band?: [number, number] } = {},
): LootDrop {
  const [lo, hi] = opts.band ?? [8, 30];
  const drop: LootDrop = { gear: [], consumables: [], credits: rng.int(lo, hi), line: "" };
  const found: string[] = [];
  if (drop.credits > 0) found.push(`¢${drop.credits}`);

  // Most attempts turn up one bit of scrap.
  const scrap = pick(rng, SCRAP);
  drop.gear.push({ name: scrap, detail: "scavenged" });
  found.push(scrap);

  // A clean hit (crit) does better: a useful oddment, or — rarely — a real stim.
  if (opts.crit) {
    drop.credits += rng.int(lo, hi);
    if (rng.int(1, 4) === 1) {
      drop.consumables.push("stim");
      found.push("a stim");
    } else {
      const useful = pick(rng, USEFUL);
      drop.gear.push({ name: useful, detail: "scavenged" });
      found.push(useful);
    }
  }

  drop.line = `🎒 Scavenged: ${found.join(", ")}`;
  return drop;
}
