import { describe, it, expect, vi } from "vitest";

// server-only is a no-op shim in tests (matches lib/creationPrewarm.test.ts).
vi.mock("server-only", () => ({}));

import type { CampaignState } from "@/shared/schemas";
import type { NpcAnalysis } from "@/llm/summarizer";
import { freshSceneCard } from "@/shared/scene";
import { applyAnalystUpdates } from "./analystRun";
import type { SessionData } from "./state";

function state(npcs: CampaignState["npcs"] = []): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-rook", tendaysElapsed: 0 },
    universe: { id: "u", name: "Drift" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Cali", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false, credits: 0,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [
      { id: "f-crown", universeId: "u", name: "Hollow Crown" },
      { id: "f-sable", universeId: "u", name: "Sable Chain" },
    ],
    factionRep: [], locations: [], npcs, clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

function session(npcs: CampaignState["npcs"] = []): SessionData {
  return {
    state: state(npcs),
    history: [],
    transcript: [],
    log: [],
    scenes: [],
    focusIds: [],
    tickedThisScene: [],
    combat: null,
    sceneCard: freshSceneCard(),
    npcRelations: {},
    recentScenes: [],
    lastChoices: [],
    jobs: [],
    playerLedger: {},
    facts: [],
  } as unknown as SessionData;
}

describe("applyAnalystUpdates — faction backstop (HANDOFF_NPC_CANON Task B)", () => {
  it("pins a KNOWN npc's factionId from the analyst", async () => {
    const live = session([{ id: "npc-gen-sera-1", universeId: "u", name: "Sera", oneBreath: "Runs the dock kiosk." }]);
    const updates: NpcAnalysis[] = [{ id: "npc-gen-sera-1", factionId: "f-crown" }];
    const changed = await applyAnalystUpdates(live, updates, [], [], []);
    expect(changed).toBe(true);
    expect(live.state.npcs.find((n) => n.id === "npc-gen-sera-1")?.factionId).toBe("f-crown");
  });

  it("SET-ONCE: never overwrites an existing factionId (allegiance changes are out of scope)", async () => {
    const live = session([
      { id: "npc-gen-sera-1", universeId: "u", name: "Sera", oneBreath: "Runs the dock kiosk.", factionId: "f-sable" },
    ]);
    const updates: NpcAnalysis[] = [{ id: "npc-gen-sera-1", factionId: "f-crown" }];
    await applyAnalystUpdates(live, updates, [], [], []);
    expect(live.state.npcs.find((n) => n.id === "npc-gen-sera-1")?.factionId).toBe("f-sable"); // untouched
  });

  it("a NEWLY-registered figure (no known id) does NOT get a faction pinned this pass", async () => {
    const live = session([]);
    const updates: NpcAnalysis[] = [{ name: "Doss", oneBreath: "A new dockhand.", factionId: "f-crown" }];
    await applyAnalystUpdates(live, updates, [], [], []);
    const doss = live.state.npcs.find((n) => n.name === "Doss");
    expect(doss).toBeTruthy(); // still registered
    expect(doss?.factionId).toBeUndefined(); // but NOT faction-pinned on the same pass
  });

  it("no-ops when the update carries no factionId", async () => {
    const live = session([{ id: "npc-gen-sera-1", universeId: "u", name: "Sera", oneBreath: "Runs the dock kiosk." }]);
    await applyAnalystUpdates(live, [{ id: "npc-gen-sera-1", note: "Chatted about the weather." }], [], [], []);
    expect(live.state.npcs.find((n) => n.id === "npc-gen-sera-1")?.factionId).toBeUndefined();
  });
});

describe("applyAnalystUpdates — scene PLACE backstop (HANDOFF_PLAYTEST_POLISH_2.md)", () => {
  it("applies the corrected place when the live scene seq matches expectedSeq (mid-scene pass)", async () => {
    const live = session([]); // freshSceneCard() default seq = 1
    const changed = await applyAnalystUpdates(live, [], [], [], [], {
      place: "Halcyon — dockside, outside Quist's office",
      expectedSeq: 1,
    });
    expect(changed).toBe(true);
    expect(live.sceneCard.place).toBe("Halcyon — dockside, outside Quist's office");
  });

  it("drops the place update when the live scene has moved on (seq mismatch)", async () => {
    const live = session([]);
    live.sceneCard = { ...live.sceneCard, seq: 3, place: "current place" };
    const changed = await applyAnalystUpdates(live, [], [], [], [], {
      place: "a stale correction for an old scene",
      expectedSeq: 1,
    });
    expect(changed).toBe(false);
    expect(live.sceneCard.place).toBe("current place"); // untouched
  });

  it("close-pass semantics: expectedSeq = closedSeq + 1 (the NEW carried-forward card)", async () => {
    // Scene 2 just closed; carryScene already built scene 3 as the live card
    // (this is exactly the card that stale-carried the OLD place forward).
    const live = session([]);
    live.sceneCard = { ...live.sceneCard, seq: 3, place: "stale — high orbit, aboard the shuttle" };
    const closedSeq = 2;
    const changed = await applyAnalystUpdates(live, [], [], [], [], {
      place: "Halcyon — dockside",
      expectedSeq: closedSeq + 1,
    });
    expect(changed).toBe(true);
    expect(live.sceneCard.place).toBe("Halcyon — dockside");
  });

  it("a place update alone (no npc/item/thread/fact changes) still reports changed:true", async () => {
    const live = session([]);
    const changed = await applyAnalystUpdates(live, [], [], [], [], { place: "somewhere new", expectedSeq: 1 });
    expect(changed).toBe(true);
  });

  it("no placeUpdate + no other updates is a true no-op", async () => {
    const live = session([]);
    const changed = await applyAnalystUpdates(live, [], [], [], []);
    expect(changed).toBe(false);
    expect(live.sceneCard.place).toBeUndefined();
  });
});
