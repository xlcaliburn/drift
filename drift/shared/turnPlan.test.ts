import { describe, it, expect } from "vitest";
import { extractJsonObject, parseTurnPlan, repairTurnPlan } from "./turnPlan";

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("tolerates ```json fences and surrounding prose", () => {
    const t = 'Here you go:\n```json\n{"narration":"x","choices":[]}\n```\nDone.';
    expect(extractJsonObject(t)).toEqual({ narration: "x", choices: [] });
  });

  it("handles braces inside strings", () => {
    expect(extractJsonObject('{"narration":"a {weird} one"}')).toEqual({ narration: "a {weird} one" });
  });

  it("returns null for no JSON", () => {
    expect(extractJsonObject("just prose")).toBeNull();
  });
});

describe("parseTurnPlan", () => {
  it("accepts a full valid plan", () => {
    const { plan, error } = parseTurnPlan(
      JSON.stringify({
        narration: "The dock groans.",
        choices: [
          { label: "Sneak past", check: { skill: "stealth", dc: 13, stakes: true } },
          "Walk up openly",
        ],
        roll: { skill: "perception", dc: 10 },
      }),
    );
    expect(error).toBeUndefined();
    expect(plan?.choices).toHaveLength(2);
    expect(plan?.choices[0].check?.skill).toBe("stealth");
    expect(plan?.choices[1]).toEqual({ label: "Walk up openly" }); // string normalized
    expect(plan?.roll?.stakes).toBe(false); // defaulted
  });

  it("rejects a plan without narration and reports the field", () => {
    const { plan, error } = parseTurnPlan('{"choices":[]}');
    expect(plan).toBeNull();
    expect(error).toContain("narration");
  });

  it("rejects an out-of-range DC", () => {
    const { plan } = parseTurnPlan(
      '{"narration":"x","choices":[{"label":"a","check":{"skill":"melee","dc":99}}]}',
    );
    expect(plan).toBeNull();
  });
});

describe("repairTurnPlan", () => {
  it("salvages narration + menu options from a prose response", () => {
    const raw = "The guard turns.\n\n> **Rush him**\n> **Hide**\n\nYou rush him and...";
    const plan = repairTurnPlan(raw);
    expect(plan.narration).toBe("The guard turns.");
    expect(plan.choices.map((c) => c.label)).toEqual(["Rush him", "Hide"]);
  });

  it("never returns an empty narration", () => {
    expect(repairTurnPlan("").narration).toBe("…");
  });
});
