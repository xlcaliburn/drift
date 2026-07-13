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

  it("deals failDamage on a failed HAZARD check (real stakes), capped to a fraction of max HP", () => {
    // d20=1 → failure. zeroG is a hazard skill; maxHp 8 → cap = ceil(8*0.34) = 3.
    const rt = new TurnRuntime(stateWithPc(), rollRng(1));
    const res = rt.execute("roll_check", {
      characterId: "pc-1",
      skill: "zeroG",
      dc: 13,
      stakes: true,
      failDamage: "4",
    }) as { outcome: string; damage?: number };
    expect(res.outcome).toBe("failure");
    expect(res.damage).toBe(3); // capped from 4
    expect(rt.state.characters[0].hp).toBe(5); // 8 → 5
  });

  it("a failed ABILITY check (stealth) never deals damage", () => {
    const rt = new TurnRuntime(stateWithPc(), rollRng(1)); // failure
    const res = rt.execute("roll_check", {
      characterId: "pc-1",
      skill: "stealth",
      dc: 13,
      stakes: true,
      failDamage: "6",
    }) as { outcome: string; damage?: number };
    expect(res.outcome).toBe("failure");
    expect(res.damage).toBeUndefined();
    expect(rt.state.characters[0].hp).toBe(8); // untouched
  });

  it("downs at 0 HP, then a further hit kills — death is possible", () => {
    // Death only outside the tutorial (>=3 resolved quests) — the tutorial is
    // non-lethal, so give this PC a post-tutorial history.
    const s = stateWithPc();
    s.threads = [1, 2, 3].map((i) => ({
      id: `t-${i}`, campaignId: "c", title: "done", body: "", status: "resolved", entityRefs: [],
    })) as CampaignState["threads"];
    const rt = new TurnRuntime(s, rollRng(1)); // always fail
    // Capped hits (3 each) drive 8 → 5 → 2 → 0, DOWNED.
    const hit = () =>
      rt.execute("roll_check", { characterId: "pc-1", skill: "zeroG", dc: 13, stakes: true, failDamage: "9" }) as {
        downed?: boolean;
        died?: boolean;
      };
    hit();
    hit();
    const down = hit();
    expect(down.downed).toBe(true);
    expect(rt.state.characters[0].hp).toBe(0);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(true);

    // Struck while down → DEAD.
    const dead = hit();
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
