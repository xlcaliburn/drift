import { describe, it, expect } from "vitest";
import type { CampaignState } from "./schemas";
import type { NpcRelations } from "./scene";
import { matchCastCasualty, markNpcFate, applyCombatDeaths } from "./npcFate";

function state(): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [
      { id: "pc-1", kind: "pc", name: "Vess Karo" },
      { id: "crew-1", kind: "party", name: "Josen" },
    ],
    factions: [], factionRep: [], locations: [],
    npcs: [
      { id: "npc-gen-calvo-3", universeId: "u", name: "Calvo", oneBreath: "Dock boss." },
      { id: "npc-gen-ren-fixer-30", universeId: "u", name: "Ren (fixer)", oneBreath: "Rust Anchor fixer." },
      { id: "npc-gen-mara-9", universeId: "u", name: "Mara", oneBreath: "Already dead.", status: "dead" },
    ],
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("matchCastCasualty — which cast member a combat enemy name refers to", () => {
  it("matches a named cast NPC exactly (case-insensitive)", () => {
    expect(matchCastCasualty("calvo", state())?.id).toBe("npc-gen-calvo-3");
  });

  it("matches through a name-collision '(role)' suffix in either direction", () => {
    expect(matchCastCasualty("Ren", state())?.id).toBe("npc-gen-ren-fixer-30");
    expect(matchCastCasualty("Ren (fixer)", state())?.id).toBe("npc-gen-ren-fixer-30");
  });

  it("NEVER matches the player's characters or crew (they fight as characters)", () => {
    expect(matchCastCasualty("Vess Karo", state())).toBeUndefined();
    expect(matchCastCasualty("Josen", state())).toBeUndefined();
  });

  it("generic mook names match nobody; the already-dead are skipped", () => {
    expect(matchCastCasualty("Thug", state())).toBeUndefined();
    expect(matchCastCasualty("Heavy 2", state())).toBeUndefined();
    expect(matchCastCasualty("Mara", state())).toBeUndefined(); // already gone — no double-kill
  });
});

describe("markNpcFate — the single fate write path", () => {
  it("sets status and stamps the relation log + lastNote (People panel shows WHY)", () => {
    const rels: NpcRelations = {};
    const next = markNpcFate(state(), rels, "npc-gen-calvo-3", "dead", "Killed in the fight at Dock 14.", 5);
    expect(next.npcs.find((n) => n.id === "npc-gen-calvo-3")?.status).toBe("dead");
    expect(rels["npc-gen-calvo-3"].lastNote).toBe("Killed in the fight at Dock 14.");
    expect(rels["npc-gen-calvo-3"].log?.at(-1)).toEqual({ note: "Killed in the fight at Dock 14.", scene: 5 });
  });

  it("no-ops on an unknown id", () => {
    const s = state();
    expect(markNpcFate(s, {}, "npc-nope", "dead", "x")).toBe(s);
  });
});

describe("applyCombatDeaths — fight's over, record the casualties", () => {
  it("marks matching cast NPCs dead with a place-stamped note; ignores mooks", () => {
    const rels: NpcRelations = {};
    const r = applyCombatDeaths({
      state: state(),
      npcRelations: rels,
      deadEnemyNames: ["Calvo", "Thug", "Heavy 1"],
      place: "Rook Station — the Undertow desk",
      sceneSeq: 7,
    });
    expect(r.deadNames).toEqual(["Calvo"]);
    expect(r.state.npcs.find((n) => n.name === "Calvo")?.status).toBe("dead");
    expect(rels["npc-gen-calvo-3"].lastNote).toMatch(/Killed in the fight at Rook Station/);
    // Everyone else untouched.
    expect(r.state.npcs.find((n) => n.name === "Ren (fixer)")?.status).toBeUndefined();
  });

  it("returns state unchanged when nobody named fell", () => {
    const s = state();
    const r = applyCombatDeaths({ state: s, npcRelations: {}, deadEnemyNames: ["Thug", "Raider 2"] });
    expect(r.deadNames).toEqual([]);
    expect(r.state).toBe(s);
  });
});
