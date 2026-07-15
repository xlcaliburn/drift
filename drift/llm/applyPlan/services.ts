import type { PlanHandler } from "./types";

/**
 * Model-initiated engine SERVICES: dock repair (ECONOMY E-3), the patron safety
 * net (STARTER.md), and the Rook body-mod studio. Each is a single engine call
 * whose success/failure line is surfaced to the player.
 */
export const services: PlanHandler = (plan, { runtime, pc, emit, toolCalls }) => {
  // Dock repair — model-initiated ("patch me up at the dock").
  if (plan.repair && pc) {
    toolCalls.push("repair_ship");
    const res = runtime.repairShip(plan.repair.hp ?? undefined);
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ ${res.error}`]);
  }
  // Patron safety net — model-initiated ("rest up with your patron").
  if (plan.patronRest && pc) {
    toolCalls.push("rest_patron");
    const res = runtime.restWithPatron();
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ ${res.error}`]);
  }
  // Rook body-modification (Chrome's studio) — reshape appearance + story for ¢500.
  if (plan.bodyMod && pc) {
    toolCalls.push("body_mod");
    const res = runtime.bodyMod({
      appearance: plan.bodyMod.appearance ?? undefined,
      story: plan.bodyMod.story ?? undefined,
    });
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ ${res.error}`]);
  }
};
