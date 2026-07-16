import "server-only";
import { getSession, setSession, persistSession, hasSupabase, type SessionData } from "@/lib/state";
import { runDailyAudit, type AuditInputs, type DailyAuditResult } from "@/llm/dailyAudit";
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

/** Assemble one campaign's audit inputs from its live session. Exported for tests. */
export function buildAuditInputs(live: SessionData, appeals: string): AuditInputs {
  const s = live.state;
  const pc = s.characters.find((c) => c.kind === "pc");
  const loc = s.locations.find((l) => l.id === s.campaign.currentLocationId);
  const faction = s.factions.find(
    (f) => f.id === (pc?.ownFactionId ?? pc?.parentFactionId),
  );
  const header =
    `${pc?.name ?? "Unknown"} — ${faction ? `${faction.name} ` : ""}character at ` +
    `${loc?.name ?? "unknown location"}, tenday ${s.campaign.tendaysElapsed ?? 0} ` +
    `(campaign ${s.campaign.id})`;

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

  // The full recent transcript window (the store caps it at ~400 entries). Char
  // cap keeps a whale campaign under ~30k input tokens.
  const transcript = live.transcript
    .filter((e) => e.role !== "recap")
    .map((e) => `${e.role.toUpperCase()}: ${e.text}`)
    .join("\n")
    .slice(-120_000);

  return { header, transcript, npcRoster, threadRoster, jobs, recentScenes, appeals };
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
    const inputs = buildAuditInputs(live, appeals);
    const res = await runDailyAudit(inputs);

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

/** The full nightly pass: every campaign that played today, one at a time.
 *  `onlyIds` (the admin modal's selection) scopes the run — ids are still
 *  intersected with the ACTIVE set, so a stale/foreign id can't force an audit. */
export async function runNightlyAudits(onlyIds?: string[]): Promise<AuditRunSummary[]> {
  let ids = await activeCampaignIds();
  if (onlyIds) {
    // An explicit selection is honored exactly — [] runs nothing (deselect-all),
    // undefined (the cron, no body) runs everyone active.
    const wanted = new Set(onlyIds);
    ids = ids.filter((id) => wanted.has(id));
  }
  const out: AuditRunSummary[] = [];
  for (const id of ids) out.push(await auditCampaign(id));
  return out;
}
