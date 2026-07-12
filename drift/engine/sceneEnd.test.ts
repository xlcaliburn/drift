import { describe, it, expect } from "vitest";
import { applySceneCosts, repairCost, missileCost } from "./economy";
import { runSceneEnd } from "./sceneEnd";
import { buildCampaignState } from "@/engine/__fixtures__/vessCampaign";

describe("economy", () => {
  it("paying job with 2 crew + 1 docking = -¢115", () => {
    const r = applySceneCosts({ paying: true, crewWithWages: 2, dockings: 1 });
    expect(r.creditsDelta).toBe(-115);
  });
  it("non-paying, no docking = ¢0", () => {
    expect(applySceneCosts({ paying: false, crewWithWages: 2, dockings: 0 }).creditsDelta).toBe(0);
  });
  it("repair ¢18/HP and missiles ¢51 ea", () => {
    expect(repairCost(19)).toBe(342);
    expect(missileCost(3)).toBe(153);
  });
});

describe("runSceneEnd — full DM checklist pipeline", () => {
  const state = buildCampaignState();
  const report = runSceneEnd(state, {
    paying: true,
    dockings: 1,
    arrivedAtLocationId: "loc-rook",
    tickedRolls: [{ characterId: "vess", skill: "gunnery" }],
    clockAdvances: [{ clockId: "clk-sable", amount: 1, reason: "bulk run completed" }],
  });

  it("deducts crew wages + dock fee from the PC (2008 -> 1893)", () => {
    const vess = report.state.characters.find((c) => c.id === "vess")!;
    expect(vess.credits).toBe(1893);
  });

  it("awards the gunnery tick (5 -> 6)", () => {
    const vess = report.state.characters.find((c) => c.id === "vess")!;
    expect(vess.skills.find((s) => s.name === "gunnery")!.ticks).toBe(6);
    expect(report.checklist.ticksAwarded[0]).toBe("Gunnery (lvl 2): 5→6/9");
  });

  it("advances the Sable Chain clock (3 -> 4)", () => {
    const clk = report.state.clocks.find((c) => c.id === "clk-sable")!;
    expect(clk.current).toBe(4);
  });

  it("flags an arrival beat and updates location", () => {
    expect(report.checklist.arrivalBeatOwed).toBe(true);
    expect(report.state.campaign.currentLocationId).toBe("loc-rook");
  });

  it("does not mutate the original state", () => {
    expect(state.characters.find((c) => c.id === "vess")!.credits).toBe(2008);
    expect(state.clocks.find((c) => c.id === "clk-sable")!.current).toBe(3);
  });
});
