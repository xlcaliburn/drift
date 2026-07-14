import { describe, it, expect } from "vitest";
import { resolveDownedTurn, isSceneMove, DOWNED_TURN_LIMIT } from "./scene";

describe("isSceneMove — a move opens a new scene", () => {
  it("a station/location change is always a move", () => {
    expect(isSceneMove("the docks", "the docks", "loc-rook", "loc-undertow")).toBe(true);
    // even with no place set, the location change alone is enough
    expect(isSceneMove(undefined, undefined, "loc-rook", "loc-meridian")).toBe(true);
  });

  it("a genuinely different place (same location) is a move", () => {
    expect(isSceneMove("the fixer's stall", "the Undertow bounty desk", "loc-rook", "loc-rook")).toBe(true);
  });

  it("a reword or elaboration is NOT a move (substring after normalize)", () => {
    // "docking bay" ⊂ "calvo s docking bay" → elaboration, not a move
    expect(isSceneMove("docking bay", "Calvo's docking bay", "loc-rook", "loc-rook")).toBe(false);
    // pure re-affirmation (identical after normalize)
    expect(isSceneMove("The Bar.", "the bar", "loc-rook", "loc-rook")).toBe(false);
  });

  it("first-set of a place is NOT a move", () => {
    expect(isSceneMove(undefined, "the fixer's stall", "loc-rook", "loc-rook")).toBe(false);
    expect(isSceneMove("", "the fixer's stall", "loc-rook", "loc-rook")).toBe(false);
  });

  it("empty / missing inputs are NOT a move", () => {
    expect(isSceneMove(undefined, undefined, undefined, undefined)).toBe(false);
    expect(isSceneMove("the docks", "", "loc-rook", "loc-rook")).toBe(false);
    expect(isSceneMove("the docks", "   ", "loc-rook", "loc-rook")).toBe(false);
    // same location echoed back with no place change is not a move
    expect(isSceneMove(undefined, undefined, "loc-rook", "loc-rook")).toBe(false);
  });
});

describe("resolveDownedTurn — the bleed-out clock", () => {
  const base = { downedTurns: 0, presentHostile: false, dangerPresent: false, inTutorial: false };

  it("gives a desperate turn first, before the limit trips", () => {
    // First downed turn: counter 1 (< limit of 2) → keep letting them try.
    expect(resolveDownedTurn(base)).toEqual({ downedTurns: 1, outcome: "continue" });
  });

  it("forces a conclusion once the limit is reached — stabilises when the coast is clear", () => {
    const r = resolveDownedTurn({ ...base, downedTurns: DOWNED_TURN_LIMIT - 1 });
    expect(r).toEqual({ downedTurns: DOWNED_TURN_LIMIT, outcome: "stabilize" });
  });

  it("kills instead of stabilising when a hostile NPC is present", () => {
    const r = resolveDownedTurn({ ...base, downedTurns: DOWNED_TURN_LIMIT - 1, presentHostile: true });
    expect(r.outcome).toBe("die");
  });

  it("kills when an active danger is bleeding them out", () => {
    const r = resolveDownedTurn({ ...base, downedTurns: DOWNED_TURN_LIMIT - 1, dangerPresent: true });
    expect(r.outcome).toBe("die");
  });

  it("never kills in the tutorial, even in a hostile scene", () => {
    const r = resolveDownedTurn({
      downedTurns: DOWNED_TURN_LIMIT - 1,
      presentHostile: true,
      dangerPresent: true,
      inTutorial: true,
    });
    expect(r.outcome).toBe("stabilize");
  });
});
