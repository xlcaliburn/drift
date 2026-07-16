import { describe, it, expect } from "vitest";
import { combatRoster } from "./jsonTurn";
import type { CombatState, CombatEnemy } from "@/shared/combat";

const enemy = (name: string): CombatEnemy => ({
  id: `e-${name}`, name, tier: "T1", hp: 8, maxHp: 8, ac: 13, atk: 0, damage: "1d8",
  shieldReady: false, multiAttack: false,
});
const combat = (names: string[]): CombatState => ({
  active: true, round: 1, scale: "personal", enemies: names.map(enemy),
  playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0,
});

describe("combatRoster — the ground truth fed to the opening re-narration", () => {
  it("collapses numbered identical foes into a count", () => {
    expect(combatRoster(combat(["Thug 1", "Thug 2", "Thug 3"]))).toBe("3× Thug");
  });

  it("keeps a lone/named foe as itself", () => {
    expect(combatRoster(combat(["Korr"]))).toBe("Korr");
  });

  it("mixes a named boss with a grouped pack", () => {
    expect(combatRoster(combat(["Korr", "Heavy 1", "Heavy 2"]))).toBe("Korr, 2× Heavy");
  });

  it("groups distinct packs separately", () => {
    expect(combatRoster(combat(["Guard 1", "Guard 2", "Sniper 1"]))).toBe("2× Guard, Sniper");
  });
});
