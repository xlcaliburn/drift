import { describe, it, expect } from "vitest";
import { buildContextSlice } from "./promptBuilder";
import { buildCampaignState } from "@/engine/__fixtures__/vessCampaign";

describe("player directive — the aim reaches the narrator context", () => {
  it("injects PLAYER'S OWN AIM with the player's text when set", () => {
    const state = buildCampaignState();
    state.campaign = { ...state.campaign, directive: "get close to people and dig into who they really are" };
    const ctx = buildContextSlice(state, "look around the bar", [], undefined, true);
    expect(ctx).toContain("PLAYER'S OWN AIM");
    expect(ctx).toContain("get close to people and dig into who they really are");
    expect(ctx).toContain("Do NOT force an unrelated questline");
  });

  it("adds nothing when no directive is set (or it's blank)", () => {
    const state = buildCampaignState();
    state.campaign = { ...state.campaign, directive: undefined };
    expect(buildContextSlice(state, "look around", [], undefined, true)).not.toContain("PLAYER'S OWN AIM");
    state.campaign = { ...state.campaign, directive: "   " };
    expect(buildContextSlice(state, "look around", [], undefined, true)).not.toContain("PLAYER'S OWN AIM");
  });
});
