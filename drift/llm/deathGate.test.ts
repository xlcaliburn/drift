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

const lethalHit = (rt: TurnRuntime) =>
  rt.execute("roll_check", { characterId: "pc-1", skill: "stealth", dc: 99, stakes: false, failDamage: "100" });

describe("death gate", () => {
  it("in the tutorial (<3 quests), a second lethal hit only DOWNS — no permadeath", () => {
    const rt = new TurnRuntime(pcState(0), minRng);
    lethalHit(rt); // hp 5 → 0: downed
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(true);
    lethalHit(rt); // struck while down — would kill, but tutorial forbids it
    const names = rt.state.characters[0].injuries.map((i) => i.name);
    expect(names).toContain("Downed");
    expect(names).not.toContain("Dead");
    expect(TurnRuntime.isDead(rt.state.characters[0])).toBe(false);
  });

  it("after the tutorial (>=3 quests), a second lethal hit KILLS", () => {
    const rt = new TurnRuntime(pcState(3), minRng);
    lethalHit(rt); // downed
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(true);
    lethalHit(rt); // dead
    expect(TurnRuntime.isDead(rt.state.characters[0])).toBe(true);
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
