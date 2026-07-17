import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { freshSceneCard, carryScene, MAX_BEATS, dispositionLabel, relationSuffix, relationHistory, appendRelationLog, isPlaceholderOneBreath } from "@/shared/scene";
import type { NpcRelation } from "@/shared/scene";
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
    // COMPANION CONTINUITY: who was just with the player is remembered for one
    // scene, so a traveling companion isn't stranded by the home-location gate
    // the moment the scene turns over (the "Ren with Lyra at Halcyon" gap).
    expect(next.prevPresentNpcIds).toEqual([id]);
    expect(next.startTranscriptIdx).toBe(42);
    // And it decays: a full scene without them present → gone from the next carry.
    const third = carryScene(next, 60);
    expect(third.prevPresentNpcIds).toEqual([]);
  });

  it("a genuine place change clears present NPCs (old crowd left behind); a reword keeps them", () => {
    const card = freshSceneCard(2);
    const rt = new TurnRuntime(baseState(), rng, { sceneCard: card });
    const { id: fixer } = rt.registerNpc("The Fixer");
    rt.markPresent(fixer);
    rt.updateScene(undefined, undefined, "the fixer's stall");
    expect(card.presentNpcIds).toEqual([fixer]);

    // A reword/elaboration of the same place must NOT wipe the cast.
    rt.updateScene(undefined, undefined, "the fixer's stall, back room");
    expect(card.presentNpcIds).toEqual([fixer]);

    // A move to a genuinely different place leaves the old crowd behind.
    rt.updateScene(undefined, undefined, "the Undertow bounty desk");
    expect(card.presentNpcIds).toEqual([]);
    expect(card.place).toBe("the Undertow bounty desk");
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

  it("refreshSituation keeps Here & now live — derives situation from the narration", () => {
    const card = freshSceneCard();
    const rt = new TurnRuntime(baseState(), rng, { sceneCard: card });
    // Stale line from an earlier beat; the model didn't set one this turn.
    card.situation = "Aboard the Dust Eater, docking collar to the Magpie";
    rt.refreshSituation("You lay the chip on the fixer's counter. The broker watches, arms crossed.");
    expect(card.situation).toBe("You lay the chip on the fixer's counter."); // first sentence
  });
});

describe("narrative gear changes", () => {
  it("a player-CLAIMED item grants nothing — item gains need a legitimate source", () => {
    const rt = new TurnRuntime(baseState(), rng);
    // No loot roll, no quest reward this turn → the narrator can't hand it over.
    expect(rt.applyGearChange("a rocket launcher", "gain")).toBeNull();
    expect(rt.state.characters[0].gear.some((g) => /rocket/i.test(g.name))).toBe(false);
    // A quest reward unlocks the transfer for the turn.
    rt.markQuestCompleted();
    expect(rt.applyGearChange("a data slate", "gain")).toContain("Gained");
  });

  it("a looted CATALOG item (medkit) becomes the mechanical item — usable via useItem", () => {
    const rt = new TurnRuntime(baseState(), { int: (_min, max) => max });
    rt.markQuestCompleted(); // legitimate source (reward) — gains are engine-gated
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

  it("a successful loot check makes the ENGINE generate the reward + unlocks items[]", () => {
    const rt = new TurnRuntime(baseState(), { int: (_min, max) => max }); // nat 20 → success + crit
    const pc = rt.state.characters.find((c) => c.kind === "pc")!;
    const before = pc.credits ?? 0;
    const res = rt.execute("roll_check", {
      characterId: pc.id,
      skill: "scavenging",
      dc: 12,
      stakes: true,
      loot: true,
    }) as { loot?: string; outcome?: string };
    expect(res.outcome).toBe("success");
    expect(res.loot).toContain("Scavenged"); // the engine decided the haul
    expect((rt.state.characters.find((c) => c.kind === "pc")!.credits ?? 0)).toBeGreaterThan(before);
    // Having looted this turn, a corroborating narrator gain is now allowed.
    expect(rt.applyGearChange("a stripped access panel", "gain")).toContain("Gained");
  });

  it("gain adds a flavor item (deduped); lose removes it — catalog stacks decrement", () => {
    const s = baseState();
    s.characters[0].gear = [{ name: "Stim", itemId: "stim", qty: 2 }] as typeof s.characters[0]["gear"];
    const rt = new TurnRuntime(s, rng);
    rt.markQuestCompleted(); // legitimate source for the gains below
    expect(rt.applyGearChange("vacuum-rated facemask", "gain", "looted from the locker")).toContain("Gained");
    expect(rt.applyGearChange("Vacuum-Rated Facemask", "gain")).toBeNull(); // dedupe, case-insensitive
    expect(rt.state.characters[0].gear.some((g) => g.name === "vacuum-rated facemask")).toBe(true);
    expect(rt.applyGearChange("vacuum-rated facemask", "lose")).toContain("Lost"); // losses are always allowed
    expect(rt.state.characters[0].gear.some((g) => g.name === "vacuum-rated facemask")).toBe(false);
    // Catalog-owned gear: a narrative loss (drop / confiscation — ITEMS.md slice B)
    // decrements the stack by ONE; the entry goes when the last one does.
    expect(rt.applyGearChange("Stim", "lose")).toContain("Lost");
    expect(rt.state.characters[0].gear.find((g) => g.itemId === "stim")?.qty).toBe(1);
    expect(rt.applyGearChange("Stim", "lose")).toContain("Lost");
    expect(rt.state.characters[0].gear.some((g) => g.itemId === "stim")).toBe(false);
  });

  it("a FLAVOR prop (a gift) is granted WITHOUT loot/quest; gear-ish names still gated", () => {
    const rt = new TurnRuntime(baseState(), rng); // no loot, no quest this turn
    // The rose-bouquet bug: an NPC hands the player flowers in plain dialogue.
    expect(rt.applyGearChange("rose bouquet", "gain", "a gift from Agnes")).toContain("Gained");
    const bouquet = rt.state.characters[0].gear.find((g) => g.name.toLowerCase() === "rose bouquet");
    expect(bouquet).toBeTruthy();
    // Every added item records how + when it was acquired (the note + the tenday).
    expect(bouquet!.detail).toMatch(/gift from Agnes.*tenday/);
    // But real GEAR still needs a legit source, even by a non-catalog name.
    expect(rt.applyGearChange("a plasma rifle", "gain")).toBeNull();
    expect(rt.applyGearChange("Combat armor", "gain")).toBeNull(); // catalog gear
    expect(rt.state.characters[0].gear.some((g) => /rifle|armor/i.test(g.name))).toBe(false);
  });
});

describe("npc relations (tier CANON)", () => {
  it("disposition does NOT move without a quest completion (standing is earned)", () => {
    const rt = new TurnRuntime(baseState(), rng, { npcRelations: {} });
    const { id } = rt.registerNpc("Doyle");
    // No payout/thread-resolve this turn → the nudge is ignored, no line.
    const res = rt.updateNpcRelation(id, { disposition: 1, note: "chatted" });
    expect(res.line).toBeUndefined();
    expect(rt.npcRelations[id].disposition).toBe(0);
    // …but memory (note) still updates every turn.
    expect(rt.npcRelations[id].lastNote).toBe("chatted");
  });

  it("disposition nudges are clamped to ±1 per NPC per turn (on a quest-completion turn)", () => {
    const rt = new TurnRuntime(baseState(), rng, { npcRelations: {} });
    rt.markQuestCompleted(); // a job concluded this turn → standing may move
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
    rt.markQuestCompleted();
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

  it("ACCUMULATES a history log across turns and RENDERS it for the prompt (the 'forgot the scene' fix)", () => {
    const card = freshSceneCard(5);
    const rt = new TurnRuntime(baseState(), rng, { sceneCard: card, npcRelations: {} });
    const { id } = rt.registerNpc("Sera");
    // An extensive scene: several distinct developments over the turns.
    rt.updateNpcRelation(id, { note: "met at the bar; she's a Sable courier" });
    rt.updateNpcRelation(id, { note: "she told you about her missing sister" });
    rt.updateNpcRelation(id, { note: "she asked you to look into the Rook manifests" });
    rt.updateNpcRelation(id, { note: "she asked you to look into the Rook manifests" }); // dupe → no new entry
    const rel = rt.npcRelations[id];
    expect(rel.log?.length).toBe(3); // deduped, all three distinct beats kept
    const hist = relationHistory(rel);
    // The whole arc is in the prompt string, scene-tagged — not just the last line.
    expect(hist).toContain("met at the bar");
    expect(hist).toContain("missing sister");
    expect(hist).toContain("Rook manifests");
    expect(hist).toContain("[s5]");
  });

  it("relationHistory stays quiet for a brand-new relationship (≤1 beat)", () => {
    expect(relationHistory({ disposition: 0, log: [{ note: "just met", scene: 1 }] })).toBe("");
    expect(relationHistory({ disposition: 0 })).toBe("");
  });
});

describe("scene analyst helpers (CONTINUITY — the Sera fix)", () => {
  it("isPlaceholderOneBreath flags the junk fallbacks + thin lines, spares real canon", () => {
    expect(isPlaceholderOneBreath("Spoke with the player.")).toBe(true);
    expect(isPlaceholderOneBreath("Sera the player is dealing with.")).toBe(true);
    expect(isPlaceholderOneBreath("a fixer")).toBe(true); // too short
    expect(isPlaceholderOneBreath(undefined)).toBe(true);
    expect(
      isPlaceholderOneBreath("A Ledger fixer — a ghost in heels — who warmed to Dresch and became his partner."),
    ).toBe(false); // real canon is preserved
  });

  it("appendRelationLog builds history, dedupes consecutively, and caps", () => {
    const rel: NpcRelation = { disposition: 2 };
    appendRelationLog(rel, "met at the bar", 5);
    appendRelationLog(rel, "met at the bar", 5); // consecutive dupe → ignored
    appendRelationLog(rel, "she gave you the Dock-14 job", 6);
    expect(rel.log).toEqual([
      { note: "met at the bar", scene: 5 },
      { note: "she gave you the Dock-14 job", scene: 6 },
    ]);
    // Cap: pushing past MAX_RELATION_LOG trims the oldest.
    for (let i = 0; i < 12; i++) appendRelationLog(rel, `beat ${i}`, 7 + i);
    expect(rel.log!.length).toBeLessThanOrEqual(8);
    expect(rel.log![rel.log!.length - 1].note).toBe("beat 11"); // newest kept
  });
});
