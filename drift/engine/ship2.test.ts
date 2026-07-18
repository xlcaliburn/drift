import { describe, it, expect } from "vitest";
import { rollMount, applyGunnerBoost, applyPointDefense, resolveVolley, resolvePolicyAllocation, ship2SalvageLine, type Ship2MountProfile } from "./ship2";
import type { RNG } from "./rng";
import type { Ship2Profile } from "@/shared/ship2";

/** Pops values off a queue in call order — lets a test dictate the EXACT dice
 *  sequence a multi-die mount rolls (unlike engine/combatEngine.test.ts's
 *  fixed-d20 helper, ship2 rolls many d6s per mount per round). */
const seqRng = (values: number[]): RNG => {
  let i = 0;
  return { int: () => values[i++] ?? 1 };
};

const railgun: Ship2MountProfile = { id: "railgun", name: "Railgun", dice: 1, hitOn: 4, dmgPerHit: 3, power: 2 };
const autocannon: Ship2MountProfile = { id: "autocannon", name: "Autocannon battery", dice: 6, hitOn: 6, dmgPerHit: 1, power: 2 };
const beamLance: Ship2MountProfile = { id: "beamLance", name: "Beam lance", dice: 2, hitOn: 5, dmgPerHit: 2, power: 2, overchargeHitOn: 4 };
const missileRack: Ship2MountProfile = { id: "missileRack", name: "Missile rack", dice: 4, hitOn: 4, dmgPerHit: 1, power: 2, ammoLimited: true, pdHitOn: 5 };

describe("rollMount", () => {
  it("a natural 6 always hits, even past a raised threshold", () => {
    // hitOn 6 + evasion 3 = threshold 9 (unreachable by a normal compare); only
    // a literal 6 lands.
    const r = rollMount(autocannon, { evasionBonus: 3 }, seqRng([6, 5, 1, 6, 3, 2]));
    expect(r.hits).toBe(2); // the two literal 6s
    expect(r.dice).toEqual([6, 5, 1, 6, 3, 2]);
  });

  it("evasion raises the threshold by the given bonus", () => {
    const r = rollMount(railgun, { evasionBonus: 1 }, seqRng([4])); // hitOn 4+1=5, a 4 misses
    expect(r.hits).toBe(0);
    const r2 = rollMount(railgun, { evasionBonus: 1 }, seqRng([5]));
    expect(r2.hits).toBe(1);
  });

  it("overcharge lowers the hit-on for mounts that support it", () => {
    const normal = rollMount(beamLance, { evasionBonus: 0 }, seqRng([4, 4]));
    expect(normal.hits).toBe(0); // hitOn 5, a 4 misses
    const overcharged = rollMount(beamLance, { evasionBonus: 0, overcharged: true }, seqRng([4, 4]));
    expect(overcharged.hits).toBe(2); // overchargeHitOn 4, both hit
    expect(overcharged.overcharged).toBe(true);
  });

  it("overcharge is a no-op for a mount that doesn't support it", () => {
    const r = rollMount(railgun, { evasionBonus: 0, overcharged: true }, seqRng([4]));
    expect(r.overcharged).toBe(false);
    expect(r.hitOn).toBe(4); // unchanged — railgun has no overchargeHitOn
  });

  it("damage is hits × dmgPerHit, pre armor/shield", () => {
    const r = rollMount(autocannon, { evasionBonus: 0 }, seqRng([6, 6, 1, 2, 3, 6]));
    expect(r.hits).toBe(3);
    expect(r.damage).toBe(3); // 3 hits × 1 dmg
  });
});

describe("applyGunnerBoost", () => {
  it("boosts the single highest near-miss across every fired mount into a hit", () => {
    const a = rollMount(railgun, { evasionBonus: 0 }, seqRng([3])); // miss, hitOn 4 — the best miss (3 > 2)
    const b = rollMount(beamLance, { evasionBonus: 0 }, seqRng([1, 2])); // both miss, hitOn 5
    const boosted = applyGunnerBoost([a, b]);
    expect(boosted[0].dice).toEqual([4]); // 3 → 4, now hits
    expect(boosted[0].hits).toBe(1);
    expect(boosted[0].damage).toBe(3);
    expect(boosted[1].dice).toEqual([1, 2]); // untouched — its best miss (2) lost to a's 3
    expect(boosted[1].hits).toBe(0);
  });

  it("a boosted die that still doesn't clear the threshold stays a miss", () => {
    // beamLance hitOn 5: a 3 bumped to 4 still misses.
    const b = rollMount(beamLance, { evasionBonus: 0 }, seqRng([1, 3]));
    const boosted = applyGunnerBoost([b]);
    expect(boosted[0].dice).toEqual([1, 4]);
    expect(boosted[0].hits).toBe(0);
    expect(boosted[0].damage).toBe(0);
  });

  it("a boost that crosses the threshold adds one hit and its damage", () => {
    // railgun hitOn 4: a 3 bumped to 4 now hits.
    const r = rollMount(railgun, { evasionBonus: 0 }, seqRng([3]));
    const boosted = applyGunnerBoost([r]);
    expect(boosted[0].hits).toBe(1);
    expect(boosted[0].damage).toBe(3);
  });

  it("is a no-op when every fired die already hit", () => {
    const r = rollMount(railgun, { evasionBonus: 0 }, seqRng([6]));
    const boosted = applyGunnerBoost([r]);
    expect(boosted).toEqual([r]);
  });

  it("is a no-op with no fired mounts", () => {
    expect(applyGunnerBoost([])).toEqual([]);
  });
});

describe("applyPointDefense", () => {
  it("downs missile hits that roll at/above pdHitOn, reducing hits and damage", () => {
    const r = rollMount(missileRack, { evasionBonus: 0 }, seqRng([4, 4, 4, 4])); // all 4 hit (hitOn 4)
    expect(r.hits).toBe(4);
    const pd = applyPointDefense(r, missileRack, true, seqRng([5, 3, 6, 4])); // downs 2 of 4 (5,6 ≥ 5)
    expect(pd.pdDowned).toBe(2);
    expect(pd.hits).toBe(2);
    expect(pd.damage).toBe(2);
  });

  it("is a no-op for a non-ammo-limited mount", () => {
    const r = rollMount(railgun, { evasionBonus: 0 }, seqRng([6]));
    const pd = applyPointDefense(r, railgun, true, seqRng([6, 6, 6]));
    expect(pd).toEqual(r);
  });

  it("is a no-op when the defender has no point defense", () => {
    const r = rollMount(missileRack, { evasionBonus: 0 }, seqRng([4, 4, 4, 4]));
    const pd = applyPointDefense(r, missileRack, false, seqRng([6, 6, 6, 6]));
    expect(pd).toEqual(r);
  });
});

describe("resolveVolley", () => {
  it("armor shaves flat damage per hit (can zero out a 1-dmg spray mount)", () => {
    const spray = rollMount(autocannon, { evasionBonus: 0 }, seqRng([6, 6, 6, 1, 2, 3])); // 3 hits × 1 dmg
    const out = resolveVolley("You", [spray], { armor: 1, shieldPool: 0 });
    expect(out.grossDamage).toBe(0); // 1 - 1 armor = 0 per hit
    expect(out.netDamage).toBe(0);
  });

  it("armor doesn't reduce below 0 per hit (no negative damage)", () => {
    const gun = rollMount(railgun, { evasionBonus: 0 }, seqRng([4])); // 1 hit × 3 dmg
    const out = resolveVolley("You", [gun], { armor: 99, shieldPool: 0 });
    expect(out.grossDamage).toBe(0);
  });

  it("shields absorb up to the pool; the remainder is hull damage", () => {
    const gun = rollMount(railgun, { evasionBonus: 0 }, seqRng([4])); // 3 dmg
    const out = resolveVolley("You", [gun], { armor: 0, shieldPool: 2 });
    expect(out.grossDamage).toBe(3);
    expect(out.shieldAbsorbed).toBe(2);
    expect(out.netDamage).toBe(1);
  });

  it("a shield pool bigger than the damage absorbs all of it", () => {
    const gun = rollMount(railgun, { evasionBonus: 0 }, seqRng([4]));
    const out = resolveVolley("You", [gun], { armor: 0, shieldPool: 99 });
    expect(out.netDamage).toBe(0);
  });

  it("multiple fired mounts sum into one breakdown line", () => {
    const gun = rollMount(railgun, { evasionBonus: 0 }, seqRng([4]));
    const spray = rollMount(autocannon, { evasionBonus: 0 }, seqRng([6, 1, 1, 1, 1, 1]));
    const out = resolveVolley("Raiders", [gun, spray], { armor: 0, shieldPool: 0 });
    expect(out.netDamage).toBe(4); // 3 (railgun) + 1 (autocannon)
    expect(out.breakdown).toMatch(/^Raiders — /);
    expect(out.breakdown).toMatch(/Railgun 2P/);
    expect(out.breakdown).toMatch(/Autocannon battery 2P/);
    expect(out.breakdown).toMatch(/hull −4$/);
  });

  it("no fired mounts reads as holding fire, not a zero-damage volley line", () => {
    const out = resolveVolley("You", [], { armor: 0, shieldPool: 0 });
    expect(out.breakdown).toBe("You: holds fire.");
    expect(out.netDamage).toBe(0);
  });
});

describe("resolvePolicyAllocation", () => {
  const gunshipProfile: Ship2Profile = {
    shipClass: "gunship", reactor: 5, engineCap: 1, shieldCap: 2, armor: 0, hasPointDefense: false, gunnerBoost: false,
    mounts: [
      { id: "railgun", name: "Railgun", power: 2, dice: 1, hitOn: 4, dmgPerHit: 3 },
      { id: "beamLance", name: "Beam lance", power: 2, dice: 2, hitOn: 5, dmgPerHit: 2, overchargeHitOn: 4 },
    ],
  };

  it("resolves tokens in order until the reactor runs out", () => {
    // gunship policy: ["guns","guns","shields"] — 2+2+1 = 5, exactly the reactor.
    const out = resolvePolicyAllocation(gunshipProfile, ["guns", "guns", "shields"]);
    expect(out.mounts).toEqual(["railgun", "beamLance"]);
    expect(out.shields).toBe(1);
    expect(out.engines).toBe(0);
  });

  it("a guns token with no more unfunded mounts is a no-op, not a crash", () => {
    const out = resolvePolicyAllocation(gunshipProfile, ["guns", "guns", "guns", "shields"]);
    expect(out.mounts).toEqual(["railgun", "beamLance"]); // only 2 mounts exist
    expect(out.shields).toBe(1); // the leftover 1 power still goes to shields
  });

  it("shields/engines tokens stop at their cap even with reactor left over", () => {
    const out = resolvePolicyAllocation(gunshipProfile, ["shields", "shields", "shields"]);
    expect(out.shields).toBe(2); // shieldCap
    expect(out.mounts).toEqual([]);
  });

  it("a dry ammo-limited mount is skipped by a guns token", () => {
    const withDryRack: Ship2Profile = {
      ...gunshipProfile,
      mounts: [{ id: "missileRack", name: "Missile rack", power: 2, dice: 4, hitOn: 4, dmgPerHit: 1, ammoLimited: true, pdHitOn: 5, ammo: 0 }],
    };
    const out = resolvePolicyAllocation(withDryRack, ["guns", "shields"]);
    expect(out.mounts).toEqual([]);
    expect(out.shields).toBe(1);
  });

  it("an empty policy or zero reactor allocates nothing", () => {
    expect(resolvePolicyAllocation(gunshipProfile, [])).toEqual({ mounts: [], shields: 0, engines: 0 });
    expect(resolvePolicyAllocation({ ...gunshipProfile, reactor: 0 }, ["guns", "shields"])).toEqual({ mounts: [], shields: 0, engines: 0 });
  });
});

describe("ship2SalvageLine", () => {
  it("formats through the lexicon facade", () => {
    expect(ship2SalvageLine(120)).toBe("💰 Enemy driven off / destroyed — salvage worth ¢120.");
  });
});
