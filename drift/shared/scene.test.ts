import { describe, it, expect } from "vitest";
import { resolveDownedTurn, DOWNED_TURN_LIMIT } from "./scene";

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
