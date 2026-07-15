import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { AdminOp, applyAdminOp, type EditableSlices } from "./adminEdit";
import { freshSceneCard } from "@/shared/scene";

function pc(over: Record<string, unknown> = {}) {
  return {
    id: "pc-1", campaignId: "c", kind: "pc", name: "Silas",
    attributes: { might: 1, reflex: 2, vitality: 0, intellect: 0, perception: 0, presence: 0 },
    hp: 8, maxHp: 19, ac: 12, stims: 0, fragile: false, credits: 100,
    skills: [], actionModifiers: {}, gear: [], injuries: [],
    ...over,
  };
}

function slices(over: Record<string, unknown> = {}, rest: Partial<EditableSlices> = {}): EditableSlices {
  return {
    state: {
      universe: { id: "u", name: "U" },
      campaign: { id: "c", universeId: "u", name: "Silas", status: "active", tendaysElapsed: 0 },
      characters: [pc()],
      factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
      ...over,
    } as unknown as CampaignState,
    history: [],
    transcript: [],
    combat: null,
    sceneCard: freshSceneCard(),
    npcRelations: {},
    recentScenes: [],
    lastChoices: [],
    tickedThisScene: [],
    ...rest,
  };
}

const parse = (o: unknown) => AdminOp.parse(o);

describe("AdminOp schema", () => {
  it("round-trips a valid character op and rejects an unknown op", () => {
    expect(parse({ op: "endCombat" })).toEqual({ op: "endCombat" });
    expect(() => parse({ op: "nuke" })).toThrow();
  });
  it("enforces scene/relation caps", () => {
    expect(() => parse({ op: "npcRelations", value: { x: { disposition: 9 } } })).toThrow(); // > +3
    expect(() =>
      parse({ op: "sceneCard", value: { seq: 1, turnCount: 0, presentNpcIds: [], situation: "x", beats: ["a", "b", "c", "d", "e", "f", "g"], startTranscriptIdx: 0 } }),
    ).toThrow(); // > MAX_BEATS
  });
});

describe("applyAdminOp — character", () => {
  it("clamps hp, strips Downed when healed, derives AC from gear", () => {
    const s = slices({ characters: [pc({ hp: 0, injuries: [{ name: "Downed", effect: "x" }] })] });
    const op = parse({ op: "character", value: pc({ hp: 30, gear: [{ name: "Vest", detail: "+2 AC", acBonus: 2 }] }) });
    const r = applyAdminOp(s, op);
    const c = r.slices.state.characters[0];
    expect(c.hp).toBe(19); // clamped to maxHp
    expect(c.injuries).toEqual([]); // Downed stripped
    expect(c.ac).toBe(10 + 2 + 2); // 10 + reflex(2) + best armor(2)
  });
  it("keeps campaignId/kind immutable when the id matches", () => {
    const op = parse({ op: "character", value: pc({ campaignId: "other", kind: "party" }) });
    const c = applyAdminOp(slices(), op).slices.state.characters[0];
    expect([c.id, c.campaignId, c.kind]).toEqual(["pc-1", "c", "pc"]);
  });
  it("honors an explicit AC change over the derived value", () => {
    const op = parse({ op: "character", value: pc({ ac: 20 }) });
    expect(applyAdminOp(slices(), op).slices.state.characters[0].ac).toBe(20);
  });
});

describe("applyAdminOp — revive / combat / choices", () => {
  it("revive strips Downed+Dead, floors HP at 1, un-deceases, clears deathSaves via followup", () => {
    const s = slices(
      { characters: [pc({ hp: 0, injuries: [{ name: "Dead", effect: "x" }], deathSaves: { successes: 0, failures: 3 } })], campaign: { id: "c", universeId: "u", name: "Silas", status: "deceased", tendaysElapsed: 0 } as never },
      { lastChoices: [{ label: "old" }] },
    );
    const r = applyAdminOp(s, parse({ op: "revive" }));
    const c = r.slices.state.characters[0];
    expect(c.injuries).toEqual([]);
    expect(c.hp).toBe(1);
    expect(c.deathSaves).toBeUndefined();
    expect(r.slices.state.campaign.status).toBe("active");
    expect(r.slices.lastChoices).toEqual([]);
    expect(r.followups).toContainEqual({ kind: "clearDeathSaves", characterId: "pc-1" });
  });
  it("endCombat nulls combat and clears choices", () => {
    const r = applyAdminOp(slices({}, { combat: { active: true } as never, lastChoices: [{ label: "x" }] }), parse({ op: "endCombat" }));
    expect(r.slices.combat).toBeNull();
    expect(r.slices.lastChoices).toEqual([]);
  });
});

describe("applyAdminOp — npcs / threads followups", () => {
  it("deleteNpcs strips cast+relations and only deletes generated ids", () => {
    const s = slices(
      { npcs: [{ id: "npc-gen-x-1", universeId: "u", name: "X", oneBreath: "x" }, { id: "npc-seed-y", universeId: "u", name: "Y", oneBreath: "y" }] as never },
      { sceneCard: { ...freshSceneCard(), presentNpcIds: ["npc-gen-x-1"] }, npcRelations: { "npc-gen-x-1": { disposition: 1 } } },
    );
    const r = applyAdminOp(s, parse({ op: "deleteNpcs", ids: ["npc-gen-x-1", "npc-seed-y"] }));
    expect(r.slices.state.npcs.map((n) => n.id)).toEqual(["npc-seed-y"]); // seed protected
    expect(r.slices.sceneCard.presentNpcIds).toEqual([]);
    expect(r.slices.npcRelations["npc-gen-x-1"]).toBeUndefined();
    expect(r.followups).toContainEqual({ kind: "deleteNpcs", ids: ["npc-gen-x-1"] });
  });
  it("threads op diffs removed ids into a delete followup", () => {
    const s = slices({ threads: [{ id: "t1", campaignId: "c", title: "A", body: "b", status: "active", entityRefs: [] }, { id: "t2", campaignId: "c", title: "B", body: "b", status: "active", entityRefs: [] }] as never });
    const r = applyAdminOp(s, parse({ op: "threads", value: [{ id: "t1", campaignId: "c", title: "A", body: "b", status: "active", entityRefs: [] }] }));
    expect(r.followups).toContainEqual({ kind: "deleteThreads", ids: ["t2"] });
  });
});

describe("applyAdminOp — gmNote", () => {
  it("appends an out-of-character user message to history", () => {
    const r = applyAdminOp(slices(), parse({ op: "gmNote", value: "Draven already paid them." }));
    const last = r.slices.history.at(-1) as { role: string; content: string };
    expect(last.role).toBe("user");
    expect(last.content).toContain("GM NOTE");
    expect(last.content).toContain("Draven already paid them.");
  });
});
