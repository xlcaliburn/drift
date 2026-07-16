"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminCampaignRow } from "@/app/api/admin/campaigns/route";
import { RefreshButton } from "@/components/admin/RefreshButton";

const STATUS_STYLE: Record<string, string> = {
  active: "border-good/60 text-good",
  deceased: "border-bad/60 text-bad",
  archived: "border-edge text-neutral-400",
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** Admin campaign list → click through to the editor to fix a stuck/derailed game. */
export default function AdminCampaignsPage() {
  const [rows, setRows] = useState<AdminCampaignRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const d = await fetch("/api/admin/campaigns").then((r) => r.json());
    setRows(d.campaigns ?? []);
    setLoaded(true);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = q
    ? rows.filter((r) =>
        [r.characterName, r.name, r.playerEmail, r.playerName, r.status].some((v) => v?.toLowerCase().includes(q.toLowerCase())),
      )
    : rows;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-400">
          Inspect and fix any player&apos;s live game — character, inventory, scene, story. Edits apply immediately (even mid-session).
        </p>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter…"
            className="rounded-md border border-edge bg-ink px-2 py-1 text-xs text-neutral-300 outline-none focus:border-accent"
          />
          <RefreshButton onClick={refresh} busy={refreshing} />
        </div>
      </div>

      {!loaded && <p className="mt-8 text-sm text-neutral-500">Loading…</p>}
      {loaded && rows.length === 0 && (
        <p className="mt-8 text-sm text-neutral-500">No campaigns (or Supabase isn&apos;t configured).</p>
      )}

      {loaded && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-edge">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2 font-medium">Character</th>
                <th className="px-3 py-2 font-medium">Player</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Last played</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-edge/50 last:border-0 hover:bg-panel/30">
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-100">{c.characterName ?? c.name}</div>
                    <div className="text-[11px] text-neutral-600">{c.universeName ?? ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-neutral-300">{c.playerName ?? "—"}</div>
                    <div className="text-[11px] text-neutral-500">{c.playerEmail ?? ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[c.status] ?? "border-edge text-neutral-400"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{fmtDate(c.lastPlayed)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/admin/campaigns/${c.id}`}
                      className="rounded-md border border-edge px-2 py-1 text-[11px] text-neutral-300 hover:border-accent hover:text-accent"
                    >
                      Edit →
                    </Link>
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
