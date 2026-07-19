import { describe, it, expect } from "vitest";
import type { Character, Campaign } from "@/shared/schemas";
import { survivesLoad } from "./queries";

function character(over: Partial<Character> = {}): Character {
  return {
    id: "c1", campaignId: "camp-1", kind: "party", name: "Ally",
    attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
    hp: 10, maxHp: 10, ac: 12, stims: 0, fragile: false,
    skills: [], actionModifiers: {}, gear: [], injuries: [],
    ...over,
  } as Character;
}

function campaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: "camp-1", universeId: "u", name: "x", status: "active", tendaysElapsed: 0,
    ...over,
  } as Campaign;
}

describe("survivesLoad — the prologue-ally cold-load drop (HANDOFF_STORY_4.md trap 2)", () => {
  it("a temporary character is DROPPED once the prologue is complete", () => {
    expect(survivesLoad(character({ temporary: true }), campaign({ prologueStage: "complete" }))).toBe(false);
  });

  it("a temporary character SURVIVES while the prologue is still running", () => {
    for (const stage of ["intro", "groundFight", "shipFight", "graduation"] as const) {
      expect(survivesLoad(character({ temporary: true }), campaign({ prologueStage: stage })), stage).toBe(true);
    }
  });

  it("a temporary character survives on a LEGACY campaign (no prologueStage at all)", () => {
    expect(survivesLoad(character({ temporary: true }), campaign())).toBe(true);
  });

  it("a normal (non-temporary) character is NEVER dropped, even at complete", () => {
    expect(survivesLoad(character({ temporary: false }), campaign({ prologueStage: "complete" }))).toBe(true);
    expect(survivesLoad(character(), campaign({ prologueStage: "complete" }))).toBe(true);
  });
});
