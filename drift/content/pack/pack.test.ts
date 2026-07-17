import { describe, it, expect } from "vitest";
import { ContentPack, validatePack } from "./types";
import { pack, NAMED_LANES, FACTION_HOME, MAP_LAYOUT, DEFAULT_HOME_LOCATION } from "./index";

describe("content pack — schema + referential integrity (the world seam)", () => {
  it("the active pack parses against the schema", () => {
    const res = ContentPack.safeParse(pack);
    expect(res.success, res.success ? "" : JSON.stringify(res.error.issues, null, 2)).toBe(true);
  });

  it("the active pack has no integrity problems", () => {
    expect(validatePack(pack)).toEqual([]);
  });

  it("integrity: catches a broken home / dangling lane / faction-named NPC", () => {
    const broken: typeof pack = {
      ...pack,
      factions: [{ ...pack.factions[0], homeLocationId: "loc-nowhere" }],
      locations: [
        { ...pack.locations[0], lanes: [{ to: "loc-missing", tendays: 2, risk: "low" }] },
        ...pack.locations.slice(1),
      ],
      cast: [{ id: "npc-bad", name: pack.factions[0].name, oneBreath: "a faction wearing a trenchcoat" }],
    };
    const problems = validatePack(broken);
    expect(problems.some((p) => p.includes("loc-nowhere"))).toBe(true);
    expect(problems.some((p) => p.includes("loc-missing"))).toBe(true);
    expect(problems.some((p) => p.includes("collides with a faction name"))).toBe(true);
  });

  it("derived views are populated and internally consistent", () => {
    // Every faction has a home that maps to a real location.
    for (const home of Object.values(FACTION_HOME)) {
      expect(pack.locations.some((l) => l.id === home)).toBe(true);
    }
    // Lanes derive with sorted keys and land on real locations.
    expect(Object.keys(NAMED_LANES).length).toBeGreaterThan(0);
    for (const key of Object.keys(NAMED_LANES)) {
      const [a, b] = key.split("|");
      expect(a < b).toBe(true);
      expect(pack.locations.some((l) => l.id === a)).toBe(true);
      expect(pack.locations.some((l) => l.id === b)).toBe(true);
    }
    // Every location has a map position; the default home is a real location.
    expect(Object.keys(MAP_LAYOUT).sort()).toEqual(pack.locations.map((l) => l.id).sort());
    expect(pack.locations.some((l) => l.id === DEFAULT_HOME_LOCATION)).toBe(true);
  });
});
