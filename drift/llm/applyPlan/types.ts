import type { CampaignState, Character } from "@/shared/schemas";
import type { TurnPlan } from "@/shared/turnPlan";
import type { CombatState } from "@/shared/combat";
import type { TurnRuntime } from "../engineBridge";

/**
 * Shared context for every plan handler. The TurnRuntime is the only mutator, so
 * a handler is a pure `(plan, ctx) => void` that reads the plan and drives the
 * engine + emits lines. `combat` is mutable state (the combatStart handler writes
 * it; others read it) — mutate `ctx.combat` directly, don't destructure it.
 */
export interface ApplyCtx {
  runtime: TurnRuntime;
  /** The PRE-turn state (input.state) — used for the combat net-worth ceiling. */
  preState: CampaignState;
  pc: Character | undefined;
  emit: (lines: string[]) => void;
  toolCalls: string[];
  /** Last resolved action check this turn (set by the pre/mid-turn roll). */
  lastRoll: { skill: string; outcome?: string } | null;
  /** Combat spawned this turn — combatStart sets it; a reroute may have already. */
  combat: CombatState | null;
}

export type PlanHandler = (plan: TurnPlan, ctx: ApplyCtx) => void;
