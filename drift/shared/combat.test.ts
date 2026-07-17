import { describe, it, expect } from "vitest";
import { interpretCombatText, type CombatState, type CombatEnemy } from "./combat";

const enemy = (over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  id: "e-1", name: "Draven", tier: "T2", hp: 8, maxHp: 8, ac: 12, atk: 5, damage: "1d6",
  shieldReady: false, multiAttack: false, ...over,
});
const combat = (enemies: CombatEnemy[]): CombatState => ({
  active: true, round: 2, scale: "personal", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0,
});

describe("interpretCombatText — free text can't bypass combat", () => {
  const c = combat([enemy({ id: "a", name: "Draven" }), enemy({ id: "b", name: "Cutter" })]);

  it("defaults ANY aggressive/ambiguous free text to an attack (never a no-op)", () => {
    expect(interpretCombatText("I gun them all down", c, [])).toEqual({ type: "attack", enemyId: "a" });
    expect(interpretCombatText("kick the table into them and shoot", c, [])).toEqual({ type: "attack", enemyId: "a" });
  });

  it("targets the NAMED enemy when one is mentioned", () => {
    expect(interpretCombatText("put a round through Cutter", c, [])).toEqual({ type: "attack", enemyId: "b" });
  });

  it("maps flee / cover / aim keywords", () => {
    expect(interpretCombatText("I break off and run", c, [])).toEqual({ type: "flee" });
    expect(interpretCombatText("dive behind the crates", c, [])).toEqual({ type: "cover" });
    expect(interpretCombatText("steady my aim on him", c, [])).toEqual({ type: "aim" });
  });

  it("maps heal intent to a held consumable (else falls through to attack)", () => {
    const stim = [{ itemId: "stim", name: "Stim", count: 1, verb: "Use" }];
    expect(interpretCombatText("jam a stim into my leg", c, stim)).toEqual({ type: "item", itemId: "stim" });
    expect(interpretCombatText("patch myself up", c, stim)).toEqual({ type: "item", itemId: "stim" });
    // No consumable held → the heal keyword can't fire, so it's still an attack.
    expect(interpretCombatText("patch myself up", c, [])).toEqual({ type: "attack", enemyId: "a" });
  });

  it("bare use/heal/patch is NOT an item spend — needs an item cue (unintended-stim misfire)", () => {
    const stim = [{ itemId: "stim", name: "Stim", count: 1, verb: "Use" }];
    // "use <weapon>" is a switch, not a stim — the item branch used to shadow this.
    expect(interpretCombatText("use the plasma carbine", c, stim, ["Plasma carbine"])).toEqual({
      type: "switch",
      weaponName: "Plasma carbine",
    });
    // "patch me through" is comms, not self-treatment → default attack.
    expect(interpretCombatText("patch me through to the ship", c, stim)).toEqual({ type: "attack", enemyId: "a" });
    // A decline never spends — same negation guard as the out-of-combat backstop.
    expect(interpretCombatText("save my stim and charge him", c, stim)).toEqual({ type: "attack", enemyId: "a" });
  });

  it("skips a dead enemy and attacks a living one", () => {
    const c2 = combat([enemy({ id: "a", name: "Draven", hp: 0 }), enemy({ id: "b", name: "Cutter" })]);
    expect(interpretCombatText("open fire", c2, [])).toEqual({ type: "attack", enemyId: "b" });
  });
});
