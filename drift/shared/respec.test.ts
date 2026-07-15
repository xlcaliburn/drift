import { describe, it, expect } from "vitest";
import { validateAttributes, attrTotal, pointsRemaining, ATTR_BUDGET, ATTR_MIN, ATTR_MAX } from "./respec";
import type { Attributes } from "./schemas";

const at = (o: Partial<Attributes>): Attributes => ({
  might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0, ...o,
});

describe("respec balance — a remake never exceeds the creation budget", () => {
  it("accepts a spread that sums to the budget within caps", () => {
    expect(validateAttributes(at({ might: 3 })).ok).toBe(true); // 3
    expect(validateAttributes(at({ reflex: 4, might: -1 })).ok).toBe(true); // 3
    expect(validateAttributes(at({ might: 1, reflex: 1, vitality: 1 })).ok).toBe(true); // 3
  });

  it("rejects an over-budget spread (free points)", () => {
    const r = validateAttributes(at({ might: 3, reflex: 3 })); // 6
    expect(r.ok).toBe(false);
    expect(r.error).toContain(String(ATTR_BUDGET));
  });

  it("rejects an under-budget spread", () => {
    expect(validateAttributes(at({ might: 1 })).ok).toBe(false); // 1
  });

  it("rejects a stat outside the per-stat range (no dump-stat monster builds)", () => {
    expect(validateAttributes(at({ might: ATTR_MAX + 1, reflex: -(ATTR_MAX + 1) + 3 })).ok).toBe(false);
    expect(validateAttributes(at({ might: ATTR_MIN - 1, reflex: -(ATTR_MIN - 1) + 3 })).ok).toBe(false);
  });

  it("rejects non-integer stats", () => {
    expect(validateAttributes(at({ might: 1.5, reflex: 1.5 })).ok).toBe(false);
  });

  it("attrTotal / pointsRemaining track the budget", () => {
    expect(attrTotal(at({ might: 2, reflex: 1 }))).toBe(3);
    expect(pointsRemaining(at({ might: 2 }))).toBe(1); // one point still to place
    expect(pointsRemaining(at({ might: 3 }))).toBe(0);
  });
});
