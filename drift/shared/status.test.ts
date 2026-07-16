import { describe, it, expect } from "vitest";
import type { RNG } from "@/engine/rng";
import {
  applyStatus,
  tickStatuses,
  acPenalty,
  clearOnHeal,
  hasStatus,
  summarizeStatuses,
  type StatusEffect,
} from "./status";

const maxRng: RNG = { int: (_min, max) => max };
const minRng: RNG = { int: (min) => min };

describe("applyStatus — apply / refresh / stack", () => {
  it("adds a fresh status with the kind's base duration", () => {
    const s = applyStatus([], "burning");
    expect(s).toEqual([{ kind: "burning", rounds: 2, stacks: 1 }]);
  });

  it("a non-stacking status just refreshes duration on re-apply", () => {
    let s: StatusEffect[] = [{ kind: "burning", rounds: 1, stacks: 1 }];
    s = applyStatus(s, "burning");
    expect(s).toEqual([{ kind: "burning", rounds: 2, stacks: 1 }]); // refreshed, not stacked
  });

  it("bleeding stacks up to 5; corroded up to 2", () => {
    let bleed: StatusEffect[] = [];
    for (let i = 0; i < 7; i++) bleed = applyStatus(bleed, "bleeding");
    expect(bleed[0].stacks).toBe(5);
    let cor: StatusEffect[] = [];
    for (let i = 0; i < 4; i++) cor = applyStatus(cor, "corroded");
    expect(cor[0].stacks).toBe(2);
  });
});

describe("tickStatuses — turn-start resolution", () => {
  it("burning deals 1d4 and counts down (expires after 2 ticks)", () => {
    const start = applyStatus([], "burning");
    const t1 = tickStatuses(start, "Thug", maxRng);
    expect(t1.damage).toBe(4); // max d4
    expect(t1.statuses[0].rounds).toBe(1);
    const t2 = tickStatuses(t1.statuses, "Thug", minRng);
    expect(t2.damage).toBe(1); // min d4
    expect(t2.statuses).toHaveLength(0); // wears off
    expect(t2.lines.some((l) => /wears off/.test(l))).toBe(true);
  });

  it("bleeding scales with stacks (2 × stacks), no roll", () => {
    let bleed: StatusEffect[] = [];
    bleed = applyStatus(bleed, "bleeding");
    bleed = applyStatus(bleed, "bleeding");
    bleed = applyStatus(bleed, "bleeding"); // 3 stacks
    const t = tickStatuses(bleed, "Vess", minRng);
    expect(t.damage).toBe(6); // 2 × 3
  });

  it("shocked deals no damage but skips the turn, then clears", () => {
    const t = tickStatuses(applyStatus([], "shocked"), "Boss", maxRng);
    expect(t.damage).toBe(0);
    expect(t.skipTurn).toBe(true);
    expect(t.statuses).toHaveLength(0); // one-and-done
  });

  it("corroded deals no damage and rides its full duration", () => {
    const t = tickStatuses(applyStatus([], "corroded"), "Merc", maxRng);
    expect(t.damage).toBe(0);
    expect(t.skipTurn).toBe(false);
    expect(t.statuses[0].rounds).toBe(2);
  });
});

describe("modifiers + clears", () => {
  it("corroded lowers AC by 2 per stack", () => {
    expect(acPenalty([{ kind: "corroded", rounds: 3, stacks: 1 }])).toBe(2);
    expect(acPenalty([{ kind: "corroded", rounds: 3, stacks: 2 }])).toBe(4);
    expect(acPenalty([{ kind: "burning", rounds: 2, stacks: 1 }])).toBe(0);
  });

  it("a heal clears burning + bleeding but leaves control effects", () => {
    const list: StatusEffect[] = [
      { kind: "burning", rounds: 2, stacks: 1 },
      { kind: "bleeding", rounds: 3, stacks: 2 },
      { kind: "corroded", rounds: 3, stacks: 1 },
    ];
    const { statuses, cleared } = clearOnHeal(list);
    expect(cleared.sort()).toEqual(["bleeding", "burning"]);
    expect(statuses).toEqual([{ kind: "corroded", rounds: 3, stacks: 1 }]);
  });

  it("hasStatus + summarizeStatuses", () => {
    const list: StatusEffect[] = [{ kind: "burning", rounds: 2, stacks: 1 }, { kind: "bleeding", rounds: 3, stacks: 3 }];
    expect(hasStatus(list, "burning")).toBe(true);
    expect(hasStatus(list, "shocked")).toBe(false);
    expect(summarizeStatuses(list)).toBe("🔥🩸×3");
    expect(summarizeStatuses([])).toBe("");
  });
});
