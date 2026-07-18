import { describe, it, expect } from "vitest";
import { factionOpenings, openingFor } from "./openings";

/**
 * PIN TEST (Modularity M1 Task E) — captured from the code BEFORE
 * factionOpenings moved into the pack, proving the move is byte-identical.
 */
describe("content/openings — pin", () => {
  it("factionOpenings covers all 6 factions", () => {
    expect(factionOpenings.length).toBe(6);
    expect(new Set(factionOpenings.map((o) => o.factionId)).size).toBe(6);
  });

  it("openingFor(f-crown) is unchanged", () => {
    const o = openingFor("f-crown");
    expect(o?.hook).toBe(
      "Ilyana, a Crown debt handler on Meridian, has a stack of jobs no one senior wants — the lanes are turning dangerous and the Crown is short-handed. This is your chance to prove you're worth a real contract.",
    );
    expect(o?.threadTitle).toBe("Prove yourself to the Hollow Crown");
    expect(o?.firstMoves).toEqual([
      "Ask Ilyana for a starter contract",
      "Collect on a debtor who's gone quiet",
      "Ask around the docks what the Sable Chain is doing",
    ]);
    expect(o?.loaner).toEqual({
      name: "The Wren",
      shipClass: "scout",
      weaponName: "Nose kinetic",
      notes:
        "Hollow Crown loaner — a Wren-class courier. You fly it on the Crown's leave, not your own; the title stays theirs until you've earned it. Cross them and it's gone.",
    });
    expect(o?.seed.leads).toEqual([
      "A debtor a few levels down has stopped paying and stopped answering",
      "A courier run no senior contractor will touch since the lane got dangerous",
      "Word that a Crown client is quietly talking to the Sable Chain",
    ]);
  });

  it("openingFor(f-wreckers) has NO loaner (begs/borrows passage)", () => {
    expect(openingFor("f-wreckers")?.loaner).toBeUndefined();
  });

  it("openingFor is undefined for an unknown/absent faction", () => {
    expect(openingFor("f-nope")).toBeUndefined();
    expect(openingFor(undefined)).toBeUndefined();
  });
});
