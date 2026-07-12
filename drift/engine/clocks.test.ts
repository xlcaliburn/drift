import { describe, it, expect } from "vitest";
import { advanceClock, timeTrigger } from "./clocks";
import { clocks } from "@/scripts/seedData";

const sable = clocks.find((c) => c.id === "clk-sable")!;
const talos = clocks.find((c) => c.id === "clk-talos")!;

describe("advanceClock", () => {
  it("Sable Chain 3→4 crosses the 'hit a contact' milestone", () => {
    const res = advanceClock(sable, 1, "bulk run completed");
    expect(res.clock.current).toBe(4);
    expect(res.crossedMilestones).toEqual(["hit a contact (Ledger or broker)"]);
    expect(res.event.breakdown).toContain("3→4/6");
  });

  it("does not re-trigger already-done milestones", () => {
    const res = advanceClock(sable, 1);
    // milestones at 2 and 3 are already done; only 4 newly crossed
    expect(res.crossedMilestones).toEqual(["hit a contact (Ledger or broker)"]);
  });

  it("caps at max and marks complete", () => {
    const res = advanceClock(sable, 10);
    expect(res.clock.current).toBe(6);
    expect(res.clock.status).toBe("complete");
  });

  it("does not mutate the input clock", () => {
    advanceClock(sable, 3);
    expect(sable.current).toBe(3);
  });
});

describe("timeTrigger", () => {
  it("Talos +1 per 3 tendays: 6 elapsed -> +2", () => {
    const res = timeTrigger(talos, 6, 3);
    expect(res).not.toBeNull();
    expect(res!.clock.current).toBe(2);
  });
  it("under threshold -> no advance", () => {
    expect(timeTrigger(talos, 2, 3)).toBeNull();
  });
});
