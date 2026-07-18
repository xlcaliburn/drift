import { describe, it, expect } from "vitest";
import { worldIntro, seasonOneSpine, factionBriefs } from "./briefs";

/**
 * PIN TEST (Modularity M1 Task E) — captured from the code BEFORE
 * worldIntro/seasonOneSpine/factionBriefs moved into the pack.
 */
describe("content/briefs — pin", () => {
  it("worldIntro and seasonOneSpine are unchanged", () => {
    expect(worldIntro).toMatch(/^THE DRIFT\n\nA hard, lawless stretch/);
    expect(seasonOneSpine).toMatch(/^SEASON ONE — FAULT LINE/);
  });

  it("factionBriefs covers all 6 factions, unchanged text for one", () => {
    expect(factionBriefs.length).toBe(6);
    const crown = factionBriefs.find((f) => f.factionId === "f-crown");
    expect(crown?.name).toBe("The Hollow Crown");
    expect(crown?.tagline).toBe("The house that owns the debt.");
    expect(crown?.playstyle).toBe("Establishment power and clean money — steady work, defending turf under threat.");
  });
});
