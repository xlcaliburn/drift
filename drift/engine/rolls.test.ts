import { describe, it, expect } from "vitest";
import { computeModifier, rollCheck } from "./rolls";
import { scriptedRng } from "./rng";
import { vess, denna, josen } from "@/scripts/seedData";

describe("computeModifier — reproduces the Quick Reference Card", () => {
  const cases: [string, number][] = [
    ["piloting", 8],
    ["gunnery", 5],
    ["smallArms", 5],
    ["melee", 0],
    ["stealth", 4],
    ["perception", -2],
    ["streetwise", 1],
    ["negotiation", 1],
    ["deception", -1],
    ["intimidation", -1],
    ["mechanics", 1],
    ["electronics", 1],
    ["navigation", 3],
    ["initiative", 4],
    ["deathSave", 0],
    ["shipSensors", 1],
  ];
  for (const [skill, expected] of cases) {
    it(`Vess ${skill} = ${expected >= 0 ? "+" : ""}${expected}`, () => {
      expect(computeModifier(vess, skill)).toBe(expected);
    });
  }
});

describe("computeModifier — derivation fallback (no QRC override)", () => {
  it("Denna piloting = reflex(0) + level 2 = 2", () => {
    expect(computeModifier(denna, "piloting")).toBe(2);
  });
  it("Denna navigation = intellect(2) + level 1 = 3", () => {
    expect(computeModifier(denna, "navigation")).toBe(3);
  });
  it("situational modifier adds on top (sensor assist +3)", () => {
    expect(computeModifier(vess, "shipSensors", 3)).toBe(4);
  });
});

describe("Josen fragile death save", () => {
  it("death save modifier is -4", () => {
    expect(computeModifier(josen, "deathSave")).toBe(-4);
  });
});

describe("rollCheck", () => {
  it("produces a full breakdown and success outcome", () => {
    const rng = scriptedRng([14]);
    const r = rollCheck({ character: vess, skill: "piloting", dc: 15, stakes: true }, rng);
    expect(r.d20).toBe(14);
    expect(r.total).toBe(22);
    expect(r.outcome).toBe("success");
    expect(r.breakdown).toBe("piloting: d20(14) +8 = 22 vs DC 15 → success");
  });

  it("applies ship DC modifier (racing thrusters -2 to DC)", () => {
    const rng = scriptedRng([5]);
    // effective DC 15 - 2 = 13; total 5+8=13 -> success
    const r = rollCheck({ character: vess, skill: "piloting", dc: 15, dcModifier: -2 }, rng);
    expect(r.dc).toBe(13);
    expect(r.outcome).toBe("success");
  });

  it("tick eligible only for stakes DC13+", () => {
    const rng = scriptedRng([10, 10]);
    const eligible = rollCheck({ character: vess, skill: "gunnery", dc: 15, stakes: true }, rng);
    expect(eligible.tickEligible).toBe(true);
    const low = rollCheck({ character: vess, skill: "gunnery", dc: 12, stakes: true }, rng);
    expect(low.tickEligible).toBe(false);
  });
});
