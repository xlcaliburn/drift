import { describe, it, expect } from "vitest";
import { ambitions, alignments, backgrounds, patronFor, factionStarterGear, FACTION_PATRON } from "./creation";

/**
 * PIN TEST (Modularity M1 Task D) — captured from the code BEFORE
 * backgrounds/ambitions/alignments/patron-templates/starter-gear-flavor moved
 * into the pack, so the move is provably byte-identical data motion.
 * engine/creation.test.ts already pins backgrounds' gear/stats byte-for-byte
 * via built-character assertions; this file covers what it doesn't: ambition/
 * alignment prose, patron templates, and faction starter-gear flavor.
 */
describe("content/creation — pin (world-flavored creation data)", () => {
  it("pool sizes are unchanged", () => {
    expect(ambitions.length).toBe(6);
    expect(alignments.length).toBe(14);
    expect(backgrounds.length).toBe(16);
    expect(Object.keys(FACTION_PATRON)).toEqual(["f-crown", "f-sable", "f-undertow", "f-wreckers", "f-free", "f-reclaimers"]);
  });

  it("patronFor is unchanged for a known faction and the default fallback", () => {
    expect(patronFor("f-crown")).toEqual({
      name: "Quartermaster Vane",
      role: "Crown recruit-handler",
      oneBreath: "The Hollow Crown's recruit-handler on Meridian — gruff, fair, keeps green contractors alive long enough to be useful. Patches you up and points you at safe work until you're on your feet.",
    });
    expect(patronFor(undefined)).toEqual({
      name: "The Harbor-keeper",
      role: "dockside fixer",
      oneBreath: "A dockside fixer who looks after green newcomers — a berth, a mend, a few creds, and a safe first job until they can stand on their own.",
    });
  });

  it("factionStarterGear flavor is unchanged for a known faction and the default", () => {
    expect(factionStarterGear("f-sable")).toEqual([
      { name: "Back-alley snub pistol", itemId: "sidearm", damage: "1d8", detail: "faction-issue sidearm" },
      { name: "Reinforced jacket", itemId: "paddedJacket", acBonus: 1, detail: "+1 AC" },
      { name: "Burner comm", detail: "part of your starting kit" },
    ]);
    expect(factionStarterGear(undefined)).toEqual([
      { name: "Sidearm", itemId: "sidearm", damage: "1d8", detail: "faction-issue sidearm" },
      { name: "Padded jacket", itemId: "paddedJacket", acBonus: 1, detail: "+1 AC" },
      { name: "Multitool", detail: "part of your starting kit" },
    ]);
  });
});
