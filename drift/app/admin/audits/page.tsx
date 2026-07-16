"use client";

import { useEffect, useState } from "react";
import type { AuditRow } from "@/app/api/admin/audits/route";
import type { AuditCandidate } from "@/lib/auditRun";
import { RefreshButton } from "@/components/admin/RefreshButton";

/**
 * Nightly audit reports (the ~3am strong-model continuity pass): per campaign
 * per day — where the story stands, cross-scene inconsistencies, dropped story
 * lines, player-frustration signals (incl. appeals), and dev-facing adjustments.
 */

const SEV_CLASS: Record<string, string> = {
  high: "text-bad",
  medium: "text-accent",
  low: "text-neutral-400",
};

export default function AdminAuditsPage() {
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  // The Run-now scoping modal: who WOULD be included, with deselection.
  const [candidates, setCandidates] = useState<AuditCandidate[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoaded(false);
    fetch("/api/admin/audits")
      .then((r) => r.json())
      .then((data) => {
        setAudits(data.audits ?? []);
        setLoaded(true);
      });
  }, [reloadNonce]);

  // A serverless failure (timeout, crash) comes back as PLAIN TEXT, not JSON —
  // surface the status + first line instead of a raw JSON.parse error.
  async function safeJson(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${res.status} — ${text.slice(0, 120) || "empty response"}`);
    }
  }

  // Step 1 — open the modal with tonight's would-be roster (everyone pre-checked).
  async function openPicker() {
    setPickerLoading(true);
    setRunNote("");
    try {
      const res = await fetch("/api/cron/daily-audit?preview=1");
      const data = await safeJson(res);
      const list = (data.candidates ?? []) as AuditCandidate[];
      setCandidates(list);
      setSelected(new Set(list.map((c) => c.campaignId)));
    } catch (e) {
      setRunNote(`⚠ ${e instanceof Error ? e.message : "preview failed"}`);
    } finally {
      setPickerLoading(false);
    }
  }

  // Step 2 — run the checked campaigns ONE REQUEST EACH. A single request for
  // the whole pass dies on the serverless wall clock (one strong-model read is
  // 30-90s); per-campaign requests keep each call inside the limit and give
  // real progress. Failures don't stop the rest.
  async function runSelected() {
    const ids = [...selected];
    const names = new Map((candidates ?? []).map((c) => [c.campaignId, c.name || c.campaignId]));
    setCandidates(null);
    setRunning(true);
    let ok = 0;
    let cost = 0;
    const failures: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      setRunNote(`Auditing ${i + 1}/${ids.length} — ${names.get(ids[i])} (a strong-model read; ~1 min each)…`);
      try {
        const res = await fetch(`/api/cron/daily-audit?campaignId=${encodeURIComponent(ids[i])}`, { method: "POST" });
        const data = await safeJson(res);
        const r = (data.results as { ok?: boolean; costUsd?: number; error?: string }[] | undefined)?.[0];
        if (res.ok && r?.ok) {
          ok++;
          cost += r.costUsd ?? 0;
        } else {
          failures.push(`${names.get(ids[i])}: ${r?.error ?? (data.error as string) ?? "failed"}`);
        }
      } catch (e) {
        failures.push(`${names.get(ids[i])}: ${e instanceof Error ? e.message : "failed"}`);
      }
      setReloadNonce((n) => n + 1); // each finished report shows up as it lands
    }
    setRunNote(
      `Audited ${ok}/${ids.length} campaigns · $${cost.toFixed(3)}` +
        (failures.length ? ` · ⚠ ${failures.join(" · ")}` : ""),
    );
    setRunning(false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalIssues = (a: AuditRow) =>
    a.report.inconsistencies.length + a.report.droppedThreads.length + a.report.frustrations.length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-400">
          The nightly continuity pass — one strong-model read per campaign per day: inconsistencies, dropped story
          lines, and player frustration (incl. appeals).
        </p>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={openPicker}
            disabled={running || pickerLoading}
            className="rounded-md border border-edge px-3 py-1 text-neutral-300 transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {running ? "Running…" : pickerLoading ? "Loading…" : "▶ Run now"}
          </button>
          <RefreshButton onClick={() => setReloadNonce((n) => n + 1)} busy={!loaded} />
        </div>
      </div>
      {runNote && <p className="mt-2 text-xs text-neutral-500">{runNote}</p>}

      {/* Run-now scoping modal: tonight's would-be roster, deselectable. */}
      {candidates !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={() => setCandidates(null)}>
          <div
            className="w-full max-w-lg rounded-xl border border-edge bg-panel p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-100">Run the audit pass</span>
              <button onClick={() => setCandidates(null)} className="text-neutral-400 hover:text-accent" aria-label="Close">
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Campaigns that played in the last day. Untick any to leave them out — each audit is one strong-model read
              (~$0.15–0.35).
            </p>

            {candidates.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">Nobody played in the last day — nothing to audit.</p>
            ) : (
              <div className="scrollbar-thin mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
                {candidates.map((c) => (
                  <label
                    key={c.campaignId}
                    className="flex cursor-pointer items-center gap-2.5 rounded border border-edge bg-ink/40 px-2.5 py-1.5 transition hover:border-accent/50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.campaignId)}
                      onChange={() => toggle(c.campaignId)}
                      className="accent-[#e8a33d]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-neutral-200">
                        {c.name || c.campaignId}
                        {c.auditedToday && (
                          <span className="ml-1.5 text-[10px] text-neutral-600" title="Already audited today — a rerun replaces the report">
                            (rerun)
                          </span>
                        )}
                      </span>
                      {c.playerEmail && <span className="block truncate text-[11px] text-neutral-500">{c.playerEmail}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-[11px] text-neutral-500">{c.turnsToday} turns</span>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between text-xs">
              {candidates.length > 0 && (
                <button
                  onClick={() =>
                    setSelected(
                      selected.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.campaignId)),
                    )
                  }
                  className="text-neutral-500 hover:text-neutral-300"
                >
                  {selected.size === candidates.length ? "Deselect all" : "Select all"}
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setCandidates(null)}
                  className="rounded-md border border-edge px-3 py-1.5 text-neutral-400 transition hover:text-neutral-200"
                >
                  Cancel
                </button>
                <button
                  onClick={runSelected}
                  disabled={selected.size === 0}
                  className="rounded-md border border-accent px-3 py-1.5 font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-40"
                >
                  Run {selected.size} campaign{selected.size === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loaded && <p className="mt-8 text-sm text-neutral-500">Loading…</p>}
      {loaded && audits.length === 0 && (
        <p className="mt-8 text-sm text-neutral-500">
          No audit reports yet — they land nightly (~3am), or click “Run now”.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {audits.map((a) => (
          <div key={a.id} className="rounded-lg border border-edge bg-panel/30">
            <button onClick={() => setOpenId(openId === a.id ? null : a.id)} className="block w-full p-3 text-left">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold text-neutral-100">{a.campaignTitle || a.campaignId}</span>
                {a.playerName && <span className="text-xs text-accent/80">{a.playerName}</span>}
                <span className="text-xs text-neutral-500">{a.auditDate}</span>
                <span className="font-mono text-[10px] text-neutral-600">{a.model}</span>
                {a.costUsd != null && <span className="text-[10px] text-neutral-600">${a.costUsd.toFixed(3)}</span>}
                <span className="ml-auto flex gap-3 text-xs">
                  <Count n={a.report.inconsistencies.length} label="inconsistencies" tone="text-bad" />
                  <Count n={a.report.droppedThreads.length} label="dropped" tone="text-accent" />
                  <Count n={a.report.frustrations.length} label="frustrations" tone="text-bad" />
                  {a.applied && (a.applied.npcs > 0 || a.applied.threads > 0) && (
                    <span className="text-good" title="Continuity fills auto-applied to the live session">
                      ✓ applied {a.applied.npcs + a.applied.threads}
                    </span>
                  )}
                </span>
              </div>
              {totalIssues(a) === 0 && (
                <div className="mt-1 text-xs text-good">Clean — no issues found.</div>
              )}
              <p className="mt-1.5 text-[13px] leading-snug text-neutral-300">{a.report.storyContext}</p>
            </button>

            {openId === a.id && (
              <div className="space-y-4 border-t border-edge p-3 text-[13px]">
                <Section title="Inconsistencies" empty={a.report.inconsistencies.length === 0}>
                  {a.report.inconsistencies.map((x, i) => (
                    <div key={i} className="rounded border border-edge bg-ink/40 p-2">
                      <div>
                        <span className={`font-semibold uppercase text-[10px] ${SEV_CLASS[x.severity]}`}>{x.severity}</span>{" "}
                        <span className="text-neutral-200">{x.what}</span>
                      </div>
                      {x.evidence && <div className="mt-1 text-xs italic text-neutral-500">{x.evidence}</div>}
                      {x.suggestedFix && <div className="mt-1 text-xs text-good">fix: {x.suggestedFix}</div>}
                    </div>
                  ))}
                </Section>

                <Section title="Dropped story lines" empty={a.report.droppedThreads.length === 0}>
                  {a.report.droppedThreads.map((x, i) => (
                    <div key={i} className="rounded border border-edge bg-ink/40 p-2">
                      <div className="text-neutral-200">{x.title}</div>
                      {x.lastSeen && <div className="mt-0.5 text-xs text-neutral-500">last seen: {x.lastSeen}</div>}
                      {x.suggestedBeat && <div className="mt-1 text-xs text-good">beat: {x.suggestedBeat}</div>}
                    </div>
                  ))}
                </Section>

                <Section title="Player frustration" empty={a.report.frustrations.length === 0}>
                  {a.report.frustrations.map((x, i) => (
                    <div key={i} className="rounded border border-edge bg-ink/40 p-2">
                      <div className="text-neutral-200">{x.signal}</div>
                      {x.quote && <div className="mt-0.5 text-xs italic text-neutral-400">“{x.quote}”</div>}
                      {x.cause && <div className="mt-0.5 text-xs text-neutral-500">cause: {x.cause}</div>}
                      {x.suggestedFix && <div className="mt-1 text-xs text-good">fix: {x.suggestedFix}</div>}
                    </div>
                  ))}
                </Section>

                {/* THE HEADLINE — the systemic cause behind the findings and the
                    check that prevents recurrence (stories are never retro-edited). */}
                {(a.report.patterns ?? []).length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-accent">
                      Patterns → proposed checks (the durable fix)
                    </div>
                    <div className="space-y-1.5">
                      {(a.report.patterns ?? []).map((p, i) => (
                        <div key={i} className="rounded border border-accent/40 bg-ink/40 p-2">
                          <div className="text-neutral-100">
                            <span className="mr-1.5 rounded bg-panel px-1 py-0.5 font-mono text-[10px] uppercase text-accent">
                              {p.mechanism}
                            </span>
                            {p.pattern}
                          </div>
                          {p.evidence && <div className="mt-1 text-xs italic text-neutral-500">seen in: {p.evidence}</div>}
                          {p.proposedCheck && <div className="mt-1 text-xs text-good">check: {p.proposedCheck}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Legacy pre-patterns reports. */}
                {(a.report.patterns ?? []).length === 0 && a.report.adjustments.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                      Recommended adjustments (dev-facing)
                    </div>
                    <ul className="space-y-1">
                      {a.report.adjustments.map((s, i) => (
                        <li key={i} className="text-neutral-300">
                          • {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return <span className={n > 0 ? tone : "text-neutral-600"}>{n} {label}</span>;
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  if (empty) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
