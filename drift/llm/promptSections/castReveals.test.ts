import { describe, it, expect, vi } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { SectionCtx } from "./types";
import type { StorylineState } from "@/shared/storyline";

/** HANDOFF_STORY_2.md Task B: castReveals gates a storyline NPC's authored
 *  secret/arc to (active chapter ∧ cast member ∧ present) — all engine
 *  facts, never model discretion. The live pack ships zero chapters and
 *  zero authored depth this slice, so the gating logic is proven here
 *  against a mocked pack.storyline + authoredCastDepth. */
const { CHAPTER } = vi.hoisted(() => ({
  CHAPTER: {
    id: "ch-1",
    act: 2,
    title: "The Ledger",
    trigger: {},
    castNpcIds: ["npc-ilyana", "npc-broker", "npc-osk"],
    objectives: [{ id: "o1", kind: "travel", summary: "Go", locationId: "loc-a" }],
    beats: [],
    reward: { credits: 0 },
  },
}));

vi.mock("@/content/pack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/content/pack")>();
  return {
    ...actual,
    pack: { ...actual.pack, storyline: { chapters: [CHAPTER] } },
    authoredCastDepth: (id: string) => {
      if (id === "npc-ilyana") return { secret: "Ilyana forged the manifest.", arc: ["act1 line", "act2 line", "act3 line"] };
      if (id === "npc-broker") return { arc: ["broker act1"] }; // no secret, arc too short for act2
      return undefined;
    },
  };
});

import { castReveals } from "./castReveals";

function state(): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [], factionRep: [], factions: [],
    locations: [{ id: "loc-a", universeId: "u", name: "Dock", tags: [] }],
    npcs: [
      { id: "npc-ilyana", universeId: "u", name: "Ilyana", oneBreath: "x" },
      { id: "npc-broker", universeId: "u", name: "The Broker", oneBreath: "x" },
      { id: "npc-osk", universeId: "u", name: "Foreman Osk", oneBreath: "x" },
    ],
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

function activeStoryline(): StorylineState {
  return { chapters: { "ch-1": { status: "active", objectivesDone: [], deliveredBeatIds: [], openedAtTenday: 0 } } };
}

function ctx(over: Partial<SectionCtx> = {}): SectionCtx {
  return {
    state: state(),
    playerText: "",
    focusIds: [],
    jsonMode: false,
    npcs: [],
    threads: [],
    ...over,
  };
}

describe("castReveals — chapter-gated secret/arc (HANDOFF_STORY_2.md Task B)", () => {
  it("renders a present cast member's secret when their chapter is ACTIVE", () => {
    const lines = castReveals(ctx({ storyline: activeStoryline(), memory: { sceneCard: { presentNpcIds: ["npc-ilyana"] } as never } }));
    const text = lines.join("\n");
    expect(text).toContain("Ilyana forged the manifest.");
  });

  it("NOT present → no reveal, even with an active chapter and authored secret", () => {
    const lines = castReveals(ctx({ storyline: activeStoryline(), memory: { sceneCard: { presentNpcIds: [] } as never } }));
    expect(lines).toEqual([]);
  });

  it("no active chapter → nothing at all, even if the NPC is present", () => {
    const lines = castReveals(ctx({ storyline: { chapters: {} }, memory: { sceneCard: { presentNpcIds: ["npc-ilyana"] } as never } }));
    expect(lines).toEqual([]);
  });

  it("present but NOT in this chapter's cast → no reveal", () => {
    const lines = castReveals(ctx({ storyline: activeStoryline(), memory: { sceneCard: { presentNpcIds: ["npc-stranger"] } as never } }));
    expect(lines).toEqual([]);
  });

  it("no storyline slice at all → []", () => {
    expect(castReveals(ctx({ memory: { sceneCard: { presentNpcIds: ["npc-ilyana"] } as never } }))).toEqual([]);
  });

  it("arc picks by ACT (chapter.act - 1), and is silently omitted when the array is too short", () => {
    const lines = castReveals(ctx({ storyline: activeStoryline(), memory: { sceneCard: { presentNpcIds: ["npc-ilyana", "npc-broker"] } as never } }));
    const text = lines.join("\n");
    expect(text).toContain("act2 line"); // Ilyana, act 2 (chapter.act=2 → arc[1])
    expect(text).not.toContain("act1 line"); // NOT act 1's line
    expect(text).not.toContain("broker act1"); // broker's arc has no index 1 (only act1 at index 0)
  });

  it("a present cast member with no authored depth at all contributes nothing, without crashing", () => {
    const lines = castReveals(ctx({ storyline: activeStoryline(), memory: { sceneCard: { presentNpcIds: ["npc-osk"] } as never } }));
    expect(lines).toEqual([]);
  });
});
