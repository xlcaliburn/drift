import { describe, it, expect } from "vitest";
import { generateQuirk, generateBackstory, generateNpcFlavor } from "./npcFlavor";

describe("NPC flavor — stable, canonical personalities + backstory hooks", () => {
  it("is deterministic — same id always yields the same quirk + backstory", () => {
    expect(generateQuirk("npc-gen-fixer-11")).toBe(generateQuirk("npc-gen-fixer-11"));
    expect(generateBackstory("npc-rell")).toBe(generateBackstory("npc-rell"));
    expect(generateNpcFlavor("npc-broker")).toEqual(generateNpcFlavor("npc-broker"));
  });

  it("quirk is a 'demeanor; tell.' line; backstory is a 'want, complication.' line", () => {
    expect(generateQuirk("npc-broker")).toMatch(/^.+; .+\.$/);
    expect(generateBackstory("npc-broker")).toMatch(/^.+, .+\.$/);
  });

  it("varies across NPCs — not everyone shares a quirk or a backstory", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "npc-1", "npc-2"];
    expect(new Set(ids.map(generateQuirk)).size).toBeGreaterThan(6);
    expect(new Set(ids.map(generateBackstory)).size).toBeGreaterThan(6);
  });

  it("is case/whitespace insensitive and handles empty input", () => {
    expect(generateQuirk("  NPC-Rell  ")).toBe(generateQuirk("npc-rell"));
    expect(generateBackstory("")).toMatch(/^.+, .+\.$/);
  });
});
