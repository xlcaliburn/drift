import { describe, it, expect } from "vitest";
import { deriveLocationTier, locationTier, locationDangerLabel } from "./locations";

describe("location tiers", () => {
  it("derives the danger tier from tags — highest present wins", () => {
    expect(deriveLocationTier(["crown", "home", "commerce"])).toBe("T1"); // Meridian
    expect(deriveLocationTier(["blackmarket", "lawless"])).toBe("T2"); // Rook
    expect(deriveLocationTier(["contested"])).toBe("T2"); // Undertow
    expect(deriveLocationTier(["hostile"])).toBe("T3"); // Talos
    expect(deriveLocationTier(["hazard", "unexplained"])).toBe("T3"); // The Shear
    expect(deriveLocationTier(["lawless", "hidden", "shear", "raiders"])).toBe("T3"); // The Nest — shear/raiders win over lawless
  });

  it("defaults an untagged place to the secure tier", () => {
    expect(deriveLocationTier([])).toBe("T1");
    expect(deriveLocationTier()).toBe("T1");
  });

  it("prefers an explicit hand-set tier over the tag derivation", () => {
    expect(locationTier({ tier: "T3", tags: ["home"] })).toBe("T3"); // override
    expect(locationTier({ tags: ["blackmarket"] })).toBe("T2"); // derived
    expect(locationTier(null)).toBe("T1");
  });

  it("labels a tier for the prompt/UI", () => {
    expect(locationDangerLabel("T1")).toBe("T1 · secure");
    expect(locationDangerLabel("T2")).toBe("T2 · rough");
    expect(locationDangerLabel("T3")).toBe("T3 · deadly");
  });
});
