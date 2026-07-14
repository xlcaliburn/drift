import { describe, it, expect } from "vitest";
import {
  readDeathSave,
  advanceSaves,
  trackOutcome,
  saveTrackLabel,
  interpretDownedText,
  downedActions,
  freshDeathSaves,
} from "./death";

describe("readDeathSave — one d20 → track effect (D&D rules)", () => {
  it("10+ is a success, 9- a failure", () => {
    expect(readDeathSave(10)).toMatchObject({ kind: "success", successes: 1 });
    expect(readDeathSave(15)).toMatchObject({ kind: "success", successes: 1 });
    expect(readDeathSave(9)).toMatchObject({ kind: "failure", failures: 1 });
    expect(readDeathSave(2)).toMatchObject({ kind: "failure", failures: 1 });
  });

  it("nat 20 rallies; nat 1 is two failures", () => {
    expect(readDeathSave(20).kind).toBe("rally");
    expect(readDeathSave(1)).toMatchObject({ kind: "failure", failures: 2 });
  });

  it("an edge lowers the bar (cover: success on 8+)", () => {
    expect(readDeathSave(8, 2).kind).toBe("success");
    expect(readDeathSave(7, 2).kind).toBe("failure");
  });
});

describe("trackOutcome — three of either ends it", () => {
  it("3 successes stabilise, 3 failures die", () => {
    expect(trackOutcome({ successes: 3, failures: 0 })).toBe("stabilized");
    expect(trackOutcome({ successes: 0, failures: 3 })).toBe("dead");
    expect(trackOutcome({ successes: 2, failures: 2 })).toBe("continue");
  });

  it("the tutorial never tips into death", () => {
    expect(trackOutcome({ successes: 0, failures: 3 }, { inTutorial: true })).toBe("continue");
    expect(trackOutcome({ successes: 3, failures: 3 }, { inTutorial: true })).toBe("stabilized");
  });

  it("stabilise wins a tie (3/3) — you pulled through", () => {
    expect(trackOutcome({ successes: 3, failures: 3 })).toBe("stabilized");
  });
});

describe("advanceSaves + label", () => {
  it("accumulates and never goes negative", () => {
    expect(advanceSaves(freshDeathSaves(), { failures: 2 })).toEqual({ successes: 0, failures: 2 });
    expect(advanceSaves({ successes: 1, failures: 1 }, { successes: 1 })).toEqual({ successes: 2, failures: 1 });
  });

  it("renders a readable pip track", () => {
    expect(saveTrackLabel({ successes: 2, failures: 1 })).toBe("saves ●●○ / fails ✕○○");
  });
});

describe("interpretDownedText — free text → desperate act", () => {
  it("routes stims, cover, help; defaults to hold on", () => {
    expect(interpretDownedText("jam a stim in my leg")).toEqual({ kind: "item", itemId: "stim" });
    expect(interpretDownedText("use the medkit")).toEqual({ kind: "item", itemId: "medkit" });
    expect(interpretDownedText("crawl behind the crates")).toMatchObject({ kind: "cover" });
    expect(interpretDownedText("scream for help")).toMatchObject({ kind: "help" });
    expect(interpretDownedText("clench my jaw and refuse to die")).toMatchObject({ kind: "hold" });
  });
});

describe("downedActions — engine-generated chips", () => {
  it("always offers hold + cover; stim/medkit only when held; help only with an ally", () => {
    const bare = downedActions([], false).map((c) => c.downedAction.kind);
    expect(bare).toEqual(["hold", "cover"]);

    const armed = downedActions([{ itemId: "stim", name: "Stim", count: 2 }], true);
    expect(armed.map((c) => c.downedAction.kind)).toEqual(["hold", "cover", "item", "help"]);
    expect(armed.find((c) => c.downedAction.kind === "item")?.downedAction.itemId).toBe("stim");
  });

  it("ignores non-healing consumables (a frag isn't a lifeline)", () => {
    const chips = downedActions([{ itemId: "frag", name: "Frag grenade", count: 1 }], false);
    expect(chips.some((c) => c.downedAction.kind === "item")).toBe(false);
  });
});
