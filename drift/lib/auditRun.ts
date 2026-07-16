import "server-only";
import { getSession, setSession, persistSession, hasSupabase, type SessionData } from "@/lib/state";
import {
  runDailyAudit,
  defaultAuditModel,
  escalationAuditModel,
  RECENTLY_FIXED_NOTE,
  type AuditInputs,
  type DailyAuditResult,
} from "@/llm/dailyAudit";
import { applyAnalystUpdates } from "@/lib/analystRun";
import { recordAiCall } from "@/lib/audit";
import { dispositionLabel } from "@/shared/scene";

/**
 * The NIGHTLY AUDIT ORCHESTRATOR (~3am cron): for every campaign that actually
 * PLAYED in the last day, run the strong-model continuity audit, fold its safe
 * continuity fills back into the live session (same analyst machinery as the
 * per-scene pass), and persist the report for /admin/audits. Sequential on
 * purpose — one campaign at a time keeps memory flat and respects rate limits;
 * at playtest scale (~7 active) the whole pass is a few minutes.
 */

export interface AuditRunSummary {
  campaignId: string;
  ok: boolean;
  model?: string;
  costUsd?: number;
  latencyMs?: number;
  inconsistencies?: number;
  droppedThreads?: number;
  frustrations?: number;
  applied?: { npcs: number; threads: number };
  error?: string;
}

/** Campaigns with at least one recorded turn in the window (default 26h — a
 *  little slack so a 3am cron never misses late-evening play to clock drift). */
export async function activeCampaignIds(hours = 26): Promise<string[]> {
  if (!hasSupabase()) return [];
  const { getServiceClient } = await import("@/db/queries");
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await getServiceClient()
    .from("turn_usage")
    .select("campaign_id")
    .gt("created_at", cutoff)
    .not("campaign_id", "is", null);
  if (error) throw new Error(`activeCampaignIds: ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.campaign_id as string))];
}

/** One row per campaign the nightly pass WOULD include — the admin "Run now"
 *  modal shows these so a run can be scoped before it spends. */
export interface AuditCandidate {
  campaignId: string;
  name: string | null;
  playerEmail: string | null;
  /** Turns recorded in the window — a feel for how much there is to audit. */
  turnsToday: number;
  /** Already has a report for today's date (a rerun replaces it). */
  auditedToday: boolean;
}

export async function activeCampaignPreviews(hours = 26): Promise<AuditCandidate[]> {
  if (!hasSupabase()) return [];
  const { getServiceClient } = await import("@/db/queries");
  const db = getServiceClient();
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();

  const { data: turns, error } = await db
    .from("turn_usage")
    .select("campaign_id")
    .gt("created_at", cutoff)
    .not("campaign_id", "is", null);
  if (error) throw new Error(`activeCampaignPreviews: ${error.message}`);
  const counts = new Map<string, number>();
  for (const r of turns ?? []) {
    const id = r.campaign_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ids = [...counts.keys()];
  if (!ids.length) return [];

  const [{ data: camps }, { data: audited }] = await Promise.all([
    db.from("campaigns").select("id,name,player_id").in("id", ids),
    db
      .from("daily_audits")
      .select("campaign_id")
      .eq("audit_date", new Date().toISOString().slice(0, 10))
      .in("campaign_id", ids),
  ]);
  const auditedSet = new Set((audited ?? []).map((r) => r.campaign_id as string));
  const playerIds = [...new Set((camps ?? []).map((c) => c.player_id as string | null).filter((p): p is string => !!p))];
  const emails = new Map<string, string>();
  if (playerIds.length) {
    const { data: profiles } = await db.from("profiles").select("id,email").in("id", playerIds);
    for (const p of profiles ?? []) emails.set(p.id as string, (p.email as string) ?? "");
  }
  const campById = new Map((camps ?? []).map((c) => [c.id as string, c]));

  return ids
    .map((id) => {
      const c = campById.get(id);
      return {
        campaignId: id,
        name: (c?.name as string) ?? null,
        playerEmail: c?.player_id ? emails.get(c.player_id as string) ?? null : null,
        turnsToday: counts.get(id) ?? 0,
        auditedToday: auditedSet.has(id),
      };
    })
    .sort((a, b) => b.turnsToday - a.turnsToday);
}

/** The day's APPEAL calls + errored turns for one campaign — the strongest
 *  frustration signals, fed to the auditor verbatim (truncated). */
async function dayAppealsText(campaignId: string, hours = 26): Promise<string> {
  if (!hasSupabase()) return "";
  const { getServiceClient } = await import("@/db/queries");
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data } = await getServiceClient()
    .from("ai_calls")
    .select("kind, prompt_preview, response_preview, error, created_at")
    .eq("campaign_id", campaignId)
    .gt("created_at", cutoff)
    .or("kind.eq.appeal,error.not.is.null")
    .order("created_at", { ascending: true })
    .limit(20);
  return (data ?? [])
    .map((r) => {
      const when = String(r.created_at).slice(11, 16);
      if (r.kind === "appeal") {
        return `[${when}] APPEAL — player: ${String(r.prompt_preview ?? "").slice(-400)}\n  ruling: ${String(r.response_preview ?? "").slice(0, 400)}`;
      }
      return `[${when}] ${r.kind} ERROR: ${String(r.error ?? "").slice(0, 300)}`;
    })
    .join("\n");
}

/** Turns recorded for this campaign in the window — sizes the day-slice. */
async function dayTurnCount(campaignId: string, hours = 26): Promise<number> {
  if (!hasSupabase()) return 0;
  const { getServiceClient } = await import("@/db/queries");
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const { count } = await getServiceClient()
    .from("turn_usage")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .gt("created_at", cutoff);
  return count ?? 0;
}

/** Assemble one campaign's audit inputs from its live session. Exported for tests.
 *  `maxEntries` day-slices the transcript (derived from turns recorded today) —
 *  the audit reads TODAY's play in full and leans on scene summaries for the
 *  older story, which halves input cost and stops re-reporting stale findings. */
export function buildAuditInputs(live: SessionData, appeals: string, maxEntries?: number): AuditInputs {
  const s = live.state;
  const pc = s.characters.find((c) => c.kind === "pc");
  const loc = s.locations.find((l) => l.id === s.campaign.currentLocationId);
  const faction = s.factions.find(
    (f) => f.id === (pc?.ownFactionId ?? pc?.parentFactionId),
  );
  // The LIVE sheet rides the header as ground truth — the transcript contains
  // HISTORICAL sheet snapshots, and auditing against those produced a false
  // "riot gun still on sheet after being dropped" finding (the live sheet was
  // fine; the audit had only an old in-transcript copy to compare with).
  const gearNow = pc?.gear.map((g) => `${g.name}${g.qty && g.qty > 1 ? ` ×${g.qty}` : ""}`).join(", ") || "nothing";
  const header =
    `${pc?.name ?? "Unknown"} — ${faction ? `${faction.name} ` : ""}character at ` +
    `${loc?.name ?? "unknown location"}, tenday ${s.campaign.tendaysElapsed ?? 0} ` +
    `(campaign ${s.campaign.id}).\n` +
    `LIVE SHEET RIGHT NOW (the engine's single source of truth — any sheet text inside the transcript is a HISTORICAL snapshot; judge sheet-vs-prose findings against THIS line only): ` +
    `HP ${pc?.hp ?? "?"}/${pc?.maxHp ?? "?"}, ¢${pc?.credits ?? 0}, stims ${pc?.stims ?? 0}, carrying: ${gearNow}`;

  const npcRoster = s.npcs
    .map((n) => {
      const rel = live.npcRelations[n.id];
      const standing = rel
        ? ` [${dispositionLabel(rel.disposition)}${rel.relationship ? ` · ${rel.relationship}` : ""}${rel.lastNote ? ` · last: ${rel.lastNote}` : ""}]`
        : "";
      const home = n.locationId ? ` (based ${s.locations.find((l) => l.id === n.locationId)?.name ?? n.locationId})` : "";
      return `${n.id} = ${n.name}${n.role ? ` (${n.role})` : ""}${home}: ${n.oneBreath}${standing}`;
    })
    .join("\n");

  const threadRoster = s.threads
    .filter((t) => t.status !== "resolved")
    .map((t) => `${t.id} = ${t.title}${t.body ? ` — ${t.body}` : ""}`)
    .join("\n");

  const jobs = live.jobs
    .filter((j) => j.status === "active" || j.status === "complete")
    .slice(-10)
    .map((j) => {
      const next = j.objectives.find((o) => !o.done);
      return `${j.title} [${j.status}]${next ? ` — next: ${next.summary}` : ""}`;
    })
    .join("\n");

  const recentScenes = live.recentScenes.map((sc) => `[s${sc.seq}] ${sc.title}: ${sc.summary}`).join("\n");

  // Day-sliced transcript: the tail covering roughly today's turns (each turn ≈
  // 2-3 entries), floored so quiet days still carry enough context to judge.
  // Older story rides the scene summaries above. Char cap backstops a whale.
  const entries = live.transcript.filter((e) => e.role !== "recap");
  const transcript = entries
    .slice(-(maxEntries ?? entries.length))
    .map((e) => `${e.role.toUpperCase()}: ${e.text}`)
    .join("\n")
    .slice(-120_000);

  return { header, transcript, npcRoster, threadRoster, jobs, recentScenes, appeals, recentlyFixed: RECENTLY_FIXED_NOTE };
}

/** Persist the report row (idempotent per campaign per day — a rerun replaces). */
async function persistReport(
  campaignId: string,
  res: DailyAuditResult,
  applied: { npcs: number; threads: number },
  costUsd: number,
): Promise<void> {
  if (!hasSupabase()) return;
  const { getServiceClient } = await import("@/db/queries");
  const { error } = await getServiceClient()
    .from("daily_audits")
    .upsert(
      {
        campaign_id: campaignId,
        audit_date: new Date().toISOString().slice(0, 10),
        model: res.model,
        report: res.report,
        applied,
        cost_usd: costUsd,
      },
      { onConflict: "campaign_id,audit_date" },
    );
  if (error) console.error("[auditRun] persist report failed:", error.message);
}

/** Audit ONE campaign end to end. Never throws — errors land in the summary. */
export async function auditCampaign(campaignId: string): Promise<AuditRunSummary> {
  try {
    const live = await getSession(campaignId);
    if (!live) return { campaignId, ok: false, error: "session not found" };
    if (live.transcript.length < 6) return { campaignId, ok: false, error: "too little play to audit" };

    const appeals = await dayAppealsText(campaignId).catch(() => "");
    // Day-slice: ~3 transcript entries per recorded turn, floored at 40 entries
    // so a quiet day still gives the auditor enough to judge continuity against.
    const turnsToday = await dayTurnCount(campaignId).catch(() => 0);
    const inputs = buildAuditInputs(live, appeals, Math.max(40, turnsToday * 3));
    // Model tiering: Sonnet by default; a day the player FILED AN APPEAL is a day
    // something went wrong enough to escalate to the strong model for diagnosis.
    const model = appeals.includes("APPEAL") ? escalationAuditModel() : defaultAuditModel();
    const res = await runDailyAudit(inputs, { model });

    // Fold the safe continuity fills into the live session via the SAME guarded
    // machinery as the scene analyst (dedup, name guards, engine-owned ids). The
    // report itself (inconsistencies/frustrations/adjustments) is human-facing.
    let applied = { npcs: 0, threads: 0 };
    if (res.report.npcs.length || res.report.threads.length) {
      const changed = await applyAnalystUpdates(live, res.report.npcs, [], res.report.threads);
      if (changed) {
        applied = { npcs: res.report.npcs.length, threads: res.report.threads.length };
        setSession(campaignId, live);
        await persistSession(campaignId, live);
      }
    }

    const { estimateCostUsd } = await import("@/lib/pricing");
    const costUsd = estimateCostUsd(res.model, res.usage);
    await persistReport(campaignId, res, applied, costUsd);
    await recordAiCall({
      campaignId,
      kind: "audit",
      model: res.model,
      latencyMs: res.latencyMs,
      usage: res.usage,
      prompt: `nightly audit — ${inputs.header}`,
      response: res.raw,
    });

    return {
      campaignId,
      ok: true,
      model: res.model,
      costUsd,
      latencyMs: res.latencyMs,
      inconsistencies: res.report.inconsistencies.length,
      droppedThreads: res.report.droppedThreads.length,
      frustrations: res.report.frustrations.length,
      applied,
    };
  } catch (e) {
    return { campaignId, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Campaigns that already have a report for TODAY (a cron re-invocation skips
 *  them — that's what makes the split cron schedule resumable). */
async function auditedTodayIds(ids: string[]): Promise<Set<string>> {
  if (!hasSupabase() || !ids.length) return new Set();
  const { getServiceClient } = await import("@/db/queries");
  const { data } = await getServiceClient()
    .from("daily_audits")
    .select("campaign_id")
    .eq("audit_date", new Date().toISOString().slice(0, 10))
    .in("campaign_id", ids);
  return new Set((data ?? []).map((r) => r.campaign_id as string));
}

/**
 * The full nightly pass: every campaign that played today, one at a time.
 * `onlyIds` (the admin modal's selection) scopes the run — ids are still
 * intersected with the ACTIVE set, so a stale/foreign id can't force an audit.
 *
 * SERVERLESS REALITY: one strong-model read is 30-90s, and the function that
 * hosts this has a hard wall-clock cap (Vercel kills it mid-run and returns a
 * PLAIN-TEXT error). So a no-selection run (the cron) SKIPS campaigns already
 * audited today and STOPS STARTING new audits once `timeBudgetMs` is spent —
 * the schedule invokes the route more than once, and each invocation picks up
 * where the last left off. An explicit selection ignores both (reruns are the
 * point) — the admin UI drives those one campaign per request instead.
 */
export async function runNightlyAudits(
  onlyIds?: string[],
  timeBudgetMs = Number(process.env.AUDIT_TIME_BUDGET_MS) || 240_000,
): Promise<AuditRunSummary[]> {
  const started = Date.now();
  let ids = await activeCampaignIds();
  if (onlyIds) {
    // An explicit selection is honored exactly — [] runs nothing (deselect-all),
    // undefined (the cron, no body) runs everyone active.
    const wanted = new Set(onlyIds);
    ids = ids.filter((id) => wanted.has(id));
  } else {
    const done = await auditedTodayIds(ids);
    ids = ids.filter((id) => !done.has(id));
  }
  const out: AuditRunSummary[] = [];
  for (const id of ids) {
    if (Date.now() - started > timeBudgetMs) {
      out.push({ campaignId: id, ok: false, error: "skipped — time budget spent (next cron invocation picks it up)" });
      continue;
    }
    out.push(await auditCampaign(id));
  }
  return out;
}
