import { describe, it, expect } from "vitest";
import type { CampaignState } from "./schemas";
import { buildOpeningRecap } from "./recap";

function state(over: { characters?: CampaignState["characters"]; threads?: CampaignState["threads"] } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-a", tendaysElapsed: 0, situation: "The lanes are shifting." },
    universe: { id: "u", name: "U" },
    characters: over.characters ?? [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [], factionRep: [],
    locations: [{ id: "loc-a", universeId: "u", name: "Home Berth", tags: [] }],
    npcs: [], clocks: [], threads: over.threads ?? [], contracts: [],
  } as unknown as CampaignState;
}

describe("buildOpeningRecap — HANDOFF_PLAYTEST_POLISH_1.md ally line", () => {
  it("names the temporary prologue ally when one is in the party", () => {
    const ally = {
      id: "ally-c", campaignId: "c", kind: "party" as const, name: "Juno Vex", hp: 16, maxHp: 16, ac: 12,
      stims: 0, fragile: false, temporary: true,
      attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
      skills: [], actionModifiers: {}, gear: [], injuries: [],
    };
    const s = state({ characters: [state().characters[0], ally] });
    expect(buildOpeningRecap(s)).toContain("Juno Vex is riding with you on your first runs.");
  });

  it("says nothing about an ally when there isn't one", () => {
    expect(buildOpeningRecap(state())).not.toMatch(/riding with you/);
  });

  it("says nothing about a non-temporary party member (real crew, not the prologue ally)", () => {
    const crew = {
      id: "crew-1", campaignId: "c", kind: "party" as const, name: "Hired Hand", hp: 16, maxHp: 16, ac: 12,
      stims: 0, fragile: false,
      attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
      skills: [], actionModifiers: {}, gear: [], injuries: [],
    };
    const s = state({ characters: [state().characters[0], crew] });
    expect(buildOpeningRecap(s)).not.toMatch(/riding with you/);
  });
});
