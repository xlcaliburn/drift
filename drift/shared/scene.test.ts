import { describe, it, expect } from "vitest";
import { isSceneMove, shortRole, toSecondPerson } from "./scene";

describe("isSceneMove — a move opens a new scene", () => {
  it("a station/location change is always a move", () => {
    expect(isSceneMove("the docks", "the docks", "loc-rook", "loc-undertow")).toBe(true);
    // even with no place set, the location change alone is enough
    expect(isSceneMove(undefined, undefined, "loc-rook", "loc-meridian")).toBe(true);
  });

  it("a genuinely different place (same location) is a move", () => {
    expect(isSceneMove("the fixer's stall", "the Undertow bounty desk", "loc-rook", "loc-rook")).toBe(true);
  });

  it("a reword or elaboration is NOT a move (substring after normalize)", () => {
    // "docking bay" ⊂ "calvo s docking bay" → elaboration, not a move
    expect(isSceneMove("docking bay", "Calvo's docking bay", "loc-rook", "loc-rook")).toBe(false);
    // pure re-affirmation (identical after normalize)
    expect(isSceneMove("The Bar.", "the bar", "loc-rook", "loc-rook")).toBe(false);
  });

  it("first-set of a place is NOT a move", () => {
    expect(isSceneMove(undefined, "the fixer's stall", "loc-rook", "loc-rook")).toBe(false);
    expect(isSceneMove("", "the fixer's stall", "loc-rook", "loc-rook")).toBe(false);
  });

  it("empty / missing inputs are NOT a move", () => {
    expect(isSceneMove(undefined, undefined, undefined, undefined)).toBe(false);
    expect(isSceneMove("the docks", "", "loc-rook", "loc-rook")).toBe(false);
    expect(isSceneMove("the docks", "   ", "loc-rook", "loc-rook")).toBe(false);
    // same location echoed back with no place change is not a move
    expect(isSceneMove(undefined, undefined, "loc-rook", "loc-rook")).toBe(false);
  });
});

describe("shortRole — a role is a short handle, not a sentence", () => {
  it("cuts a descriptive clause the model tacked on (the live 'giving you a' bug)", () => {
    expect(shortRole("meridian trade-house broker giving you a cut on the deal")).toBe("meridian trade-house broker");
    expect(shortRole("dock foreman who owes you money")).toBe("dock foreman");
    expect(shortRole("a fixer offering leads")).toBe("a fixer");
  });
  it("keeps a plain short handle", () => {
    expect(shortRole("broker")).toBe("broker");
    expect(shortRole("dock foreman")).toBe("dock foreman");
  });
  it("returns undefined for empty/too-short", () => {
    expect(shortRole(undefined)).toBeUndefined();
    expect(shortRole("  ")).toBeUndefined();
    expect(shortRole("a")).toBeUndefined();
  });
});

describe("toSecondPerson — relationship notes read as 'what you know'", () => {
  it("rewrites third-person player references to 'you' and recapitalizes", () => {
    expect(toSecondPerson("Player handed over the data core")).toBe("You handed over the data core");
    expect(toSecondPerson("the player paid her off")).toBe("You paid her off");
    expect(toSecondPerson("she trusts the player's word")).toBe("she trusts your word");
  });
  it("rewrites the PC's own name (case-sensitive, so common-word names are safe)", () => {
    expect(toSecondPerson("Silas vouched for him", "Silas")).toBe("You vouched for him");
    expect(toSecondPerson("Cali's cut was fair", "Cali")).toBe("Your cut was fair"); // sentence-leading → capitalized
    // lowercase 'nix' as an ordinary verb is NOT swallowed by the PC named "Nix"
    expect(toSecondPerson("agreed to nix the side deal", "Nix")).toBe("agreed to nix the side deal");
  });
  it("leaves a normal note (no player reference) untouched, including its casing", () => {
    expect(toSecondPerson("met at the bar; she's a Sable courier")).toBe("met at the bar; she's a Sable courier");
  });
});
