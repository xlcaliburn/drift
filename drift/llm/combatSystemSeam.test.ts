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

/** HANDOFF_COMBAT_V2_2.md Task B — the ship2 CombatSystem takes over EVERY new
 *  ship fight; a fight already mid-flight at deploy (stored `system:
 *  "classic"`) must still resolve through resolveShipRound, unchanged. */
function pilot(): CampaignState {
  return {
    ...fighter(),
    ship: {
      id: "ship-1", campaignId: "c", name: "The Wren", shipClass: "hauler", hp: 20, maxHp: 20, ac: 12,
      evasiveAcBonus: 0, damageReduction: 0, weapons: [], hasShield: true, shieldReady: true,
      hasPointDefense: false, burstDriveReady: false, dcModifier: 0, buyoutRemaining: 0,
    },
  } as unknown as CampaignState;
}

const shipEnemy = (over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  id: "e-1", name: "Cutter", tier: "T2", hp: 30, maxHp: 30, ac: 12, atk: 5, damage: "2d6",
  weaponType: "kinetic", shieldReady: false, multiAttack: false, ...over,
});

/** A ship fight persisted BEFORE the ship2 cutover — no `ship2` slice. */
const legacyShipCombat = (enemies: CombatEnemy[]): CombatState =>
  ({ active: true, round: 1, scale: "ship", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0, system: "classic" }) as CombatState;

describe("CombatSystem seam — ship2 cutover (HANDOFF_COMBAT_V2_2 Task B)", () => {
  it("startShipCombat now stamps system: \"ship2\" and freezes the player's profile", () => {
    const rt = new TurnRuntime(pilot(), maxRng);
    const started = rt.startShipCombat([{ shipClass: "scout", count: 1 }], "none");
    expect(started.combat.system).toBe("ship2");
    expect(started.combat.ship2?.player.shipClass).toBe("hauler");
    expect(started.combat.ship2?.player.mounts.length).toBeGreaterThan(0);
  });

  it("a stored system:\"classic\" SHIP fight still resolves via resolveShipRound, not ship2", () => {
    const rt = new TurnRuntime(pilot(), maxRng);
    // Proof it's the CLASSIC path, not ship2: ship2's resolveRound immediately
    // bails with "You have no ship to fight in." (outcome "escaped") whenever
    // `combat.ship2` is missing — this legacy CombatState has no such slice
    // (never populated pre-cutover). A real "victory" here is only reachable
    // through resolveShipRound's d20 weapon-slot math.
    const r = rt.resolveCombatRound(legacyShipCombat([shipEnemy({ hp: 4 })]), { type: "attack", enemyId: "e-1" });
    expect(r.outcome).toBe("victory");
    expect(r.combat.system).toBe("classic");
  });
});
