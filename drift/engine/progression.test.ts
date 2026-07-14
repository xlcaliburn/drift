import { describe, it, expect } from "vitest";
import { awardTick, nextLevelCost, tickMax, skillProficiency, MAX_SKILL_LEVEL } from "./progression";
import type { Character } from "@/shared/schemas";
import { vess } from "@/engine/__fixtures__/vessCampaign";

describe("tick / level-up math", () => {
  it("next-level cost = (level+1) * 6", () => {
    expect(nextLevelCost(1)).toBe(12);
    expect(nextLevelCost(4)).toBe(30);
    expect(tickMax(2)).toBe(18);
  });

  it("Gunnery lvl 2: 5→6/18 (a single failure XP, no level up)", () => {
    const res = awardTick(vess, "gunnery", new Set(), 1);
    expect(res.ticked).toBe(true);
    expect(res.leveledUp).toBe(false);
    expect(res.event.breakdown).toBe("Gunnery (lvl 2): 5→6/18");
    const sk = res.character.skills.find((s) => s.name === "gunnery")!;
    expect(sk.ticks).toBe(6);
    expect(sk.level).toBe(2);
  });

  it("awards `amount` XP — 1 on a fail, 2 on a success", () => {
    const fresh = { ...vess, skills: [{ name: "stealth", level: 0, ticks: 0 }] } as Character;
    expect(awardTick(fresh, "stealth", new Set(), 1).character.skills[0].ticks).toBe(1);
    expect(awardTick(fresh, "stealth", new Set(), 2).character.skills[0].ticks).toBe(2);
  });

  it("a success (2 XP) crosses a level boundary, carrying the overflow", () => {
    const near = { ...vess, skills: [{ name: "mechanics", level: 0, ticks: 5 }] } as Character;
    const res = awardTick(near, "mechanics", new Set(), 2); // 5 + 2 = 7 ≥ cost(0)=6 → level up, carry 1
    expect(res.leveledUp).toBe(true);
    expect(res.event.breakdown).toBe("Mechanics LEVEL UP → lvl 1 (1/12)");
    const sk = res.character.skills.find((s) => s.name === "mechanics")!;
    expect(sk.level).toBe(1);
    expect(sk.ticks).toBe(1);
  });

  it("caps at 1 tick per skill per scene", () => {
    const ticked = new Set<string>();
    const first = awardTick(vess, "gunnery", ticked);
    expect(first.ticked).toBe(true);
    const second = awardTick(first.character, "gunnery", ticked);
    expect(second.ticked).toBe(false);
    expect(second.event.breakdown).toContain("already ticked");
  });

  it("does not mutate the input character", () => {
    const before = vess.skills.find((s) => s.name === "gunnery")!.ticks;
    awardTick(vess, "gunnery", new Set());
    expect(vess.skills.find((s) => s.name === "gunnery")!.ticks).toBe(before);
  });
});

describe("compressed proficiency (bounded accuracy)", () => {
  it("maps level 0–10 to a bounded +0…+5 (ceil(level/2))", () => {
    const bonuses = Array.from({ length: 11 }, (_, l) => skillProficiency(l));
    expect(bonuses).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("never exceeds +5, even above the cap", () => {
    expect(skillProficiency(20)).toBe(5);
    expect(skillProficiency(-3)).toBe(0);
  });
});

describe("level cap", () => {
  const maxed = (): Character =>
    ({
      ...vess,
      skills: [{ name: "gunnery", level: MAX_SKILL_LEVEL, ticks: tickMax(MAX_SKILL_LEVEL) - 1 }],
    }) as Character;

  it("does not level past the cap; the bar sits full", () => {
    const res = awardTick(maxed(), "gunnery", new Set());
    const sk = res.character.skills.find((s) => s.name === "gunnery")!;
    expect(sk.level).toBe(MAX_SKILL_LEVEL);
    expect(res.leveledUp).toBe(false);
    expect(sk.ticks).toBe(tickMax(MAX_SKILL_LEVEL)); // clamped, not overflowing
    expect(res.event.breakdown).toContain("maxed");
  });
});
