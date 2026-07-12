import { describe, it, expect } from "vitest";
import { buildNewCampaignState, buildFaultLineClock, SEASON_LENGTH_DAYS } from "@/lib/newCampaign";
import { runSceneEnd } from "./sceneEnd";
import { vess } from "@/engine/__fixtures__/vessCampaign";

describe("Fault Line — the season's shared pressure clock", () => {
  it("spans the 14-day season with 5 predetermined milestones", () => {
    const c = buildFaultLineClock("camp-x");
    expect(c.id).toBe("clk-faultline");
    expect(c.current).toBe(0);
    expect(c.max).toBe(SEASON_LENGTH_DAYS);
    expect(SEASON_LENGTH_DAYS).toBe(14);
    expect(c.milestones.map((m) => m.at)).toEqual([3, 6, 9, 12, 14]);
  });

  it("is seeded into every new campaign at day 0", () => {
    const state = buildNewCampaignState(vess);
    const fl = state.clocks.find((c) => c.id === "clk-faultline");
    expect(fl).toBeDefined();
    expect(fl!.current).toBe(0);
  });

  it("advances +1 per in-world day and fires the day-3 milestone", () => {
    const state = buildNewCampaignState(vess);
    const report = runSceneEnd(state, { tendaysDelta: 3 });
    const fl = report.state.clocks.find((c) => c.id === "clk-faultline")!;
    expect(fl.current).toBe(3);
    expect(report.checklist.clocksAdvanced.join(" ")).toContain("Probing");
  });

  it("is time-only: a scene with no elapsed time never advances it", () => {
    const state = buildNewCampaignState(vess);
    const report = runSceneEnd(state, { paying: true, dockings: 1 });
    const fl = report.state.clocks.find((c) => c.id === "clk-faultline")!;
    expect(fl.current).toBe(0);
  });

  it("caps at the season length and completes at the reckoning", () => {
    const state = buildNewCampaignState(vess);
    const report = runSceneEnd(state, { tendaysDelta: 99 });
    const fl = report.state.clocks.find((c) => c.id === "clk-faultline")!;
    expect(fl.current).toBe(14);
    expect(fl.status).toBe("complete");
  });
});
