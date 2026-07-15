import type { TurnPlan } from "@/shared/turnPlan";
import type { ApplyCtx, PlanHandler } from "./types";
import { money } from "./money";
import { trade, gearItems } from "./inventory";
import { services } from "./services";
import { npcs, continuity, quests, sceneEnd } from "./world";
import { combatStart } from "./combat";

export type { ApplyCtx } from "./types";

/**
 * Apply the plan's mechanical INTENTS through the engine (jsonTurn regions I + J).
 * Every state-changing field the model can emit is applied by an ordered HANDLER —
 * a new mechanic is a new handler file + one registry entry, not an edit inside a
 * monolith (mirrors promptSections; REFACTOR.md Plan 2). Guarded by applyPlan.test.ts.
 *
 * The ORDER is load-bearing — do not reshuffle without reading the invariants:
 *  1. `money` reads ctx.lastRoll (a negotiation shades the band), set by the earlier
 *     pre/mid-turn roll — so plan application runs AFTER those.
 *  2. `combatStart` is LAST and only fires when ctx.combat is still null (a gun-skill
 *     reroute earlier this turn already started the fight and wins). It reads
 *     ctx.preState (PRE-turn) for the net-worth ceiling.
 *  3. The caller reconciles dock debt (syncDockDebt) AFTER this, so scene-end wages
 *     and payouts here are all included.
 */
const HANDLERS: PlanHandler[] = [
  money,        // payout + offers
  trade,        // useItem + purchase + sell
  services,     // repair + patronRest + bodyMod
  npcs,         // register + present + relations
  gearItems,    // items[] → real gear
  continuity,   // scene card + world event
  quests,       // threads + clock advances
  sceneEnd,     // scene close / auto-close
  combatStart,  // LAST — skipped when a reroute already set ctx.combat
];

export function applyPlan(plan: TurnPlan, ctx: ApplyCtx): void {
  for (const handler of HANDLERS) handler(plan, ctx);
}
