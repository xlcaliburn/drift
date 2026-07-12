import type { Clock } from "@/shared/schemas";
import type { EngineEvent } from "./events";

export interface ClockAdvanceResult {
  clock: Clock;
  crossedMilestones: string[];
  event: EngineEvent;
}

/**
 * Advance a clock by `amount` (default 1), capped at max. Returns the milestone
 * effects newly crossed so the narrator can apply them (they are non-optional).
 */
export function advanceClock(
  clock: Clock,
  amount = 1,
  reason = "",
): ClockAdvanceResult {
  const from = clock.current;
  const to = Math.min(clock.max, clock.current + amount);

  const crossed = clock.milestones
    .filter((m) => m.at > from && m.at <= to && !m.done)
    .map((m) => m.effect);

  const milestones = clock.milestones.map((m) =>
    m.at > from && m.at <= to ? { ...m, done: true } : m,
  );

  const updated: Clock = {
    ...clock,
    current: to,
    milestones,
    status: to >= clock.max ? "complete" : clock.status,
  };

  const reasonStr = reason ? ` (${reason})` : "";
  const crossStr = crossed.length ? ` — triggered: ${crossed.join("; ")}` : "";
  const breakdown = `Clock "${clock.name}": ${from}→${to}/${clock.max}${reasonStr}${crossStr}`;

  return {
    clock: updated,
    crossedMilestones: crossed,
    event: {
      type: "clock",
      breakdown,
      clockId: clock.id,
      from,
      to,
      milestones: crossed,
    },
  };
}

/**
 * Time-based advances: some clocks tick on elapsed time (e.g. Talos "+1 per 3
 * tendays", Sable Chain "each tenday of inaction"). `perTendays` says how many
 * elapsed tendays trigger +1 for a given clock; returns advances to apply.
 */
export function timeTrigger(
  clock: Clock,
  tendaysDelta: number,
  perTendays: number,
): ClockAdvanceResult | null {
  if (perTendays <= 0 || tendaysDelta <= 0) return null;
  const steps = Math.floor(tendaysDelta / perTendays);
  if (steps <= 0) return null;
  return advanceClock(clock, steps, `${tendaysDelta} tendays elapsed`);
}
