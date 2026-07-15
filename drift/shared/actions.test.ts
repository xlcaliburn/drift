import { describe, it, expect } from "vitest";
import { checkFromVerb, verbFromLabel, verbRolls, inferAttemptVerb, ACTION_VERBS, FREE_VERBS, VERB_LIST } from "./actions";
import skills from "@/content/skills.json";

describe("action verbs → engine checks", () => {
  it("maps 'force' to athletics (not zeroG) — the shelving bug", () => {
    const c = checkFromVerb("force");
    expect(c?.skill).toBe("athletics");
    expect(c?.stakes).toBe(true);
    expect(c?.hazardLevel).toBe(2); // hazard verb: a failed heave can hurt (⚠⚠)
  });

  it("maps the social verbs to their skills", () => {
    expect(checkFromVerb("persuade")?.skill).toBe("negotiation");
    expect(checkFromVerb("lie")?.skill).toBe("deception");
    expect(checkFromVerb("threaten")?.skill).toBe("intimidation");
    expect(checkFromVerb("loot")?.skill).toBe("scavenging");
    expect(checkFromVerb("examine")?.skill).toBe("perception");
  });

  it("non-hazard verbs carry no hazard level (failure can't hurt)", () => {
    expect(checkFromVerb("examine")?.hazardLevel).toBeUndefined();
    expect(checkFromVerb("persuade")?.hazardLevel).toBeUndefined();
  });

  it("difficulty maps to a DC; default falls back to the verb's", () => {
    expect(checkFromVerb("hack", "easy")?.dc).toBe(10);
    expect(checkFromVerb("hack", "hard")?.dc).toBe(16);
    expect(checkFromVerb("hack")?.dc).toBe(14); // hack's default
  });

  it("attack routes to combat (smallArms + combat flag)", () => {
    const c = checkFromVerb("attack");
    expect(c?.skill).toBe("smallArms");
    expect(c?.combat).toBe(true);
  });

  it("unknown verb → null (falls back to the model's check)", () => {
    expect(checkFromVerb("frobnicate")).toBeNull();
  });

  it("every ATTEMPT verb maps to a real skill in the catalog", () => {
    for (const v of Object.keys(ACTION_VERBS)) {
      expect(ACTION_VERBS[v].skill in skills.skills).toBe(true);
    }
  });

  it("every skill has a verb EXCEPT the combat skills (which route via combat)", () => {
    // gunnery/melee are exercised through combat (the attack verb / ship combat),
    // not a verb-check — so only these may lack a verb.
    const COMBAT_ONLY = new Set(["gunnery", "melee"]);
    const covered = new Set(Object.values(ACTION_VERBS).map((d) => d.skill));
    const uncovered = Object.keys(skills.skills).filter((s) => !covered.has(s));
    expect(uncovered.sort()).toEqual([...COMBAT_ONLY].sort());
  });

  it("infers the verb from an untagged label (the missing-tooltip bug)", () => {
    expect(verbFromLabel("Search the lockers for a mask")).toBe("loot"); // search → loot → scavenging
    expect(verbFromLabel("Move the fallen shelving")).toBe("force");
    expect(verbFromLabel("Try to force the hatch")).toBe("force"); // leading filler stripped
    expect(verbFromLabel("Open fire on the freighter")).toBe("attack"); // multi-word alias
    expect(verbFromLabel("Ask around the docks")).toBe("network"); // beats bare "ask"
    expect(verbFromLabel("Head back to the ship")).toBe("go"); // free verb — no check
    expect(verbFromLabel("Accept the offer")).toBeNull(); // no verb → plain choice
  });

  it("FREE verbs carry NO check and don't roll", () => {
    for (const v of Object.keys(FREE_VERBS)) {
      expect(checkFromVerb(v)).toBeNull(); // no skill, no check
      expect(verbRolls(v)).toBe(false);
    }
    // ...while attempt verbs DO roll.
    expect(verbRolls("force")).toBe(true);
    // Both kinds are valid schema values.
    expect(VERB_LIST).toContain("go");
    expect(VERB_LIST).toContain("force");
  });
});

describe("inferAttemptVerb — a typed custom action gets a check even without a model roll", () => {
  it("catches attempts buried under first-person filler", () => {
    expect(inferAttemptVerb("I sneak past the guards")).toBe("sneak");
    expect(inferAttemptVerb("I'll persuade the dockmaster to look the other way")).toBe("persuade");
    expect(inferAttemptVerb("I try to hack the door panel")).toBe("hack");
    expect(inferAttemptVerb("let me search the body")).toBe("loot");
    expect(inferAttemptVerb("I'm gonna carefully climb the gantry")).toBe("climb");
    expect(inferAttemptVerb("sweet-talk the guard")).toBe("persuade");
    expect(inferAttemptVerb("I want to intimidate him into talking")).toBe("threaten");
    expect(inferAttemptVerb("bluff my way past the checkpoint")).toBe("lie");
  });

  it("returns null for pure dialogue and free actions — no false checks", () => {
    expect(inferAttemptVerb("I greet the bartender")).toBeNull();
    expect(inferAttemptVerb("ask the bartender about the job")).toBeNull(); // 'ask' is free (talk)
    expect(inferAttemptVerb("I head back to the ship")).toBeNull();
    expect(inferAttemptVerb("wait and watch the crowd")).toBeNull();
    expect(inferAttemptVerb("tell him my name")).toBeNull();
  });

  it("never manufactures a FIGHT — combat verbs route themselves", () => {
    expect(inferAttemptVerb("I shoot the guard")).toBeNull();
    expect(inferAttemptVerb("open fire on them")).toBeNull();
  });

  it("'ask around' (streetwise) still beats bare 'ask' (dialogue)", () => {
    expect(inferAttemptVerb("ask around the docks about the courier")).toBe("network");
  });
});
