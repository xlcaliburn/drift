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

/**
 * PIN TEST (Modularity M1 Task C) — exact strings captured from the code
 * BEFORE the DEMEANORS/TELLS/DRIVES/HOOKS/BUILDS/FACES/MARKS/AGES/VOICES/
 * ORIGINS pools moved into the pack. HANDOFF_MODULARITY_M1.md's named trap:
 * these are RENDER-TIME fallbacks (world.ts recomputes generateAppearance/
 * generateQuirk for any seed NPC without a persisted value, every turn) — a
 * reordered or resized pool silently changes what every live campaign sees
 * for that NPC. These ids are real seed/generated npcs from live data; if any
 * assertion here changes, the pool moved wrong — fix the move, never the pin.
 */
describe("NPC flavor — pin (exact strings, live-data ids)", () => {
  it("npc-broker", () => {
    expect(generateQuirk("npc-broker")).toBe("Cautious, measures every word; flinches at loud noises, then covers it.");
    expect(generateAppearance("npc-broker")).toBe(
      "Lean and angular, in their late twenties, with deep-set eyes under a mess of unkempt hair and an old blast scar across the scalp where hair won't grow.",
    );
    expect(generateVoice("npc-broker")).toBe("clipped sentences, dock slang thick enough to cut");
    expect(generateBackstory("npc-broker")).toBe(
      "Grew up in the gutter-decks of a Crown station and clawed out. Wants off this station for good, though the favor they'd need to call in isn't free.",
    );
  });

  it("npc-patron-camp-vess", () => {
    expect(generateQuirk("npc-patron-camp-vess")).toBe("Suspicious of everyone, you included; drops into a second language when rattled.");
    expect(generateAppearance("npc-patron-camp-vess")).toBe(
      "Big-framed but slow-moving, in their fifties, with a long face with a crooked, often-broken nose and a limp favoring the right leg.",
    );
    expect(generateVoice("npc-patron-camp-vess")).toBe("blunt monosyllables, nothing wasted");
    expect(generateBackstory("npc-patron-camp-vess")).toBe(
      "Came up through a salvage crew that didn't all make it back. Is chasing a rumor of a wreck worth a fortune, and can't move the one thing that would pay for it.",
    );
  });

  it("npc-gen-ren-fixer-30", () => {
    expect(generateQuirk("npc-gen-ren-fixer-30")).toBe("World-weary but still kind; calls everyone by their faction, not their name.");
    expect(generateAppearance("npc-gen-ren-fixer-30")).toBe(
      "Compact and coiled, a fighter's build, in their late twenties, with close-cropped dark hair and sharp cheekbones and a voice box implant that flattens every word.",
    );
    expect(generateVoice("npc-gen-ren-fixer-30")).toBe("constant low profanity, oddly warm underneath it");
    expect(generateBackstory("npc-gen-ren-fixer-30")).toBe(
      "Grew up in the gutter-decks of a Crown station and clawed out. Wants to prove they're more than the work they do, though the favor they'd need to call in isn't free.",
    );
  });

  it("npc-ilyana", () => {
    expect(generateQuirk("npc-ilyana")).toBe("Cold and precise, wastes no words; never sits with their back to a door.");
    expect(generateAppearance("npc-ilyana")).toBe(
      "Big-framed but slow-moving, old enough that people wonder how they've lasted this long, with a jaw like a bulkhead and a flattened ear and a tremor in the left hand they try to hide.",
    );
    expect(generateVoice("npc-ilyana")).toBe("precise, like reading off a manifest");
    expect(generateBackstory("npc-ilyana")).toBe(
      "Came up through a salvage crew that didn't all make it back. Wants revenge they can't afford to take yet, and can't move the one thing that would pay for it.",
    );
  });
});
