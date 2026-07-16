import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { tendaysForSceneClose, advanceTendays } from "./time";

function state(tendays = 0, withFaultline = false): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "l", tendaysElapsed: tendays },
    universe: { id: "u", name: "U" },
    characters: [],
    factions: [], factionRep: [], locations: [], npcs: [],
    clocks: withFaultline
      ? [{ id: "clk-faultline", campaignId: "c", name: "Fault Line", current: 0, max: 12, triggerText: "", milestones: [], status: "active" }]
      : [],
    threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("tendaysForSceneClose — the deterministic clock policy", () => {
  it("a station hop always costs a tenday", () => {
    expect(tendaysForSceneClose({ moved: true, sceneSeq: 1 })).toBe(1);
    expect(tendaysForSceneClose({ moved: true, sceneSeq: 7 })).toBe(1);
  });

  it("in-place scenes tick a tenday every 4th close, else nothing", () => {
    expect(tendaysForSceneClose({ moved: false, sceneSeq: 1 })).toBe(0);
    expect(tendaysForSceneClose({ moved: false, sceneSeq: 2 })).toBe(0);
    expect(tendaysForSceneClose({ moved: false, sceneSeq: 3 })).toBe(0);
    expect(tendaysForSceneClose({ moved: false, sceneSeq: 4 })).toBe(1);
    expect(tendaysForSceneClose({ moved: false, sceneSeq: 5 })).toBe(0);
    expect(tendaysForSceneClose({ moved: false, sceneSeq: 8 })).toBe(1);
    expect(tendaysForSceneClose({ moved: false, sceneSeq: 0 })).toBe(0); // fresh campaign
  });
});

describe("advanceTendays", () => {
  it("bumps the campaign clock and reports it", () => {
    const r = advanceTendays(state(5), 1);
    expect(r.state.campaign.tendaysElapsed).toBe(6);
    expect(r.lines.some((l) => /tenday 6/.test(l))).toBe(true);
    expect(r.events.some((e) => /Time passes/.test(e.breakdown ?? ""))).toBe(true);
  });

  it("drives the time-only Fault Line season clock", () => {
    const r = advanceTendays(state(0, true), 2);
    expect(r.state.clocks[0].current).toBe(2); // +1 per tenday
  });

  it("is a no-op at delta 0 (same state back, no lines)", () => {
    const s = state(3);
    const r = advanceTendays(s, 0);
    expect(r.state).toBe(s);
    expect(r.lines).toHaveLength(0);
  });
});
