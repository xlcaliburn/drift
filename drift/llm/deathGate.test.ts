import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

// d20 = 1 → any check vs a high DC fails (and 1 is not a crit), so failDamage lands.
const minRng: RNG = { int: (min) => min };
const maxRng: RNG = { int: (_min, max) => max };

/** A low-HP PC with `resolved` completed quests (>=3 ends the tutorial). */
function pcState(resolved: number): CampaignState {
  const threads = Array.from({ length: resolved }, (_, i) => ({
    id: `t-${i}`, campaignId: "c", title: "done", body: "", status: "resolved", entityRefs: [],
  }));
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 5, maxHp: 5, ac: 12, stims: 0, fragile: false, credits: 0,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads, contracts: [],
  } as unknown as CampaignState;
}

// zeroG is a hazard skill, so failure hurts — but the hit is capped to a fraction
// of max HP, so it takes several to drop a 5-HP character.
const hazardHit = (rt: TurnRuntime) =>
  rt.execute("roll_check", { characterId: "pc-1", skill: "zeroG", dc: 99, stakes: false, failDamage: "100" });
const hitUntilDown = (rt: TurnRuntime) => {
  for (let i = 0; i < 6 && rt.state.characters[0].hp > 0; i++) hazardHit(rt);
};

describe("death gate", () => {
  it("in the tutorial (<3 quests), repeated hits DOWN but never kill — no permadeath", () => {
    const rt = new TurnRuntime(pcState(0), minRng);
    hitUntilDown(rt); // driven to 0 HP: downed
    expect(rt.state.characters[0].hp).toBe(0);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(true);
    hazardHit(rt); // struck while down — would kill, but tutorial forbids it
    const names = rt.state.characters[0].injuries.map((i) => i.name);
    expect(names).toContain("Downed");
    expect(names).not.toContain("Dead");
    expect(TurnRuntime.isDead(rt.state.characters[0])).toBe(false);
  });

  it("after the tutorial (>=3 quests), a hit while down KILLS", () => {
    const rt = new TurnRuntime(pcState(3), minRng);
    hitUntilDown(rt); // downed
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(true);
    hazardHit(rt); // struck while down → dead
    expect(TurnRuntime.isDead(rt.state.characters[0])).toBe(true);
  });
});

describe("failure damage is gated + capped (D&D-style)", () => {
  it("a failed ability check (perception) deals NO damage", () => {
    const rt = new TurnRuntime(pcState(3), minRng); // hp 5, fails vs dc 99
    rt.execute("roll_check", { characterId: "pc-1", skill: "perception", dc: 99, failDamage: "100" });
    expect(rt.state.characters[0].hp).toBe(5); // untouched — perception can't hurt you
  });

  it("a failed hazard check (zeroG) deals damage, capped to a fraction of max HP", () => {
    const rt = new TurnRuntime(pcState(3), minRng); // hp 5, maxHp 5 → cap = ceil(5*0.34) = 2
    rt.execute("roll_check", { characterId: "pc-1", skill: "zeroG", dc: 99, failDamage: "100" });
    expect(rt.state.characters[0].hp).toBe(3); // 5 - 2 (capped), not 5 - 100
  });

  it("a danger save (hazard flag) deals damage on any skill but stays capped", () => {
    const rt = new TurnRuntime(pcState(3), minRng);
    rt.execute("roll_check", { characterId: "pc-1", skill: "perception", dc: 99, failDamage: "100", hazard: true });
    expect(rt.state.characters[0].hp).toBe(3); // danger vs a trap can hurt even on a perception save — but capped
  });
});

describe("downed recovery", () => {
  function downedState(): CampaignState {
    const s = pcState(3);
    s.characters[0].hp = 0;
    s.characters[0].injuries = [{ name: "Downed", effect: "bleeding out" }];
    s.characters[0].stims = 1;
    return s;
  }

  it("a heal that brings HP above 0 clears Downed (back on your feet)", () => {
    const rt = new TurnRuntime(downedState(), maxRng);
    rt.useItem("stim");
    expect(rt.state.characters[0].hp).toBeGreaterThan(0);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(false);
  });

  it("scene end stabilises a downed survivor to at least 1 HP and clears Downed", () => {
    const rt = new TurnRuntime(downedState(), maxRng);
    rt.execute("end_scene", {});
    expect(rt.state.characters[0].hp).toBe(1);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(false);
  });
});
