import { describe, it, expect } from "vitest";
import { redactMoney } from "./jsonTurn";

describe("redactMoney — engine owns every credit figure", () => {
  it("scrubs digit + currency-word forms", () => {
    expect(redactMoney("She slides 1,800 credits across the table.")).toBe(
      "She slides a fair sum across the table.",
    );
    expect(redactMoney("The job pays 185 creds, no more.")).toBe(
      "The job pays a fair sum, no more.",
    );
    expect(redactMoney("A flat 250 credit bounty.")).toBe("A flat a fair sum bounty.");
  });

  it("scrubs the ¢ sign glued to digits, either side", () => {
    expect(redactMoney("Marked ¢450 on the manifest.")).toBe("Marked a fair sum on the manifest.");
    expect(redactMoney("Worth 1,800¢ if you can move it.")).toBe(
      "Worth a fair sum if you can move it.",
    );
  });

  it("scrubs the bare trailing-c form (1800c)", () => {
    expect(redactMoney("He counters with 1800c.")).toBe("He counters with a fair sum.");
  });

  it("scrubs number-WORD forms (the negotiation runaway)", () => {
    expect(redactMoney("She narrated it as eighteen hundred credits.")).toBe(
      "She narrated it as a fair sum.",
    );
    expect(redactMoney("A rival buyer offered twelve hundred creds.")).toBe(
      "A rival buyer offered a fair sum.",
    );
    expect(redactMoney("The score's worth two thousand credits, easy.")).toBe(
      "The score's worth a fair sum, easy.",
    );
    expect(redactMoney("Fifty credits and not a coin more.")).toBe(
      "a fair sum and not a coin more.",
    );
  });

  it("leaves non-money numbers alone (false-positive guard)", () => {
    const samples = [
      "You drop to deck 4 and cut left.",
      "Three guards block the corridor.",
      "The lift stops at level 7.",
      "Twenty crates are stacked by the airlock.",
      "It takes 3 hours to burn out-system.",
      "A hundred voices roar at once.",
    ];
    for (const s of samples) expect(redactMoney(s)).toBe(s);
  });

  it("does not mangle words that merely contain a currency substring", () => {
    expect(redactMoney("The deal was credited to your account.")).toBe(
      "The deal was credited to your account.",
    );
    // "100cc" (cubic centimetres) is not "100c" money — boundary must hold.
    expect(redactMoney("A 100cc vial of stim.")).toBe("A 100cc vial of stim.");
  });

  it("handles empty / plain narration untouched", () => {
    expect(redactMoney("")).toBe("");
    expect(redactMoney("The lanes keep turning around you.")).toBe(
      "The lanes keep turning around you.",
    );
  });
});
