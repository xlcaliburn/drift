import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { CombatOutcome } from "@/shared/combat";
import { TurnRuntime } from "@/llm/engineBridge";
import { spawnCombatEnemies } from "./combatEngine";
import { seededRng } from "./rng";

/**
 * Combat-balance simulation. Drives a STANDARD personal fight through the real
 * engine path (startCombat → resolveCombatRound) over a spread of seeded RNGs and
 * asserts the pacing goal: a freshly-created combat PC (18 HP) vs a lone general
 * T2 (14 HP) resolves in ~3-6 rounds and the PC wins a healthy majority. If the
 * HP knobs (player 18, T2 14) drift, this test catches the pacing regression.
 */

/**
 * A freshly-created combat-focused PC: 18 HP (the new base), combat armor (AC 18),
 * a 2d6+1 rifle, and smallArms → +4 to-hit.
 *   attackMod = reflex(+3) + skillProficiency(smallArms lvl 2 → ceil(2/2)=+1) = +4.
 * AC 18 models the well-armored fighter (10 + reflex 3 + heavy armor 5) — a
 * dedicated combatant, not an average civilian, which is what "vs a lone T2" is
 * meant to be an even match for.
 */
function combatPc(): CampaignState {
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 18, stims: 0, fragile: false, credits: 100,
        attributes: { might: 1, reflex: 3, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "smallArms", level: 2, ticks: 0 }],
        actionModifiers: {}, gear: [{ name: "Rifle", damage: "2d6+1" }], injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

/** Play a lone-T2 fight to the end (player always attacks). Returns rounds taken
 *  and whether the PC won. Safety-capped so a pathological seed can't loop. */
function simulateFight(seed: number): { rounds: number; won: boolean; outcome: CombatOutcome } {
  const rt = new TurnRuntime(combatPc(), seededRng(seed));
  let { combat, outcome } = rt.startCombat([{ tier: "T2", count: 1 }], "none");
  let rounds = 0;
  while (outcome === "continue" && combat.active && rounds < 50) {
    rounds += 1;
    const target = combat.enemies.find((e) => e.hp > 0);
    const res = rt.resolveCombatRound(combat, { type: "attack", enemyId: target?.id });
    combat = res.combat;
    outcome = res.outcome;
  }
  return { rounds, won: outcome === "victory", outcome };
}

describe("combat balance — standard personal fight (18 HP PC vs lone T2)", () => {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const results = seeds.map(simulateFight);

  it("resolves in a mean of 3-6 rounds across 20 seeds", () => {
    const decisive = results.filter((r) => r.outcome !== "continue"); // all should be decisive
    expect(decisive.length).toBe(results.length);
    const mean = results.reduce((a, r) => a + r.rounds, 0) / results.length;
    // Observed: ~4.35 rounds (deterministic over seeds 1..20). Guardrail catches a
    // regression that makes fights trivial (<3) or a slog (>6).
    expect(mean).toBeGreaterThanOrEqual(3);
    expect(mean).toBeLessThanOrEqual(6);
  });

  it("the PC wins a healthy majority (not a coin-flip loss)", () => {
    const wins = results.filter((r) => r.won).length;
    // Observed: 12/20 = 0.60 — a genuine edge, not a reliable loss.
    expect(wins / results.length).toBeGreaterThan(0.5);
  });
});

describe("major (boss) spawns a longer fight", () => {
  it("a T2 major has ~1.8× the tier HP (≈25)", () => {
    const [boss] = spawnCombatEnemies([{ tier: "T2", major: true }], seededRng(7));
    expect(boss.hp).toBe(25); // round(14 × 1.8)
    expect(boss.maxHp).toBe(25);
  });

  it("a T3 major has ~1.8× the tier HP (≈43)", () => {
    const [boss] = spawnCombatEnemies([{ tier: "T3", major: true }], seededRng(7));
    expect(boss.hp).toBe(43); // round(24 × 1.8)
  });

  it("a general (non-major) T2 keeps the uniform 14 HP", () => {
    const [mook] = spawnCombatEnemies([{ tier: "T2" }], seededRng(7));
    expect(mook.hp).toBe(14);
  });
});
