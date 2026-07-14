import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

const rng: RNG = { int: (min) => min };

function stateAt(locId = "loc-meridian"): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: locId, tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [{ id: "pc-1", kind: "pc", name: "Vess", hp: 8, maxHp: 8, ac: 12, stims: 0, fragile: false, attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 }, skills: [], actionModifiers: {}, gear: [], injuries: [] }],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("registerNpc — continuity", () => {
  it("persists a narrator-introduced NPC to the cast, at the current location", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const res = rt.registerNpc("Quartermaster Doyle", "Gruff supply officer; keeps the manifests.");
    expect(res.added).toBe(true);
    const npc = rt.state.npcs.find((n) => n.id === res.id)!;
    expect(npc.name).toBe("Quartermaster Doyle");
    expect(npc.locationId).toBe("loc-meridian"); // remembered where you met them
    expect(npc.id.startsWith("npc-gen-")).toBe(true); // campaign-scoped id
  });

  it("dedupes by name (case-insensitive) and refreshes their location", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const first = rt.registerNpc("Doyle", "supply officer");
    // Later, the same NPC is used again at a different location.
    rt.state = { ...rt.state, campaign: { ...rt.state.campaign, currentLocationId: "loc-rook" } };
    const again = rt.registerNpc("doyle");
    expect(again.added).toBe(false);
    expect(again.id).toBe(first.id);
    expect(rt.state.npcs.filter((n) => n.name.toLowerCase() === "doyle").length).toBe(1);
    expect(rt.state.npcs.find((n) => n.id === first.id)!.locationId).toBe("loc-rook");
  });
});
