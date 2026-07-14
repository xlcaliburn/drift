import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { freshSceneCard, carryScene, MAX_BEATS, dispositionLabel, relationSuffix } from "@/shared/scene";
import type { RNG } from "@/engine";

const rng: RNG = { int: (min) => min };

function baseState(): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-1", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [{ id: "pc-1", kind: "pc", name: "Vess", hp: 8, maxHp: 8, ac: 12, stims: 0, fragile: false, attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 }, skills: [], actionModifiers: {}, gear: [], injuries: [] }],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("scene card (tier NOW)", () => {
  it("registerNpc + markPresent track who is in the scene, deduped", () => {
    const card = freshSceneCard();
    const rt = new TurnRuntime(baseState(), rng, { sceneCard: card });
    const { id } = rt.registerNpc("Doyle", "quartermaster");
    rt.markPresent(id);
    rt.markPresent(id);
    expect(card.presentNpcIds).toEqual([id]);
  });

  it("place overwrites and persists into the next scene; scene-specific state resets", () => {
    const card = freshSceneCard(3);
    const rt = new TurnRuntime(baseState(), rng, { sceneCard: card });
    const { id } = rt.registerNpc("Doyle");
    rt.markPresent(id);
    rt.updateScene("boarding the Dust Eater", ["Doyle promised 200c"], "aboard the Dust Eater, in the black");
    expect(card.place).toBe("aboard the Dust Eater, in the black");

    const next = carryScene(card, 42);
    expect(next.seq).toBe(4);
    expect(next.place).toBe("aboard the Dust Eater, in the black"); // whereabouts carry
    expect(next.situation).toBe(""); // scene-specific reset
    expect(next.beats).toEqual([]);
    expect(next.presentNpcIds).toEqual([]);
    expect(next.startTranscriptIdx).toBe(42);
  });

  it("dangers overwrite and clear with []; a new scene starts clear", () => {
    const card = freshSceneCard(2);
    const rt = new TurnRuntime(baseState(), rng, { sceneCard: card });
    rt.updateScene(undefined, undefined, undefined, ["toxic coolant fog", "sparking conduit"]);
    expect(card.dangers).toEqual(["toxic coolant fog", "sparking conduit"]);
    rt.updateScene(undefined, undefined, undefined, ["toxic coolant fog"]); // conduit dealt with
    expect(card.dangers).toEqual(["toxic coolant fog"]);
    rt.updateScene(undefined, undefined, undefined, []); // all clear
    expect(card.dangers).toEqual([]);
    expect(carryScene(card, 0).dangers).toEqual([]); // never carried across scenes
  });

  it("situation overwrites; beats append, dedupe, and cap at MAX_BEATS", () => {
    const card = freshSceneCard();
    const rt = new TurnRuntime(baseState(), rng, { sceneCard: card });
    rt.updateScene("Doyle is checking the seals", ["Doyle promised 200c"]);
    rt.updateScene("Doyle looks up, suspicious", ["Doyle promised 200c"]); // dupe beat ignored
    expect(card.situation).toBe("Doyle looks up, suspicious");
    expect(card.beats).toEqual(["Doyle promised 200c"]);
    for (let i = 0; i < MAX_BEATS + 3; i++) rt.updateScene(undefined, [`beat ${i}`]);
    expect(card.beats.length).toBe(MAX_BEATS); // oldest evicted, capped
    expect(card.beats).not.toContain("Doyle promised 200c");
  });
});

describe("narrative gear changes", () => {
  it("a looted CATALOG item (medkit) becomes the mechanical item — usable via useItem", () => {
    const rt = new TurnRuntime(baseState(), { int: (_min, max) => max });
    expect(rt.applyGearChange("a Medkit", "gain")).toContain("Gained: Medkit");
    const g = rt.state.characters[0].gear.find((x) => x.itemId === "medkit");
    expect(g).toBeTruthy(); // itemId attached → possession check passes
    expect(rt.applyGearChange("medkit", "gain")).toContain("×2"); // second one stacks
    // And it actually WORKS: the heal applies (the reported medkit bug).
    rt.state = {
      ...rt.state,
      characters: rt.state.characters.map((c) => (c.kind === "pc" ? { ...c, hp: 1 } : c)),
    };
    const res = rt.useItem("medkit") as { line?: string; error?: string };
    expect(res.error).toBeUndefined();
    expect(rt.state.characters[0].hp).toBeGreaterThan(1);
  });

  it("gain adds a flavor item (deduped); lose removes it — catalog items protected", () => {
    const s = baseState();
    s.characters[0].gear = [{ name: "Stim", itemId: "stim", qty: 2 }] as typeof s.characters[0]["gear"];
    const rt = new TurnRuntime(s, rng);
    expect(rt.applyGearChange("vacuum-rated facemask", "gain", "looted from the locker")).toContain("Gained");
    expect(rt.applyGearChange("Vacuum-Rated Facemask", "gain")).toBeNull(); // dedupe, case-insensitive
    expect(rt.state.characters[0].gear.some((g) => g.name === "vacuum-rated facemask")).toBe(true);
    expect(rt.applyGearChange("vacuum-rated facemask", "lose")).toContain("Lost");
    expect(rt.state.characters[0].gear.some((g) => g.name === "vacuum-rated facemask")).toBe(false);
    // Catalog-owned gear can't be removed narratively (spent via useItem only).
    expect(rt.applyGearChange("Stim", "lose")).toBeNull();
    expect(rt.state.characters[0].gear.some((g) => g.name === "Stim")).toBe(true);
  });
});

describe("npc relations (tier CANON)", () => {
  it("disposition nudges are clamped to ±1 per NPC per turn and to the -3..+3 range", () => {
    const relations = {};
    const rt = new TurnRuntime(baseState(), rng, { npcRelations: relations });
    const { id } = rt.registerNpc("Doyle");
    const first = rt.updateNpcRelation(id, { disposition: 1 });
    expect(first.line).toContain("neutral → warm");
    // Second nudge same turn: ignored (cap).
    const second = rt.updateNpcRelation(id, { disposition: 1 });
    expect(second.line).toBeUndefined();
    expect(rt.npcRelations[id].disposition).toBe(1);
  });

  it("range clamps at +3 (ally) — a nudge past the cap is a no-op with no line", () => {
    const rt = new TurnRuntime(baseState(), rng, {
      npcRelations: { "npc-x": { disposition: 3 } },
    });
    rt.state = { ...rt.state, npcs: [{ id: "npc-x", universeId: "u", name: "Vex", oneBreath: "fence" }] };
    const res = rt.updateNpcRelation("npc-x", { disposition: 1 });
    expect(res.line).toBeUndefined();
    expect(rt.npcRelations["npc-x"].disposition).toBe(3);
  });

  it("relationship is set-once; note overwrites and stamps the scene", () => {
    const card = freshSceneCard(4);
    const rt = new TurnRuntime(baseState(), rng, { sceneCard: card, npcRelations: {} });
    const { id } = rt.registerNpc("Doyle");
    rt.updateNpcRelation(id, { relationship: "your supply contact", note: "met at the desk" });
    rt.updateNpcRelation(id, { relationship: "sworn enemy", note: "paid you 200c" });
    expect(rt.npcRelations[id].relationship).toBe("your supply contact"); // first write sticks
    expect(rt.npcRelations[id].lastNote).toBe("paid you 200c"); // rolling memory
    expect(rt.npcRelations[id].lastSceneSeq).toBe(4);
  });

  it("renders a compact context suffix", () => {
    expect(relationSuffix({ disposition: 2, relationship: "your handler", lastNote: "paid you 200c" })).toBe(
      " [trusted (+2) · your handler · last: paid you 200c]",
    );
    expect(relationSuffix({ disposition: 0 })).toBe("");
    expect(dispositionLabel(-3)).toBe("hostile");
  });
});
