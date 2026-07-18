import { describe, it, expect } from "vitest";
import type { CampaignState, Npc } from "./schemas";
import type { PackStoryline } from "@/content/pack/types";
import { turnSignals } from "./quests";
import { resolveStorylineTurn } from "./storylineRuntime";
import { nextBeat, markBeatDelivered, type StorylineState } from "./storyline";

function stub(): PackStoryline {
  return {
    chapters: [
      {
        id: "ch-1", act: 1, title: "The Ledger", trigger: {}, castNpcIds: [],
        objectives: [{ id: "o1", kind: "travel", summary: "Reach Rook Station", locationId: "loc-b" }],
        beats: [{ id: "b1", directive: "Ilyana greets you warily." }],
        reward: { credits: 100, factionRep: { factionId: "f-crown", delta: 1 } },
      },
    ],
  };
}

function state(over: Partial<CampaignState["campaign"]> = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-b", tendaysElapsed: 0, ...over },
    universe: { id: "u", name: "U" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false, credits: 100,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [{ id: "f-crown", universeId: "u", name: "The Crown" }],
    factionRep: [],
    locations: [{ id: "loc-a", universeId: "u", name: "Home Berth", tags: [] }, { id: "loc-b", universeId: "u", name: "Rook Station", tags: [] }],
    npcs: [] as Npc[],
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("resolveStorylineTurn", () => {
  it("opens ch-1, advances its objective, and pays credits + rep on completion", () => {
    const s = state();
    const signals = turnSignals("loc-b", [], false, []);
    const res = resolveStorylineTurn({
      content: stub(), storyline: { chapters: {} }, state: s, npcRelations: {}, facts: [], signals,
    });
    expect(res.storyline.chapters["ch-1"].status).toBe("complete");
    const pc = res.state.characters.find((c) => c.kind === "pc")!;
    expect(pc.credits).toBe(200);
    expect(res.state.factionRep.find((r) => r.factionId === "f-crown")?.rep).toBe(1);
    expect(res.events.some((e) => e.type === "resource" && e.field === "credits")).toBe(true);
    expect(res.lines.some((l) => l.includes("Reward paid"))).toBe(true);
  });

  it("does not pay when the objective isn't met this turn", () => {
    const s = state({ currentLocationId: "loc-a" });
    const signals = turnSignals("loc-a", [], false, []);
    const res = resolveStorylineTurn({
      content: stub(), storyline: { chapters: {} }, state: s, npcRelations: {}, facts: [], signals,
    });
    expect(res.state.characters.find((c) => c.kind === "pc")!.credits).toBe(100);
  });

  it("marks the beat that was fed THIS turn as delivered, once", () => {
    const opened: StorylineState = { chapters: { "ch-1": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
    const fed = nextBeat(stub(), opened, [], 0)!;
    expect(fed.beat.id).toBe("b1");
    const s = state({ currentLocationId: "loc-a" }); // objective not yet met this turn
    const res = resolveStorylineTurn({
      content: stub(), storyline: opened, state: s, npcRelations: {}, facts: [],
      signals: turnSignals("loc-a", [], false, []), deliveredBeat: fed,
    });
    expect(res.storyline.chapters["ch-1"].deliveredBeatIds).toEqual(["b1"]);
  });

  it("rollback-safety shape: beat delivery is a pure transform, never applied unless the caller explicitly commits it", () => {
    // The route only calls markBeatDelivered (via resolveStorylineTurn's
    // deliveredBeat param) from the SUCCESS path, after the turn lands — a
    // thrown error before that point means the caller's session.storyline
    // object was never reassigned, so nothing to roll back (trap 4). This
    // test pins that nextBeat/markBeatDelivered themselves never mutate
    // their input.
    const before: StorylineState = { chapters: { "ch-1": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
    const beat = nextBeat(stub(), before, [], 0)!;
    const after = markBeatDelivered(before, beat, 0);
    expect(before.chapters["ch-1"].deliveredBeatIds).toEqual([]); // untouched
    expect(after.chapters["ch-1"].deliveredBeatIds).toEqual(["b1"]);
  });
});
