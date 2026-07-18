import { describe, it, expect } from "vitest";
import type { CampaignState } from "./schemas";
import type { PackSidequest, PackStoryChapter } from "@/content/pack/types";
import type { StorylineState } from "./storyline";
import { seededRng } from "@/engine/rng";
import { refreshBoard } from "./quests";
import { injectSidequests, sidequestJob, currentAct } from "./sidequests";

function state(over: { currentLocationId?: string; rep?: CampaignState["factionRep"] } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: over.currentLocationId ?? "loc-a", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [],
    factions: [{ id: "f-crown", universeId: "u", name: "The Crown" }],
    factionRep: over.rep ?? [],
    locations: [
      { id: "loc-a", universeId: "u", name: "Rook Station", tags: [] },
      { id: "loc-b", universeId: "u", name: "Meridian", tags: [] },
    ],
    npcs: [{ id: "npc-ilyana", universeId: "u", name: "Ilyana", oneBreath: "x", role: "debt handler" }],
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

function sidequest(over: Partial<PackSidequest> = {}): PackSidequest {
  return {
    id: "sq-test",
    title: "A Favor for Ilyana",
    blurb: "She needs eyes on a shipment.",
    giverNpcId: "npc-ilyana",
    tier: "T1",
    postedLocationId: "loc-a",
    objectives: [{ id: "o1", kind: "travel", summary: "Go to Meridian", locationId: "loc-b" }],
    reward: {},
    ...over,
  };
}

function chapter(over: Partial<PackStoryChapter> = {}): PackStoryChapter {
  return {
    id: "ch-1", act: 1, title: "x", trigger: {}, castNpcIds: [],
    objectives: [{ id: "o", kind: "travel", summary: "x", locationId: "loc-a" }],
    beats: [], reward: { credits: 0 },
    ...over,
  };
}

const freshStoryline = (): StorylineState => ({ chapters: {} });
const content = (sqs: PackSidequest[], chapters: PackStoryChapter[] = []) => ({ sidequests: sqs, storyline: { chapters } });

describe("currentAct", () => {
  it("is 0 when dormant (no chapters opened at all)", () => {
    expect(currentAct(freshStoryline(), [])).toBe(0);
  });

  it("is the highest act among ACTIVE or COMPLETE chapters", () => {
    const storyline: StorylineState = {
      chapters: {
        "ch-1": { status: "complete", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 },
        "ch-2": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 },
      },
    };
    const chapters = [chapter({ id: "ch-1", act: 1 }), chapter({ id: "ch-2", act: 2 })];
    expect(currentAct(storyline, chapters)).toBe(2);
  });
});

describe("sidequestJob", () => {
  it("materializes with sq- prefix, the giver's REAL name/role, and an UNCLAMPED tier", () => {
    const job = sidequestJob(sidequest({ tier: "T3" }), "Ilyana", "debt handler", 5);
    expect(job.id).toBe("sq-sq-test");
    expect(job.giver).toBe("npc-ilyana");
    expect(job.archetype).toBe("authored");
    expect(job.cast).toEqual([{ role: "giver", npcId: "npc-ilyana", name: "Ilyana", roleLabel: "debt handler" }]);
    expect(job.reward.tier).toBe("T3"); // authored stakes — never clamped by payoutCeiling
    expect(job.status).toBe("offered");
    expect(job.expiresTenday).toBe(8);
  });

  it("falls back to 'contact' when the giver has no pack role", () => {
    const job = sidequestJob(sidequest(), "Ilyana", undefined, 0);
    expect(job.cast[0].roleLabel).toBe("contact");
  });
});

describe("injectSidequests", () => {
  it("only offers a sidequest AT its own postedLocationId", () => {
    const here = injectSidequests(content([sidequest()]), [], state({ currentLocationId: "loc-a" }), freshStoryline(), {}, [], 0);
    expect(here.some((j) => j.id === "sq-sq-test")).toBe(true);
    const elsewhere = injectSidequests(content([sidequest()]), [], state({ currentLocationId: "loc-b" }), freshStoryline(), {}, [], 0);
    expect(elsewhere.some((j) => j.id === "sq-sq-test")).toBe(false);
  });

  it("actAtLeast gates on the season's CURRENT act (from the storyline slice)", () => {
    const sq = sidequest({ trigger: { actAtLeast: 2 } });
    expect(injectSidequests(content([sq]), [], state(), freshStoryline(), {}, [], 0)).toHaveLength(0); // dormant = act 0

    const act1Active: StorylineState = { chapters: { "ch-1": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
    expect(injectSidequests(content([sq], [chapter({ id: "ch-1", act: 1 })]), [], state(), act1Active, {}, [], 0)).toHaveLength(0);

    const act2Active: StorylineState = { chapters: { "ch-2": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
    expect(injectSidequests(content([sq], [chapter({ id: "ch-2", act: 2 })]), [], state(), act2Active, {}, [], 0)).toHaveLength(1);
  });

  it("factionRepAtLeast gates correctly", () => {
    const sq = sidequest({ trigger: { factionRepAtLeast: { factionId: "f-crown", rep: 3 } } });
    expect(injectSidequests(content([sq]), [], state(), freshStoryline(), {}, [], 0)).toHaveLength(0);
    expect(
      injectSidequests(content([sq]), [], state({ rep: [{ campaignId: "c", factionId: "f-crown", rep: 3 }] }), freshStoryline(), {}, [], 0),
    ).toHaveLength(1);
  });

  it("hasFact gates on a substring match against the facts ledger", () => {
    const sq = sidequest({ trigger: { hasFact: "sided-crown" } });
    expect(injectSidequests(content([sq]), [], state(), freshStoryline(), {}, [], 0)).toHaveLength(0);
    expect(
      injectSidequests(content([sq]), [], state(), freshStoryline(), {}, [{ text: "You sided-crown at the tribunal.", entityRefs: [] }], 0),
    ).toHaveLength(1);
  });

  it("one-shot: a COMPLETE or FAILED sq- job blocks re-injection even while the trigger still holds", () => {
    const completeJob = { ...sidequestJob(sidequest(), "Ilyana", undefined, 0), status: "complete" as const };
    const afterComplete = injectSidequests(content([sidequest()]), [completeJob], state(), freshStoryline(), {}, [], 99);
    expect(afterComplete.filter((j) => j.id === "sq-sq-test")).toHaveLength(1); // still just the one completed record

    const failedJob = { ...sidequestJob(sidequest(), "Ilyana", undefined, 0), status: "failed" as const };
    const afterFailed = injectSidequests(content([sidequest()]), [failedJob], state(), freshStoryline(), {}, [], 99);
    expect(afterFailed.filter((j) => j.id === "sq-sq-test")).toHaveLength(1);
  });

  it("an offered-but-dropped copy (expired / walked away, already pruned by refreshBoard) is RE-injectable", () => {
    // Simulates the state AFTER refreshBoard already dropped an expired/away
    // offer out of jobs[] — injectSidequests sees an empty slate and re-adds.
    const jobs = injectSidequests(content([sidequest()]), [], state(), freshStoryline(), {}, [], 50);
    expect(jobs.some((j) => j.id === "sq-sq-test")).toBe(true);
  });

  it("the materialized cast is the REAL pack npc — name/role read from state.npcs, never a phantom", () => {
    const jobs = injectSidequests(content([sidequest()]), [], state(), freshStoryline(), {}, [], 0);
    const job = jobs.find((j) => j.id === "sq-sq-test")!;
    expect(job.cast).toEqual([{ role: "giver", npcId: "npc-ilyana", name: "Ilyana", roleLabel: "debt handler" }]);
  });

  it("an unknown giver id degrades to using the id itself as the name, without crashing", () => {
    const sq = sidequest({ giverNpcId: "npc-ghost" });
    const jobs = injectSidequests(content([sq]), [], state(), freshStoryline(), {}, [], 0);
    expect(jobs.find((j) => j.id === "sq-sq-test")?.cast[0].name).toBe("npc-ghost");
  });

  it("an injected sidequest COUNTS toward BOARD_SIZE — it displaces a generated offer, never adds a 5th slot", () => {
    const injected = injectSidequests(content([sidequest()]), [], state(), freshStoryline(), {}, [], 0);
    const topped = refreshBoard(state(), injected, seededRng(1), 0, 4);
    const offeredHere = topped.filter((j) => j.status === "offered");
    expect(offeredHere).toHaveLength(4);
    expect(offeredHere.some((j) => j.id === "sq-sq-test")).toBe(true);
  });
});
