import { describe, it, expect } from "vitest";
import { hasDuplication, trimToLastSentence } from "./narrator";

describe("hasDuplication (DeepSeek repeat artifact)", () => {
  it("flags a substantial line repeated verbatim", () => {
    const t =
      "The hauler is tethered to the airlock, 500 meters off your bow.\n" +
      "Hold position and watch from the debris shadows for now.\n" +
      "Hold position and watch from the debris shadows for now.";
    expect(hasDuplication(t)).toBe(true);
  });

  it("does not flag distinct lines", () => {
    const t = "You clamp onto the wreck's hull with a magnetic anchor.\nThrough a cracked viewport you see movement.";
    expect(hasDuplication(t)).toBe(false);
  });

  it("ignores short repeated lines", () => {
    expect(hasDuplication("Yes.\nYes.\nYes.")).toBe(false);
  });
});

describe("trimToLastSentence (max_tokens cutoff)", () => {
  it("drops a dangling final fragment", () => {
    expect(trimToLastSentence("You cycle the airlock. A figure in a")).toBe("You cycle the airlock.");
  });

  it("keeps already-complete text", () => {
    expect(trimToLastSentence("You cycle the airlock. Nothing moves.")).toBe("You cycle the airlock. Nothing moves.");
  });

  it("returns text as-is when there is no sentence end yet", () => {
    expect(trimToLastSentence("A figure in a")).toBe("A figure in a");
  });
});
