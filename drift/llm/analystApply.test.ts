import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { isPlaceholderOneBreath } from "@/shared/scene";
import type { RNG } from "@/engine";

const rng: RNG = { int: (_min, max) => max };

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
    factions: [], factionRep: [], locations: [], npcs, clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const pc = (rt: TurnRuntime) => rt.state.characters[0];

describe("scene analyst — applying continuity updates (the Yuri/Calvo fixes)", () => {
  it("registers a figure the live turn MISSED, as a real cast member", () => {
    const rt = new TurnRuntime(state(), rng);
    const { id, added } = rt.registerNpc("Yuri", "A one-eyed dockmaster who taught you the trade.", "dockmaster");
    expect(added).toBe(true);
    const yuri = rt.state.npcs.find((n) => n.id === id)!;
    expect(yuri.name).toBe("Yuri");
    expect(yuri.role).toBe("dockmaster");
    expect(yuri.oneBreath).toContain("dockmaster");
  });

  it("PRESENT figures go into Here & now; MENTIONED ones (Calvo) are tracked but NOT present", () => {
    const rt = new TurnRuntime(state(), rng);
    const yuri = rt.registerNpc("Yuri", "The dockmaster.", "dockmaster").id;
    const calvo = rt.registerNpc("Calvo", "A ghost who berths a corvette at Undertow.").id;
    rt.markPresent(yuri); // analyst said present
    // Calvo (mentioned) is deliberately NOT marked present.
    expect(rt.sceneCard.presentNpcIds).toContain(yuri);
    expect(rt.sceneCard.presentNpcIds).not.toContain(calvo);
    // …but both exist in the cast, so Calvo is a trackable target.
    expect(rt.state.npcs.map((n) => n.name).sort()).toEqual(["Calvo", "Yuri"]);
  });

  it("setNpcOneBreath UPGRADES a placeholder identity but never clobbers real canon", () => {
    const rt = new TurnRuntime(
      state([
        { id: "npc-gen-yuri-0", universeId: "u", name: "Yuri", oneBreath: "Spoke with the player." },
        { id: "npc-ledger", universeId: "u", name: "The Ledger", oneBreath: "Rook's symbol-marked courier-fixer, trusted by all sides." },
      ]),
      rng,
    );
    expect(isPlaceholderOneBreath("Spoke with the player.")).toBe(true);
    rt.setNpcOneBreath("npc-gen-yuri-0", "A one-eyed dockmaster who taught you the trade.");
    expect(rt.state.npcs.find((n) => n.id === "npc-gen-yuri-0")!.oneBreath).toContain("dockmaster");
    // The caller gates on isPlaceholderOneBreath — real canon (the Ledger) is left alone.
    expect(isPlaceholderOneBreath("Rook's symbol-marked courier-fixer, trusted by all sides.")).toBe(false);
  });

  it("grantSceneItem adds a FLAVOR prop but refuses real gear (engine-owned)", () => {
    const rt = new TurnRuntime(state(), rng);
    expect(rt.grantSceneItem("a marked credchip", "Deren's name etched in")).toContain("credchip");
    expect(pc(rt).gear.some((g) => g.name === "a marked credchip")).toBe(true);
    // Weapons / armor / catalog items are NOT granted here.
    expect(rt.grantSceneItem("a plasma rifle")).toBeNull();
    expect(rt.grantSceneItem("Medkit")).toBeNull(); // catalog item
    expect(pc(rt).gear.some((g) => /rifle|medkit/i.test(g.name))).toBe(false);
    // Dedup: granting the same prop twice is a no-op.
    expect(rt.grantSceneItem("a marked credchip")).toBeNull();
  });
});
