import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { applyAppealAdjustments } from "./appealTurn";
import { itemCount } from "@/shared/items";
import { freshSceneCard } from "@/shared/scene";
import type { RNG } from "@/engine";

const rng: RNG = { int: (_min, max) => max };

function state(over: Partial<{ hp: number; credits: number; stims: number; injuries: { name: string; effect: string }[] }> = {}): CampaignState {
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Silas", hp: over.hp ?? 8, maxHp: 19, ac: 12, stims: over.stims ?? 0,
        fragile: false, credits: over.credits ?? 100,
        attributes: { might: 1, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: over.injuries ?? [],
      },
    ],
    npcs: [{ id: "npc-gen-draven-1", universeId: "u", name: "Draven", oneBreath: "Wrecker leader." }],
    factions: [], factionRep: [], locations: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const sc = () => {
  const s = freshSceneCard();
  s.presentNpcIds = ["npc-gen-draven-1"];
  return s;
};

describe("applyAppealAdjustments — engine-legal corrections", () => {
  it("grants a stim (the Draven case)", () => {
    const r = applyAppealAdjustments(state(), [{ kind: "grantItem", name: "stim", qty: 1 }], { rng });
    expect(itemCount(r.state.characters[0], "stim")).toBe(1);
    expect(r.lines[0]).toMatch(/stim/i);
  });

  it("grants a weapon too (broad scope, authorized)", () => {
    const r = applyAppealAdjustments(state(), [{ kind: "grantItem", name: "laser rifle" }], { rng });
    expect(r.state.characters[0].gear.some((g) => /laser rifle/i.test(g.name))).toBe(true);
  });

  it("heals but clamps to max HP", () => {
    const r = applyAppealAdjustments(state({ hp: 8 }), [{ kind: "adjustHp", delta: 100 }], { rng });
    expect(r.state.characters[0].hp).toBe(19); // maxHp
  });

  it("adjusts credits and floors at 0", () => {
    expect(applyAppealAdjustments(state({ credits: 100 }), [{ kind: "adjustCredits", delta: 400 }], { rng }).state.characters[0].credits).toBe(500);
    expect(applyAppealAdjustments(state({ credits: 100 }), [{ kind: "adjustCredits", delta: -9999 }], { rng }).state.characters[0].credits).toBe(0);
  });

  it("reviving clears Downed and restores at least 1 HP", () => {
    const r = applyAppealAdjustments(state({ hp: 0, injuries: [{ name: "Downed", effect: "bleeding out" }] }), [{ kind: "clearInjury", name: "Downed" }], { rng });
    expect(r.state.characters[0].injuries.length).toBe(0);
    expect(r.state.characters[0].hp).toBeGreaterThanOrEqual(1);
  });

  it("moves standing toward a named present NPC, clamped to ±3", () => {
    const r = applyAppealAdjustments(state(), [{ kind: "adjustDisposition", npc: "Draven", delta: 5 }], { sceneCard: sc(), npcRelations: {}, rng });
    expect(r.npcRelations["npc-gen-draven-1"].disposition).toBe(3); // clamped
  });
});
