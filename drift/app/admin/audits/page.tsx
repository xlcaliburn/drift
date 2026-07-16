"use client";

import { useEffect, useState } from "react";
import type { AuditRow } from "@/app/api/admin/audits/route";
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

  useEffect(() => {
    setLoaded(false);
    fetch("/api/admin/audits")
      .then((r) => r.json())
      .then((data) => {
        setAudits(data.audits ?? []);
        setLoaded(true);
      });
  }, [reloadNonce]);

  // Manual trigger — runs the same pass the 3am cron does (admin-authed).
  async function runNow() {
    setRunning(true);
    setRunNote("Running the audit pass — a strong-model read per campaign; this can take a few minutes…");
    try {
      const res = await fetch("/api/cron/daily-audit", { method: "POST" });
      const data = await res.json();
      setRunNote(
        res.ok
          ? `Audited ${data.audited}/${data.total} campaigns · $${(data.costUsd ?? 0).toFixed(3)}`
          : `⚠ ${data.error ?? "run failed"}`,
      );
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setRunNote(`⚠ ${e instanceof Error ? e.message : "run failed"}`);
    } finally {
      setRunning(false);
    }
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
            onClick={runNow}
            disabled={running}
            className="rounded-md border border-edge px-3 py-1 text-neutral-300 transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {running ? "Running…" : "▶ Run now"}
          </button>
          <RefreshButton onClick={() => setReloadNonce((n) => n + 1)} busy={!loaded} />
        </div>
      </div>
      {runNote && <p className="mt-2 text-xs text-neutral-500">{runNote}</p>}

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

                {a.report.adjustments.length > 0 && (
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
