"use client";

/** Admin-tab refetch control. Each tab wires it to re-pull its data from the DB —
 *  a manual refresh so an admin isn't stuck on a stale snapshot mid-triage. */
export function RefreshButton({ onClick, busy = false }: { onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Refetch from the database"
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-edge px-2.5 py-1 text-xs text-neutral-300 transition hover:border-accent hover:text-accent disabled:opacity-50"
    >
      <span className={busy ? "inline-block animate-spin" : "inline-block"}>↻</span>
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}
