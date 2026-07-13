import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { CombatState, CombatEnemy } from "@/shared/combat";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

/** All d20s and dice roll their max. */
const maxRng: RNG = { int: (_min, max) => max };
/** All rolls return their min (d20=1 → miss). */
const minRng: RNG = { int: (min) => min };

function fighter(hp = 20, stims = 0): CampaignState {
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp, maxHp: 20, ac: 14, stims, fragile: false, credits: 100,
        attributes: { might: 1, reflex: 2, vitality: 1, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "smallArms", level: 2, ticks: 0 }],
        actionModifiers: {}, gear: [{ name: "Rifle", damage: "2d6" }], injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const combatWith = (enemies: CombatEnemy[]): CombatState => ({
  active: true, round: 1, scale: "personal", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0,
});

const enemy = (over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  id: "e-1", name: "Gunhand", tier: "T2", hp: 30, maxHp: 30, ac: 14, atk: 5, damage: "2d8",
  shieldReady: false, multiAttack: false, ...over,
});

const pcHp = (rt: TurnRuntime) => rt.state.characters[0].hp;

describe("resolveCombatRound", () => {
  it("killing the last enemy = victory + loot credited", () => {
    const rt = new TurnRuntime(fighter(), maxRng);
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 6 })]), { type: "attack", enemyId: "e-1" });
    expect(r.outcome).toBe("victory");
    expect(r.combat.active).toBe(false);
    expect(r.loot).toBeGreaterThan(0);
    expect(rt.state.characters[0].credits).toBe(100 + r.loot);
  });

  it("a surviving enemy hits back and damages the player", () => {
    const rt = new TurnRuntime(fighter(20), maxRng);
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 30 })]), { type: "attack", enemyId: "e-1" });
    expect(r.outcome).toBe("continue");
    expect(r.combat.round).toBe(2);
    expect(pcHp(rt)).toBe(4); // 20 - max(2d8)=16 (enemy crit)
  });

  it("a shield absorbs the player's first hit", () => {
    const rt = new TurnRuntime(fighter(), maxRng);
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 30, shieldReady: true })]), { type: "attack", enemyId: "e-1" });
    expect(r.combat.enemies[0].hp).toBe(30); // absorbed
    expect(r.combat.enemies[0].shieldReady).toBe(false);
  });

  it("flee can end the fight", () => {
    const rt = new TurnRuntime(fighter(), maxRng);
    const r = rt.resolveCombatRound(combatWith([enemy()]), { type: "flee" });
    expect(r.outcome).toBe("escaped");
    expect(r.combat.active).toBe(false);
  });

  it("stim heals and decrements, without a player attack", () => {
    const rt = new TurnRuntime(fighter(5, 1), minRng); // minRng → enemy volley misses
    const r = rt.resolveCombatRound(combatWith([enemy()]), { type: "stim" });
    expect(pcHp(rt)).toBe(8); // 5 + (1d6+2 min = 3)
    expect(rt.state.characters[0].stims).toBe(0);
    expect(r.outcome).toBe("continue");
  });

  it("lethal volley downs then can kill (halt after the drop)", () => {
    const rt = new TurnRuntime(fighter(10), maxRng);
    // Two T3 elites (multiAttack, 2d10) vs 10 HP: first hit drops, halt.
    const r = rt.resolveCombatRound(
      combatWith([enemy({ id: "e-1", tier: "T3", hp: 40, damage: "2d10", multiAttack: true }), enemy({ id: "e-2", tier: "T3", hp: 40 })]),
      { type: "cover" },
    );
    expect(["downed", "dead"]).toContain(r.outcome);
    expect(r.combat.active).toBe(false);
  });
});

describe("startCombat", () => {
  it("spawns enemies; an ambush hits the player before they act", () => {
    const rt = new TurnRuntime(fighter(20), maxRng);
    const { combat, outcome } = rt.startCombat([{ tier: "T2", count: 1 }], "personal", "enemy");
    expect(combat.enemies).toHaveLength(1);
    expect(pcHp(rt)).toBeLessThan(20); // took the ambush volley
    expect(["continue", "downed", "dead"]).toContain(outcome);
  });

  it("a no-surprise start leaves HP untouched until the player acts", () => {
    const rt = new TurnRuntime(fighter(20), maxRng);
    rt.startCombat([{ tier: "T2", count: 2 }], "personal", "none");
    expect(pcHp(rt)).toBe(20);
  });
});
