import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { weaponSkill, combatActions, interpretCombatText } from "@/shared/combat";
import type { CombatState } from "@/shared/combat";
import type { RNG } from "@/engine";

// d20 = 8 fixed; every other roll maxes — enough to read the +mod off the breakdown.
const fixed8: RNG = { int: (min, max) => (min === 1 && max === 20 ? 8 : max) };

/** A MELEE build (Dresch's shape): might, melee skill, ZERO ranged — carries a
 *  blade AND a stronger-damage gun he has no skill for. */
function meleeChar(): CampaignState {
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Dresch", hp: 20, maxHp: 20, ac: 12, stims: 0, fragile: false, credits: 0,
        attributes: { might: 3, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "melee", level: 2, ticks: 0 }], // melee mod = might 3 + prof(ceil(2/2)=1) = 4
        actionModifiers: {},
        gear: [{ name: "Combat knife", itemId: "lightBlade", damage: "1d6" }, { name: "Plasma carbine", itemId: "plasmaCarbine", damage: "2d10" }],
        injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const atkLine = (lines: string[]) => lines.find((l) => l.includes("attack:")) ?? "";

describe("weaponSkill — a blade rolls melee, a gun rolls smallArms", () => {
  it("classifies by name", () => {
    expect(weaponSkill("Combat knife")).toBe("melee");
    expect(weaponSkill("Shock baton")).toBe("melee");
    expect(weaponSkill("Plasma carbine")).toBe("smallArms");
    expect(weaponSkill("Riot gun")).toBe("smallArms");
    expect(weaponSkill(undefined)).toBe("smallArms");
  });
});

describe("combat weapon selection — the always-miss / melee-build bug", () => {
  it("a melee build DEFAULTS to the blade and attacks with MELEE (might), not smallArms", () => {
    const rt = new TurnRuntime(meleeChar(), fixed8);
    const started = rt.startCombat([{ tier: "T1", count: 1 }], "none");
    expect(started.combat.weaponName).toBe("Combat knife"); // drew the blade, NOT the higher-damage gun
    const r = rt.resolveCombatRound(started.combat, { type: "attack", enemyId: started.combat.enemies[0].id });
    // melee mod = might(3) + prof(1) = +4 — NOT the ranged +0 that made every shot miss.
    expect(atkLine(r.lines)).toContain("+4");
  });

  it("drawing another weapon is FREE (no round/volley) and changes the skill used", () => {
    const rt = new TurnRuntime(meleeChar(), fixed8);
    const started = rt.startCombat([{ tier: "T1", count: 1 }], "none");
    const sw = rt.resolveCombatRound(started.combat, { type: "switch", weaponName: "Plasma carbine" });
    expect(sw.combat.weaponName).toBe("Plasma carbine");
    expect(sw.outcome).toBe("continue");
    expect(sw.combat.round).toBe(started.combat.round); // free — the round didn't advance
    const r = rt.resolveCombatRound(sw.combat, { type: "attack", enemyId: sw.combat.enemies[0].id });
    expect(atkLine(r.lines)).toContain("+0"); // now smallArms: reflex 0, no skill
  });

  it("combatActions offers a 'Draw' chip for each OTHER carried weapon", () => {
    const combat = { active: true, round: 1, scale: "personal", enemies: [{ id: "e", name: "Mook", tier: "T1", hp: 8, maxHp: 8, ac: 12, atk: 3, damage: "1d8", shieldReady: false, multiAttack: false }], playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0, weaponName: "Combat knife" } as CombatState;
    const chips = combatActions(combat, [], false, ["Combat knife", "Plasma carbine"]);
    expect(chips.some((c) => c.combatAction.type === "switch" && c.combatAction.weaponName === "Plasma carbine")).toBe(true);
    expect(chips.some((c) => c.combatAction.weaponName === "Combat knife")).toBe(false); // not the drawn one
    expect(chips.find((c) => c.combatAction.type === "attack")?.label).toContain("with Combat knife");
  });

  it("typed 'switch to my plasma carbine' draws it; 'shoot the mook' stays an attack", () => {
    const combat = { active: true, round: 1, scale: "personal", enemies: [{ id: "e", name: "Mook", tier: "T1", hp: 8, maxHp: 8, ac: 12, atk: 3, damage: "1d8", shieldReady: false, multiAttack: false }], playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0, weaponName: "Combat knife" } as CombatState;
    const weapons = ["Combat knife", "Plasma carbine"];
    expect(interpretCombatText("switch to my plasma carbine", combat, [], weapons)).toEqual({ type: "switch", weaponName: "Plasma carbine" });
    expect(interpretCombatText("shoot the Mook", combat, [], weapons).type).toBe("attack");
  });
});
