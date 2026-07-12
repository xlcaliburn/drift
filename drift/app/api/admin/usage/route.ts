import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { hasSupabase } from "@/lib/state";

export const runtime = "nodejs";

export interface UsageByModel {
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface UsageByUser {
  userId: string;
  email: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  monthlyTokenBudget: number;
  monthlyCostBudgetUsd: number;
  byModel: UsageByModel[];
}

/**
 * GET /api/admin/usage?month=YYYY-MM — turn_usage aggregated by user (+ per
 * model breakdown) for the given calendar month (UTC). Defaults to current.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!hasSupabase()) return NextResponse.json({ month: "", users: [] });

  const now = new Date();
  const monthParam = req.nextUrl.searchParams.get("month");
  const match = monthParam?.match(/^(\d{4})-(\d{2})$/);
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) - 1 : now.getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 1));
  const monthLabel = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`;

  const { getServiceClient } = await import("@/db/queries");
  const db = getServiceClient();

  const [usageRes, profilesRes] = await Promise.all([
    db
      .from("turn_usage")
      .select("user_id,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd")
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString()),
    db.from("profiles").select("id,email,monthly_token_budget,monthly_cost_budget_usd"),
  ]);
  if (usageRes.error) {
    return NextResponse.json({ error: usageRes.error.message }, { status: 500 });
  }

  const profiles = new Map(
    (profilesRes.data ?? []).map((p) => [
      String(p.id),
      {
        email: String(p.email),
        tokenBudget: Number(p.monthly_token_budget ?? 0),
        costBudget: Number(p.monthly_cost_budget_usd ?? 0),
      },
    ]),
  );

  const byUser = new Map<string, UsageByUser>();
  for (const r of usageRes.data ?? []) {
    const userId = String(r.user_id);
    const profile = profiles.get(userId);
    let u = byUser.get(userId);
    if (!u) {
      u = {
        userId,
        email: profile?.email ?? userId,
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        monthlyTokenBudget: profile?.tokenBudget ?? 0,
        monthlyCostBudgetUsd: profile?.costBudget ?? 0,
        byModel: [],
      };
      byUser.set(userId, u);
    }
    const inc = {
      turns: 1,
      inputTokens: Number(r.input_tokens ?? 0),
      outputTokens: Number(r.output_tokens ?? 0),
      cacheReadTokens: Number(r.cache_read_tokens ?? 0),
      cacheWriteTokens: Number(r.cache_write_tokens ?? 0),
      costUsd: Number(r.cost_usd ?? 0),
    };
    u.turns += inc.turns;
    u.inputTokens += inc.inputTokens;
    u.outputTokens += inc.outputTokens;
    u.cacheReadTokens += inc.cacheReadTokens;
    u.cacheWriteTokens += inc.cacheWriteTokens;
    u.costUsd += inc.costUsd;

    const model = String(r.model);
    let m = u.byModel.find((x) => x.model === model);
    if (!m) {
      m = {
        model,
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      };
      u.byModel.push(m);
    }
    m.turns += inc.turns;
    m.inputTokens += inc.inputTokens;
    m.outputTokens += inc.outputTokens;
    m.cacheReadTokens += inc.cacheReadTokens;
    m.cacheWriteTokens += inc.cacheWriteTokens;
    m.costUsd += inc.costUsd;
  }

  const users = [...byUser.values()].sort((a, b) => b.costUsd - a.costUsd);
  return NextResponse.json({ month: monthLabel, users });
}
