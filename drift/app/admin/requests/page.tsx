"use client";

import { useEffect, useState } from "react";
import type { FeatureRequest } from "@/shared/feedback";

const STATUS_STYLE: Record<string, string> = {
  pending: "border-accent/60 text-accent",
  approved: "border-good/60 text-good",
  done: "border-good/60 text-good",
  declined: "border-bad/60 text-bad",
};

/** Review queue for player feature requests (admin-gated by the layout + API). */
export default function AdminRequestsPage() {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const res = await fetch("/api/feedback");
    const data = await res.json();
    setRequests(data.requests ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function decide(id: string, status: "approved" | "declined" | "done") {
    await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    refresh();
  }

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <div>
      <p className="text-sm text-neutral-400">
        Player-submitted, auto-formatted. Approve what you&apos;ll build; decline the rest.
      </p>

      {!loaded && <p className="mt-8 text-sm text-neutral-500">Loading…</p>}
      {loaded && requests.length === 0 && (
        <p className="mt-8 text-sm text-neutral-500">
          Nothing yet. Players submit via the 💡 Request button in-game.
        </p>
      )}

      {pending.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">
            Pending ({pending.length})
          </h2>
          <div className="mt-3 space-y-3">
            {pending.map((r) => (
              <Card key={r.id} r={r}>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => decide(r.id, "approved")}
                    className="rounded-md bg-good/20 px-3 py-1.5 text-sm font-semibold text-good hover:bg-good/30"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => decide(r.id, "declined")}
                    className="rounded-md bg-bad/20 px-3 py-1.5 text-sm font-semibold text-bad hover:bg-bad/30"
                  >
                    Decline
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">Decided</h2>
          <div className="mt-3 space-y-3">
            {decided.map((r) => (
              <Card key={r.id} r={r}>
                {r.status === "approved" && (
                  <button
                    onClick={() => decide(r.id, "done")}
                    className="mt-3 rounded-md border border-edge px-3 py-1.5 text-sm text-neutral-400 hover:border-good hover:text-good"
                  >
                    Mark done
                  </button>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Card({ r, children }: { r: FeatureRequest; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-panel/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-neutral-100">{r.title}</div>
          <div className="mt-0.5 text-xs text-neutral-500">
            {r.authorName} · {new Date(r.createdAt).toLocaleString()} · {r.category}
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[r.status] ?? ""}`}>
          {r.status}
        </span>
      </div>
      {r.summary && <p className="mt-2 text-sm text-neutral-300">{r.summary}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-300">
          original text
        </summary>
        <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-400">{r.raw}</p>
      </details>
      {children}
    </div>
  );
}
