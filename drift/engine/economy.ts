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
 * - after a PAYING job: -¢50 wage per crew member with a wage
 * - each docking: -¢15 dock fee
 * Missiles fired are NOT charged here (only when re-bought); ammo is tracked
 * separately via resource deltas.
 */
export function applySceneCosts(input: {
  paying: boolean;
  crewWithWages: number;
  dockings: number;
}): CostResult {
  const events: EngineEvent[] = [];
  let delta = 0;

  if (input.paying && input.crewWithWages > 0) {
    const wages = C.crewWagePerPayingJob * input.crewWithWages;
    delta -= wages;
    events.push({
      type: "cost",
      breakdown: `Crew wages: -¢${wages} (¢${C.crewWagePerPayingJob} × ${input.crewWithWages})`,
      amount: -wages,
    });
  }

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
