import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { TurnPlan } from "@/shared/turnPlan";
import type { RNG } from "@/engine";

const rng: RNG = { int: (_min, max) => max };

function state(threads: CampaignState["threads"] = []): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-rook", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Dresch", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false, credits: 0,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads, contracts: [],
  } as unknown as CampaignState;
}

describe("quest threads — the JSON turn path can OPEN and RESOLVE (the fence-job bug)", () => {
  it("TurnPlan accepts a threads field (open + resolve)", () => {
    const plan = TurnPlan.parse({
      narration: "Sera sets you on a fence.",
      threads: [
        { op: "open", title: "Fence the salvage through Yoren", body: "Dock-14 broker." },
        { op: "resolve", id: "th-old" },
      ],
    });
    expect(plan.threads).toHaveLength(2);
  });

  it("the engine OPENS a tracked thread (a job no longer lives only in prose)", () => {
    const rt = new TurnRuntime(state(), rng);
    rt.execute("update_thread", { op: "create", title: "Fence the salvage through Yoren", body: "Dock-14 broker." });
    const open = rt.state.threads.filter((t) => t.status === "active");
    expect(open).toHaveLength(1);
    expect(open[0].title).toContain("Yoren");
  });

  it("the engine RESOLVES a thread when the job is done", () => {
    const rt = new TurnRuntime(
      state([{ id: "th-fence", campaignId: "c", title: "Fence the salvage", body: "", status: "active", entityRefs: [] }]),
      rng,
    );
    rt.execute("update_thread", { op: "resolve", threadId: "th-fence" });
    expect(rt.state.threads.find((t) => t.id === "th-fence")?.status).toBe("resolved");
  });
});
