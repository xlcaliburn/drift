import "server-only";
import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/state";

/**
 * Authorization for pages and route handlers. All table access runs through
 * the service client (RLS bypassed), so these guards ARE the enforcement —
 * every route handler calls one first.
 *
 * Keyless local dev (no Supabase env): getAuthedUser() returns a stub
 * admin+approved "dev" user so the in-memory flow keeps working untouched.
 */

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "player";
  status: "pending" | "approved" | "suspended";
  monthlyTokenBudget: number;
  monthlyCostBudgetUsd: number;
}

const DEV_USER: AuthedUser = {
  id: "dev",
  email: "dev@localhost",
  displayName: "Dev",
  role: "admin",
  status: "approved",
  monthlyTokenBudget: Number.MAX_SAFE_INTEGER,
  monthlyCostBudgetUsd: Number.MAX_SAFE_INTEGER,
};

/** True when the request is running without Supabase (in-memory dev mode). */
export function isDevUser(user: AuthedUser): boolean {
  return user.id === "dev";
}

/**
 * The signed-in user's profile, or null when unauthenticated.
 * A missing profile row (signed in before the 002 migration ran) is treated
 * as pending rather than crashing.
 */
export async function getAuthedUser(): Promise<AuthedUser | null> {
  if (!hasSupabase()) return DEV_USER;

  const { createServerSupabase } = await import("@/lib/supabase/server");
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { getServiceClient } = await import("@/db/queries");
  const { data: profile } = await getServiceClient()
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return {
      id: user.id,
      email: user.email ?? "",
      displayName: user.email ?? "",
      role: "player",
      status: "pending",
      monthlyTokenBudget: 0,
      monthlyCostBudgetUsd: 0,
    };
  }

  return {
    id: String(profile.id),
    email: String(profile.email),
    displayName: String(profile.display_name ?? profile.email),
    role: profile.role === "admin" ? "admin" : "player",
    status:
      profile.status === "approved" ? "approved" : profile.status === "suspended" ? "suspended" : "pending",
    monthlyTokenBudget: Number(profile.monthly_token_budget ?? 0),
    monthlyCostBudgetUsd: Number(profile.monthly_cost_budget_usd ?? 0),
  };
}

type GuardResult = { user: AuthedUser; error?: never } | { user?: never; error: NextResponse };

/** Route-handler guard: 401 unauthenticated, 403 pending/suspended. */
export async function requireApprovedUser(): Promise<GuardResult> {
  const user = await getAuthedUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Sign in to play." }, { status: 401 }) };
  }
  if (user.status !== "approved") {
    const msg =
      user.status === "suspended"
        ? "Your account is suspended."
        : "Your account is awaiting approval.";
    return { error: NextResponse.json({ error: msg }, { status: 403 }) };
  }
  return { user };
}

/** Route-handler guard: approved admin only. */
export async function requireAdmin(): Promise<GuardResult> {
  const result = await requireApprovedUser();
  if (result.error) return result;
  if (result.user.role !== "admin") {
    return { error: NextResponse.json({ error: "Admin only." }, { status: 403 }) };
  }
  return result;
}

/** True when `user` may access the campaign owned by `playerId`. */
export function canAccessCampaign(user: AuthedUser, playerId: string | undefined): boolean {
  if (user.role === "admin") return true; // admins see everything, incl. unowned seeds
  return playerId === user.id;
}
