import "server-only";
import { hasSupabase } from "@/lib/state";
import type { AuthedUser } from "@/lib/auth";
import { estimateCostUsd, totalTokens, type TokenUsage } from "@/lib/pricing";

/**
 * Per-turn usage metering + monthly budget checks against turn_usage.
 * Recording is best-effort (log, never throw — same contract as
 * persistSession): a metering hiccup must not eat a narrated turn.
 */

export interface MonthUsage {
  totalTokens: number;
  costUsd: number;
  turns: number;
}

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Month-to-date usage for one user. Zeroes when Supabase is off. */
export async function getMonthUsage(userId: string): Promise<MonthUsage> {
  if (!hasSupabase()) return { totalTokens: 0, costUsd: 0, turns: 0 };
  const { getServiceClient } = await import("@/db/queries");
  const { data, error } = await getServiceClient()
    .from("turn_usage")
    .select("input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd")
    .eq("user_id", userId)
    .gte("created_at", monthStartIso());
  if (error || !data) return { totalTokens: 0, costUsd: 0, turns: 0 };
  return data.reduce<MonthUsage>(
    (acc, r) => ({
      totalTokens:
        acc.totalTokens +
        Number(r.input_tokens ?? 0) +
        Number(r.output_tokens ?? 0) +
        Number(r.cache_read_tokens ?? 0) +
        Number(r.cache_write_tokens ?? 0),
      costUsd: acc.costUsd + Number(r.cost_usd ?? 0),
      turns: acc.turns + 1,
    }),
    { totalTokens: 0, costUsd: 0, turns: 0 },
  );
}

/** Global kill-switch for the hard caps. Budgets are OFF by default (they're
 *  "removed for everyone for now") — metering + recording continue regardless, so
 *  usage is still tracked and visible in the admin panel; nothing is blocked. Set
 *  ENFORCE_BUDGET_CAPS=1 (or true/yes) to turn hard enforcement back on. */
function budgetCapsEnforced(): boolean {
  const v = (process.env.ENFORCE_BUDGET_CAPS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Hard-cap check. Blocks when either the token or the cost budget is spent —
 *  UNLESS caps are disabled (the current default; see budgetCapsEnforced). */
export function checkBudget(
  user: AuthedUser,
  month: MonthUsage,
): { ok: true } | { ok: false; reason: string } {
  if (!budgetCapsEnforced()) return { ok: true };
  if (month.totalTokens >= user.monthlyTokenBudget) {
    return { ok: false, reason: `token cap ${user.monthlyTokenBudget.toLocaleString()} reached` };
  }
  if (month.costUsd >= user.monthlyCostBudgetUsd) {
    return { ok: false, reason: `cost cap $${user.monthlyCostBudgetUsd.toFixed(2)} reached` };
  }
  return { ok: true };
}

/**
 * Record one turn's usage. Cost is estimated at write time so the budget
 * aggregate stays a plain SUM. Note: a mid-turn provider fallback (DeepSeek →
 * Haiku) books the whole turn under the final model — an acceptable estimate.
 */
export async function recordTurnUsage(entry: {
  userId: string;
  campaignId: string;
  model: string;
  usage: TokenUsage;
}): Promise<void> {
  if (!hasSupabase()) return;
  try {
    const { getServiceClient } = await import("@/db/queries");
    const { error } = await getServiceClient().from("turn_usage").insert({
      user_id: entry.userId,
      campaign_id: entry.campaignId,
      model: entry.model,
      input_tokens: entry.usage.inputTokens,
      output_tokens: entry.usage.outputTokens,
      cache_read_tokens: entry.usage.cacheReadTokens,
      cache_write_tokens: entry.usage.cacheWriteTokens,
      cost_usd: estimateCostUsd(entry.model, entry.usage),
    });
    if (error) console.error("recordTurnUsage failed", error);
  } catch (err) {
    console.error("recordTurnUsage failed", err);
  }
}

export { totalTokens };
