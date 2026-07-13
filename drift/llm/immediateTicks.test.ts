import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

/** Fixed-roll RNG so outcomes are deterministic. */
const rollRng = (d20: number): RNG => ({
  int: (min: number, max: number) => (min === 1 && max === 20 ? d20 : min),
});

function stateWithPc(): CampaignState {
  return {
    campaign: { id: "camp-t", currentLocationId: "loc-x", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1",
        kind: "pc",
        name: "Test",
        attributes: { might: 0, reflex: 2, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        hp: 8,
        maxHp: 8,
        ac: 12,
        stims: 0,
        fragile: false,
        skills: [{ name: "stealth", level: 1, ticks: 0 }],
        actionModifiers: {},
        gear: [],
        injuries: [],
      },
    ],
    factions: [],
    factionRep: [],
    locations: [],
    npcs: [],
    clocks: [],
    threads: [],
    contracts: [],
  } as unknown as CampaignState;
}

const roll = (rt: TurnRuntime, opts?: Record<string, unknown>) =>
  rt.execute("roll_check", { characterId: "pc-1", skill: "stealth", dc: 13, stakes: true, ...opts }) as {
    tick?: string;
    outcome: string;
  };

describe("immediate tick award on qualifying rolls", () => {
  it("awards the tick on the roll itself (no end_scene needed)", () => {
    const rt = new TurnRuntime(stateWithPc(), rollRng(10));
    const res = roll(rt);
    expect(res.tick).toContain("Stealth");
    const pc = rt.state.characters[0];
    expect(pc.skills.find((s) => s.name === "stealth")?.ticks).toBe(1);
  });

  it("caps at one tick per skill per scene, across separate runtimes sharing the set", () => {
    const ticked = new Set<string>();
    const rt1 = new TurnRuntime(stateWithPc(), rollRng(10), { tickedThisScene: ticked });
    const r1 = roll(rt1);
    expect(r1.tick).toBeDefined();

    // Next turn: new runtime, same persisted set (as the route does).
    const rt2 = new TurnRuntime(rt1.state, rollRng(10), { tickedThisScene: ticked });
    const r2 = roll(rt2);
    expect(r2.tick).toBeUndefined(); // capped
    expect(rt2.state.characters[0].skills.find((s) => s.name === "stealth")?.ticks).toBe(1);
  });

  it("does not tick below DC 13 or without stakes", () => {
    const rt = new TurnRuntime(stateWithPc(), rollRng(10));
    expect(roll(rt, { dc: 10 }).tick).toBeUndefined();
    expect(roll(rt, { stakes: false }).tick).toBeUndefined();
  });

  it("deals failDamage on a failed check (real stakes)", () => {
    // d20=1 → total 1+2 vs DC 13 → failure → 4 damage.
    const rt = new TurnRuntime(stateWithPc(), rollRng(1));
    const res = rt.execute("roll_check", {
      characterId: "pc-1",
      skill: "stealth",
      dc: 13,
      stakes: true,
      failDamage: "4",
    }) as { outcome: string; damage?: number };
    expect(res.outcome).toBe("failure");
    expect(res.damage).toBe(4);
    expect(rt.state.characters[0].hp).toBe(4); // 8 → 4
  });

  it("does not deal damage on a successful check", () => {
    const rt = new TurnRuntime(stateWithPc(), rollRng(20)); // crit success
    const res = rt.execute("roll_check", {
      characterId: "pc-1",
      skill: "stealth",
      dc: 13,
      stakes: true,
      failDamage: "6",
    }) as { outcome: string; damage?: number };
    expect(res.outcome).toBe("success");
    expect(res.damage).toBeUndefined();
    expect(rt.state.characters[0].hp).toBe(8);
  });

  it("downs at 0 HP, then a further hit kills — death is possible", () => {
    const rt = new TurnRuntime(stateWithPc(), rollRng(1)); // always fail
    // First big hit: 8 → 0, DOWNED.
    const down = rt.execute("roll_check", {
      characterId: "pc-1", skill: "stealth", dc: 13, stakes: true, failDamage: "8",
    }) as { downed?: boolean; died?: boolean };
    expect(down.downed).toBe(true);
    expect(rt.state.characters[0].hp).toBe(0);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(true);

    // Struck while down → DEAD.
    const dead = rt.execute("roll_check", {
      characterId: "pc-1", skill: "stealth", dc: 13, stakes: true, failDamage: "3",
    }) as { died?: boolean };
    expect(dead.died).toBe(true);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Dead")).toBe(true);
    expect(TurnRuntime.isDead(rt.state.characters[0])).toBe(true);
  });

  it("scene end resets the cap so the skill can tick again", () => {
    const ticked = new Set<string>();
    const rt = new TurnRuntime(stateWithPc(), rollRng(10), { tickedThisScene: ticked });
    roll(rt);
    expect(ticked.size).toBe(1);
    rt.execute("end_scene", { paying: false });
    expect(ticked.size).toBe(0); // fresh scene, cap reset
    const again = roll(rt);
    expect(again.tick).toBeDefined();
  });
});
