import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { freshSceneCard } from "@/shared/scene";
import type { RNG } from "@/engine";

/** Every die returns `v` (nat 20 → crit, nat 1 → fumble). */
const rngOf = (v: number): RNG => ({ int: () => v });

function stateWithNpc(): CampaignState {
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Ekko", hp: 10, maxHp: 10, ac: 12, stims: 0, fragile: false, credits: 100,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "negotiation", level: 0, ticks: 0 }],
        actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    npcs: [{ id: "npc-sera", universeId: "u", name: "Sera", oneBreath: "A fixer." }],
    factions: [], factionRep: [], locations: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

function withSeraPresent(rng: RNG): TurnRuntime {
  const sc = freshSceneCard();
  sc.presentNpcIds = ["npc-sera"];
  return new TurnRuntime(stateWithNpc(), rng, { sceneCard: sc, npcRelations: {} });
}

const roll = (rt: TurnRuntime, skill: string) =>
  rt.execute("roll_check", { characterId: "pc-1", skill, dc: 10, stakes: true });

describe("relationship mechanic — a passed social check moves standing", () => {
  it("a successful negotiation warms the sole present NPC (+1)", () => {
    const rt = withSeraPresent(rngOf(15)); // 15 + 0 vs DC 10 → success, not a crit
    roll(rt, "negotiation");
    expect(rt.npcRelations["npc-sera"].disposition).toBe(1);
  });

  it("a critical success warms them harder (+2)", () => {
    const rt = withSeraPresent(rngOf(20)); // nat 20
    roll(rt, "negotiation");
    expect(rt.npcRelations["npc-sera"].disposition).toBe(2);
  });

  it("a fumble sours them (-1)", () => {
    const rt = withSeraPresent(rngOf(1)); // nat 1
    roll(rt, "negotiation");
    expect(rt.npcRelations["npc-sera"].disposition).toBe(-1);
  });

  it("does NOT move standing when the target is ambiguous (multiple present)", () => {
    const sc = freshSceneCard();
    sc.presentNpcIds = ["npc-sera", "npc-kaela"];
    const st = stateWithNpc();
    (st.npcs as unknown as Record<string, unknown>[]).push({ id: "npc-kaela", universeId: "u", name: "Kaela", oneBreath: "x" });
    const rt = new TurnRuntime(st, rngOf(20), { sceneCard: sc, npcRelations: {} });
    roll(rt, "negotiation");
    expect(rt.npcRelations["npc-sera"]).toBeUndefined();
  });

  it("a non-social skill never moves standing", () => {
    const rt = withSeraPresent(rngOf(20));
    roll(rt, "stealth");
    expect(rt.npcRelations["npc-sera"]).toBeUndefined();
  });

  it("caps at one move per NPC per turn", () => {
    const rt = withSeraPresent(rngOf(20)); // crit → +2 once
    roll(rt, "negotiation");
    roll(rt, "negotiation"); // second roll same turn — no further move
    expect(rt.npcRelations["npc-sera"].disposition).toBe(2);
  });

  it("a standing change appends a beat to the relationship history log", () => {
    const rt = withSeraPresent(rngOf(15));
    roll(rt, "negotiation");
    const log = rt.npcRelations["npc-sera"].log ?? [];
    expect(log.length).toBe(1);
    expect(log[0].note).toMatch(/warmed to you/i);
  });

  it("model notes accumulate into the log (not overwrite), de-duping repeats", () => {
    const rt = withSeraPresent(rngOf(15));
    rt.updateNpcRelation("npc-sera", { note: "Met at the docks." });
    rt.updateNpcRelation("npc-sera", { note: "Met at the docks." }); // dupe — ignored
    rt.updateNpcRelation("npc-sera", { note: "She trusted you with the manifest." });
    const log = rt.npcRelations["npc-sera"].log ?? [];
    expect(log.map((e) => e.note)).toEqual(["Met at the docks.", "She trusted you with the manifest."]);
  });
});
