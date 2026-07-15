"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AiCallRow, AiCallUser } from "@/app/api/admin/ai-calls/route";

const KINDS = ["", "turn", "appeal", "creation", "summary"] as const;

const fmtChars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function latencyClass(ms: number): string {
  if (ms >= 8000) return "text-bad";
  if (ms >= 4000) return "text-accent";
  return "text-good";
}

/** Pull the player's typed/clicked action out of the request dump ("…PLAYER: <x>"). */
function playerActionOf(dump: string | null): string {
  if (!dump) return "";
  const i = dump.lastIndexOf("PLAYER:");
  return i >= 0 ? dump.slice(i + "PLAYER:".length).trim() : "";
}

/** The offered-choice labels for a call, parsed from the LAST JSON object in its
 *  exchange dump (the final TurnPlan). Empty when the dump has no plan JSON. */
function offeredChoices(dump: string | null): string[] {
  if (!dump) return [];
  // Walk from the end for the last balanced {...} — that's the final plan.
  let depth = 0;
  let end = -1;
  for (let i = dump.length - 1; i >= 0; i--) {
    const ch = dump[i];
    if (ch === "}") {
      if (depth === 0) end = i;
      depth++;
    } else if (ch === "{") {
      depth--;
      if (depth === 0 && end >= 0) {
        try {
          const obj = JSON.parse(dump.slice(i, end + 1)) as { choices?: { label?: string }[] };
          const labels = (obj.choices ?? []).map((c) => c?.label).filter((l): l is string => !!l);
          if (labels.length) return labels;
        } catch {
          /* keep scanning outward */
        }
        end = -1;
      }
    }
  }
  return [];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Audit view rendered like the player's own chat: each call is the action + the
 * narration it produced. Pick a player (no "all" — the audit is per-player), click a
 * call for its full request/response/cost, and pop it out to read everything.
 */
export default function AdminAiCallsPage() {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("");
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<AiCallUser[]>([]);
  const [calls, setCalls] = useState<AiCallRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
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
        if (data.users?.length) setUsers(data.users);
        // No "all players" — default to the first player, then this refetches.
        if (!userId && data.users?.length) {
          setUserId(data.users[0].id);
          return;
        }
        setCalls(data.calls ?? []);
        setSelectedId(null);
        setLoaded(true);
      });
  }, [kind, userId]);

  // Oldest → newest so it reads like a chat; scroll up for history.
  const ordered = useMemo(() => [...calls].reverse(), [calls]);
  // For each call, the NEXT same-campaign action = what the player did with its options.
  const nextActionByCall = useMemo(() => {
    const map = new Map<string, string>();
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i];
      for (let j = i + 1; j < ordered.length; j++) {
        if (ordered[j].campaignId === c.campaignId) {
          map.set(c.id, playerActionOf(ordered[j].promptPreview));
          break;
        }
      }
    }
    return map;
  }, [ordered]);

  const selected = calls.find((c) => c.id === selectedId) ?? null;
  const avgLatency = calls.length ? Math.round(calls.reduce((s, c) => s + c.latencyMs, 0) / calls.length) : 0;

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
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mb-2 text-xs text-neutral-500">
              {calls.length} calls · avg <span className={`font-semibold ${latencyClass(avgLatency)}`}>{avgLatency}ms</span>
            </div>
            <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto rounded-lg border border-edge bg-panel/20 p-3">
              {ordered.map((c) => (
                <CallBubble
                  key={c.id}
                  c={c}
                  selected={c.id === selectedId}
                  onSelect={() => setSelectedId(c.id)}
                  nextAction={nextActionByCall.get(c.id) ?? ""}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          <aside className="hidden w-[400px] shrink-0 overflow-y-auto lg:block">
            {selected ? (
              <CallDetails c={selected} onExpand={() => setExpanded(true)} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-edge p-6 text-center text-sm text-neutral-600">
                Select a call to see its full request, response, and cost.
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Detail modal (mobile). */}
      {selected && !expanded && (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/80 p-3 lg:hidden" onClick={() => setSelectedId(null)}>
          <div className="max-h-[85dvh] w-full overflow-y-auto rounded-xl border border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setSelectedId(null)} className="text-neutral-400 hover:text-accent" aria-label="Close">
                ✕
              </button>
            </div>
            <CallDetails c={selected} onExpand={() => setExpanded(true)} />
          </div>
        </div>
      )}

      {/* Pop-out: full-screen reader for the entire input + output. */}
      {selected && expanded && <ExpandedCall c={selected} onClose={() => setExpanded(false)} />}
    </div>
  );
}

function CallBubble({
  c,
  selected,
  onSelect,
  nextAction,
}: {
  c: AiCallRow;
  selected: boolean;
  onSelect: () => void;
  nextAction: string;
}) {
  const action = c.kind === "turn" ? playerActionOf(c.promptPreview) : "";
  const choices = c.kind === "turn" ? offeredChoices(c.exchangeDump) : [];
  const chosenIdx = choices.findIndex((l) => norm(l) === norm(nextAction));
  const typedNext = nextAction && chosenIdx < 0;
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
        <span className="ml-auto font-normal normal-case text-neutral-600">{new Date(c.createdAt).toLocaleTimeString()}</span>
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
      {choices.length > 0 && (
        <div className="mt-1.5 space-y-0.5 pl-1">
          <div className="text-[10px] uppercase tracking-wide text-neutral-600">options offered</div>
          {choices.map((label, i) => (
            <div key={i} className={`text-[12px] ${i === chosenIdx ? "font-medium text-accent" : "text-neutral-500"}`}>
              {i === chosenIdx ? "✓ " : "• "}
              {label}
            </div>
          ))}
          {typedNext && <div className="text-[12px] text-good">✎ player typed their own: “{nextAction}”</div>}
        </div>
      )}
    </button>
  );
}

function CallDetails({ c, onExpand }: { c: AiCallRow; onExpand: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-edge bg-panel/40 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">Call detail</span>
        <button
          onClick={onExpand}
          className="rounded-md border border-edge px-2 py-1 text-[11px] text-neutral-300 hover:border-accent hover:text-accent"
          title="Pop out — read the full input and output"
        >
          ⤢ Pop out
        </button>
      </div>
      <div className="space-y-1">
        <Detail label="model" value={c.model} mono />
        <Detail label="latency" value={`${c.latencyMs}ms`} valueClass={latencyClass(c.latencyMs)} />
        <Detail label="cost" value={`$${c.costUsd.toFixed(5)}`} />
        {c.rounds != null && <Detail label="rounds" value={String(c.rounds)} />}
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

      <details>
        <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">full input — system, exchange, context, action</summary>
        <pre className="mt-1 max-h-[45vh] overflow-auto whitespace-pre-wrap rounded bg-ink p-2 text-[11px] leading-relaxed text-neutral-300">
          {c.promptPreview ?? "—"}
        </pre>
      </details>
      {c.exchangeDump && (
        <details>
          <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">rounds / exchange</summary>
          <pre className="mt-1 max-h-[35vh] overflow-auto whitespace-pre-wrap rounded bg-ink p-2 text-[11px] leading-relaxed text-neutral-300">
            {c.exchangeDump}
          </pre>
        </details>
      )}
      <details open>
        <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">returned (final narration)</summary>
        <pre className="mt-1 max-h-[25vh] overflow-auto whitespace-pre-wrap rounded bg-ink p-2 text-[11px] leading-relaxed text-neutral-300">
          {c.responsePreview ?? "—"}
        </pre>
      </details>
    </div>
  );
}

/** Full-screen reader: the ENTIRE input and output side by side, nothing truncated. */
function ExpandedCall({ c, onClose }: { c: AiCallRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink/95 p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded bg-panel px-2 py-1 font-mono text-xs text-neutral-300">{c.kind}</span>
        <span className="text-xs text-neutral-500">{c.model}</span>
        {c.email && <span className="text-xs text-neutral-500">· {c.email}</span>}
        <span className={`text-xs ${latencyClass(c.latencyMs)}`}>· {c.latencyMs}ms</span>
        <span className="text-xs text-neutral-500">· ${c.costUsd.toFixed(5)}</span>
        <button
          onClick={onClose}
          className="ml-auto rounded-md border border-edge px-3 py-1 text-sm text-neutral-300 hover:border-accent hover:text-accent"
        >
          Close ✕
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <Pane title="INPUT — full request fed to the model">{c.promptPreview ?? "—"}</Pane>
        <div className="flex min-h-0 flex-col gap-4">
          <Pane title="OUTPUT — final narration">{c.responsePreview ?? "—"}</Pane>
          {c.exchangeDump && <Pane title="ROUNDS / EXCHANGE">{c.exchangeDump}</Pane>}
        </div>
      </div>
    </div>
  );
}

function Pane({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-edge bg-panel/30">
      <div className="border-b border-edge px-3 py-1.5 text-[11px] uppercase tracking-wide text-neutral-500">{title}</div>
      <pre className="scrollbar-thin flex-1 overflow-auto whitespace-pre-wrap p-3 text-[12px] leading-relaxed text-neutral-200">
        {children}
      </pre>
    </div>
  );
}

function Detail({ label, value, mono, valueClass }: { label: string; value: string; mono?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-neutral-600">{label}</span>
      <span className={`min-w-0 truncate text-right ${mono ? "font-mono" : ""} ${valueClass ?? "text-neutral-300"}`}>{value}</span>
    </div>
  );
}
