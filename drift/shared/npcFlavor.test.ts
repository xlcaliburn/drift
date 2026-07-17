import { describe, it, expect } from "vitest";
import { generateQuirk, generateBackstory, generateAppearance, generateNpcFlavor } from "./npcFlavor";

describe("NPC flavor — stable, canonical personalities + backstory hooks", () => {
  it("is deterministic — same id always yields the same quirk + backstory + appearance", () => {
    expect(generateQuirk("npc-gen-fixer-11")).toBe(generateQuirk("npc-gen-fixer-11"));
    expect(generateBackstory("npc-rell")).toBe(generateBackstory("npc-rell"));
    expect(generateAppearance("npc-rell")).toBe(generateAppearance("npc-rell"));
    expect(generateNpcFlavor("npc-broker")).toEqual(generateNpcFlavor("npc-broker"));
  });

  it("quirk is a 'demeanor; tell.' line; backstory is 'origin. want, complication.'", () => {
    expect(generateQuirk("npc-broker")).toMatch(/^.+; .+\.$/);
    // Two sentences now: an origin, then the want+complication hook.
    expect(generateBackstory("npc-broker")).toMatch(/^.+\. .+, .+\.$/);
  });

  it("appearance is 'build, with face and mark.' — a complete physical description", () => {
    expect(generateAppearance("npc-broker")).toMatch(/^.+, with .+ and .+\.$/);
    expect(generateNpcFlavor("npc-x").appearance).toBe(generateAppearance("npc-x"));
  });

  it("varies across NPCs — not everyone shares a quirk, backstory, or look", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "npc-1", "npc-2"];
    expect(new Set(ids.map(generateQuirk)).size).toBeGreaterThan(6);
    expect(new Set(ids.map(generateBackstory)).size).toBeGreaterThan(6);
    expect(new Set(ids.map(generateAppearance)).size).toBeGreaterThan(6);
  });

  it("is case/whitespace insensitive and handles empty input", () => {
    expect(generateQuirk("  NPC-Rell  ")).toBe(generateQuirk("npc-rell"));
    expect(generateAppearance("  NPC-Rell  ")).toBe(generateAppearance("npc-rell"));
    expect(generateBackstory("")).toMatch(/^.+\. .+, .+\.$/);
  });
});
