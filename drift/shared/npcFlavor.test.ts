import { describe, it, expect } from "vitest";
import { generateQuirk, generateBackstory, generateAppearance, generateVoice, generateNpcFlavor } from "./npcFlavor";

describe("NPC flavor — stable, canonical personalities + backstory hooks", () => {
  it("is deterministic — same id always yields the same quirk + backstory + appearance + voice", () => {
    expect(generateQuirk("npc-gen-fixer-11")).toBe(generateQuirk("npc-gen-fixer-11"));
    expect(generateBackstory("npc-rell")).toBe(generateBackstory("npc-rell"));
    expect(generateAppearance("npc-rell")).toBe(generateAppearance("npc-rell"));
    expect(generateVoice("npc-rell")).toBe(generateVoice("npc-rell"));
    expect(generateNpcFlavor("npc-broker")).toEqual(generateNpcFlavor("npc-broker"));
  });

  it("quirk is a 'demeanor; tell.' line; backstory is 'origin. want, complication.'", () => {
    expect(generateQuirk("npc-broker")).toMatch(/^.+; .+\.$/);
    // Two sentences now: an origin, then the want+complication hook.
    expect(generateBackstory("npc-broker")).toMatch(/^.+\. .+, .+\.$/);
  });

  it("appearance is 'build, age, with face and mark.' — a complete physical description", () => {
    expect(generateAppearance("npc-broker")).toMatch(/^.+, .+, with .+ and .+\.$/);
    expect(generateNpcFlavor("npc-x").appearance).toBe(generateAppearance("npc-x"));
  });

  it("voice is a single speech-pattern line, distinct from quirk", () => {
    expect(generateVoice("npc-broker")).toMatch(/^[a-z].+[a-z]$/i);
    expect(generateVoice("npc-broker")).not.toBe(generateQuirk("npc-broker"));
    expect(generateNpcFlavor("npc-x").voice).toBe(generateVoice("npc-x"));
  });

  it("varies across NPCs — not everyone shares a quirk, backstory, look, or voice", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "npc-1", "npc-2"];
    expect(new Set(ids.map(generateQuirk)).size).toBeGreaterThan(6);
    expect(new Set(ids.map(generateBackstory)).size).toBeGreaterThan(6);
    expect(new Set(ids.map(generateAppearance)).size).toBeGreaterThan(6);
    expect(new Set(ids.map(generateVoice)).size).toBeGreaterThan(4); // smaller pool (14)
  });

  it("is case/whitespace insensitive and handles empty input", () => {
    expect(generateQuirk("  NPC-Rell  ")).toBe(generateQuirk("npc-rell"));
    expect(generateAppearance("  NPC-Rell  ")).toBe(generateAppearance("npc-rell"));
    expect(generateVoice("  NPC-Rell  ")).toBe(generateVoice("npc-rell"));
    expect(generateBackstory("")).toMatch(/^.+\. .+, .+\.$/);
    expect(generateVoice("")).toMatch(/^.+$/);
  });
});
