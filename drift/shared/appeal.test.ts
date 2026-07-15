import { describe, it, expect } from "vitest";
import { isAppeal, stripAppeal, AppealRuling } from "./appeal";

describe("appeal detection", () => {
  it("recognizes the APPEAL marker in its forms", () => {
    for (const t of ["APPEAL: I should have a stim", "appeal i should have a stim", "/appeal: revive me"]) {
      expect(isAppeal(t)).toBe(true);
    }
  });
  it("does not fire on ordinary play", () => {
    for (const t of ["I appeal to his better nature", "shoot the guard", "The appealing offer"]) {
      expect(isAppeal(t)).toBe(false);
    }
  });
  it("strips the marker to the bare complaint", () => {
    expect(stripAppeal("APPEAL: Draven gave me a stim")).toBe("Draven gave me a stim");
    expect(stripAppeal("/appeal revive me")).toBe("revive me");
  });
});

describe("AppealRuling schema", () => {
  it("accepts a granted ruling with valid adjustments", () => {
    const r = AppealRuling.safeParse({
      granted: true,
      ruling: "Draven did hand you the stim — corrected.",
      adjustments: [{ kind: "grantItem", name: "stim", qty: 1 }, { kind: "adjustHp", delta: 4 }],
    });
    expect(r.success).toBe(true);
  });
  it("defaults adjustments to [] and rejects an unknown kind", () => {
    const denied = AppealRuling.safeParse({ granted: false, ruling: "No merit." });
    expect(denied.success && denied.data.adjustments).toEqual([]);
    const bad = AppealRuling.safeParse({ granted: true, ruling: "x", adjustments: [{ kind: "teleport" }] });
    expect(bad.success).toBe(false);
  });
});
