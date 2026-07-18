import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { CombatState, CombatEnemy } from "@/shared/combat";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

/**
 * The CombatSystem seam (Modularity M5, HANDOFF_COMBAT_V2_1 Task B). Zero
 * behavior change is the whole point — every other combat test file staying
 * green UNCHANGED is the real pin; these two cover what's NEW about the seam
 * itself: a legacy (system-less) fight still resolves, and the orders-array
 * call path is byte-identical to the single-action back-compat path.
 */

const maxRng: RNG = { int: (_min, max) => max };

function fighter(): CampaignState {
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 20, maxHp: 20, ac: 14, stims: 0, fragile: false, credits: 100,
        attributes: { might: 1, reflex: 2, vitality: 1, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "smallArms", level: 2, ticks: 0 }],
        actionModifiers: {}, gear: [{ name: "Rifle", damage: "2d6" }], injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const enemy = (over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  id: "e-1", name: "Gunhand", tier: "T2", hp: 30, maxHp: 30, ac: 14, atk: 5, damage: "2d8",
  shieldReady: false, multiAttack: false, ...over,
});

/** Deliberately NO `system` field — a fight persisted before this deploy. */
const legacyCombat = (enemies: CombatEnemy[]): CombatState =>
  ({ active: true, round: 1, scale: "personal", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0 }) as CombatState;

describe("CombatSystem seam — legacy state + orders-array back-compat", () => {
  it("a legacy CombatState with no `system` field still resolves (defensive fallback to classic)", () => {
    const rt = new TurnRuntime(fighter(), maxRng);
    const r = rt.resolveCombatRound(legacyCombat([enemy({ hp: 6 })]), { type: "attack", enemyId: "e-1" });
    expect(r.outcome).toBe("victory");
    expect(r.combat.active).toBe(false);
  });

  it("beginCombat stamps system: \"classic\" on every new fight", () => {
    const rt = new TurnRuntime(fighter(), maxRng);
    const started = rt.startCombat([{ tier: "T1", count: 1 }], "none");
    expect(started.combat.system).toBe("classic");
  });

  it("a MemberOrder[] carrying only the PC's order is byte-identical to the single-action call", () => {
    const single = new TurnRuntime(fighter(), maxRng).resolveCombatRound(legacyCombat([enemy({ hp: 6 })]), {
      type: "attack",
      enemyId: "e-1",
    });
    const asOrders = new TurnRuntime(fighter(), maxRng).resolveCombatRound(legacyCombat([enemy({ hp: 6 })]), [
      { memberId: "pc-1", action: { type: "attack", enemyId: "e-1" } },
    ]);
    expect(asOrders.lines).toEqual(single.lines);
    expect(asOrders.outcome).toBe(single.outcome);
    expect(asOrders.combat.enemies).toEqual(single.combat.enemies);
  });
});
