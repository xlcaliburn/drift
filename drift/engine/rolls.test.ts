import { describe, it, expect } from "vitest";
import { computeModifier, modifierParts, formatModifierParts, rollCheck } from "./rolls";
import { scriptedRng } from "./rng";
import { vess, denna, josen } from "@/engine/__fixtures__/vessCampaign";
import type { Character } from "@/shared/schemas";

// Real skills are ALWAYS live-derived — attribute mod + skillProficiency(level)
// (the compressed +0…+5 curve, NOT raw level) + passive — so a QRC snapshot can
// never freeze a leveled skill at a stale value. Values below are the LIVE
// derivations for Vess (reflex 4 / presence -1 / perception -2, intellect 0):
//   piloting  = reflex(4)   + prof(level 4 → +2) = 6   (was frozen at raw-level 8)
//   negotiation = presence(-1) + prof(level 2 → +1) = 0 (was frozen at 1)
//   navigation  = intellect(0) + prof(level 1 → +1) = 1 (was frozen at 3 w/ baked gear)
// NON-skill action keys (initiative/deathSave/shipSensors) have no skills.json
// entry and never level up, so they still honor the stored actionModifiers value.
describe("computeModifier — live-derived skills, stored overrides for special actions", () => {
  const cases: [string, number][] = [
    ["piloting", 6],
    ["gunnery", 5],
    ["smallArms", 5],
    ["melee", 0],
    ["stealth", 4],
    ["perception", -2],
    ["streetwise", 1],
    ["negotiation", 0],
    ["deception", -1],
    ["intimidation", -1],
    ["mechanics", 1],
    ["electronics", 1],
    ["navigation", 1],
    ["initiative", 4], // non-skill: stored override preserved
    ["deathSave", 0], // non-skill: stored override preserved
    ["shipSensors", 1], // non-skill: stored override preserved
  ];
  for (const [skill, expected] of cases) {
    it(`Vess ${skill} = ${expected >= 0 ? "+" : ""}${expected}`, () => {
      expect(computeModifier(vess, skill)).toBe(expected);
    });
  }
});

describe("computeModifier — stale actionModifiers must not freeze a leveled skill (regression)", () => {
  // The reported bug: negotiation was captured as +0 in a QRC snapshot at
  // creation (level 0, presence 0). The character has since reached level 2 and
  // has positive presence — the live modifier must reflect that, not the stale 0.
  const leveled: Character = {
    ...denna,
    attributes: { ...denna.attributes, presence: 3 },
    skills: [{ name: "negotiation", level: 2, ticks: 0 }],
    actionModifiers: { negotiation: 0 }, // stale snapshot, frozen at level 0
  };

  it("ignores the stale override and live-derives: presence(3) + prof(level 2 → +1) = 4", () => {
    expect(computeModifier(leveled, "negotiation")).toBe(4);
  });

  it("unique-skill passive still stacks on the live-derived skill modifier", () => {
    const withPassive: Character = {
      ...leveled,
      uniqueSkill: {
        name: "Silver Tongue",
        description: "always persuasive",
        kind: "passive",
        passiveTargetType: "skill",
        passiveTarget: "negotiation",
        passiveAmount: 2,
        usesPerScene: 1,
      },
    };
    // presence(3) + prof(2 → +1) + passive(2) = 6 — still NOT the stale 0
    expect(computeModifier(withPassive, "negotiation")).toBe(6);
  });

  it("non-skill action keys (deathSave) still honor their stored modifier", () => {
    // deathSave has no skills.json entry and can't go stale on level-up, so the
    // vitality-routed override for fragile crew is preserved.
    expect(computeModifier(josen, "deathSave")).toBe(-4);
  });
});

describe("computeModifier — derivation fallback (no QRC override)", () => {
  it("Denna piloting = reflex(0) + prof(level 2)=+1 = 1", () => {
    expect(computeModifier(denna, "piloting")).toBe(1);
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

describe("modifierParts — the itemized sources behind a +N (or +0)", () => {
  it("explains a flat +0: presence -1 and skill +1 cancel out", () => {
    // negotiation = presence(-1) + prof(level 2 → +1) = 0 — the reported +0 mystery.
    const parts = modifierParts(vess, "negotiation");
    expect(parts).toEqual([
      { label: "presence", value: -1 },
      { label: "skill", value: 1 },
    ]);
    expect(formatModifierParts(parts)).toBe("presence -1, skill +1");
    expect(parts.reduce((n, p) => n + p.value, 0)).toBe(computeModifier(vess, "negotiation"));
  });

  it("always shows attribute + skill, and folds in a situational modifier", () => {
    const parts = modifierParts(vess, "piloting", 2);
    expect(parts).toEqual([
      { label: "reflex", value: 4 },
      { label: "skill", value: 2 },
      { label: "situational", value: 2 },
    ]);
  });

  it("a non-skill action key shows its baked bonus as its own line", () => {
    expect(modifierParts(vess, "initiative")).toEqual([{ label: "initiative", value: 4 }]);
  });
});

describe("rollCheck", () => {
  it("produces a full breakdown and success outcome", () => {
    const rng = scriptedRng([14]);
    const r = rollCheck({ character: vess, skill: "piloting", dc: 15, stakes: true }, rng);
    expect(r.d20).toBe(14);
    // piloting = reflex(4) + prof(level 4 → +2) = 6; 14 + 6 = 20
    expect(r.total).toBe(20);
    expect(r.outcome).toBe("success");
    expect(r.breakdown).toBe("piloting: d20(14) +6 (reflex +4, skill +2) = 20 vs DC 15 → success");
  });

  it("natural 20 auto-succeeds even vs an impossible DC (critical)", () => {
    const r = rollCheck({ character: vess, skill: "perception", dc: 30 }, scriptedRng([20]));
    expect(r.critical).toBe(true);
    expect(r.criticalFailure).toBe(false);
    expect(r.outcome).toBe("success");
    expect(r.breakdown).toContain("[CRIT]");
  });

  it("natural 1 auto-fails even with a big modifier (fumble)", () => {
    const r = rollCheck({ character: vess, skill: "piloting", dc: 5 }, scriptedRng([1]));
    expect(r.criticalFailure).toBe(true);
    expect(r.critical).toBe(false);
    expect(r.outcome).toBe("failure"); // 1 + 6 = 7 ≥ 5, but a nat 1 always fails
    expect(r.breakdown).toContain("[FUMBLE]");
  });

  it("applies ship DC modifier (racing thrusters -2 to DC)", () => {
    const rng = scriptedRng([7]);
    // effective DC 15 - 2 = 13; piloting mod 6, total 7+6=13 -> success
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
