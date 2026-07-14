import { describe, it, expect } from "vitest";
import { extractJsonObject } from "./deepseek";

describe("extractJsonObject — thinking-only salvage guard", () => {
  it("returns a COMPLETE object drafted inside reasoning prose", () => {
    const reasoning = 'We should reply with: {"narration":"You duck.","choices":["Run"]} — that fits.';
    expect(extractJsonObject(reasoning)).toBe('{"narration":"You duck.","choices":["Run"]}');
  });

  it("returns null for reasoning with NO object (so nothing leaks as narration)", () => {
    expect(extractJsonObject("We need to generate a JSON response for the player.")).toBeNull();
  });

  it("returns null for a TRUNCATED object (max_tokens mid-draft) — never a partial leak", () => {
    expect(extractJsonObject('Let me draft: {"narration":"You reach for the stim on your')).toBeNull();
  });

  it("respects strings/escapes and braces inside the narration", () => {
    const s = '{"narration":"He said \\"stop\\" {now}","choices":[]}';
    expect(extractJsonObject("noise " + s)).toBe(s);
  });

  it("handles empty / null input", () => {
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject(null)).toBeNull();
  });
});
