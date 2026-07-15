import { describe, it, expect } from "vitest";
import { isEchoOfPrevious } from "./jsonTurn";

const beat =
  "Sera's fork clatters to the crate. She stares at you for a long moment, then lets out a low breath — almost a laugh. 'You know, most people just lie about their name. You're something else.'";

describe("isEchoOfPrevious — the 'same answer 3 times' guard", () => {
  it("flags a verbatim repeat of the previous narration", () => {
    expect(isEchoOfPrevious(beat, beat)).toBe(true);
  });

  it("flags a near-verbatim repeat (punctuation/whitespace drift)", () => {
    expect(isEchoOfPrevious(beat + "  ", beat.replace(/—/g, "-"))).toBe(true);
  });

  it("flags an echo that shares a long identical opening", () => {
    const trimmedTail = beat.slice(0, 160) + " She shakes her head and stands.";
    expect(isEchoOfPrevious(beat, trimmedTail)).toBe(true);
  });

  it("does NOT flag a genuinely different next beat", () => {
    const next =
      "You follow Sera through the market's back corridors to Dock 14. Doran Vex is already there, counting credsticks by a rusted crane.";
    expect(isEchoOfPrevious(next, beat)).toBe(false);
  });

  it("does not judge very short fragments", () => {
    expect(isEchoOfPrevious("Okay.", "Okay.")).toBe(false);
  });
});
