import { describe, it, expect } from "vitest";
import type { CampaignState, Character } from "@/shared/schemas";
import type { CombatState, CombatEnemy } from "@/shared/combat";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

/** maxRng: every d20 = 20 (all attacks crit-hit), dice max, and the volley TARGET
 *  pick lands on the LAST standing party member (index max). minRng: d20 = 1
 *  (attacks miss), target pick = the PC (index 0). */
const maxRng: RNG = { int: (_min, max) => max };
const minRng: RNG = { int: (min) => min };

function crew(name: string, role: string, hp = 10, over: Partial<Character> = {}): Character {
  return {
    id: `crew-${name.toLowerCase()}`, kind: "party", name, hp, maxHp: 10, ac: 12, stims: 0, fragile: false,
    loyalty: 3, crewRole: role, crewTier: "T1", wage: 25,
    attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
    skills: [{ name: role === "muscle" ? "melee" : "smallArms", level: 1, ticks: 0 }],
    actionModifiers: {},
    gear: role === "medic" ? [{ name: "Medkit", itemId: "medkit" }] : [{ name: "Sidearm", itemId: "sidearm", damage: "1d8" }],
    injuries: [], ...over,
  } as unknown as Character;
}

function state(party: Character[], pcHp = 20): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: pcHp, maxHp: 20, ac: 14, stims: 0, fragile: false, credits: 100,
        attributes: { might: 1, reflex: 2, vitality: 1, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "smallArms", level: 2, ticks: 0 }],
        actionModifiers: {}, gear: [{ name: "Rifle", damage: "2d6" }], injuries: [],
      },
      ...party,
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const combatWith = (enemies: CombatEnemy[]): CombatState => ({
  active: true, round: 1, scale: "personal", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0,
});

const enemy = (over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  id: "e-1", name: "Gunhand", tier: "T2", hp: 60, maxHp: 60, ac: 14, atk: 5, damage: "2d8",
  shieldReady: false, multiAttack: false, ...over,
});

describe("crew fight beside the PC (CREW.md §4)", () => {
  it("muscle/gunner add their attacks — one summary line per round", () => {
    const rt = new TurnRuntime(state([crew("Bruno", "muscle"), crew("Vex", "gunner")]), maxRng);
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 60 })]), { type: "attack", enemyId: "e-1" });
    const crewLine = r.lines.find((l) => l.startsWith("🧑‍🚀 Crew —"));
    expect(crewLine).toBeTruthy();
    expect(crewLine).toMatch(/Bruno hits Gunhand/);
    expect(crewLine).toMatch(/Vex hits Gunhand/);
    // The enemy took the PC's crit AND both crew hits.
    expect(r.combat.enemies[0].hp).toBeLessThan(60 - 20);
  });

  it("a face holds position — no crew attack from them (they can still be shot at)", () => {
    const rt = new TurnRuntime(state([crew("Silk", "face")]), maxRng);
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 60 })]), { type: "attack", enemyId: "e-1" });
    expect(r.lines.some((l) => l.startsWith("🧑‍🚀 Crew —"))).toBe(false); // no crew-phase action
  });

  it("enemies split fire — a crew member can take the swing instead of the PC", () => {
    // maxRng picks the LAST standing target = the crew member; the hit crits 2d8=16
    // which drops Bruno (10 hp) to 0 → DOWNED, not dead.
    const rt = new TurnRuntime(state([crew("Bruno", "muscle")]), maxRng);
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 999, ac: 99 })]), { type: "cover" });
    expect(rt.state.characters.find((c) => c.kind === "pc")!.hp).toBe(20); // PC untouched
    const bruno = rt.state.characters.find((c) => c.name === "Bruno")!;
    expect(bruno.hp).toBe(0);
    expect(bruno.injuries.some((i) => i.name === "Downed")).toBe(true);
    expect(r.lines.some((l) => /Bruno takes/.test(l))).toBe(true);
  });

  it("the medic patches a downed crewmate on the crew phase", () => {
    const downed = crew("Bruno", "muscle", 0, { injuries: [{ name: "Downed", effect: "" }] } as Partial<Character>);
    const rt = new TurnRuntime(state([downed, crew("Kessa", "medic")]), minRng); // minRng: enemy misses
    rt.resolveCombatRound(combatWith([enemy()]), { type: "cover" });
    const bruno = rt.state.characters.find((c) => c.name === "Bruno")!;
    expect(bruno.hp).toBeGreaterThan(0);
    expect(bruno.injuries.some((i) => i.name === "Downed")).toBe(false);
  });

  it("the medic catches the PC as they drop — the fight continues (once per fight)", () => {
    // minRng targets the PC; enemy needs to HIT, so give it a huge atk vs the pc AC
    // while minRng d20=1... d20 1 + atk still under AC → miss. Use a custom rng:
    // d20 rolls high, damage low, target pick = 0 (the PC).
    const rigged: RNG = { int: (min, max) => (max === 20 ? 20 : min) }; // d20=20, dice/table=min
    const rt = new TurnRuntime(state([crew("Kessa", "medic")], 1), rigged); // PC at 1 HP
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 999 })]), { type: "cover" });
    const pc = rt.state.characters.find((c) => c.kind === "pc")!;
    expect(r.outcome).toBe("continue"); // NOT halted into Bleeding Out
    expect(pc.hp).toBeGreaterThan(0); // back on their feet
    expect(pc.injuries.some((i) => i.name === "Downed")).toBe(false);
    expect(r.lines.some((l) => /Kessa drags you back up/.test(l))).toBe(true);
    expect(r.combat.medicSpentIds).toContain("crew-kessa");
  });

  it("without a medic, the PC drop still halts the fight (Bleeding Out)", () => {
    const rigged: RNG = { int: (min, max) => (max === 20 ? 20 : min) };
    const rt = new TurnRuntime(state([], 1), rigged);
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 999 })]), { type: "cover" });
    expect(r.outcome).toBe("downed");
    expect(r.combat.active).toBe(false);
  });
});

describe("squad orders (HANDOFF_COMBAT_V2_1 Task C)", () => {
  it("an ordered crew member attacks THEIR chosen target, not just the front enemy", () => {
    const rt = new TurnRuntime(state([crew("Bruno", "muscle")]), maxRng);
    const e1 = enemy({ id: "e-1", name: "Gunhand", hp: 60 });
    const e2 = enemy({ id: "e-2", name: "Chaser", hp: 60 });
    const r = rt.resolveCombatRound(combatWith([e1, e2]), [
      { memberId: "pc-1", action: { type: "cover" } },
      { memberId: "crew-bruno", action: { type: "attack", enemyId: "e-2" } },
    ]);
    const front = r.combat.enemies.find((e) => e.id === "e-1")!;
    const chosen = r.combat.enemies.find((e) => e.id === "e-2")!;
    expect(front.hp).toBe(60); // untouched — the PC took cover, Bruno was ordered elsewhere
    expect(chosen.hp).toBeLessThan(60);
    expect(r.lines.find((l) => l.startsWith("🧑‍🚀 Crew —"))).toMatch(/Bruno hits Chaser/);
  });

  it("an ordered crew member self-uses a held stim", () => {
    // minRng (not maxRng): a maxRng enemy volley would always crit-hit Vex right
    // after her heal, muddying the assertion — this test is about the heal itself.
    const hurt = crew("Vex", "gunner", 5, { gear: [{ name: "Stim", itemId: "stim", qty: 1 }] } as Partial<Character>);
    const rt = new TurnRuntime(state([hurt]), minRng);
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 999 })]), [
      { memberId: "pc-1", action: { type: "cover" } },
      { memberId: "crew-vex", action: { type: "stim" } },
    ]);
    const vex = rt.state.characters.find((c) => c.name === "Vex")!;
    expect(vex.hp).toBe(8); // 5 + min(1d6+2)=3
    expect(r.lines.find((l) => l.startsWith("🧑‍🚀 Crew —"))).toMatch(/Vex uses Stim/);
    expect(vex.gear.some((g) => g.itemId === "stim" && (g.qty ?? 1) > 0)).toBe(false); // consumed
  });

  it("a patient-less medic acts on an order instead of holding position", () => {
    const rt = new TurnRuntime(state([crew("Kessa", "medic")]), maxRng);
    const r = rt.resolveCombatRound(combatWith([enemy({ hp: 60 })]), [
      { memberId: "pc-1", action: { type: "cover" } },
      { memberId: "crew-kessa", action: { type: "attack", enemyId: "e-1" } },
    ]);
    expect(r.lines.find((l) => l.startsWith("🧑‍🚀 Crew —"))).toMatch(/Kessa hits Gunhand/);
  });

  it("an un-ordered member keeps auto-acting alongside an ordered one (mixed round)", () => {
    const rt = new TurnRuntime(state([crew("Bruno", "muscle"), crew("Vex", "gunner")]), maxRng);
    const e1 = enemy({ id: "e-1", name: "Gunhand", hp: 60 });
    const e2 = enemy({ id: "e-2", name: "Chaser", hp: 60 });
    const r = rt.resolveCombatRound(combatWith([e1, e2]), [
      { memberId: "pc-1", action: { type: "cover" } },
      { memberId: "crew-vex", action: { type: "attack", enemyId: "e-2" } },
      // Bruno gets no order — his old auto-act (front enemy) still fires.
    ]);
    const front = r.combat.enemies.find((e) => e.id === "e-1")!;
    const chosen = r.combat.enemies.find((e) => e.id === "e-2")!;
    expect(front.hp).toBeLessThan(60); // Bruno's auto-act hit the front enemy
    expect(chosen.hp).toBeLessThan(60); // Vex's order hit her chosen target
    const crewLine = r.lines.find((l) => l.startsWith("🧑‍🚀 Crew —"))!;
    expect(crewLine).toMatch(/Bruno hits Gunhand/);
    expect(crewLine).toMatch(/Vex hits Chaser/);
  });

  it("a solo PC round with no crew orders is unchanged whether called with [] or omitted", () => {
    const rt1 = new TurnRuntime(state([]), maxRng);
    const withEmpty = rt1.resolveCombatRound(combatWith([enemy({ hp: 60 })]), [
      { memberId: "pc-1", action: { type: "attack", enemyId: "e-1" } },
    ]);
    const rt2 = new TurnRuntime(state([]), maxRng);
    const withSingle = rt2.resolveCombatRound(combatWith([enemy({ hp: 60 })]), { type: "attack", enemyId: "e-1" });
    expect(withEmpty.lines).toEqual(withSingle.lines);
    expect(withEmpty.combat.enemies[0].hp).toBe(withSingle.combat.enemies[0].hp);
  });
});
