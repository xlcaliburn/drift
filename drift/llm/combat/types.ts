import type { CombatState, CombatAction, CombatOutcome, CombatSystemId } from "@/shared/combat";
import type { CombatRT } from "../runtimeCombat";

/**
 * The CombatSystem seam (Modularity M5, HANDOFF_COMBAT_V2_1 Task B) — an
 * extraction shaped by its two consumers: today's ground/ship d20 engine
 * ("classic") and the Eclipse-style ship-power system arriving in slice 2
 * ("ship2"). Every fight already crosses ONE dispatcher
 * (runtimeCombat.resolveCombatRound); this formalizes it as a registry.
 *
 * `action` uses the ENGINE-internal CombatAction (shared/combat.ts) rather
 * than the Zod CombatActionSpec (shared/turnPlan.ts) — the latter is the
 * API-boundary validation shape for untrusted client input, structurally
 * identical but the wrong layer for engine-internal types. Route-level
 * parsing validates with CombatActionSpec, then hands off CombatAction-shaped
 * data down to here.
 */
export { type CombatSystemId };

export interface MemberOrder {
  /** A character id (PC or "party" crew/temporary-ally). */
  memberId: string;
  action: CombatAction;
}

export interface RoundResult {
  combat: CombatState;
  lines: string[];
  outcome: CombatOutcome;
  loot: number;
}

export interface CombatSystem {
  resolveRound(rt: CombatRT, state: CombatState, orders: MemberOrder[]): RoundResult;
}
