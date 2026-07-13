import { describe, it, expect } from "vitest";
import { awardTick, nextLevelCost, tickMax, skillProficiency, MAX_SKILL_LEVEL } from "./progression";
import type { Character } from "@/shared/schemas";
import { vess } from "@/engine/__fixtures__/vessCampaign";

describe("tick / level-up math", () => {
  it("next-level cost = (level+1) * 3", () => {
    expect(nextLevelCost(1)).toBe(6);
    expect(nextLevelCost(4)).toBe(15);
    expect(tickMax(2)).toBe(9);
  });

  it("Gunnery lvl 2: 5→6/9 (no level up)", () => {
    const res = awardTick(vess, "gunnery", new Set());
    expect(res.ticked).toBe(true);
    expect(res.leveledUp).toBe(false);
    expect(res.event.breakdown).toBe("Gunnery (lvl 2): 5→6/9");
    const sk = res.character.skills.find((s) => s.name === "gunnery")!;
    expect(sk.ticks).toBe(6);
    expect(sk.level).toBe(2);
  });

  it("Mechanics lvl 1: 5→ level up to 2", () => {
    const res = awardTick(vess, "mechanics", new Set());
    expect(res.leveledUp).toBe(true);
    expect(res.event.breakdown).toBe("Mechanics LEVEL UP → lvl 2 (0/9)");
    const sk = res.character.skills.find((s) => s.name === "mechanics")!;
    expect(sk.level).toBe(2);
    expect(sk.ticks).toBe(0);
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
