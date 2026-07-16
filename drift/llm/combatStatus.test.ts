import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { CombatState, CombatEnemy } from "@/shared/combat";
import type { StatusEffect } from "@/shared/status";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

/** d20s and dice roll max → the player always hits (nat 20). */
const maxRng: RNG = { int: (_min, max) => max };

function pc(gear: { name: string; itemId?: string; damage?: string }[], hp = 60): CampaignState {
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp, maxHp: 60, ac: 14, stims: 1, fragile: false, credits: 0,
        attributes: { might: 1, reflex: 2, vitality: 1, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "smallArms", level: 2, ticks: 0 }, { name: "melee", level: 2, ticks: 0 }],
        actionModifiers: {}, gear, injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const combat = (enemies: CombatEnemy[], playerStatuses?: StatusEffect[]): CombatState => ({
  active: true, round: 1, scale: "personal", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0,
  ...(playerStatuses ? { playerStatuses } : {}),
});

const enemy = (over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  id: "e-1", name: "Gunhand", tier: "T2", hp: 60, maxHp: 60, ac: 14, atk: 5, damage: "2d8",
  shieldReady: false, multiAttack: false, ...over,
});

const pcHp = (rt: TurnRuntime) => rt.state.characters[0].hp;

describe("combat status wiring — player weapons inflict on hit", () => {
  const cases = [
    { name: "Incinerator", itemId: "incinerator", kind: "burning" },
    { name: "Corroder", itemId: "corroder", kind: "corroded" },
    { name: "Serrated blade", itemId: "serratedBlade", kind: "bleeding" },
    { name: "Ion lance", itemId: "ionLance", kind: "shocked" },
  ] as const;
  for (const c of cases) {
    it(`${c.name} applies ${c.kind} on a hit`, () => {
      const rt = new TurnRuntime(pc([{ name: c.name, itemId: c.itemId, damage: "1d6" }]), maxRng);
      const r = rt.resolveCombatRound(combat([enemy()]), { type: "attack", enemyId: "e-1" });
      expect(r.combat.enemies[0].statuses?.some((s) => s.kind === c.kind)).toBe(true);
    });
  }
});

describe("shields: shock arcs through, physical/thermal is blocked", () => {
  it("a shocked hit drops the shield AND lands the stun", () => {
    const rt = new TurnRuntime(pc([{ name: "Ion lance", itemId: "ionLance", damage: "1d6" }]), maxRng);
    const r = rt.resolveCombatRound(combat([enemy({ shieldReady: true })]), { type: "attack", enemyId: "e-1" });
    expect(r.combat.enemies[0].shieldReady).toBe(false); // shield popped
    expect(r.combat.enemies[0].statuses?.some((s) => s.kind === "shocked")).toBe(true); // arced through
  });

  it("a burning hit is absorbed by the shield — no burn applied", () => {
    const rt = new TurnRuntime(pc([{ name: "Incinerator", itemId: "incinerator", damage: "1d8" }]), maxRng);
    const r = rt.resolveCombatRound(combat([enemy({ shieldReady: true })]), { type: "attack", enemyId: "e-1" });
    expect(r.combat.enemies[0].shieldReady).toBe(false); // shield still absorbs the hit
    expect(r.combat.enemies[0].statuses?.length ?? 0).toBe(0); // burn blocked
  });
});

describe("shocked denies the next turn", () => {
  it("a shocked enemy skips its volley the following round", () => {
    const rt = new TurnRuntime(pc([{ name: "Ion lance", itemId: "ionLance", damage: "1d6" }]), maxRng);
    // Round 1: shock the enemy (it still volleys this round).
    const r1 = rt.resolveCombatRound(combat([enemy({ hp: 60 })]), { type: "attack", enemyId: "e-1" });
    expect(r1.combat.enemies[0].statuses?.some((s) => s.kind === "shocked")).toBe(true);
    const hpAfterR1 = pcHp(rt);
    // Round 2: player takes cover (no re-shock). At round start the shock ticks → the
    // enemy is skipped → no damage dealt, and the status clears.
    const r2 = rt.resolveCombatRound(r1.combat, { type: "cover" });
    expect(pcHp(rt)).toBe(hpAfterR1); // enemy took no swing
    expect(r2.combat.enemies[0].statuses?.some((s) => s.kind === "shocked")).toBe(false); // cleared
  });
});

describe("armor traits vs enemy statuses", () => {
  it("a sealed hardsuit blocks an enemy's burning on-hit", () => {
    const rt = new TurnRuntime(
      pc([{ name: "Sealed hardsuit", itemId: "sealedHardsuit" }, { name: "Sidearm", itemId: "sidearm", damage: "1d8" }]),
      maxRng,
    );
    const r = rt.resolveCombatRound(combat([enemy({ personalDamageType: "thermal", onHit: "burning" })]), { type: "cover" });
    expect(r.combat.playerStatuses?.some((s) => s.kind === "burning") ?? false).toBe(false);
  });

  it("ablative plating halves thermal damage", () => {
    const rt = new TurnRuntime(
      pc([{ name: "Ablative plating", itemId: "ablativePlating" }, { name: "Sidearm", itemId: "sidearm", damage: "1d8" }]),
      maxRng,
    );
    const r = rt.resolveCombatRound(combat([enemy({ personalDamageType: "thermal" })]), { type: "cover" });
    // Enemy 2d8 max = 16, resisted ×0.5 = 8.
    expect(pcHp(rt)).toBe(60 - 8);
    expect(r.combat.playerStatuses?.length ?? 0).toBe(0);
  });
});

describe("a heal stops the bleeding", () => {
  it("using a stim clears burning + bleeding on the player", () => {
    const rt = new TurnRuntime(pc([{ name: "Sidearm", itemId: "sidearm", damage: "1d8" }]), maxRng);
    const start = combat([enemy({ hp: 60 })], [
      { kind: "burning", rounds: 2, stacks: 1 },
      { kind: "bleeding", rounds: 3, stacks: 2 },
    ]);
    const r = rt.resolveCombatRound(start, { type: "stim" });
    const kinds = (r.combat.playerStatuses ?? []).map((s) => s.kind);
    expect(kinds).not.toContain("burning");
    expect(kinds).not.toContain("bleeding");
  });
});
