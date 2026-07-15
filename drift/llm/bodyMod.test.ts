import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

const rng: RNG = { int: (_min, max) => max };

/** A PC at a location with a given wallet + backstory. */
function state(over: { locationId?: string; credits?: number; backstory?: string } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: over.locationId ?? "loc-rook", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        credits: over.credits ?? 800,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
        backstory: over.backstory,
      },
    ],
    factions: [], factionRep: [], locations: [{ id: "loc-rook", universeId: "u", name: "Rook", tags: ["blackmarket"] }],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const pc = (rt: TurnRuntime) => rt.state.characters[0];

describe("bodyMod — Rook body-modification service (¢500)", () => {
  it("charges ¢500, rewrites appearance, and folds the change into the backstory", () => {
    const rt = new TurnRuntime(state({ credits: 800, backstory: "A courier who ran the Rim." }), rng);
    const res = rt.bodyMod({ appearance: "shaved head, new jawline", story: "The old face is gone." });
    expect(res.line).toContain("¢500");
    expect(pc(rt).credits).toBe(300);
    expect(pc(rt).appearance).toBe("shaved head, new jawline");
    expect(pc(rt).backstory).toBe("A courier who ran the Rim.\n\nThe old face is gone."); // appended, not replaced
  });

  it("sets a backstory from scratch when there was none", () => {
    const rt = new TurnRuntime(state({ backstory: undefined }), rng);
    rt.bodyMod({ appearance: "chromed arms", story: "You bought a new silhouette." });
    expect(pc(rt).backstory).toBe("You bought a new silhouette.");
  });

  it("is REFUSED when the player can't afford it (elective, not survival)", () => {
    const rt = new TurnRuntime(state({ credits: 200 }), rng);
    const res = rt.bodyMod({ appearance: "new face" });
    expect(res.error).toMatch(/afford/);
    expect(pc(rt).credits).toBe(200); // untouched
    expect(pc(rt).appearance).toBeUndefined();
  });

  it("only works at Rook Station", () => {
    const rt = new TurnRuntime(state({ locationId: "loc-meridian", credits: 800 }), rng);
    expect(rt.bodyMod({ appearance: "new face" }).error).toMatch(/Rook/);
  });

  it("needs an actual change described", () => {
    const rt = new TurnRuntime(state({ credits: 800 }), rng);
    expect(rt.bodyMod({}).error).toMatch(/no change/);
    expect(pc(rt).credits).toBe(800); // nothing charged
  });
});
