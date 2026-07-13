"use client";

import { useEffect, useState } from "react";
import type { UsageByUser, UsageByModel } from "@/app/api/admin/usage/route";

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Token/cost usage per user for a calendar month, with per-model breakdown. */
export default function AdminUsagePage() {
  const [month, setMonth] = useState(currentMonth());
  const [users, setUsers] = useState<UsageByUser[]>([]);
  const [totalsByModel, setTotalsByModel] = useState<UsageByModel[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    fetch(`/api/admin/usage?month=${month}`)
      .then((r) => r.json())
      .then((data) => {
        setUsers(data.users ?? []);
        setTotalsByModel(data.totalsByModel ?? []);
        setLoaded(true);
      });
  }, [month]);

  const totalCost = users.reduce((s, u) => s + u.costUsd, 0);
  const totalTurns = users.reduce((s, u) => s + u.turns, 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-400">
          Estimated spend per player. Costs are pricing-map estimates, not invoices.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="rounded-md border border-edge px-2 py-1 text-neutral-400 hover:border-accent hover:text-accent"
          >
            ←
          </button>
          <span className="font-mono text-neutral-200">{month}</span>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={month >= currentMonth()}
            className="rounded-md border border-edge px-2 py-1 text-neutral-400 hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-edge disabled:hover:text-neutral-400"
          >
            →
          </button>
        </div>
      </div>

      {!loaded && <p className="mt-8 text-sm text-neutral-500">Loading…</p>}
      {loaded && users.length === 0 && (
        <p className="mt-8 text-sm text-neutral-500">No usage recorded for {month}.</p>
      )}

      {loaded && users.length > 0 && (
        <>
          <div className="mt-4 rounded-lg border border-edge bg-panel/50 p-3 text-sm text-neutral-300">
            {totalTurns} turns · <span className="font-semibold">${totalCost.toFixed(3)}</span>{" "}
            total estimated
          </div>

          {/* Global spend broken down by model — where the money actually went. */}
          {totalsByModel.length > 0 && (
            <div className="mt-3 rounded-lg border border-edge bg-panel/50 p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">By model (all players)</div>
              <div className="space-y-1.5">
                {totalsByModel.map((m) => (
                  <div key={m.model} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-mono text-xs text-neutral-300">{m.model}</span>
                    <span className="text-neutral-400">
                      {m.turns} turns · in {fmtTokens(m.inputTokens)} · out {fmtTokens(m.outputTokens)} ·{" "}
                      <span className="font-semibold text-neutral-200">${m.costUsd.toFixed(4)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 space-y-3">
            {users.map((u) => {
              const pctCost =
                u.monthlyCostBudgetUsd > 0
                  ? Math.min(100, (u.costUsd / u.monthlyCostBudgetUsd) * 100)
                  : 0;
              return (
                <div key={u.userId} className="rounded-lg border border-edge bg-panel/50 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-neutral-100">{u.email}</span>
                    <span className="text-sm text-neutral-300">
                      ${u.costUsd.toFixed(3)}
                      <span className="text-xs text-neutral-600">
                        {" "}
                        / ${u.monthlyCostBudgetUsd.toFixed(2)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink">
                    <div
                      className={`h-full ${pctCost >= 90 ? "bg-bad" : pctCost >= 60 ? "bg-accent" : "bg-good"}`}
                      style={{ width: `${pctCost}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-neutral-400">
                    {u.turns} turns · in {fmtTokens(u.inputTokens)} · out {fmtTokens(u.outputTokens)} ·
                    cache {fmtTokens(u.cacheReadTokens)}r/{fmtTokens(u.cacheWriteTokens)}w · total{" "}
                    {fmtTokens(
                      u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens,
                    )}
                    <span className="text-neutral-600"> / {fmtTokens(u.monthlyTokenBudget)} cap</span>
                  </div>
                  <div className="mt-2 border-t border-edge/60 pt-2">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-600">by model</div>
                    <div className="space-y-1">
                      {u.byModel.map((m) => (
                        <div key={m.model} className="flex justify-between font-mono text-xs text-neutral-400">
                          <span>{m.model}</span>
                          <span>
                            {m.turns}t · in {fmtTokens(m.inputTokens)} · out {fmtTokens(m.outputTokens)} · $
                            {m.costUsd.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
