import { describe, it, expect } from "vitest";
import { ContentPack, validatePack, PackStoryChapter, PackStoryObjective } from "./types";
import { ObjectiveKind } from "@/shared/quests";
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

describe("content pack — Modularity M1 category completeness (Task F)", () => {
  it("every faction has a patron, starter-gear flavor, a brief, and an opening", () => {
    for (const f of pack.factions) {
      expect(pack.creation.patrons[f.id], `patron for ${f.id}`).toBeTruthy();
      expect(pack.creation.starterGearFlavor[f.id], `starter gear for ${f.id}`).toBeTruthy();
      expect(pack.briefs.factions.some((b) => b.factionId === f.id), `brief for ${f.id}`).toBe(true);
      expect(pack.openings.factions.some((o) => o.factionId === f.id), `opening for ${f.id}`).toBe(true);
    }
  });

  it("mechanical catalogs are all present and non-empty", () => {
    for (const key of ["economy", "weapons", "enemyTiers", "shipClasses", "crew", "items"] as const) {
      expect(Object.keys(pack.catalogs[key]).length, `catalogs.${key}`).toBeGreaterThan(0);
    }
  });

  it("name pools and the creation gallery are non-empty", () => {
    expect(pack.names.given.length).toBeGreaterThan(0);
    expect(pack.names.surnames.length).toBeGreaterThan(0);
    expect(pack.names.mononyms.length).toBeGreaterThan(0);
    expect(pack.examples.skills.length).toBeGreaterThan(0);
    expect(pack.examples.moralCodes.length).toBeGreaterThan(0);
    expect(pack.examples.losses.length).toBeGreaterThan(0);
    expect(pack.examples.ties.length).toBeGreaterThan(0);
    expect(pack.examples.tells.length).toBeGreaterThan(0);
  });

  it("every npcFlavor pool meets its minimum arity (⚠ never shrink below this — order-sensitive, see types.ts)", () => {
    for (const key of ["demeanors", "tells", "drives", "hooks", "builds", "faces", "marks", "ages", "voices", "origins"] as const) {
      expect(pack.npcFlavor[key].length, `npcFlavor.${key}`).toBeGreaterThanOrEqual(6);
    }
  });

  it("creation backgrounds are non-empty and every one grants gear", () => {
    expect(pack.creation.backgrounds.length).toBeGreaterThan(0);
    for (const b of pack.creation.backgrounds) expect(b.gear.length, `gear for ${b.id}`).toBeGreaterThan(0);
  });
});

describe("content pack — ship2 CombatSystem completeness (HANDOFF_COMBAT_V2_2.md)", () => {
  it("every shipClass has a ship2 statline, and every owned mount resolves", () => {
    const knownShipClasses = (pack.catalogs.shipClasses as { classes: Record<string, unknown> }).classes;
    for (const classId of Object.keys(knownShipClasses)) {
      const cls = pack.ship2.classes[classId];
      expect(cls, `ship2 statline for ${classId}`).toBeTruthy();
      expect(cls.mounts.length, `${classId} owns at least one mount`).toBeGreaterThan(0);
      for (const mountId of cls.mounts) {
        expect(pack.ship2.mounts[mountId], `${classId} mount ${mountId}`).toBeTruthy();
      }
    }
  });

  it("every policy token is a real allocation weight", () => {
    for (const [classId, cls] of Object.entries(pack.ship2.classes)) {
      for (const token of cls.policy) {
        expect(["guns", "shields", "engines"], `${classId} policy token ${token}`).toContain(token);
      }
    }
  });
});

describe("content pack — storyline schema + referential integrity (HANDOFF_STORY_1.md)", () => {
  it("the live pack ships an EMPTY storyline (dormant until content lands)", () => {
    expect(pack.storyline.chapters).toEqual([]);
  });

  function chapter(over: Partial<(typeof pack.storyline.chapters)[number]> = {}) {
    return {
      id: "ch-1", act: 1 as const, title: "Test Chapter",
      trigger: {},
      castNpcIds: [pack.cast[0].id],
      objectives: [{ id: "o1", kind: "travel" as const, summary: "Go there", locationId: pack.locations[0].id }],
      beats: [],
      reward: { credits: 100 },
      ...over,
    };
  }

  it("a well-formed 2-chapter fixture has no integrity problems", () => {
    const withStory = {
      ...pack,
      storyline: {
        chapters: [
          chapter({ id: "ch-1" }),
          chapter({ id: "ch-2", trigger: { requiresChapterId: "ch-1" } }),
        ],
      },
    };
    expect(ContentPack.safeParse(withStory).success).toBe(true);
    expect(validatePack(withStory)).toEqual([]);
  });

  it("catches a duplicate chapter id", () => {
    const problems = validatePack({ ...pack, storyline: { chapters: [chapter({ id: "ch-1" }), chapter({ id: "ch-1" })] } });
    expect(problems.some((p) => p.includes("duplicate chapter id"))).toBe(true);
  });

  it("catches an unknown cast npc", () => {
    const problems = validatePack({ ...pack, storyline: { chapters: [chapter({ castNpcIds: ["npc-does-not-exist"] })] } });
    expect(problems.some((p) => p.includes("unknown cast npc"))).toBe(true);
  });

  it("catches a trigger requiring an UNKNOWN chapter, and one requiring a LATER chapter", () => {
    const unknown = validatePack({ ...pack, storyline: { chapters: [chapter({ trigger: { requiresChapterId: "ch-nope" } })] } });
    expect(unknown.some((p) => p.includes("requires unknown chapter"))).toBe(true);

    const outOfOrder = validatePack({
      ...pack,
      storyline: {
        chapters: [
          chapter({ id: "ch-1", trigger: { requiresChapterId: "ch-2" } }), // ch-2 comes AFTER ch-1
          chapter({ id: "ch-2" }),
        ],
      },
    });
    expect(outOfOrder.some((p) => p.includes("isn't EARLIER"))).toBe(true);
  });

  it("catches unknown location/faction/npc ids in a trigger", () => {
    const problems = validatePack({
      ...pack,
      storyline: {
        chapters: [
          chapter({
            trigger: {
              atLocationId: "loc-nowhere",
              factionRepAtLeast: { factionId: "f-nowhere", rep: 3 },
              npcTrustAtLeast: { npcId: "npc-nowhere", disposition: 2 },
            },
          }),
        ],
      },
    });
    expect(problems.some((p) => p.includes("trigger location loc-nowhere"))).toBe(true);
    expect(problems.some((p) => p.includes("trigger faction f-nowhere"))).toBe(true);
    expect(problems.some((p) => p.includes("trigger npc npc-nowhere"))).toBe(true);
  });

  it("catches unknown location/npc ids in an objective, and an unknown reward faction", () => {
    const problems = validatePack({
      ...pack,
      storyline: {
        chapters: [
          chapter({
            objectives: [{ id: "o1", kind: "report" as const, summary: "Find them", npcId: "npc-nowhere" }],
            reward: { credits: 50, factionRep: { factionId: "f-nowhere", delta: 1 } },
          }),
        ],
      },
    });
    expect(problems.some((p) => p.includes("objective o1: unknown npc"))).toBe(true);
    expect(problems.some((p) => p.includes("reward faction f-nowhere"))).toBe(true);
  });

  it("the mortal-NPC rule: a beat ABOUT a cast member needs a fallbackDirective", () => {
    const missing = validatePack({
      ...pack,
      storyline: {
        chapters: [chapter({ beats: [{ id: "b1", directive: "They reveal a secret.", aboutNpcId: pack.cast[0].id }] })],
      },
    });
    expect(missing.some((p) => p.includes("aboutNpcId set with no fallbackDirective"))).toBe(true);

    const withFallback = validatePack({
      ...pack,
      storyline: {
        chapters: [
          chapter({
            beats: [{ id: "b1", directive: "They reveal a secret.", aboutNpcId: pack.cast[0].id, fallbackDirective: "A note in their effects reveals it instead." }],
          }),
        ],
      },
    });
    expect(withFallback.some((p) => p.includes("fallbackDirective"))).toBe(false);
  });

  it("PackStoryObjective's duplicated kind enum stays in sync with shared/quests.ts's ObjectiveKind", () => {
    const packKinds = [...PackStoryObjective.shape.kind.options].sort();
    const realKinds = [...ObjectiveKind.options].sort();
    expect(packKinds).toEqual(realKinds);
  });

  it("at most one choicePoint per chapter is enforced by the SCHEMA shape (not an array)", () => {
    const withChoice = chapter({ choicePoint: { id: "c1", prompt: "Pick a side", options: [{ id: "a", label: "Crown", fact: "sided-crown" }, { id: "b", label: "Chain", fact: "sided-chain" }] } });
    expect(PackStoryChapter.safeParse(withChoice).success).toBe(true);
  });
});

describe("content pack — ship2 outfitting completeness (HANDOFF_COMBAT_V2_3.md)", () => {
  it("every class's mount/system slot caps fit its own default loadout", () => {
    for (const [classId, cls] of Object.entries(pack.ship2.classes)) {
      expect(cls.mountSlots, `${classId} mountSlots`).toBeGreaterThanOrEqual(cls.mounts.length);
      expect(cls.systemSlots, `${classId} systemSlots`).toBeGreaterThan(0);
    }
  });

  it("every mount item's weapon type resolves to a real ship2 mount profile", () => {
    const TYPE_TO_MOUNT: Record<string, string> = { kinetic: "railgun", energy: "beamLance", ion: "autocannon", missile: "missileRack" };
    for (const [itemId, item] of Object.entries(pack.ship2.outfitting.mountItems)) {
      const mountId = TYPE_TO_MOUNT[item.type];
      expect(mountId, `${itemId} type ${item.type}`).toBeTruthy();
      expect(pack.ship2.mounts[mountId!], `${itemId} → mount ${mountId}`).toBeTruthy();
      expect(item.price, `${itemId} price`).toBeGreaterThan(0);
    }
  });

  it("every system item writes one of the five known Ship fields, with a positive price", () => {
    const KNOWN_FIELDS = ["damageReduction", "evasiveAcBonus", "hasShield", "hasPointDefense", "burstDriveReady"];
    for (const [itemId, item] of Object.entries(pack.ship2.outfitting.systemItems)) {
      expect(KNOWN_FIELDS, `${itemId} field ${item.field}`).toContain(item.field);
      expect(item.price, `${itemId} price`).toBeGreaterThan(0);
    }
  });

  it("outfitting is non-empty on both sides of the shop", () => {
    expect(Object.keys(pack.ship2.outfitting.mountItems).length).toBeGreaterThan(0);
    expect(Object.keys(pack.ship2.outfitting.systemItems).length).toBeGreaterThan(0);
  });
});
