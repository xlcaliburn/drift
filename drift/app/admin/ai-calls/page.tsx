"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AiCallRow, AiCallUser } from "@/app/api/admin/ai-calls/route";

const KINDS = ["", "turn", "creation", "summary"] as const;

const fmtChars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Colour the latency so slow calls jump out. */
function latencyClass(ms: number): string {
  if (ms >= 8000) return "text-bad";
  if (ms >= 4000) return "text-accent";
  return "text-good";
}

/** Pull the player's typed action out of the full request dump (which ends with
 *  "…PLAYER: <action>") for the chat bubble. */
function playerActionOf(dump: string | null): string {
  if (!dump) return "";
  const i = dump.lastIndexOf("PLAYER:");
  return i >= 0 ? dump.slice(i + "PLAYER:".length).trim() : "";
}

/**
 * Audit view rendered like the player's own chat: each call is the action + the
 * narration it produced, oldest at the top so you scroll UP for history. Click a
 * call to open the full request fed to the API, the full response, and the
 * api/cost details in the side panel.
 */
export default function AdminAiCallsPage() {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("");
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<AiCallUser[]>([]);
  const [calls, setCalls] = useState<AiCallRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
        setSelectedId(null);
        setLoaded(true);
      });
  }, [kind, userId]);

  // Oldest → newest so it reads like a chat; scroll up for history.
  const ordered = useMemo(() => [...calls].reverse(), [calls]);
  const selected = calls.find((c) => c.id === selectedId) ?? null;
  const avgLatency = calls.length
    ? Math.round(calls.reduce((s, c) => s + c.latencyMs, 0) / calls.length)
    : 0;

  useEffect(() => {
    if (loaded) bottomRef.current?.scrollIntoView();
  }, [loaded]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-400">
          Every model call as the player saw it — click one for the full request, response, and cost.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
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
                  kind === k ? "border-accent text-accent" : "border-edge text-neutral-400 hover:text-neutral-200"
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
        <p className="mt-8 text-sm text-neutral-500">No AI calls recorded{kind ? ` for “${kind}”` : ""}.</p>
      )}

      {loaded && calls.length > 0 && (
        <div className="mt-3 flex h-[72vh] gap-4">
          {/* Chat column — scroll up for older calls. */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mb-2 text-xs text-neutral-500">
              {calls.length} calls · avg{" "}
              <span className={`font-semibold ${latencyClass(avgLatency)}`}>{avgLatency}ms</span>
            </div>
            <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto rounded-lg border border-edge bg-panel/20 p-3">
              {ordered.map((c) => (
                <CallBubble key={c.id} c={c} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Detail rail (desktop). */}
          <aside className="hidden w-[400px] shrink-0 overflow-y-auto lg:block">
            {selected ? (
              <CallDetails c={selected} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-edge p-6 text-center text-sm text-neutral-600">
                Select a call to see its full request, response, and cost.
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Detail modal (mobile). */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/80 p-3 lg:hidden" onClick={() => setSelectedId(null)}>
          <div className="max-h-[85dvh] w-full overflow-y-auto rounded-xl border border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setSelectedId(null)} className="text-neutral-400 hover:text-accent" aria-label="Close">
                ✕
              </button>
            </div>
            <CallDetails c={selected} />
          </div>
        </div>
      )}
    </div>
  );
}

/** One call rendered as play-style bubbles: the action, then the narration. */
function CallBubble({ c, selected, onSelect }: { c: AiCallRow; selected: boolean; onSelect: () => void }) {
  const action = c.kind === "turn" ? playerActionOf(c.promptPreview) : "";
  return (
    <button
      onClick={onSelect}
      className={
        "block w-full rounded-lg border p-2 text-left transition " +
        (selected ? "border-accent bg-panel" : "border-transparent hover:bg-panel/40")
      }
    >
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-neutral-600">
        <span className="rounded bg-ink px-1 py-0.5 font-mono">{c.kind}</span>
        <span className={latencyClass(c.latencyMs)}>{c.latencyMs}ms</span>
        {c.fellBack && <span className="text-bad">fell back</span>}
        {c.error && <span className="text-bad">error</span>}
        <span className="ml-auto font-normal normal-case text-neutral-600">
          {new Date(c.createdAt).toLocaleTimeString()}
        </span>
      </div>
      {action && (
        <div className="text-right">
          <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl bg-edge px-3 py-1.5 text-[13px] text-neutral-50">
            {action}
          </span>
        </div>
      )}
      <div className="mt-1">
        <span className="inline-block max-w-[92%] whitespace-pre-wrap rounded-2xl bg-panel px-3 py-1.5 text-[13px] leading-relaxed text-neutral-100">
          {c.responsePreview ?? "—"}
        </span>
      </div>
    </button>
  );
}

/** The side panel: api/cost details, plus the full request and response text. */
function CallDetails({ c }: { c: AiCallRow }) {
  return (
    <div className="space-y-3 rounded-lg border border-edge bg-panel/40 p-3 text-xs">
      <div className="space-y-1">
        <Detail label="model" value={c.model} mono />
        <Detail label="latency" value={`${c.latencyMs}ms`} valueClass={latencyClass(c.latencyMs)} />
        <Detail label="cost" value={`$${c.costUsd.toFixed(5)}`} />
        {c.rounds != null && (
          <Detail
            label="rounds"
            value={String(c.rounds)}
            title="Model round-trips in the tool loop (1 = narrate-and-done; more = rolls/combat)."
          />
        )}
        {c.stopReason && <Detail label="stop" value={c.stopReason} />}
        {c.email && <Detail label="user" value={c.email} />}
        {c.campaignId && <Detail label="campaign" value={c.campaignId} mono />}
        {c.systemChars != null && <Detail label="system prompt" value={`${fmtChars(c.systemChars)} chars`} />}
      </div>

      {c.toolCalls.length > 0 && (
        <div className="text-neutral-400">
          tools: <span className="font-mono text-neutral-300">{c.toolCalls.join(" → ")}</span>
        </div>
      )}
      {c.fellBack && <div className="text-bad">fell back to Haiku mid-turn</div>}
      {c.error && <pre className="whitespace-pre-wrap rounded bg-ink p-2 text-bad">{c.error}</pre>}

      {/* Full input log — collapsed by default (it's large: system prompt +
          exchange history + context slice + action). */}
      <details>
        <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
          full input — system, exchange history, context slice, action
        </summary>
        <pre className="mt-1 max-h-[55vh] overflow-auto whitespace-pre-wrap rounded bg-ink p-2 text-[11px] leading-relaxed text-neutral-300">
          {c.promptPreview ?? "—"}
        </pre>
      </details>

      {c.exchangeDump && (
        <details>
          <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
            tool-loop rounds{c.rounds != null ? ` (${c.rounds})` : ""} — assistant text, tool calls, and results each round
          </summary>
          <pre className="mt-1 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded bg-ink p-2 text-[11px] leading-relaxed text-neutral-300">
            {c.exchangeDump}
          </pre>
        </details>
      )}

      <details open>
        <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
          returned (final narration)
        </summary>
        <pre className="mt-1 max-h-[30vh] overflow-auto whitespace-pre-wrap rounded bg-ink p-2 text-[11px] leading-relaxed text-neutral-300">
          {c.responsePreview ?? "—"}
        </pre>
      </details>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
  valueClass,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
  title?: string;
}) {
  return (
    <div className="flex justify-between gap-3" title={title}>
      <span className="text-neutral-600">{label}</span>
      <span className={`min-w-0 truncate text-right ${mono ? "font-mono" : ""} ${valueClass ?? "text-neutral-300"}`}>
        {value}
      </span>
    </div>
  );
}
