import { describe, it, expect } from "vitest";
import type { CampaignState } from "./schemas";
import type { EngineEvent } from "@/engine/events";
import { seededRng, scriptedRng } from "@/engine/rng";
import {
  generateJob,
  generatePersonalJob,
  refreshBoard,
  acceptJob,
  abandonJob,
  advanceJobs,
  turnSignals,
  rollJobCredits,
  type Job,
  type Objective,
} from "./quests";

function state(over: { bias?: string; directive?: string; currentLocationId?: string; credits?: number } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: over.currentLocationId ?? "loc-a", tendaysElapsed: 0, directive: over.directive },
    universe: { id: "u", name: "U" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        credits: over.credits ?? 50,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
        ...(over.bias ? { bias: over.bias } : {}),
      },
    ],
    factions: [
      { id: "f-crown", universeId: "u", name: "The Crown" },
      { id: "f-wreck", universeId: "u", name: "Wreckers" },
    ],
    factionRep: [],
    locations: [
      { id: "loc-a", universeId: "u", name: "Home Berth", tags: [] },
      { id: "loc-b", universeId: "u", name: "Rook Station", tags: [] },
      { id: "loc-c", universeId: "u", name: "The Shear", tags: [] },
    ],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const roll = (skill: string, outcome: string): EngineEvent => ({ type: "roll", breakdown: "x", skill, total: 10, outcome, tickEligible: false });
const active = (j: Job): Job => ({ ...j, status: "active" });

describe("generateJob", () => {
  it("builds a valid job with objectives away from the player's current location", () => {
    const j = generateJob(state(), seededRng(1), 0);
    expect(j).not.toBeNull();
    expect(j!.objectives.length).toBeGreaterThan(0);
    // any travel/deliver objective points somewhere the player ISN'T standing.
    for (const o of j!.objectives) if (o.locationId) expect(o.locationId).not.toBe("loc-a");
  });

  it("clamps the reward tier down to the player's net-worth ceiling (a rookie can't draw a big score)", () => {
    // Broke rookie → payoutCeiling T1; even a T2-band archetype must clamp to ≤ T1.
    for (let seed = 0; seed < 40; seed++) {
      const j = generateJob(state({ credits: 20 }), seededRng(seed), 0);
      expect(["T0", "T1"]).toContain(j!.tier);
    }
  });

  it("weights the board toward the player's playstyle bias", () => {
    // A combat-leaning player should draw bounty/protection far more than a random baseline.
    let combatLean = 0;
    for (let seed = 0; seed < 60; seed++) {
      const j = generateJob(state({ bias: "combat", credits: 400 }), seededRng(seed), 0);
      if (j && ["bounty", "protection"].includes(j.archetype)) combatLean++;
    }
    expect(combatLean).toBeGreaterThan(20); // strongly favored (baseline ~2/8 of 60 ≈ 15)
  });
});

describe("board lifecycle", () => {
  it("refreshBoard tops offered jobs up to the count and drops expired offers", () => {
    let jobs: Job[] = [];
    jobs = refreshBoard(state(), jobs, seededRng(2), 0, 4);
    expect(jobs.filter((j) => j.status === "offered")).toHaveLength(4);
    // Advance time past expiry → the stale offers are dropped and replaced.
    const later = refreshBoard(state(), jobs, seededRng(3), 5, 4);
    expect(later.filter((j) => j.status === "offered")).toHaveLength(4);
    expect(later.some((j) => jobs.find((o) => o.id === j.id && o.expiresTenday! < 5))).toBe(false);
  });

  it("accept moves offered → active; abandon moves active → failed", () => {
    const jobs = refreshBoard(state(), [], seededRng(4), 0, 2);
    const id = jobs[0].id;
    const a = acceptJob(jobs, id);
    expect(a.find((j) => j.id === id)!.status).toBe("active");
    const b = abandonJob(a, id);
    expect(b.find((j) => j.id === id)!.status).toBe("failed");
  });
});

describe("advanceJobs — engine-owned completion detection", () => {
  const travelJob: Job = {
    id: "j1", title: "Courier run", blurb: "", giver: "board", playstyle: "commerce", archetype: "courier", tier: "T1",
    objectives: [{ id: "o1", kind: "deliver", summary: "Haul it to Rook", done: false, locationId: "loc-b" }],
    reward: { tier: "T1" }, status: "active", createdTenday: 0,
  };
  const bountyJob: Job = {
    id: "j2", title: "Bounty", blurb: "", giver: "board", playstyle: "combat", archetype: "bounty", tier: "T2",
    objectives: [
      { id: "o1", kind: "travel", summary: "Track them to the Shear", done: false, locationId: "loc-c" },
      { id: "o2", kind: "eliminate", summary: "Take them down", done: false, enemyTier: "T2" },
    ],
    reward: { tier: "T2", repFactionId: "f-crown", repDelta: 1 }, status: "active", createdTenday: 0,
  };

  it("completes a travel objective on arrival and pays out a single-step job", () => {
    const s = turnSignals("loc-b", [], false);
    const r = advanceJobs([travelJob], s);
    expect(r.jobs[0].status).toBe("complete");
    expect(r.completed).toHaveLength(1);
    expect(r.lines.join(" ")).toMatch(/Job complete/);
  });

  it("does NOT advance when the signal doesn't match the current step", () => {
    const r = advanceJobs([travelJob], turnSignals("loc-a", [roll("negotiation", "success")], false));
    expect(r.jobs[0].objectives[0].done).toBe(false);
    expect(r.completed).toHaveLength(0);
  });

  it("advances multi-step jobs ONE step at a time (travel, then the kill)", () => {
    const afterTravel = advanceJobs([bountyJob], turnSignals("loc-c", [], false));
    expect(afterTravel.jobs[0].objectives[0].done).toBe(true);
    expect(afterTravel.jobs[0].objectives[1].done).toBe(false);
    expect(afterTravel.jobs[0].status).toBe("active");
    const afterKill = advanceJobs(afterTravel.jobs, turnSignals("loc-c", [], true));
    expect(afterKill.jobs[0].status).toBe("complete");
  });

  it("completes a roll-gated objective on a matching skill success only", () => {
    const heist: Job = active({
      id: "j3", title: "Heist", blurb: "", giver: "board", playstyle: "intrigue", archetype: "heist", tier: "T1",
      objectives: [{ id: "o1", kind: "sabotage", summary: "Crack the vault", done: false, requiredSkills: ["electronics", "mechanics"] }],
      reward: { tier: "T1" }, status: "offered", createdTenday: 0,
    });
    expect(advanceJobs([heist], turnSignals(undefined, [roll("perception", "success")], false)).completed).toHaveLength(0);
    expect(advanceJobs([heist], turnSignals(undefined, [roll("electronics", "success")], false)).completed).toHaveLength(1);
    expect(advanceJobs([heist], turnSignals(undefined, [roll("electronics", "failure")], false)).completed).toHaveLength(0);
  });

  it("leaves offered/inactive jobs untouched", () => {
    const offered: Job = { ...travelJob, status: "offered" };
    const r = advanceJobs([offered], turnSignals("loc-b", [], false));
    expect(r.jobs[0].status).toBe("offered");
  });
});

describe("generatePersonalJob", () => {
  it("builds an ACTIVE, NPC-given score wrapped around their want (never on the public board)", () => {
    const npc = { id: "npc-gen-kessa", name: "Kessa", factionId: "f-crown", backstory: "wants a ship of her own." };
    const j = generatePersonalJob(npc, state({ credits: 400 }), seededRng(3), 0)!;
    expect(j.giver).toBe("npc-gen-kessa"); // sourced from the NPC, not "board"
    expect(j.status).toBe("active"); // enters active — skips the offered board
    expect(j.expiresTenday).toBeUndefined(); // a personal favor doesn't lapse
    expect(j.blurb).toContain("ship of her own"); // the want rides as the fiction hook
    expect(j.reward.repFactionId).toBe("f-crown"); // pays standing with their faction
    expect(j.objectives.length).toBeGreaterThan(0);
  });
});

describe("rollJobCredits", () => {
  it("rolls inside the tier's payout band", () => {
    const lo = rollJobCredits("T1", scriptedRng([9999]) /* clamps to band hi */);
    expect(lo).toBeGreaterThan(0);
    const c = rollJobCredits("T2", seededRng(7));
    expect(c).toBeGreaterThanOrEqual(350);
    expect(c).toBeLessThanOrEqual(600);
  });
});
