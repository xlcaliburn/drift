import { describe, it, expect } from "vitest";
import { buildCharacterFromCreation } from "./creation";
import { computeModifier, rollCheck, passiveBonus } from "./rolls";
import { resolveShipAttack } from "./combat";
import { scriptedRng } from "./rng";
import type { CreationInput } from "@/shared/multiplayer";

const base: CreationInput = {
  name: "Test Pilot",
  parentFactionId: "f-crown",
  bias: "piloting",
  alignment: "pragmatic",
  background: "dock-rat",
  ambition: "freedom",
  flavor: { moralCode: "no passengers left behind" },
  uniqueSkill: {
    name: "Deadhand",
    description: "steady in a crisis",
    kind: "passive",
    passiveTargetType: "skill",
    passiveTarget: "piloting",
    passiveAmount: 2,
    usesPerScene: 1,
  },
};

describe("buildCharacterFromCreation", () => {
  const c = buildCharacterFromCreation(base, { id: "p1", campaignId: "camp1" });

  it("applies background attribute lean (+3/+1/-1)", () => {
    // dock-rat: reflex +3, intellect +1, presence -1
    expect(c.attributes.reflex).toBe(3);
    expect(c.attributes.intellect).toBe(1);
    expect(c.attributes.presence).toBe(-1);
    expect(c.attributes.might).toBe(0);
  });

  it("grants bias skills + merges the signature skill", () => {
    // piloting bias: piloting 2, navigation 1, zeroG 1; dock-rat signature streetwise +1
    const skill = (n: string) => c.skills.find((s) => s.name === n)?.level ?? 0;
    expect(skill("piloting")).toBe(2);
    expect(skill("navigation")).toBe(1);
    expect(skill("streetwise")).toBe(1);
  });

  it("derives vitals and keeps parity credits", () => {
    expect(c.maxHp).toBe(6); // 6 + vitality(0)
    expect(c.ac).toBe(13); // 10 + reflex(3) + no armor
    expect(c.credits).toBe(300);
    expect(c.kind).toBe("pc");
  });

  it("carries creation metadata for dossier/story", () => {
    expect(c.parentFactionId).toBe("f-crown");
    expect(c.loyaltyToParent).toBe(4);
    expect(c.uniqueSkill?.name).toBe("Deadhand");
  });
});

describe("unique skill — passive buff", () => {
  const c = buildCharacterFromCreation(base, { id: "p1", campaignId: "camp1" });

  it("adds the passive bonus to the targeted skill", () => {
    // piloting: reflex(3) + level 2 + passive 2 = 7
    expect(passiveBonus(c, "piloting")).toBe(2);
    expect(computeModifier(c, "piloting")).toBe(7);
  });

  it("does not buff other skills", () => {
    expect(passiveBonus(c, "gunnery")).toBe(0);
  });

  it("attribute-targeted passive buffs every skill under that attribute", () => {
    const c2 = buildCharacterFromCreation(
      { ...base, uniqueSkill: { ...base.uniqueSkill, passiveTargetType: "attribute", passiveTarget: "reflex", passiveAmount: 1 } },
      { id: "p2", campaignId: "camp1" },
    );
    // both piloting and zeroG are reflex-governed
    expect(passiveBonus(c2, "piloting")).toBe(1);
    expect(passiveBonus(c2, "zeroG")).toBe(1);
    expect(passiveBonus(c2, "mechanics")).toBe(0); // intellect-governed
  });
});

describe("unique skill — trigger (nat 20)", () => {
  const c = buildCharacterFromCreation(base, { id: "p1", campaignId: "camp1" });

  it("forceNat20 resolves a check as a natural 20 auto-success", () => {
    const rng = scriptedRng([1]); // would roll a 1 without the trigger
    const r = rollCheck({ character: c, skill: "piloting", dc: 25, forceNat20: true }, rng);
    expect(r.d20).toBe(20);
    expect(r.critical).toBe(true);
    expect(r.outcome).toBe("success");
    expect(r.breakdown).toContain("[SIGNATURE]");
  });

  it("forceCrit makes a ship attack a guaranteed crit hit", () => {
    // forceCrit skips the to-hit roll, so rng feeds the crit reroll: 3,4 = 7
    const rng = scriptedRng([3, 4]);
    const r = resolveShipAttack(
      {
        attackerSide: "player",
        attackMod: 0,
        weaponType: "kinetic",
        damage: "2d8",
        target: { id: "t", name: "Foe", hp: 30, ac: 18 },
        forceCrit: true,
      },
      rng,
    );
    expect(r.crit).toBe(true);
    expect(r.hit).toBe(true);
    expect(r.damageDealt).toBe(16 + 7); // max 2d8 + reroll(3,4)
  });
});
