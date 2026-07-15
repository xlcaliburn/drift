import { describe, it, expect } from "vitest";
import { trimToLastSentence } from "./history";

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
