import { describe, it, expect } from "vitest";
import type { Location } from "./schemas";
import { inferLocationFromPlace } from "./locationSync";

/** The real canonical cast (ids + names as seeded live). */
const LOCATIONS = [
  { id: "loc-meridian", name: "Meridian Ring" },
  { id: "loc-rook", name: "Rook Station" },
  { id: "loc-talos", name: "Talos Station" },
  { id: "loc-shear", name: "The Shear" },
  { id: "loc-undertow", name: "Undertow outpost" },
  { id: "loc-nest", name: "The Nest" },
  { id: "loc-freeport", name: "Halcyon" },
  { id: "loc-sable", name: "Coldharbor" },
  { id: "loc-cinder", name: "Cinderhaul" },
  { id: "loc-wake", name: "The Wake" },
] as unknown as Location[];

const infer = (place?: string) => inferLocationFromPlace(place, LOCATIONS);

describe("inferLocationFromPlace — the engine-owned location backstop", () => {
  it("resolves every live desynced place line to the station the fiction is at", () => {
    // These are the ACTUAL scene_card.place values from the 6-of-10 desynced live
    // campaigns the backstop was born from (CHECKS.md §8).
    expect(infer("Halcyon — Rust Anchor, main floor")).toBe("loc-freeport"); // Lyra (engine said Meridian)
    expect(infer("Halcyon — Berth 12, cockpit of The Tally")).toBe("loc-freeport"); // Cali
    expect(infer("Coldharbor's Den — back booth")).toBe("loc-sable"); // Sparrow (possessive form)
    expect(infer("Rook Station — Undertow market docking ring")).toBe("loc-rook"); // Isko
    expect(infer("Meridian Ring — broker's kiosk, commercial concourse")).toBe("loc-meridian"); // Cinder
    expect(infer("Rook Station — Nest cargo bay")).toBe("loc-rook"); // Ana — earliest match wins over "Nest"
  });

  it("matches a station named mid-string, not only at position 0", () => {
    expect(infer("Sector 6, Rook Station — Calvo's docking bay")).toBe("loc-rook"); // Nix (live)
  });

  it("prefers the EARLIEST name when several appear (station leads; later names are flavor)", () => {
    // "Talos hauler" doesn't even match ("Talos Station" is the full name), but
    // Undertow outpost vs Rook: the leading station must win regardless.
    expect(infer("The Shear — grappled to a drifting Talos hauler")).toBe("loc-shear"); // Voss (live)
    expect(infer("Undertow outpost — Rook Station courier drop")).toBe("loc-undertow");
  });

  it("returns undefined for transit / unnamed places (no false arrival)", () => {
    expect(infer("aboard the Dust Eater, in the black")).toBeUndefined();
    expect(infer("a nameless service corridor")).toBeUndefined();
    expect(infer(undefined)).toBeUndefined();
    expect(infer("   ")).toBeUndefined();
  });

  it("NEVER reads a destination phrase as an arrival (shuttle to X, bound for X)", () => {
    expect(infer("shuttle to Halcyon, two hours out")).toBeUndefined();
    expect(infer("en route to Rook Station")).toBeUndefined();
    expect(infer("bound for the Nest")).toBeUndefined();
    expect(infer("burning hard toward Coldharbor")).toBeUndefined();
  });

  it("a destination phrase does not mask a real arrival named earlier", () => {
    // At Halcyon, discussing a run to Rook — the arrival (earliest) still wins.
    expect(infer("Halcyon — charter desk, booking passage to Rook Station")).toBe("loc-freeport");
  });

  it("is word-boundary safe (no partial-word hits) and case-insensitive", () => {
    expect(infer("the nested vents above the galley")).toBeUndefined(); // "Nest" ⊄ "nested"
    expect(infer("HALCYON — customs line")).toBe("loc-freeport");
    expect(infer("the shear — void side")).toBe("loc-shear");
  });
});
