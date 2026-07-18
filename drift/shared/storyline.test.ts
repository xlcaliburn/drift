import { describe, it, expect } from "vitest";
import type { CampaignState, Npc } from "./schemas";
import type { PackStoryline } from "@/content/pack/types";
import { turnSignals } from "./quests";
import {
  freshStorylineState,
  evaluateTriggers,
  advanceStoryline,
  nextBeat,
  markBeatDelivered,
  recordChoice,
  type StorylineState,
} from "./storyline";

/**
 * A TEST-ONLY 2-chapter stub (HANDOFF_STORY_1 trap 3) — never shipped in
 * content/pack/drift/, which stays an empty storyline live. Proves the full
 * trigger → beats → objectives (incl. report) → choice → reward → next
 * chapter loop without arming any real campaign.
 */
function stub(): PackStoryline {
  return {
    chapters: [
      {
        id: "ch-1",
        act: 1,
        title: "The Ledger",
        trigger: {},
        castNpcIds: ["npc-ilyana"],
        objectives: [
          { id: "o1", kind: "travel", summary: "Reach Rook Station", locationId: "loc-b" },
          { id: "o2", kind: "report", summary: "Report to Ilyana", npcId: "npc-ilyana" },
        ],
        beats: [
          { id: "b1", directive: "Ilyana greets you warily." },
          {
            id: "b2",
            directive: "She asks about the ledger.",
            aboutNpcId: "npc-ilyana",
            fallbackDirective: "A note from Ilyana's effects raises the same question.",
          },
        ],
        choicePoint: {
          id: "c1",
          prompt: "Where do you point the finger?",
          options: [
            { id: "crown", label: "The Crown", fact: "sided-crown" },
            { id: "chain", label: "The Chain", fact: "sided-chain" },
          ],
        },
        reward: { credits: 100, factionRep: { factionId: "f-crown", delta: 1 } },
      },
      {
        id: "ch-2",
        act: 1,
        title: "The Fallout",
        trigger: { requiresChapterId: "ch-1" },
        castNpcIds: [],
        objectives: [{ id: "o1", kind: "persuade", summary: "Talk down the guard", requiredSkills: ["negotiation"] }],
        beats: [],
        reward: { credits: 50 },
      },
    ],
  };
}

function state(over: Partial<CampaignState["campaign"]> = {}, rep: CampaignState["factionRep"] = []): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-a", tendaysElapsed: 0, ...over },
    universe: { id: "u", name: "U" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false, credits: 0,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [{ id: "f-crown", universeId: "u", name: "The Crown" }],
    factionRep: rep,
    locations: [
      { id: "loc-a", universeId: "u", name: "Home Berth", tags: [] },
      { id: "loc-b", universeId: "u", name: "Rook Station", tags: [] },
    ],
    npcs: [{ id: "npc-ilyana", universeId: "u", name: "Ilyana", oneBreath: "A ledger-keeper." }] as Npc[],
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("evaluateTriggers", () => {
  it("opens the first chapter (an opener trigger) when nothing is active yet", () => {
    const res = evaluateTriggers(stub(), freshStorylineState(), state(), {}, []);
    expect(res.openedChapterId).toBe("ch-1");
    expect(res.storyline.chapters["ch-1"].status).toBe("active");
    expect(res.lines.some((l) => l.includes("New chapter"))).toBe(true);
  });

  it("opens at most ONE chapter per call (patient pacing) even if two would qualify", () => {
    const twoOpeners: PackStoryline = { chapters: [stub().chapters[0], { ...stub().chapters[1], trigger: {} }] };
    const res = evaluateTriggers(twoOpeners, freshStorylineState(), state(), {}, []);
    expect(Object.keys(res.storyline.chapters)).toHaveLength(1);
  });

  it("does not open ch-2 until ch-1 is complete (requires-chain)", () => {
    const afterCh1: StorylineState = { chapters: { "ch-1": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
    const res = evaluateTriggers(stub(), afterCh1, state(), {}, []);
    expect(res.openedChapterId).toBeUndefined();
  });

  it("opens ch-2 the moment ch-1 is marked complete", () => {
    const ready: StorylineState = { chapters: { "ch-1": { status: "complete", objectivesDone: ["o1", "o2"], deliveredBeatIds: ["b1", "b2"], openedAtTenday: 0 } } };
    const res = evaluateTriggers(stub(), ready, state(), {}, []);
    expect(res.openedChapterId).toBe("ch-2");
  });

  it("retrofit: a campaign already past a tenday/rep threshold opens on FIRST evaluation (no backfill needed)", () => {
    const gated: PackStoryline = {
      chapters: [
        {
          id: "ch-gated", act: 1, title: "Gated", trigger: { tendaysAtLeast: 5, factionRepAtLeast: { factionId: "f-crown", rep: 2 } },
          castNpcIds: [], objectives: [{ id: "o1", kind: "travel", summary: "Go", locationId: "loc-b" }], beats: [],
          reward: { credits: 10 },
        },
      ],
    };
    const notYet = evaluateTriggers(gated, freshStorylineState(), state({ tendaysElapsed: 3 }), {}, []);
    expect(notYet.openedChapterId).toBeUndefined();

    // The SAME campaign, already past both thresholds — as if the content shipped
    // AFTER the campaign got here. No migration, no backfill: it just opens.
    const pastDue = evaluateTriggers(
      gated, freshStorylineState(), state({ tendaysElapsed: 6 }, [{ campaignId: "c", factionId: "f-crown", rep: 2 }]), {}, [],
    );
    expect(pastDue.openedChapterId).toBe("ch-gated");
  });

  it("hasFact matches a substring against the facts ledger", () => {
    const gated: PackStoryline = {
      chapters: [{ id: "ch-fact", act: 1, title: "Fact-gated", trigger: { hasFact: "sided-crown" }, castNpcIds: [], objectives: [{ id: "o1", kind: "travel", summary: "Go", locationId: "loc-b" }], beats: [], reward: { credits: 10 } }],
    };
    const no = evaluateTriggers(gated, freshStorylineState(), state(), {}, [{ text: "unrelated fact", entityRefs: [] }]);
    expect(no.openedChapterId).toBeUndefined();
    const yes = evaluateTriggers(gated, freshStorylineState(), state(), {}, [{ text: "You sided-crown at the tribunal.", entityRefs: [] }]);
    expect(yes.openedChapterId).toBe("ch-fact");
  });

  it("trap 5: an active chapter removed from the pack is dropped with a log line, freeing the slate", () => {
    const orphaned: StorylineState = { chapters: { "ch-removed": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
    const res = evaluateTriggers(stub(), orphaned, state(), {}, []); // stub has no "ch-removed"
    expect(res.storyline.chapters["ch-removed"]).toBeUndefined();
    expect(res.lines.some((l) => l.includes("removed from the pack"))).toBe(true);
    // The slate is free again — ch-1 opens the SAME call.
    expect(res.openedChapterId).toBe("ch-1");
  });
});

describe("advanceStoryline", () => {
  const active = (over: Partial<StorylineState["chapters"][string]> = {}): StorylineState => ({
    chapters: { "ch-1": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0, ...over } },
  });

  it("advances one objective at a time, by id, in order — travel then report", () => {
    const s1 = turnSignals("loc-a", [], false, []);
    const noMove = advanceStoryline(stub(), active(), s1);
    expect(noMove.storyline.chapters["ch-1"].objectivesDone).toEqual([]);

    const arrived = turnSignals("loc-b", [], false, []);
    const afterTravel = advanceStoryline(stub(), active(), arrived);
    expect(afterTravel.storyline.chapters["ch-1"].objectivesDone).toEqual(["o1"]);
    expect(afterTravel.completed).toHaveLength(0); // o2 still pending

    // Arrival alone never satisfies "report" — presence is required too.
    const stillArrivedNoReport = advanceStoryline(stub(), afterTravel.storyline, arrived);
    expect(stillArrivedNoReport.storyline.chapters["ch-1"].objectivesDone).toEqual(["o1"]);

    const reported = turnSignals("loc-b", [], false, ["npc-ilyana"]);
    const afterReport = advanceStoryline(stub(), afterTravel.storyline, reported);
    expect(afterReport.storyline.chapters["ch-1"].objectivesDone).toEqual(["o1", "o2"]);
  });

  it("does NOT complete the chapter until the choicePoint is picked, even with every objective done", () => {
    const bothDone = active({ objectivesDone: ["o1", "o2"] });
    const res = advanceStoryline(stub(), bothDone, turnSignals("loc-b", [], false, ["npc-ilyana"]));
    expect(res.completed).toHaveLength(0);
    expect(res.storyline.chapters["ch-1"].status).toBe("active");
  });

  it("completes the chapter once the choice is recorded too", () => {
    const chosen = active({ objectivesDone: ["o1", "o2"], choiceOptionId: "crown" });
    const res = advanceStoryline(stub(), chosen, turnSignals("loc-b", [], false, ["npc-ilyana"]));
    expect(res.completed).toHaveLength(1);
    expect(res.completed[0].chapter.id).toBe("ch-1");
    expect(res.storyline.chapters["ch-1"].status).toBe("complete");
  });

  it("trap 5: an objective inserted mid-list never un-completes an already-done objective", () => {
    const withO1Done = active({ objectivesDone: ["o1"] });
    // An author inserts a NEW objective "o0" ahead of o1 in the pack array —
    // completion is tracked by ID, so o1's done-ness must survive untouched.
    const edited: PackStoryline = {
      chapters: [
        { ...stub().chapters[0], objectives: [{ id: "o0", kind: "travel", summary: "New step", locationId: "loc-a" }, ...stub().chapters[0].objectives] },
        stub().chapters[1],
      ],
    };
    const res = advanceStoryline(edited, withO1Done, turnSignals("loc-b", [], false, []));
    expect(res.storyline.chapters["ch-1"].objectivesDone).toContain("o1");
    // The NEXT undone objective is now o0 (array order), not o1 again.
    expect(res.storyline.chapters["ch-1"].objectivesDone).not.toContain("o0");
  });
});

describe("nextBeat + markBeatDelivered", () => {
  it("returns beats in order, then null once all are delivered (with no nudge due yet)", () => {
    const chaptersState: StorylineState = { chapters: { "ch-1": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
    const first = nextBeat(stub(), chaptersState, state().npcs, 0);
    expect(first?.beat.id).toBe("b1");

    const afterFirst = markBeatDelivered(chaptersState, first!, 0);
    const second = nextBeat(stub(), afterFirst, state().npcs, 0);
    expect(second?.beat.id).toBe("b2");

    const afterBoth = markBeatDelivered(afterFirst, second!, 0);
    expect(nextBeat(stub(), afterBoth, state().npcs, 1)).toBeNull(); // not enough tendays for a nudge yet
  });

  it("mortal-NPC rule: a dead aboutNpcId swaps in the fallbackDirective, still delivers", () => {
    const chaptersState: StorylineState = { chapters: { "ch-1": { status: "active", objectivesDone: [], deliveredBeatIds: ["b1"], openedAtTenday: 0 } } };
    const npcs = [{ id: "npc-ilyana", universeId: "u", name: "Ilyana", oneBreath: "x", status: "dead" }] as Npc[];
    const beat = nextBeat(stub(), chaptersState, npcs, 0);
    expect(beat?.beat.id).toBe("b2");
    expect(beat?.directive).toBe("A note from Ilyana's effects raises the same question.");
  });

  it("nudges after STORY_NUDGE_TENDAYS of silence once beats run out, and updates lastNudgeTenday", () => {
    const empty: PackStoryline = { chapters: [{ ...stub().chapters[0], beats: [] }] };
    const allBeatsGone: StorylineState = { chapters: { "ch-1": { status: "active", objectivesDone: ["o1"], deliveredBeatIds: [], openedAtTenday: 0 } } };
    expect(nextBeat(empty, allBeatsGone, [], 2)).toBeNull(); // only 2 tendays — too soon
    const nudge = nextBeat(empty, allBeatsGone, [], 3);
    expect(nudge?.isNudge).toBe(true);
    expect(nudge?.directive).toContain("Report to Ilyana"); // the still-pending o2 summary

    const afterNudge = markBeatDelivered(allBeatsGone, nudge!, 3);
    expect(afterNudge.chapters["ch-1"].lastNudgeTenday).toBe(3);
    // Cadence resets from the NEW lastNudgeTenday, not openedAtTenday.
    expect(nextBeat(empty, afterNudge, [], 5)).toBeNull();
    expect(nextBeat(empty, afterNudge, [], 6)?.isNudge).toBe(true);
  });

  it("returns null when there's no active chapter, or the active chapter id was dropped from the pack", () => {
    expect(nextBeat(stub(), freshStorylineState(), [], 0)).toBeNull();
    const orphan: StorylineState = { chapters: { "ch-gone": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
    expect(nextBeat(stub(), orphan, [], 0)).toBeNull();
  });
});

describe("recordChoice", () => {
  it("sets choiceOptionId and returns the picked option's fact", () => {
    const s: StorylineState = { chapters: { "ch-1": { status: "active", objectivesDone: ["o1", "o2"], deliveredBeatIds: [], openedAtTenday: 0 } } };
    const res = recordChoice(stub(), s, "ch-1", "crown");
    expect(res.storyline.chapters["ch-1"].choiceOptionId).toBe("crown");
    expect(res.fact).toBe("sided-crown");
  });

  it("degrades gracefully on an unknown chapter/option id — no crash, no fact", () => {
    const s: StorylineState = { chapters: { "ch-1": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
    expect(recordChoice(stub(), s, "ch-1", "not-a-real-option").fact).toBeUndefined();
    expect(recordChoice(stub(), s, "ch-nope", "crown").fact).toBeUndefined();
  });
});
