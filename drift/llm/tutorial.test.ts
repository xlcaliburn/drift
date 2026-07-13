import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import {
  inTutorial,
  resolvedQuestCount,
  graduatedTutorialThisTurn,
  TUTORIAL_QUEST_TARGET,
} from "@/shared/tutorial";

// Minimal state: only `threads` is read by inTutorial / offerChoices.
const stateWith = (resolved: number, active = 1): CampaignState =>
  ({
    threads: [
      ...Array.from({ length: resolved }, (_, i) => ({ status: "resolved", id: `r${i}` })),
      ...Array.from({ length: active }, (_, i) => ({ status: "active", id: `a${i}` })),
    ],
  }) as unknown as CampaignState;

const runOfferChoices = (state: CampaignState, choices: string[]) => {
  const rt = new TurnRuntime(state);
  rt.execute("offer_choices", { choices });
  return rt.choices;
};

describe("tutorial gating", () => {
  it("window is open below the target and closed at/after it", () => {
    expect(TUTORIAL_QUEST_TARGET).toBe(3);
    expect(inTutorial(stateWith(0))).toBe(true);
    expect(inTutorial(stateWith(2))).toBe(true);
    expect(inTutorial(stateWith(3))).toBe(false);
    expect(inTutorial(stateWith(5))).toBe(false);
    expect(resolvedQuestCount(stateWith(2))).toBe(2);
  });

  it("clamps offer_choices to exactly 2 while in tutorial", () => {
    expect(runOfferChoices(stateWith(0), ["Yes", "No", "Maybe", "Negotiate"])).toEqual(["Yes", "No"]);
    expect(runOfferChoices(stateWith(2), ["Take it", "Walk", "Haggle"])).toEqual(["Take it", "Walk"]);
  });

  it("restores full branching (up to 4) once graduated", () => {
    expect(runOfferChoices(stateWith(3), ["A", "B", "C", "D"])).toEqual(["A", "B", "C", "D"]);
    expect(runOfferChoices(stateWith(4), ["A", "B", "C"])).toEqual(["A", "B", "C"]);
  });

  it("graduation fires only on the 2->3 crossing, never before or after", () => {
    expect(graduatedTutorialThisTurn(stateWith(1), stateWith(2))).toBe(false); // still in
    expect(graduatedTutorialThisTurn(stateWith(2), stateWith(3))).toBe(true); // crosses
    expect(graduatedTutorialThisTurn(stateWith(3), stateWith(4))).toBe(false); // already out
    expect(graduatedTutorialThisTurn(stateWith(2), stateWith(4))).toBe(true); // crosses (skips)
  });
});
