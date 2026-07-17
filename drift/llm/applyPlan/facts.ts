import { applyFactUpdates } from "@/shared/facts";
import type { PlanHandler } from "./types";

/**
 * FACTS LEDGER handler (CONTINUITY.md v2): fold the plan's proposed standing
 * facts into the session ledger — capped, deduped (a restated fact replaces its
 * older wording), oldest-evicted. The ledger array is the SESSION's own (passed
 * by reference into the runtime, like sceneCard), so mutate IN PLACE.
 */
export const facts: PlanHandler = (plan, ctx) => {
  const additions = (plan.facts ?? []).filter((f): f is { text: string; entityRefs?: string[] } => !!f?.text);
  if (!additions.length) return;
  ctx.toolCalls.push("record_facts");
  const tenday = ctx.runtime.state.campaign.tendaysElapsed ?? 0;
  const next = applyFactUpdates(ctx.runtime.facts, additions, tenday);
  ctx.runtime.facts.splice(0, ctx.runtime.facts.length, ...next);
};
