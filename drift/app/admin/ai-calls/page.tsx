"use client";

import { useEffect, useState } from "react";
import type { AiCallRow, AiCallUser } from "@/app/api/admin/ai-calls/route";

const KINDS = ["", "turn", "creation", "summary"] as const;

const fmtTokens = (n: number) =>
  n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

/** Colour the latency so slow calls jump out. */
function latencyClass(ms: number): string {
  if (ms >= 8000) return "text-bad";
  if (ms >= 4000) return "text-accent";
  return "text-good";
}

/**
 * Audit view: recent AI calls, newest first. Each row shows latency, tokens,
 * cost, tools, round-trips and fallback; expand for the truncated prompt +
 * response. This is where you inspect why a call was slow or long.
 */
export default function AdminAiCallsPage() {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("");
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<AiCallUser[]>([]);
  const [calls, setCalls] = useState<AiCallRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (userId) params.set("userId", userId);
    const q = params.toString();
    fetch(`/api/admin/ai-calls${q ? `?${q}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        setCalls(data.calls ?? []);
        setUsers(data.users ?? []);
        setLoaded(true);
      });
  }, [kind, userId]);

  const avgLatency = calls.length
    ? Math.round(calls.reduce((s, c) => s + c.latencyMs, 0) / calls.length)
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-400">
          Every model call, newest first. Latency, tokens, tools, and truncated prompt/response.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Filter by player — pick one to read their calls in sequence. */}
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded-md border border-edge bg-ink px-2 py-1 text-neutral-300 outline-none focus:border-accent"
          >
            <option value="">all players</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            {KINDS.map((k) => (
              <button
                key={k || "all"}
                onClick={() => setKind(k)}
                className={`rounded-md border px-2 py-1 transition ${
                  kind === k
                    ? "border-accent text-accent"
                    : "border-edge text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {k || "all"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!loaded && <p className="mt-8 text-sm text-neutral-500">Loading…</p>}
      {loaded && calls.length === 0 && (
        <p className="mt-8 text-sm text-neutral-500">
          No AI calls recorded{kind ? ` for “${kind}”` : ""}. (Requires Supabase; console logs
          always show them.)
        </p>
      )}

      {loaded && calls.length > 0 && (
        <>
          <div className="mt-4 rounded-lg border border-edge bg-panel/50 p-3 text-sm text-neutral-300">
            {calls.length} calls · avg{" "}
            <span className={`font-semibold ${latencyClass(avgLatency)}`}>{avgLatency}ms</span>
          </div>

          <div className="mt-3 space-y-2">
            {calls.map((c) => (
              <details key={c.id} className="rounded-lg border border-edge bg-panel/50 p-3">
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-neutral-300">
                    {c.kind}
                  </span>
                  <span className={`font-semibold ${latencyClass(c.latencyMs)}`}>
                    {c.latencyMs}ms
                  </span>
                  <span className="font-mono text-xs text-neutral-500">{c.model}</span>
                  <span className="text-xs text-neutral-400">
                    in {fmtTokens(c.inputTokens)} · out {fmtTokens(c.outputTokens)}
                    {c.cacheReadTokens ? ` · ${fmtTokens(c.cacheReadTokens)} cached` : ""} · $
                    {c.costUsd.toFixed(5)}
                  </span>
                  {c.rounds != null && (
                    <span className="text-xs text-neutral-500">{c.rounds} rounds</span>
                  )}
                  {c.fellBack && <span className="text-xs text-bad">fell back</span>}
                  {c.error && <span className="text-xs text-bad">error</span>}
                  <span className="ml-auto text-xs text-neutral-600">
                    {new Date(c.createdAt).toLocaleTimeString()}
                  </span>
                </summary>

                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-neutral-500">
                    {c.email && <span>user: {c.email}</span>}
                    {c.campaignId && <span>campaign: {c.campaignId}</span>}
                    {c.stopReason && <span>stop: {c.stopReason}</span>}
                    {c.systemChars != null && <span>system: {fmtTokens(c.systemChars)} chars</span>}
                    <span>{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  {c.toolCalls.length > 0 && (
                    <div className="text-neutral-400">
                      tools:{" "}
                      <span className="font-mono text-neutral-300">{c.toolCalls.join(" → ")}</span>
                    </div>
                  )}
                  {c.error && (
                    <pre className="whitespace-pre-wrap rounded bg-ink p-2 text-bad">{c.error}</pre>
                  )}
                  <div>
                    <div className="mb-1 text-neutral-500">prompt</div>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-ink p-2 text-neutral-300">
                      {c.promptPreview ?? "—"}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-neutral-500">response</div>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-ink p-2 text-neutral-300">
                      {c.responsePreview ?? "—"}
                    </pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
