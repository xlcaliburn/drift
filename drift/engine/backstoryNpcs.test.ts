import { describe, it, expect } from "vitest";
import {
  buildBackstoryNpcs,
  inferDisposition,
  deriveRole,
  seedFromString,
  type BackstoryRelationInput,
} from "@/engine/creation";

const LOCS = ["loc-meridian", "loc-rook", "loc-undertow"];

const relations: BackstoryRelationInput[] = [
  { name: "Sera Kade", relation: "old nemesis who left them for dead", oneBreath: "Betrayed you on the Rook job." },
  { name: "Old Tam", relation: "the mentor who bankrolled them", oneBreath: "Taught you the lanes." },
];

function build(overrides: Partial<Parameters<typeof buildBackstoryNpcs>[0]> = {}) {
  return buildBackstoryNpcs({
    relations,
    universeId: "uni-1",
    campaignId: "camp-abc",
    characterName: "Rix",
    ambition: "revenge",
    locationIds: LOCS,
    ...overrides,
  });
}

describe("inferDisposition", () => {
  it("reads a nemesis / betrayal as cold (-2)", () => {
    expect(inferDisposition("old nemesis")).toBe(-2);
    expect(inferDisposition("the rival who betrayed them")).toBe(-2);
    expect(inferDisposition("the captain who left them for dead")).toBe(-2);
  });
  it("reads a mentor / family / ally as warm (+1)", () => {
    expect(inferDisposition("the mentor who bankrolled them")).toBe(1);
    expect(inferDisposition("younger sister")).toBe(1);
    expect(inferDisposition("the friend who saved them")).toBe(1);
  });
  it("estrangement pulls a warm tie down", () => {
    expect(inferDisposition("estranged brother")).toBe(-1);
  });
  it("defaults to neutral for a bare acquaintance", () => {
    expect(inferDisposition("someone they used to know")).toBe(0);
  });
});

describe("deriveRole", () => {
  it("strips articles and trailing clauses to an occupational handle", () => {
    expect(deriveRole("the fixer who bankrolled them")).toBe("fixer");
    expect(deriveRole("the captain that left them for dead")).toBe("captain");
    expect(deriveRole("estranged brother")).toBe("estranged brother");
  });
});

describe("buildBackstoryNpcs", () => {
  it("turns named relations into universe-shared NPCs with role, location, provenance", () => {
    const seeds = build();
    expect(seeds).toHaveLength(2);
    const [a, b] = seeds;
    expect(a.npc.name).toBe("Sera Kade");
    expect(a.npc.universeId).toBe("uni-1");
    expect(a.npc.originCampaignId).toBe("camp-abc");
    expect(a.npc.role).toBe("old nemesis"); // "who left..." clause dropped
    expect(LOCS).toContain(a.npc.locationId);
    expect(b.npc.role).toBe("mentor");
  });

  it("pre-fills the private relation: label, inferred disposition, note, nameKnown", () => {
    const [a, b] = build();
    expect(a.id).toBe(a.npc.id);
    expect(a.relation.relationship).toBe("old nemesis who left them for dead");
    expect(a.relation.disposition).toBe(-2); // nemesis → cold
    expect(a.relation.nameKnown).toBe(true);
    expect(a.relation.lastNote).toContain("Betrayed you");
    expect(b.relation.disposition).toBe(1); // mentor → warm
  });

  it("is deterministic from the campaign seed (same in → same out)", () => {
    expect(build()).toEqual(build());
    // A different campaign id yields a (potentially) different location pick but a
    // stable result for that id.
    const other1 = build({ campaignId: "camp-xyz" });
    const other2 = build({ campaignId: "camp-xyz" });
    expect(other1).toEqual(other2);
  });

  it("caps at 2 and skips names already in the cast", () => {
    const many: BackstoryRelationInput[] = [
      { name: "A One", relation: "friend" },
      { name: "B Two", relation: "rival" },
      { name: "C Three", relation: "mentor" },
    ];
    const seeds = buildBackstoryNpcs({
      relations: many,
      universeId: "uni-1",
      campaignId: "camp-abc",
      characterName: "Rix",
      locationIds: LOCS,
      existingNames: ["A One"],
    });
    expect(seeds.map((s) => s.npc.name)).toEqual(["B Two", "C Three"]);
  });

  it("falls back to one ambition-keyed tie when the backstory named no one", () => {
    const revenge = buildBackstoryNpcs({
      relations: [],
      universeId: "uni-1",
      campaignId: "camp-abc",
      characterName: "Rix",
      ambition: "revenge",
      locationIds: LOCS,
    });
    expect(revenge).toHaveLength(1);
    expect(revenge[0].relation.disposition).toBe(-2); // nemesis
    expect(revenge[0].npc.role).toBe("old nemesis");

    const other = buildBackstoryNpcs({
      relations: [],
      universeId: "uni-1",
      campaignId: "camp-abc",
      characterName: "Rix",
      ambition: "wealth",
      locationIds: LOCS,
    });
    expect(other).toHaveLength(1);
    expect(other[0].relation.disposition).toBe(1); // mentor
  });

  it("omits location cleanly when the universe has none", () => {
    const seeds = build({ locationIds: [] });
    expect(seeds[0].npc.locationId).toBeUndefined();
  });
});

describe("seedFromString", () => {
  it("is stable and unsigned 32-bit", () => {
    const s = seedFromString("camp-abc");
    expect(s).toBe(seedFromString("camp-abc"));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(s)).toBe(true);
  });
});
