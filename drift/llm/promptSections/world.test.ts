import { describe, it, expect, vi } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { SectionCtx } from "./types";

/** HANDOFF_STORY_2.md Task A: the npcs section's hook line must prefer
 *  authored cast depth over the persisted/generated backstory. The live pack
 *  ships zero authored depth this slice (trap 4), so the precedence logic
 *  itself is proven here against a mocked `authoredCastDepth` rather than
 *  the real (empty) pack — content/pack/pack.test.ts covers the real
 *  builder's own behavior (dormant + keying) directly. vi.mock is hoisted
 *  above the static import below, so `npcs` resolves against the mock. */
vi.mock("@/content/pack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/content/pack")>();
  return {
    ...actual,
    authoredCastDepth: (id: string) =>
      id === "npc-authored" ? { backstory: "AUTHORED: a spoiler-safe hook" } : undefined,
  };
});

import { npcs } from "./world";

function state(): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [], factionRep: [],
    factions: [],
    locations: [{ id: "loc-a", universeId: "u", name: "Rook Station", tags: [] }],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

function npc(over: Partial<CampaignState["npcs"][number]> = {}): CampaignState["npcs"][number] {
  return { id: "npc-x", universeId: "u", name: "Someone", oneBreath: "A person.", ...over };
}

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

describe("npcs — authored backstory overlay (HANDOFF_STORY_2.md Task A)", () => {
  it("an authored backstory wins the hook line over the persisted one", () => {
    const present = npc({ id: "npc-authored", backstory: "generated fallback text" });
    const lines = npcs(ctx({ npcs: [present], memory: { sceneCard: { presentNpcIds: ["npc-authored"] } as never } }));
    const text = lines.join("\n");
    expect(text).toContain("[hook: AUTHORED: a spoiler-safe hook]");
    expect(text).not.toContain("generated fallback text");
  });

  it("falls back to the persisted backstory exactly as before when there's no authored depth", () => {
    const present = npc({ id: "npc-plain", backstory: "the old generated hook" });
    const lines = npcs(ctx({ npcs: [present], memory: { sceneCard: { presentNpcIds: ["npc-plain"] } as never } }));
    expect(lines.join("\n")).toContain("[hook: the old generated hook]");
  });

  it("no hook line at all when absent — neither authored nor persisted", () => {
    const present = npc({ id: "npc-bare" });
    const lines = npcs(ctx({ npcs: [present], memory: { sceneCard: { presentNpcIds: ["npc-bare"] } as never } }));
    expect(lines.join("\n")).not.toContain("[hook:");
  });

  it("the hook only renders for PRESENT npcs, even with authored depth available", () => {
    const notPresent = npc({ id: "npc-authored" });
    const lines = npcs(ctx({ npcs: [notPresent], memory: { sceneCard: { presentNpcIds: [] } as never } }));
    expect(lines.join("\n")).not.toContain("[hook:");
  });
});
