import { describe, it, expect } from "vitest";
import { buildContextSlice, buildJsonSystem, retrieveEntities } from "./promptBuilder";
import { buildCampaignState } from "@/engine/__fixtures__/vessCampaign";
import type { CampaignState } from "@/shared/schemas";
import type { Dossier } from "@/shared/multiplayer";
import type { SceneCard, NpcRelations, SceneMemory } from "@/shared/scene";

/**
 * GOLDEN SNAPSHOT of buildContextSlice / buildJsonSystem across a spread of
 * configs. This pins the EXACT prompt bytes before the promptBuilder → sections
 * refactor (REFACTOR.md Plan 1) so any code motion that changes output fails
 * loudly. Not a behavior spec — purely a freeze of today's output. If a real
 * prompt change lands later, run with -u to re-bless.
 */

function clone(s: CampaignState): CampaignState {
  return structuredClone(s);
}

/** Resolve N threads so the state graduates out of the tutorial. */
function graduate(s: CampaignState): CampaignState {
  let n = 0;
  s.threads = s.threads.map((t) => (t.status === "active" && n++ < 2 ? { ...t, status: "resolved" } : t));
  return s;
}

const memory: { sceneCard?: SceneCard; npcRelations?: NpcRelations; recentScenes?: SceneMemory[] } = {
  sceneCard: {
    seq: 4,
    turnCount: 3,
    place: "Meridian Ring — the broker's back office",
    situation: "The broker is counting out the cargo manifest",
    beats: ["Broker promised the run pays on delivery to Rook"],
    dangers: ["a Sable Chain watcher two tables over"],
    presentNpcIds: ["npc-broker"],
    startTranscriptIdx: 0,
  },
  npcRelations: {
    "npc-broker": {
      relationship: "your first standing contract",
      disposition: 2,
      nameKnown: true,
      lastNote: "Fronted the cargo on trust; expects a clean Rook delivery.",
      lastSceneSeq: 3,
      log: [
        { note: "Gave you the first standing contract.", scene: 1 },
        { note: "Fronted the Rook cargo on trust.", scene: 3 },
      ],
    },
  },
  recentScenes: [
    { seq: 1, title: "The escort delivered", summary: "Convoy reached Meridian intact under Sable eyes.", entityRefs: ["f-sable"] },
    { seq: 2, title: "Manifest signed", summary: "The broker fronted the Rook cargo on trust.", entityRefs: ["npc-broker", "loc-rook"] },
  ] as SceneMemory[],
};

const dossiers: Dossier[] = [
  {
    campaignId: "camp-other",
    universeId: "uni-drift",
    name: "Rax Dellow",
    factionId: "f-sable",
    capabilityTier: "T2",
    locationId: "loc-meridian",
    alive: true,
    role: "Sable enforcer working the ring",
    voiceNotes: "clipped, menacing",
    reputation: "known breaker of legs",
    deeds: [{ headline: "torched a Crown depot" }, { headline: "put a courier in the med-bay" }],
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Dossier,
];

/** A slimmed, genuinely-broke rookie WITH a present patron → patron eligible. */
function patronEligible(): CampaignState {
  const s = clone(buildCampaignState());
  const pc = s.characters.find((c) => c.kind === "pc")!;
  pc.credits = 30;
  pc.gear = [{ name: "Sidearm", damage: "1d8" }];
  s.ship = undefined;
  s.threads = [{ id: "th-ship-camp-vess", campaignId: "camp-vess", title: "The loaner", body: "", status: "active", entityRefs: [] }];
  s.npcs = [
    ...s.npcs,
    { id: "npc-patron-camp-vess", universeId: "uni-drift", name: "Steward Harrow", oneBreath: "Your Meridian patron.", role: "trade-house steward", locationId: "loc-meridian" },
  ];
  return s;
}

const CONFIGS: { label: string; run: () => string }[] = [
  {
    label: "tutorial + jsonMode + full memory + dossiers (names an NPC)",
    run: () => {
      const s = buildCampaignState();
      return buildContextSlice(s, "ask the broker about the Rook run", ["npc-broker"], undefined, true, memory, dossiers);
    },
  },
  {
    label: "graduated (out of tutorial) + jsonMode",
    run: () => {
      const s = graduate(clone(buildCampaignState()));
      return buildContextSlice(s, "head for the Rook lanes", [], undefined, true, memory, dossiers);
    },
  },
  {
    label: "tool-mode (jsonMode=false) ids line",
    run: () => {
      const s = buildCampaignState();
      return buildContextSlice(s, "look around", [], undefined, false);
    },
  },
  {
    label: "no ship (grounded)",
    run: () => {
      const s = clone(buildCampaignState());
      s.ship = undefined;
      return buildContextSlice(s, "look around", [], undefined, true);
    },
  },
  {
    label: "with directive set",
    run: () => {
      const s = clone(buildCampaignState());
      s.campaign = { ...s.campaign, directive: "get close to people and dig into who they really are" };
      return buildContextSlice(s, "chat with the broker", [], undefined, true);
    },
  },
  {
    label: "downed PC",
    run: () => {
      const s = clone(buildCampaignState());
      const pc = s.characters.find((c) => c.kind === "pc")!;
      pc.hp = 0;
      pc.injuries = [{ name: "Downed", effect: "critical — bleeding out" }];
      pc.deathSaves = { successes: 1, failures: 2 };
      return buildContextSlice(s, "hold on", [], undefined, true);
    },
  },
  {
    label: "patron eligible (broke rookie, patron present)",
    run: () => {
      const s = patronEligible();
      // Mirror the live turn: presentNpcIds are folded into focusIds before retrieval
      // (jsonTurn's focusWithPresent), so a PRESENT patron still surfaces as [immediate].
      // The patron no longer surfaces by bare co-location alone (retrieval/proximity fix).
      return buildContextSlice(s, "rest up", ["npc-patron-camp-vess"], undefined, true, {
        sceneCard: { seq: 1, turnCount: 1, situation: "", beats: [], presentNpcIds: ["npc-patron-camp-vess"], startTranscriptIdx: 0 },
      });
    },
  },
  {
    label: "dock repair + debt (damaged hull, negative credits)",
    run: () => {
      const s = clone(buildCampaignState());
      const pc = s.characters.find((c) => c.kind === "pc")!;
      pc.credits = -140;
      return buildContextSlice(s, "patch up the hull", [], undefined, true);
    },
  },
];

describe("golden — buildContextSlice output is byte-stable across configs", () => {
  for (const cfg of CONFIGS) {
    it(cfg.label, () => {
      expect(cfg.run()).toMatchSnapshot();
    });
  }
});

describe("golden — buildJsonSystem blocks", () => {
  it("system blocks (style contract + universe primer)", () => {
    const s = buildCampaignState();
    expect(buildJsonSystem(s).map((b) => b.text)).toMatchSnapshot();
  });
});

describe("golden — retrieveEntities selection", () => {
  it("names an NPC → surfaces it + threads", () => {
    const s = buildCampaignState();
    const r = retrieveEntities(s, "find Ilyana about the Crown work", []);
    expect({
      npcs: r.npcs.map((n) => n.id),
      threads: r.threads.map((t) => t.id),
      namedNpcIds: r.namedNpcIds,
    }).toMatchSnapshot();
  });
});
