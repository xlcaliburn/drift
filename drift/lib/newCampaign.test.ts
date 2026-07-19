import { describe, it, expect } from "vitest";
import type { Character } from "@/shared/schemas";
import { buildNewCampaignState } from "./newCampaign";

function pc(over: Partial<Character> = {}): Character {
  return {
    id: "pc-1", campaignId: "camp-x", kind: "pc", name: "Test PC",
    attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
    hp: 10, maxHp: 10, ac: 12, stims: 0, fragile: false,
    skills: [], actionModifiers: {}, gear: [], injuries: [],
    ...over,
  } as Character;
}

describe("buildNewCampaignState — the prologue (HANDOFF_STORY_4.md Task A)", () => {
  it("every NEW campaign starts prologueStage 'intro'", () => {
    const state = buildNewCampaignState(pc());
    expect(state.campaign.prologueStage).toBe("intro");
  });

  it("a character with a real parentFactionId gets a temporary, squad-orderable ally", () => {
    const state = buildNewCampaignState(pc({ parentFactionId: "f-crown" }));
    const ally = state.characters.find((c) => c.id !== "pc-1");
    expect(ally).toBeDefined();
    expect(ally!.kind).toBe("party");
    expect(ally!.temporary).toBe(true);
    expect(ally!.name).toBe("Sergeant Vale");
    expect(state.characters).toHaveLength(2);
  });

  it("a character with NO parentFactionId gets no ally (but still starts the prologue)", () => {
    const state = buildNewCampaignState(pc());
    expect(state.characters).toHaveLength(1);
    expect(state.campaign.prologueStage).toBe("intro");
  });

  it("an unknown faction id degrades to no ally, without crashing", () => {
    const state = buildNewCampaignState(pc({ parentFactionId: "f-does-not-exist" }));
    expect(state.characters).toHaveLength(1);
  });

  it("ally ids are derived from campaignId — globally unique, no RNG collision risk", () => {
    const a = buildNewCampaignState(pc({ campaignId: "camp-a", parentFactionId: "f-sable" }));
    const b = buildNewCampaignState(pc({ campaignId: "camp-b", parentFactionId: "f-sable" }));
    const allyA = a.characters.find((c) => c.temporary)!;
    const allyB = b.characters.find((c) => c.temporary)!;
    expect(allyA.id).not.toBe(allyB.id);
    expect(allyA.name).toBe(allyB.name); // same faction → same ally NAME, different id
  });

  it("every faction's ally builds without crashing, with a real crew role/skill/gear", () => {
    for (const factionId of ["f-crown", "f-sable", "f-undertow", "f-free", "f-wreckers", "f-reclaimers"]) {
      const state = buildNewCampaignState(pc({ campaignId: `camp-${factionId}`, parentFactionId: factionId }));
      const ally = state.characters.find((c) => c.temporary)!;
      expect(ally, factionId).toBeDefined();
      expect(ally.skills.length, factionId).toBeGreaterThan(0);
      expect(ally.gear.length, factionId).toBeGreaterThan(0);
      expect(ally.hp, factionId).toBeGreaterThan(0);
    }
  });
});
