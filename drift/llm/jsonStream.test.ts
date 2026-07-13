import { describe, it, expect } from "vitest";
import { NarrationExtractor } from "./jsonStream";

/** Feed a string in chunks of n chars, collecting emitted narration. */
function run(full: string, n: number): string {
  const ex = new NarrationExtractor();
  let out = "";
  for (let i = 0; i < full.length; i += n) out += ex.feed(full.slice(i, i + n));
  return out;
}

describe("NarrationExtractor", () => {
  const json = '{"narration":"You slip past the guard.\\nHe never looks up.","choices":[{"label":"Go"}]}';

  it("extracts the narration from a whole response", () => {
    expect(run(json, json.length)).toBe("You slip past the guard.\nHe never looks up.");
  });

  it("is chunk-size independent (1-char deltas)", () => {
    expect(run(json, 1)).toBe("You slip past the guard.\nHe never looks up.");
  });

  it("unescapes quotes and backslashes", () => {
    const j = '{"narration":"\\"Stop,\\" he says. A \\\\ mark."}';
    expect(run(j, 3)).toBe('"Stop," he says. A \\ mark.');
  });

  it("decodes unicode escapes", () => {
    const j = '{"narration":"caf\\u00e9 door"}';
    expect(run(j, 2)).toBe("café door");
  });

  it("emits nothing after the narration value closes", () => {
    const j = '{"narration":"end.","worldEvent":{"headline":"not narration"}}';
    expect(run(j, 4)).toBe("end.");
  });

  it("emits nothing when there is no narration field", () => {
    expect(run('{"choices":[]}', 2)).toBe("");
  });
});
