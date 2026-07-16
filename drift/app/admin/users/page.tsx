"use client";

import { useEffect, useState } from "react";
import type { AdminUserRow } from "@/app/api/admin/users/route";
import { RefreshButton } from "@/components/admin/RefreshButton";

const STATUS_STYLE: Record<string, string> = {
  pending: "border-accent/60 text-accent",
  approved: "border-good/60 text-good",
  suspended: "border-bad/60 text-bad",
};

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** Manage players: approve/suspend, and see who's active and what they've cost. */
export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "failed to load");
    setUsers(data.users ?? []);
    setLoaded(true);
    setRefreshing(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function setStatus(id: string, status: string) {
    setError(null);
    setBusy(id);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "update failed");
    }
    await refresh();
    setBusy(null);
  }

  // Most-recently-active first (never-played sink to the bottom).
  const sorted = [...users].sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
  const totalCost = users.reduce((s, u) => s + u.totalCostUsd, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-400">
          New sign-ins land pending. Approve to let them play; suspend to cut access.
        </p>
        <div className="flex items-center gap-3">
          {loaded && users.length > 0 && (
            <p className="text-xs text-neutral-500">
              {users.length} users · <span className="text-neutral-300">${totalCost.toFixed(2)}</span> all-time
            </p>
          )}
          <RefreshButton onClick={refresh} busy={refreshing} />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      {!loaded && <p className="mt-8 text-sm text-neutral-500">Loading…</p>}
      {loaded && users.length === 0 && (
        <p className="mt-8 text-sm text-neutral-500">No users yet (or Supabase isn&apos;t configured).</p>
      )}

      {loaded && users.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-edge">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2 font-medium">Player</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Last active</th>
                <th className="px-3 py-2 text-right font-medium">Turns</th>
                <th className="px-3 py-2 text-right font-medium">Tokens</th>
                <th className="px-3 py-2 text-right font-medium">Est. cost</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id} className="border-b border-edge/50 last:border-0 hover:bg-panel/30">
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-100">
                      {u.displayName}
                      {u.role === "admin" && <span className="ml-1.5 text-[10px] uppercase text-accent">admin</span>}
                    </div>
                    <div className="text-[11px] text-neutral-500">{u.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[u.status] ?? ""}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{fmtDate(u.lastActive)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{u.totalTurns}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{fmtTokens(u.totalTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-200">${u.totalCostUsd.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {u.status !== "approved" && (
                        <button
                          disabled={busy === u.id}
                          onClick={() => setStatus(u.id, "approved")}
                          className="rounded-md bg-good/15 px-2 py-1 text-[11px] font-semibold text-good hover:bg-good/25 disabled:opacity-50"
                        >
                          Approve
                        </button>
                      )}
                      {u.status !== "suspended" && u.role !== "admin" && (
                        <button
                          disabled={busy === u.id}
                          onClick={() => setStatus(u.id, u.status === "pending" ? "suspended" : "suspended")}
                          className="rounded-md bg-bad/15 px-2 py-1 text-[11px] font-semibold text-bad hover:bg-bad/25 disabled:opacity-50"
                        >
                          {u.status === "pending" ? "Reject" : "Suspend"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
