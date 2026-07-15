import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

const rng: RNG = { int: (_min, max) => max };

/** A PC at a location with a given wallet + backstory. */
function state(over: { locationId?: string; credits?: number; backstory?: string } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", name: "Vess", currentLocationId: over.locationId ?? "loc-rook", tendaysElapsed: 0 },
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

describe("respec — full remake (name + balanced attributes + look) at Chrome's", () => {
  it("renames, reallocates within budget, recomputes HP/AC, charges ¢500", () => {
    const rt = new TurnRuntime(state({ credits: 800 }), rng);
    const res = rt.respec({
      name: "Wren",
      attributes: { might: 0, reflex: 3, vitality: 2, intellect: 0, perception: 0, presence: -2 },
    });
    expect(res.line).toContain("Remade");
    const p = pc(rt);
    expect(p.name).toBe("Wren");
    expect(p.credits).toBe(300);
    expect(p.maxHp).toBe(20); // 18 + vitality 2
    expect(p.ac).toBe(13); // 10 + reflex 3 + no armor
    expect(rt.state.campaign.name).toBe("Wren"); // campaign follows the rename
  });

  it("clamps current HP to the new cap — a remake is not a free heal", () => {
    const s = state({ credits: 800 });
    s.characters[0].hp = 18;
    s.characters[0].maxHp = 18;
    const rt = new TurnRuntime(s, rng);
    rt.respec({ attributes: { might: 3, reflex: 0, vitality: -1, intellect: 1, perception: 0, presence: 0 } });
    expect(pc(rt).maxHp).toBe(17); // 18 - 1
    expect(pc(rt).hp).toBe(17); // clamped down, not healed
  });

  it("REJECTS an out-of-balance spread and charges nothing", () => {
    const rt = new TurnRuntime(state({ credits: 800 }), rng);
    const res = rt.respec({ attributes: { might: 3, reflex: 3, vitality: 0, intellect: 0, perception: 0, presence: 0 } });
    expect(res.error).toBeTruthy();
    expect(pc(rt).credits).toBe(800); // untouched
    expect(pc(rt).name).toBe("Vess");
  });

  it("is gated to Rook and refused when broke", () => {
    expect(new TurnRuntime(state({ locationId: "loc-meridian", credits: 800 }), rng).respec({ name: "X" }).error).toMatch(/Rook/);
    expect(new TurnRuntime(state({ credits: 100 }), rng).respec({ name: "X" }).error).toMatch(/afford/);
  });

  it("a name-only remake leaves the (already-balanced) attributes intact", () => {
    const rt = new TurnRuntime(state({ credits: 800 }), rng);
    const before = { ...pc(rt).attributes };
    rt.respec({ name: "Kestrel" });
    expect(pc(rt).name).toBe("Kestrel");
    expect(pc(rt).attributes).toEqual(before);
  });

  it("setAppearance writes the look without charging", () => {
    const rt = new TurnRuntime(state({ credits: 800 }), rng);
    rt.setAppearance("Shaved head, a harder jaw, chrome laced down one arm.");
    expect(pc(rt).appearance).toContain("chrome");
    expect(pc(rt).credits).toBe(800); // no charge
  });
});
