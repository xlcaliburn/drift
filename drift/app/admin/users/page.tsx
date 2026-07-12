"use client";

import { useEffect, useState } from "react";
import type { AdminUserRow } from "@/app/api/admin/users/route";

const STATUS_STYLE: Record<string, string> = {
  pending: "border-accent/60 text-accent",
  approved: "border-good/60 text-good",
  suspended: "border-bad/60 text-bad",
};

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

/** Manage players: approve/suspend + per-user monthly budget caps. */
export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "failed to load");
    setUsers(data.users ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "update failed");
    }
    refresh();
  }

  const pending = users.filter((u) => u.status === "pending");
  const rest = users.filter((u) => u.status !== "pending");

  return (
    <div>
      <p className="text-sm text-neutral-400">
        New sign-ins land pending. Approve to let them play; suspend to cut access.
      </p>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      {!loaded && <p className="mt-8 text-sm text-neutral-500">Loading…</p>}
      {loaded && users.length === 0 && (
        <p className="mt-8 text-sm text-neutral-500">
          No users yet (or Supabase isn&apos;t configured).
        </p>
      )}

      {pending.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">
            Awaiting approval ({pending.length})
          </h2>
          <div className="mt-3 space-y-3">
            {pending.map((u) => (
              <UserCard key={u.id} u={u} onPatch={patch} />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">Players</h2>
          <div className="mt-3 space-y-3">
            {rest.map((u) => (
              <UserCard key={u.id} u={u} onPatch={patch} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function UserCard({
  u,
  onPatch,
}: {
  u: AdminUserRow;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [tokenCap, setTokenCap] = useState(String(u.monthlyTokenBudget));
  const [costCap, setCostCap] = useState(u.monthlyCostBudgetUsd.toFixed(2));
  const dirty =
    Number(tokenCap) !== u.monthlyTokenBudget || Number(costCap) !== u.monthlyCostBudgetUsd;

  return (
    <div className="rounded-lg border border-edge bg-panel/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-neutral-100">
            {u.displayName}
            {u.role === "admin" && (
              <span className="ml-2 rounded-full border border-accent/60 px-2 py-0.5 text-xs text-accent">
                admin
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-neutral-500">
            {u.email}
            {u.createdAt ? ` · joined ${new Date(u.createdAt).toLocaleDateString()}` : ""}
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[u.status] ?? ""}`}>
          {u.status}
        </span>
      </div>

      <div className="mt-2 text-xs text-neutral-400">
        This month: {u.monthTurns} turns · {fmtTokens(u.monthTokens)} tok · $
        {u.monthCostUsd.toFixed(3)}
        <span className="text-neutral-600">
          {" "}
          / caps {fmtTokens(u.monthlyTokenBudget)} tok · ${u.monthlyCostBudgetUsd.toFixed(2)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {u.status !== "approved" && (
          <button
            onClick={() => onPatch(u.id, { status: "approved" })}
            className="rounded-md bg-good/20 px-3 py-1.5 text-sm font-semibold text-good hover:bg-good/30"
          >
            Approve
          </button>
        )}
        {u.status === "approved" && u.role !== "admin" && (
          <button
            onClick={() => onPatch(u.id, { status: "suspended" })}
            className="rounded-md bg-bad/20 px-3 py-1.5 text-sm font-semibold text-bad hover:bg-bad/30"
          >
            Suspend
          </button>
        )}
        {u.status === "pending" && (
          <button
            onClick={() => onPatch(u.id, { status: "suspended" })}
            className="rounded-md bg-bad/20 px-3 py-1.5 text-sm font-semibold text-bad hover:bg-bad/30"
          >
            Reject
          </button>
        )}

        <label className="ml-auto flex items-center gap-1 text-xs text-neutral-500">
          tok cap
          <input
            value={tokenCap}
            onChange={(e) => setTokenCap(e.target.value)}
            inputMode="numeric"
            className="w-24 rounded-md border border-edge bg-ink px-2 py-1 text-xs text-neutral-200 focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-neutral-500">
          $ cap
          <input
            value={costCap}
            onChange={(e) => setCostCap(e.target.value)}
            inputMode="decimal"
            className="w-16 rounded-md border border-edge bg-ink px-2 py-1 text-xs text-neutral-200 focus:border-accent focus:outline-none"
          />
        </label>
        {dirty && (
          <button
            onClick={() =>
              onPatch(u.id, {
                monthlyTokenBudget: Math.max(0, Math.floor(Number(tokenCap) || 0)),
                monthlyCostBudgetUsd: Math.max(0, Number(costCap) || 0),
              })
            }
            className="rounded-md border border-accent/60 px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10"
          >
            Save caps
          </button>
        )}
      </div>
    </div>
  );
}
