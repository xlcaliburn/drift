import { describe, it, expect } from "vitest";
import { fmtCredits, TENDAY, TENDAYS, WORLD_NOUNS } from "./lexicon";

describe("shared/lexicon — the M2 seed", () => {
  it("fmtCredits matches the existing engine format exactly", () => {
    expect(fmtCredits(56)).toBe("¢56");
    expect(fmtCredits(0)).toBe("¢0");
    expect(fmtCredits(-12)).toBe("¢-12");
  });

  it("word constants are stable", () => {
    expect(TENDAY).toBe("tenday");
    expect(TENDAYS).toBe("tendays");
    expect(WORLD_NOUNS.ship).toBe("ship");
    expect(WORLD_NOUNS.hull).toBe("hull");
    expect(WORLD_NOUNS.dock).toBe("dock");
    expect(WORLD_NOUNS.station).toBe("station");
  });
});
