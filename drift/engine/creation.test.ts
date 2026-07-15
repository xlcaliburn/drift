import { describe, it, expect } from "vitest";
import { buildCharacterFromCreation, ensureStartingGun } from "./creation";
import type { Character } from "@/shared/schemas";
import { computeModifier, rollCheck, passiveBonus } from "./rolls";
import { resolveShipAttack } from "./combat";
import { scriptedRng } from "./rng";
import { focuses, biasAttribute, biasSkills, type Bias } from "@/content/creation";
import type { CreationInput } from "@/shared/multiplayer";

const base: CreationInput = {
  name: "Test Pilot",
  parentFactionId: "f-crown",
  bias: "piloting",
  alignment: "pragmatic",
  sex: "male",
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
    expect(c.maxHp).toBe(18); // 18 + vitality(0)
    expect(c.ac).toBe(14); // 10 + reflex(3) + faction kit armor (+1)
    expect(c.credits).toBe(120); // thin, equal-footing "minion" pocket
    expect(c.kind).toBe("pc");
  });

  it("EVERY starting character ships with a gun + light armor (faction kit, standardized stats)", () => {
    // Crown flavor names, but the STATS are the standard sidearm (1d8) + padded (+1).
    const gun = c.gear.find((g) => g.itemId === "sidearm");
    const armor = c.gear.find((g) => g.itemId === "paddedJacket");
    expect(gun?.damage).toBe("1d8");
    expect(armor?.acBonus).toBe(1);
    // A different faction gets the SAME stats, a different outfit name.
    const sable = buildCharacterFromCreation({ ...base, parentFactionId: "f-sable" }, { id: "p2", campaignId: "c2" });
    expect(sable.gear.find((g) => g.itemId === "sidearm")?.damage).toBe("1d8");
    expect(sable.gear.find((g) => g.itemId === "sidearm")?.name).not.toBe(gun?.name); // flavor differs
    expect(sable.ac).toBe(c.ac); // same stat-wise
  });

  it("carries creation metadata for dossier/story", () => {
    expect(c.parentFactionId).toBe("f-crown");
    expect(c.loyaltyToParent).toBe(4);
    expect(c.uniqueSkill?.name).toBe("Deadhand");
  });
});

describe("ensureStartingGun — no PC is ever stuck gunless (the Cali backfill)", () => {
  const pc = (over: Partial<Character>): Character =>
    ({ id: "p", kind: "pc", name: "X", parentFactionId: "f-meridian", gear: [], ...over } as Character);

  it("adds a faction sidearm to a gunless legacy PC", () => {
    const fixed = ensureStartingGun(pc({ gear: [{ name: "Encrypted datapad" }, { name: "Fine jacket", acBonus: 1 }] }));
    const gun = fixed.gear.find((g) => g.itemId === "sidearm");
    expect(gun?.damage).toBe("1d8");
    expect(gun?.name).toBe("Bonded sidearm"); // f-meridian flavor
  });

  it("leaves an already-armed PC untouched (a knife-only build still counts as needing a gun)", () => {
    const armed = ensureStartingGun(pc({ gear: [{ name: "Sidearm", itemId: "sidearm", damage: "1d8" }] }));
    expect(armed.gear.filter((g) => g.itemId === "sidearm")).toHaveLength(1); // not doubled
    // A MELEE-only loadout has no gun, so one is added.
    const meleeOnly = ensureStartingGun(pc({ gear: [{ name: "Combat knife", damage: "1d6" }] }));
    expect(meleeOnly.gear.some((g) => g.itemId === "sidearm")).toBe(true);
  });

  it("does not touch non-PCs", () => {
    const crew = ensureStartingGun(pc({ kind: "party", gear: [] }));
    expect(crew.gear).toHaveLength(0);
  });
});

describe("focus (bias) — new focuses & derived records", () => {
  // Use a background whose secondary/weakness don't touch the tested primary so
  // the +3 stays clean: dock-rat leans reflex(+3 already baked out by focus)…
  // pick corporate-insider (intellect +3 bg? no) — simplest: assert the focus
  // primary gets at least +3 (background may nudge secondary/weakness elsewhere).
  const buildWith = (bias: Bias) =>
    buildCharacterFromCreation(
      { ...base, bias, background: "long-hauler" }, // long-hauler: vitality+1, perception+1?  weakness presence
      { id: "p", campaignId: "c" },
    );

  it("engineering → intellect primary + mechanics/electronics/zeroG", () => {
    const c = buildWith("engineering");
    // long-hauler bg: secondary perception +1, weakness presence -1 — neither is intellect
    expect(c.attributes.intellect).toBe(3);
    const skill = (n: string) => c.skills.find((s) => s.name === n)?.level ?? 0;
    expect(skill("mechanics")).toBe(2);
    expect(skill("electronics")).toBe(1);
    expect(skill("zeroG")).toBe(1);
  });

  it("survival → perception primary + survival/perception/athletics", () => {
    const c = buildWith("survival");
    // long-hauler secondary is perception (+1), so primary+secondary stack to +4
    expect(c.attributes.perception).toBe(4);
    const skill = (n: string) => c.skills.find((s) => s.name === n)?.level ?? 0;
    expect(skill("survival")).toBe(2);
    expect(skill("perception")).toBe(1);
    expect(skill("athletics")).toBe(1);
  });

  it("brawn → might primary + melee/athletics/intimidation", () => {
    const c = buildWith("brawn");
    expect(c.attributes.might).toBe(3);
    const skill = (n: string) => c.skills.find((s) => s.name === n)?.level ?? 0;
    expect(skill("melee")).toBe(2);
    expect(skill("athletics")).toBe(1);
    expect(skill("intimidation")).toBe(1);
  });

  it("has 8 focuses with unique ids", () => {
    expect(focuses).toHaveLength(8);
    expect(new Set(focuses.map((f) => f.id)).size).toBe(8);
  });

  it("biasAttribute/biasSkills are derived from focuses (never drift)", () => {
    for (const f of focuses) {
      expect(biasAttribute[f.id]).toBe(f.primary);
      expect(biasSkills[f.id]).toEqual(f.skills);
      // each focus grants exactly 4 skill levels
      expect(f.skills.reduce((s, k) => s + k.level, 0)).toBe(4);
    }
    // records cover exactly the focus ids, no more
    expect(Object.keys(biasAttribute).sort()).toEqual(focuses.map((f) => f.id).sort());
    expect(Object.keys(biasSkills).sort()).toEqual(focuses.map((f) => f.id).sort());
  });
});

describe("unique skill — passive buff", () => {
  const c = buildCharacterFromCreation(base, { id: "p1", campaignId: "camp1" });

  it("adds the passive bonus to the targeted skill", () => {
    // piloting: reflex(3) + prof(level 2)=+1 + passive 2 = 6
    expect(passiveBonus(c, "piloting")).toBe(2);
    expect(computeModifier(c, "piloting")).toBe(6);
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
