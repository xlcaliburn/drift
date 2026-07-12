import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { hasSupabase } from "@/lib/state";

export const runtime = "nodejs";

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "player";
  status: "pending" | "approved" | "suspended";
  monthlyTokenBudget: number;
  monthlyCostBudgetUsd: number;
  createdAt?: string;
  monthTokens: number;
  monthCostUsd: number;
  monthTurns: number;
}

/** GET /api/admin/users — all profiles + month-to-date usage. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!hasSupabase()) return NextResponse.json({ users: [] });

  const { getServiceClient } = await import("@/db/queries");
  const db = getServiceClient();

  const monthStart = new Date();
  const monthStartIso = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1),
  ).toISOString();

  const [profilesRes, usageRes] = await Promise.all([
    db.from("profiles").select("*").order("created_at", { ascending: true }),
    db
      .from("turn_usage")
      .select("user_id,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd")
      .gte("created_at", monthStartIso),
  ]);
  if (profilesRes.error) {
    return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
  }

  const byUser = new Map<string, { tokens: number; cost: number; turns: number }>();
  for (const r of usageRes.data ?? []) {
    const key = String(r.user_id);
    const acc = byUser.get(key) ?? { tokens: 0, cost: 0, turns: 0 };
    acc.tokens +=
      Number(r.input_tokens ?? 0) +
      Number(r.output_tokens ?? 0) +
      Number(r.cache_read_tokens ?? 0) +
      Number(r.cache_write_tokens ?? 0);
    acc.cost += Number(r.cost_usd ?? 0);
    acc.turns += 1;
    byUser.set(key, acc);
  }

  const users: AdminUserRow[] = (profilesRes.data ?? []).map((p) => {
    const u = byUser.get(String(p.id)) ?? { tokens: 0, cost: 0, turns: 0 };
    return {
      id: String(p.id),
      email: String(p.email),
      displayName: String(p.display_name ?? p.email),
      role: p.role === "admin" ? "admin" : "player",
      status:
        p.status === "approved" ? "approved" : p.status === "suspended" ? "suspended" : "pending",
      monthlyTokenBudget: Number(p.monthly_token_budget ?? 0),
      monthlyCostBudgetUsd: Number(p.monthly_cost_budget_usd ?? 0),
      createdAt: p.created_at ? String(p.created_at) : undefined,
      monthTokens: u.tokens,
      monthCostUsd: u.cost,
      monthTurns: u.turns,
    };
  });

  return NextResponse.json({ users });
}

const PatchBody = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "suspended"]).optional(),
  monthlyTokenBudget: z.number().int().min(0).optional(),
  monthlyCostBudgetUsd: z.number().min(0).optional(),
});

/** PATCH /api/admin/users { id, status?, monthlyTokenBudget?, monthlyCostBudgetUsd? } */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 400 });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { id, status, monthlyTokenBudget, monthlyCostBudgetUsd } = parsed.data;

  // Lockout guard: an admin cannot change their own status.
  if (status !== undefined && id === auth.user.id) {
    return NextResponse.json({ error: "You can't change your own status." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (status !== undefined) update.status = status;
  if (monthlyTokenBudget !== undefined) update.monthly_token_budget = monthlyTokenBudget;
  if (monthlyCostBudgetUsd !== undefined) update.monthly_cost_budget_usd = monthlyCostBudgetUsd;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { getServiceClient } = await import("@/db/queries");
  const { data, error } = await getServiceClient()
    .from("profiles")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
