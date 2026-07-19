import { describe, it, expect } from "vitest";
import { advancePrologue, prologueDirective } from "./prologue";
import { pack } from "@/content/pack";
import type { PrologueStage } from "./schemas";

describe("shared/prologue — advancePrologue", () => {
  it("walks the full intro → groundFight → shipFight → graduation → complete arc", () => {
    let stage: PrologueStage = "intro";

    let step = advancePrologue(stage, { turnCompleted: true, combatResolvedAlive: false });
    expect(step.stage).toBe("groundFight");
    expect(step.allyDeparts).toBe(false);
    expect(step.lines.length).toBeGreaterThan(0);
    stage = step.stage;

    step = advancePrologue(stage, { turnCompleted: true, combatResolvedAlive: true, resolvedScale: "personal" });
    expect(step.stage).toBe("shipFight");
    expect(step.allyDeparts).toBe(false);
    stage = step.stage;

    step = advancePrologue(stage, { turnCompleted: true, combatResolvedAlive: true, resolvedScale: "ship" });
    expect(step.stage).toBe("graduation");
    expect(step.allyDeparts).toBe(false);
    stage = step.stage;

    step = advancePrologue(stage, { turnCompleted: true, combatResolvedAlive: false });
    expect(step.stage).toBe("complete");
    expect(step.allyDeparts).toBe(true);
    stage = step.stage;

    step = advancePrologue(stage, { turnCompleted: true, combatResolvedAlive: true, resolvedScale: "ship" });
    expect(step.stage).toBe("complete");
    expect(step.allyDeparts).toBe(false);
    expect(step.lines).toEqual([]);
  });

  it("does not advance intro without a completed turn", () => {
    const step = advancePrologue("intro", { turnCompleted: false, combatResolvedAlive: false });
    expect(step.stage).toBe("intro");
    expect(step.lines).toEqual([]);
  });

  it("a personal-scale win does not advance shipFight", () => {
    const step = advancePrologue("shipFight", { turnCompleted: true, combatResolvedAlive: true, resolvedScale: "personal" });
    expect(step.stage).toBe("shipFight");
    expect(step.lines).toEqual([]);
  });

  it("a ship-scale win does not advance groundFight", () => {
    const step = advancePrologue("groundFight", { turnCompleted: true, combatResolvedAlive: true, resolvedScale: "ship" });
    expect(step.stage).toBe("groundFight");
    expect(step.lines).toEqual([]);
  });

  it("a fight resolved NOT alive does not advance groundFight or shipFight", () => {
    expect(advancePrologue("groundFight", { turnCompleted: true, combatResolvedAlive: false, resolvedScale: "personal" }).stage).toBe("groundFight");
    expect(advancePrologue("shipFight", { turnCompleted: true, combatResolvedAlive: false, resolvedScale: "ship" }).stage).toBe("shipFight");
  });

  it("graduation only advances on a completed turn, and only it sets allyDeparts", () => {
    const notYet = advancePrologue("graduation", { turnCompleted: false, combatResolvedAlive: false });
    expect(notYet.stage).toBe("graduation");
    expect(notYet.allyDeparts).toBe(false);

    const done = advancePrologue("graduation", { turnCompleted: true, combatResolvedAlive: false });
    expect(done.stage).toBe("complete");
    expect(done.allyDeparts).toBe(true);
  });

  it("complete is terminal — no signal moves it further", () => {
    const step = advancePrologue("complete", { turnCompleted: true, combatResolvedAlive: true, resolvedScale: "ship" });
    expect(step.stage).toBe("complete");
    expect(step.allyDeparts).toBe(false);
    expect(step.lines).toEqual([]);
  });
});

describe("shared/prologue — prologueDirective", () => {
  it("resolves every {ally}/{patron} placeholder for every faction and stage", () => {
    for (const faction of pack.factions) {
      const ally = pack.prologue.allies[faction.id];
      if (!ally) continue;
      for (const stage of ["intro", "groundFight", "shipFight", "graduation"] as const) {
        const line = prologueDirective(pack, faction.id, stage);
        expect(line).toBeTruthy();
        expect(line).not.toMatch(/\{ally\}|\{patron\}/);
      }
    }
  });

  it("fills {ally} with the faction's authored ally name where the directive references it", () => {
    const line = prologueDirective(pack, "f-crown", "intro");
    expect(line).toContain(pack.prologue.allies["f-crown"].name);
  });

  it("returns null once the stage is complete", () => {
    const factionId = pack.factions[0]?.id;
    expect(prologueDirective(pack, factionId, "complete")).toBeNull();
  });

  it("returns null with no faction id", () => {
    expect(prologueDirective(pack, undefined, "intro")).toBeNull();
  });

  it("returns null for an unauthored faction", () => {
    expect(prologueDirective(pack, "f-does-not-exist", "intro")).toBeNull();
  });
});
