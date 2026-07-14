import { describe, it, expect } from "vitest";
import { extractNpcNames, knownEntityNames } from "./npcExtract";

describe("extractNpcNames — the missing-NPC backstop", () => {
  // Eddie's world: Draven already tracked; Rook/Meridian/Talos/the Nest are places.
  const known = knownEntityNames([
    "Draven", "Rook Station", "Meridian Ring", "Talos", "The Nest", "Sable Chain", "The Hollow Crown", "Cinder",
  ]);

  it("catches a NEW named figure the narrator forgot to declare", () => {
    const n = "A wiry woman steps from the shadows — Kessa, Draven's second, gun already drawn.";
    expect(extractNpcNames(n, known)).toEqual(["Kessa"]);
  });

  it("does NOT re-register a known NPC, location, or faction", () => {
    const n = "Draven laughs from his throne in the Nest; the Sable Chain would pay well for this.";
    expect(extractNpcNames(n, known)).toEqual([]);
  });

  it("ignores sentence-initial capitalization (not a name)", () => {
    const n = "You cross the threshold. They watch you. Nothing moves. Your hand rests on your sidearm.";
    expect(extractNpcNames(n, known)).toEqual([]);
  });

  it("catches a single-word name only when it appears mid-sentence", () => {
    // "Vex" only at a sentence start → skipped (could be capitalization).
    expect(extractNpcNames("Vex is here.", known)).toEqual([]);
    // "Vex" mid-sentence → a real name.
    expect(extractNpcNames("The fixer, Vex, leans in.", known)).toEqual(["Vex"]);
  });

  it("catches multi-word names even at a sentence start; caps the count", () => {
    const n = "Rourke Vane blocks the door. Tam Hollis flanks left. Sil Draeger covers the rear. Bex Corrin waits.";
    const found = extractNpcNames(n, known);
    expect(found).toEqual(["Rourke Vane", "Tam Hollis", "Sil Draeger"]); // capped at 3
  });
});
