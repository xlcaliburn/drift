import { describe, it, expect } from "vitest";
import type { CampaignState } from "./schemas";
import { seededRng } from "@/engine/rng";
import { resolveJobsTurn, applyJobClick } from "./jobsRuntime";
import type { Job } from "./quests";

function state(over: { credits?: number; currentLocationId?: string; rep?: CampaignState["factionRep"] } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: over.currentLocationId ?? "loc-a", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        credits: over.credits ?? 100,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [{ id: "f-crown", universeId: "u", name: "The Crown" }],
    factionRep: over.rep ?? [],
    locations: [
      { id: "loc-a", universeId: "u", name: "Home Berth", tags: [] },
      { id: "loc-b", universeId: "u", name: "Rook Station", tags: [] },
    ],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const deliverJob = (over: Partial<Job["reward"]> = {}): Job => ({
  id: "j1", title: "Courier run", blurb: "", giver: "board", playstyle: "commerce", archetype: "courier", tier: "T1",
  objectives: [{ id: "o1", kind: "deliver", summary: "Haul it to Rook", done: false, locationId: "loc-b" }],
  cast: [], reward: { tier: "T1", ...over }, status: "active", createdTenday: 0,
});

describe("resolveJobsTurn", () => {
  it("pays credits into the PC when a job completes on arrival", () => {
    const s = state({ currentLocationId: "loc-b", credits: 100 });
    const r = resolveJobsTurn({ state: s, jobs: [deliverJob()], events: [], combatResolvedAlive: false, rng: seededRng(1) });
    const pc = r.state.characters.find((c) => c.kind === "pc")!;
    expect(pc.credits).toBeGreaterThan(100);
    expect(r.events.some((e) => e.type === "resource" && e.field === "credits")).toBe(true);
    expect(r.lines.some((l) => /Reward paid/.test(l))).toBe(true);
    expect(r.jobs.find((j) => j.id === "j1")!.status).toBe("complete");
  });

  it("bumps faction rep when the reward carries one, creating the row if absent", () => {
    const s = state({ currentLocationId: "loc-b" });
    const r = resolveJobsTurn({
      state: s, jobs: [deliverJob({ repFactionId: "f-crown", repDelta: 1 })],
      events: [], combatResolvedAlive: false, rng: seededRng(2),
    });
    const rep = r.state.factionRep.find((x) => x.factionId === "f-crown")!;
    expect(rep.rep).toBe(1);
  });

  it("does NOT pay when the objective isn't met, and tops the offered board up", () => {
    const s = state({ currentLocationId: "loc-a" }); // not at the drop
    const r = resolveJobsTurn({ state: s, jobs: [deliverJob()], events: [], combatResolvedAlive: false, rng: seededRng(3) });
    const pc = r.state.characters.find((c) => c.kind === "pc")!;
    expect(pc.credits).toBe(100);
    expect(r.jobs.find((j) => j.id === "j1")!.status).toBe("active");
    expect(r.jobs.filter((j) => j.status === "offered")).toHaveLength(4);
  });
});

describe("personal-job arc resolution", () => {
  const personalJob = (): Job => ({
    id: "pj1", title: "Kessa — a personal favor", blurb: "wants a ship of her own", giver: "npc-gen-kessa",
    playstyle: "commerce", archetype: "courier", tier: "T1",
    objectives: [{ id: "o1", kind: "deliver", summary: "Haul it to Rook", done: false, locationId: "loc-b" }],
    cast: [], reward: { tier: "T1" }, status: "active", createdTenday: 0,
  });

  it("resolves the giver NPC's arc + bumps disposition when a personal job completes", () => {
    const s = state({ currentLocationId: "loc-b" });
    (s.npcs as { id: string; name: string }[]).push({ id: "npc-gen-kessa", name: "Kessa" });
    const rels = { "npc-gen-kessa": { disposition: 2, arcStage: "active" as const } };
    const r = resolveJobsTurn({
      state: s, jobs: [personalJob()], events: [], combatResolvedAlive: false, rng: seededRng(9), npcRelations: rels,
    });
    const rel = r.npcRelations["npc-gen-kessa"];
    expect(rel.arcStage).toBe("resolved");
    expect(rel.arcNote).toBeTruthy();
    expect(rel.disposition).toBe(3); // +2 → +3, clamped at ally
    expect(r.lines.some((l) => /bond deepened/.test(l))).toBe(true);
  });

  it("leaves board-job completion relations untouched", () => {
    const s = state({ currentLocationId: "loc-b" });
    const rels = { "npc-gen-kessa": { disposition: 2 } };
    const r = resolveJobsTurn({ state: s, jobs: [deliverJob()], events: [], combatResolvedAlive: false, rng: seededRng(1), npcRelations: rels });
    expect(r.npcRelations["npc-gen-kessa"].disposition).toBe(2);
    expect(r.npcRelations["npc-gen-kessa"].arcStage).toBeUndefined();
  });
});

describe("applyJobClick", () => {
  it("accept moves an offered job to active and keeps the board full", () => {
    const board = applyJobClick(state(), [], {}, seededRng(4)); // seed a board
    const offered = board.find((j) => j.status === "offered")!;
    const after = applyJobClick(state(), board, { acceptJobId: offered.id }, seededRng(5));
    expect(after.find((j) => j.id === offered.id)!.status).toBe("active");
    expect(after.filter((j) => j.status === "offered")).toHaveLength(4);
  });
});
