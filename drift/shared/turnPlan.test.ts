import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJsonObject, parseTurnPlan, repairTurnPlan, REPAIR_FALLBACK_NARRATION, MemberOrderSpec, CombatActionSpec, AllocationSpec, ChoiceOption } from "./turnPlan";

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

  it("tolerates null for optional fields (cheap models write check:null)", () => {
    const { plan, error } = parseTurnPlan(
      JSON.stringify({
        narration: "The bay goes still.",
        choices: [
          { label: "Demand the recorder", check: { skill: "intimidation", dc: 13, stakes: true } },
          { label: "Take it and go", check: null },
        ],
        roll: null,
        worldEvent: null,
      }),
    );
    expect(error).toBeUndefined();
    expect(plan?.choices[1]).toEqual({ label: "Take it and go" });
    expect(plan?.roll).toBeUndefined();
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
    const n = repairTurnPlan("").narration;
    expect(n.length).toBeGreaterThan(1);
    expect(n).not.toBe("…");
  });

  it("a nothing-usable repair lands EXACTLY on the sentinel (turn-failure detection)", () => {
    // jsonTurn aborts the turn (retryable error) when repair returns the sentinel
    // with no choices — this pins the coupling so a reworded stub can't silently
    // break failure detection.
    const p = repairTurnPlan("");
    expect(p.narration).toBe(REPAIR_FALLBACK_NARRATION);
    expect(p.choices).toEqual([]);
  });

  it("salvages narration + choice labels from JSON that failed validation", () => {
    const raw = JSON.stringify({
      narration: "You level the pistol.",
      choices: [
        { label: "Fire", check: { skill: "smallArms", dc: 99 } }, // bad DC → whole plan invalid
        "Hold",
      ],
    });
    const plan = repairTurnPlan(raw);
    expect(plan.narration).toBe("You level the pistol.");
    expect(plan.choices.map((c) => c.label)).toEqual(["Fire", "Hold"]); // checks dropped, labels kept
  });

  it("jsonOnly mode NEVER surfaces raw prose as narration (no reasoning leak)", () => {
    // A hybrid model's chain-of-thought with no JSON object. For a JSON turn this
    // must fail (sentinel), not stream the thinking to the player as narration.
    const thinking =
      "We need to generate a JSON response for the player's action. The player is downed, " +
      "so we present 3 last-ditch choices and set a roll for the reach action.";
    const p = repairTurnPlan(thinking, { jsonOnly: true });
    expect(p.narration).toBe(REPAIR_FALLBACK_NARRATION); // → turn-failure detection → error+retry
    expect(p.choices).toEqual([]);
    // Without jsonOnly, the legacy prose salvage would leak it as narration:
    expect(repairTurnPlan(thinking).narration).not.toBe(REPAIR_FALLBACK_NARRATION);
  });

  it("jsonOnly still salvages a real object buried in thinking", () => {
    const raw = 'Okay, the player searches. {"narration":"You find scraps.","choices":["Move on"]}';
    const p = repairTurnPlan(raw, { jsonOnly: true });
    expect(p.narration).toBe("You find scraps.");
    expect(p.choices.map((c) => c.label)).toEqual(["Move on"]);
  });
});

// The turn route validates staged squad orders (HANDOFF_COMBAT_V2_1 Task C)
// The shipyard chips (HANDOFF_COMBAT_V2_3.md Task C) round-trip through
// lastChoices persistence like every other engine-owned ChoiceOption field.
describe("ChoiceOption — shipyard fields (HANDOFF_COMBAT_V2_3.md)", () => {
  it("accepts a well-formed buyShipItem chip", () => {
    expect(ChoiceOption.safeParse({ label: "Install Beam lance — ¢450", buyShipItem: "beamLance" }).success).toBe(true);
  });

  it("accepts a well-formed sellShipItem chip", () => {
    expect(ChoiceOption.safeParse({ label: "Strip Beam lance — +¢180", sellShipItem: "beamLance" }).success).toBe(true);
  });

  it("tolerates null (cheap models write absent fields as null)", () => {
    const r = ChoiceOption.safeParse({ label: "Move on", buyShipItem: null, sellShipItem: null });
    expect(r.success).toBe(true);
    expect(r.data?.buyShipItem).toBeUndefined();
  });

  it("a label-only choice still parses (both fields optional)", () => {
    expect(ChoiceOption.safeParse({ label: "Keep moving" }).success).toBe(true);
  });
});

// ship2's power allocation rides the existing combatAction envelope
// (HANDOFF_COMBAT_V2_2.md Task C) — a new "allocate" type + bounded alloc.
describe("CombatActionSpec — the \"allocate\" type (ship2)", () => {
  it("accepts a well-formed allocate chip", () => {
    const r = CombatActionSpec.safeParse({
      type: "allocate",
      alloc: { mounts: ["railgun", "beamLance"], shields: 1, engines: 1, overcharge: true, targetId: "e-1" },
    });
    expect(r.success).toBe(true);
  });

  it("still accepts every pre-existing action type unchanged", () => {
    for (const type of ["attack", "aim", "cover", "stim", "flee", "item", "switch"]) {
      expect(CombatActionSpec.safeParse({ type }).success, type).toBe(true);
    }
  });

  it("rejects an oversized mounts array (cap 6 — the largest class's mountSlots + headroom)", () => {
    const r = AllocationSpec.safeParse({ mounts: ["a", "b", "c", "d", "e", "f", "g"], shields: 0, engines: 0 });
    expect(r.success).toBe(false);
    expect(AllocationSpec.safeParse({ mounts: ["a", "b", "c", "d", "e", "f"], shields: 0, engines: 0 }).success).toBe(true);
  });

  it("rejects out-of-range shields/engines", () => {
    expect(AllocationSpec.safeParse({ mounts: [], shields: 7, engines: 0 }).success).toBe(false);
    expect(AllocationSpec.safeParse({ mounts: [], shields: -1, engines: 0 }).success).toBe(false);
  });

  it("rejects an unknown action type", () => {
    expect(CombatActionSpec.safeParse({ type: "nuke-everything" }).success).toBe(false);
  });
});

// The turn route validates staged squad orders (HANDOFF_COMBAT_V2_1 Task C)
// with exactly this shape — an array of MemberOrderSpec, capped at 6, dropped
// WHOLE (not partially) on any malformed entry.
describe("MemberOrderSpec — route-level squad-order validation", () => {
  const RouteOrders = z.array(MemberOrderSpec).max(6);

  it("accepts a well-formed array of member orders", () => {
    const r = RouteOrders.safeParse([
      { memberId: "crew-1", action: { type: "attack", enemyId: "e-1" } },
      { memberId: "crew-2", action: { type: "stim" } },
    ]);
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
  });

  it("rejects the whole array when one order is malformed (fail closed)", () => {
    const r = RouteOrders.safeParse([
      { memberId: "crew-1", action: { type: "attack", enemyId: "e-1" } },
      { memberId: "crew-2", action: { type: "not-a-real-action" } }, // bad enum
    ]);
    expect(r.success).toBe(false);
  });

  it("rejects an order missing a memberId", () => {
    const r = RouteOrders.safeParse([{ action: { type: "cover" } }]);
    expect(r.success).toBe(false);
  });

  it("caps at 6 orders", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      memberId: `crew-${i}`,
      action: { type: "cover" as const },
    }));
    expect(RouteOrders.safeParse(seven).success).toBe(false);
    expect(RouteOrders.safeParse(seven.slice(0, 6)).success).toBe(true);
  });
});
