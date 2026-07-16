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
  it("repair ¢12/HP and missiles ¢51 ea", () => {
    // 12/HP (was 18) — dock repair must undercut field patch kits (ECONOMY.md E-3).
    expect(repairCost(19)).toBe(228);
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
    expect(report.checklist.ticksAwarded[0]).toBe("Gunnery (lvl 2): 5→6/18");
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

describe("runSceneEnd — ship recharge after combat", () => {
  it("a popped shield STAYS down (no free shield-cell reload); burst drive recharges", () => {
    const state = buildCampaignState();
    state.ship!.shieldReady = false; // absorbed a hit this fight
    state.ship!.burstDriveReady = false; // spent on an escape
    const report = runSceneEnd(state, { combatEnded: true });
    expect(report.state.ship!.shieldReady).toBe(false); // must be re-earned with a shield cell
    expect(report.state.ship!.burstDriveReady).toBe(true); // recharges (its only charge source)
  });

  it("does NOT free-reload missiles at scene end (fired rounds are only deducted)", () => {
    const state = buildCampaignState();
    const pod = state.ship!.weapons.find((w) => w.type === "missile");
    if (pod) {
      pod.ammo = 3;
      const report = runSceneEnd(state, { combatEnded: true, missilesFired: 2 });
      const after = report.state.ship!.weapons.find((w) => w.type === "missile")!;
      expect(after.ammo).toBe(1); // 3 - 2, never topped back up
    }
  });
});
