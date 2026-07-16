import { economy } from "@/content";
import type { EngineEvent } from "./events";

const C = economy.constants;

export interface CostResult {
  creditsDelta: number;
  events: EngineEvent[];
  breakdown: string;
}

/**
 * Standard per-scene costs from the DM checklist:
 * - each docking: -¢15 dock fee
 * Crew wages are NO LONGER charged here — they moved to per-TENDAY upkeep charged
 * as the clock advances (CREW.md §6, shared/crew.chargeCrewUpkeep; the old flat
 * ¢50-per-paying-job wage would double-charge). Missiles fired are NOT charged
 * here (only when re-bought); ammo is tracked separately via resource deltas.
 */
export function applySceneCosts(input: {
  paying: boolean;
  /** @deprecated wages are per-tenday now (kept so old call sites type-check). */
  crewWithWages?: number;
  dockings: number;
}): CostResult {
  const events: EngineEvent[] = [];
  let delta = 0;

  if (input.dockings > 0) {
    const fees = C.dockFee * input.dockings;
    delta -= fees;
    events.push({
      type: "cost",
      breakdown: `Dock fees: -¢${fees} (¢${C.dockFee} × ${input.dockings})`,
      amount: -fees,
    });
  }

  return {
    creditsDelta: delta,
    events,
    breakdown: `Scene costs: ¢${delta}`,
  };
}

/** Repair cost for N hull points at ¢18/HP. */
export function repairCost(hp: number): number {
  return hp * C.repairCostPerHp;
}

/** Cost to buy N missiles at ¢51 each. */
export function missileCost(count: number): number {
  return count * C.missileCost;
}
