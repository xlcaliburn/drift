import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { Job } from "@/shared/quests";
import type { SectionCtx } from "./types";
import { activeJobs, offeredJobs } from "./quests";

/** Minimal state carrying what these two sections actually read: locations + factions. */
function state(): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [], factionRep: [],
    factions: [{ id: "f-crown", universeId: "u", name: "Hollow Crown" }],
    locations: [
      { id: "loc-a", universeId: "u", name: "Rook Station", tags: [] },
      { id: "loc-b", universeId: "u", name: "The Shear", tags: [] },
    ],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", title: "Bounty", blurb: "Track them down.", giver: "board", playstyle: "combat",
  archetype: "bounty", tier: "T1", factionId: "f-crown",
  objectives: [{ id: "o1", kind: "travel", summary: "Track Bram Volkov to The Shear", done: false, locationId: "loc-b" }],
  cast: [
    { role: "giver", npcId: "npc-job-j1-giver", name: "Sera Vantry", roleLabel: "dispatcher" },
    { role: "target", npcId: "npc-job-j1-target", name: "Bram Volkov", roleLabel: "jumped bail-runner" },
  ],
  locationId: "loc-b",
  postedLocationId: "loc-a",
  reward: { tier: "T1" },
  status: "offered",
  createdTenday: 0,
  ...over,
});

function ctx(over: Partial<SectionCtx> = {}): SectionCtx {
  return {
    state: state(),
    playerText: "",
    focusIds: [],
    jsonMode: false,
    npcs: [],
    threads: [],
    loc: state().locations[0],
    ...over,
  };
}

describe("activeJobs — quest cast manifest rendering (HANDOFF_NPC_CANON Task D)", () => {
  it("lists EXACTLY the job's cast, each with role, name, occupation, and home location", () => {
    const lines = activeJobs(ctx({ jobs: [job({ status: "active" })] }));
    const text = lines.join("\n");
    expect(text).toContain("use EXACTLY these people, invent no one else for this job");
    expect(text).toContain("giver Sera Vantry (dispatcher, at Rook Station)"); // posted-at location
    expect(text).toContain("target Bram Volkov (jumped bail-runner, at The Shear)"); // job destination
  });

  it("omits the cast bracket entirely for a job with no cast", () => {
    const lines = activeJobs(ctx({ jobs: [job({ status: "active", cast: [] })] }));
    expect(lines.join("\n")).not.toContain("cast —");
  });

  it("returns nothing when there are no active jobs", () => {
    expect(activeJobs(ctx({ jobs: [job({ status: "offered" })] }))).toEqual([]);
    expect(activeJobs(ctx({ jobs: [] }))).toEqual([]);
  });
});

describe("offeredJobs — the giver is named in the pitch", () => {
  it("includes the giver's name and occupation alongside the faction", () => {
    const lines = offeredJobs(ctx({ jobs: [job({ status: "offered" })], loc: state().locations[0] }));
    const text = lines.join("\n");
    expect(text).toContain("from Sera Vantry (dispatcher) for Hollow Crown");
  });

  it("falls back gracefully when a job somehow has no giver in its cast", () => {
    const lines = offeredJobs(ctx({ jobs: [job({ status: "offered", cast: [] })], loc: state().locations[0] }));
    expect(lines.join("\n")).toContain("from Hollow Crown");
  });
});

describe("activeJobs — travel framing (HANDOFF_PLAYTEST_POLISH_2.md)", () => {
  it("states the destination explicitly when the player hasn't arrived yet", () => {
    const s = { ...state(), campaign: { ...state().campaign, currentLocationId: "loc-a" } };
    const lines = activeJobs(ctx({ state: s, jobs: [job({ status: "active" })] }));
    const text = lines.join("\n");
    expect(text).toContain("[destination: The Shear — the player is at Rook Station, NOT there yet; getting there IS the step");
  });

  it("says the player IS at the destination once currentLocationId matches", () => {
    const s = { ...state(), campaign: { ...state().campaign, currentLocationId: "loc-b" } };
    const lines = activeJobs(ctx({ state: s, jobs: [job({ status: "active" })] }));
    const text = lines.join("\n");
    expect(text).toContain("[the player is AT The Shear now — play the step out here]");
    expect(text).not.toContain("destination:");
  });

  it("omits the travel bracket entirely for an objective with no locationId", () => {
    const noLoc = job({ status: "active", objectives: [{ id: "o1", kind: "persuade", summary: "Talk them down", done: false }] });
    const lines = activeJobs(ctx({ jobs: [noLoc] }));
    const text = lines.join("\n");
    expect(text).not.toContain("destination:");
    expect(text).not.toContain("the player is AT");
  });
});

describe("LEGACY jobs (no cast field — raw-jsonb load) never crash the context build", () => {
  // Pre-manifest jobs persist WITHOUT `cast` and load unparsed, so the Zod
  // default never fills it. The load path normalizes; these prove the sections
  // ALSO survive a stale warm session that skipped normalization.
  const legacy = (status: "active" | "offered") =>
    ({ ...job({ status }), cast: undefined }) as unknown as Job;

  it("activeJobs renders a cast-less legacy job without throwing", () => {
    const lines = activeJobs(ctx({ jobs: [legacy("active")] }));
    expect(lines.join("\n")).toContain("Bounty");
    expect(lines.join("\n")).not.toContain("cast —");
  });

  it("offeredJobs renders a cast-less legacy offer without throwing", () => {
    const lines = offeredJobs(ctx({ jobs: [legacy("offered")], loc: state().locations[0] }));
    expect(lines.join("\n")).toContain("from Hollow Crown");
  });
});
