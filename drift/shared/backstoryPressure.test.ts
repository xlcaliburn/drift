import { describe, it, expect } from "vitest";
import type { CampaignState } from "./schemas";
import type { NpcRelations } from "./scene";
import { backstoryPressureDue, selectBackstoryBeat, BACKSTORY_PRESSURE_TENDAYS } from "./backstoryPressure";

function state(over: { ambition?: string; moralCode?: string } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Lyra", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
        ambition: over.ambition, moralCode: over.moralCode,
      },
    ],
    factions: [], factionRep: [], locations: [],
    npcs: [
      { id: "npc-rel-c-1", universeId: "u", name: "Cassia Thorne", oneBreath: "Sable contact." },
      { id: "npc-rel-c-2", universeId: "u", name: "Ivo Sarn", oneBreath: "Old mentor." },
      { id: "npc-patron-c", universeId: "u", name: "Quartermaster Vane", oneBreath: "Patron." },
    ],
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("backstoryPressureDue", () => {
  it("is not due at campaign start", () => {
    expect(backstoryPressureDue({ id: "c", universeId: "u", tendaysElapsed: 0 } as never)).toBe(false);
  });

  it("is due once enough tendays have passed since the last beat (or campaign start)", () => {
    expect(
      backstoryPressureDue({ id: "c", universeId: "u", tendaysElapsed: BACKSTORY_PRESSURE_TENDAYS } as never),
    ).toBe(true);
    expect(
      backstoryPressureDue({ id: "c", universeId: "u", tendaysElapsed: BACKSTORY_PRESSURE_TENDAYS - 1 } as never),
    ).toBe(false);
  });

  it("measures from the LAST beat, not always from zero", () => {
    const campaign = { id: "c", universeId: "u", tendaysElapsed: 10, lastBackstoryBeatTenday: 8 } as never;
    expect(backstoryPressureDue(campaign)).toBe(false); // only 2 tendays since
    expect(
      backstoryPressureDue({ id: "c", universeId: "u", tendaysElapsed: 12, lastBackstoryBeatTenday: 8 } as never),
    ).toBe(true); // 4 tendays since
  });
});

describe("selectBackstoryBeat", () => {
  it("picks the highest-disposition NPC tie over the always-available fallbacks", () => {
    const rels: NpcRelations = {
      "npc-rel-c-1": { relationship: "the Sable Chain agent she loves", disposition: 3, lastNote: "Loves her for herself." },
      "npc-rel-c-2": { relationship: "the mentor who vouched for you", disposition: 1 },
    };
    const beat = selectBackstoryBeat(state({ ambition: "freedom", moralCode: "no cargo left behind" }), rels);
    expect(beat).toEqual({ kind: "npc", npcId: "npc-rel-c-1", npcName: "Cassia Thorne", note: "Loves her for herself." });
  });

  it("excludes an NPC already present in the scene", () => {
    const rels: NpcRelations = {
      "npc-rel-c-1": { relationship: "the Sable Chain agent she loves", disposition: 3 },
      "npc-rel-c-2": { relationship: "the mentor who vouched for you", disposition: 1 },
    };
    const beat = selectBackstoryBeat(state(), rels, ["npc-rel-c-1"]);
    expect(beat?.kind).toBe("npc");
    if (beat?.kind === "npc") expect(beat.npcId).toBe("npc-rel-c-2");
  });

  it("never anchors on the patron — it runs its own presence system", () => {
    const rels: NpcRelations = {
      "npc-patron-c": { relationship: "your patron", disposition: 1 },
    };
    const beat = selectBackstoryBeat(state({ ambition: "wealth" }), rels);
    expect(beat).toEqual({ kind: "ambition", label: "Wealth", description: "Enough credits to never take orders again." });
  });

  it("falls back to ambition when there is no NPC tie", () => {
    const beat = selectBackstoryBeat(state({ ambition: "revenge" }), {});
    expect(beat).toEqual({ kind: "ambition", label: "Revenge", description: "Someone owes a debt in blood or ruin." });
  });

  it("falls back to moral code when there is no NPC tie or ambition", () => {
    const beat = selectBackstoryBeat(state({ moralCode: "I don't leave people to die alone in the dark." }), {});
    expect(beat).toEqual({ kind: "moralCode", text: "I don't leave people to die alone in the dark." });
  });

  it("returns null when nothing at all is available (never throws)", () => {
    expect(selectBackstoryBeat(state(), {})).toBeNull();
  });

  it("is deterministic — ties break on id, not insertion order", () => {
    const rels: NpcRelations = {
      "npc-rel-c-2": { relationship: "the mentor who vouched for you", disposition: 2 },
      "npc-rel-c-1": { relationship: "the Sable Chain agent she loves", disposition: 2 },
    };
    const beat = selectBackstoryBeat(state(), rels);
    expect(beat?.kind).toBe("npc");
    if (beat?.kind === "npc") expect(beat.npcId).toBe("npc-rel-c-1"); // alphabetically first
  });
});
