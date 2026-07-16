import Anthropic from "@anthropic-ai/sdk";
import { deepseekChat, isDeepSeekModel, resolveModel } from "./deepseek";
import { repairTruncatedJson, stripCodeFences } from "./jsonRepair";
import type { NpcAnalysis, ThreadAnalysis } from "./summarizer";
import type { TokenUsage } from "@/lib/pricing";

/**
 * NIGHTLY CONTINUITY AUDIT (the ~3am pass). Once a day, a STRONG model (Opus by
 * default) reads each active campaign whole — the full transcript window, the
 * cast, the open threads, the day's appeals — and produces the report the
 * per-scene analyst can't: cross-scene INCONSISTENCIES, story lines that
 * DROPPED, and where the player got FRUSTRATED (retries, complaints, appeals).
 *
 * Same discipline as the scene analyst: the audit NEVER mutates mechanics.
 * Its npc/thread updates ride the same applyAnalystUpdates/applyThreadUpdates
 * machinery (engine-owned dedup/caps); everything else is a REPORT for the
 * admin panel, not an action.
 */

// ── Report shape ────────────────────────────────────────────────────────────────

export interface AuditInconsistency {
  severity: "low" | "medium" | "high";
  /** What contradicts what — one concrete sentence. */
  what: string;
  /** The evidence: short quotes/paraphrases of the contradicting beats. */
  evidence?: string;
  /** How to reconcile it in-fiction (or which check family should catch it). */
  suggestedFix?: string;
}

export interface AuditDroppedThread {
  /** The story line that went quiet (a promise, a job, an NPC's ask). */
  title: string;
  /** Where it last appeared / what state it was left in. */
  lastSeen?: string;
  /** A concrete beat the narrator could use to revive or close it. */
  suggestedBeat?: string;
}

export interface AuditFrustration {
  /** What the signal was: an APPEAL, repeated retries, a complaint typed in-game. */
  signal: string;
  /** The player's own words, when short and clear. */
  quote?: string;
  /** Root cause as best the audit can tell (model under-fire, unclear UI, rules gap). */
  cause?: string;
  suggestedFix?: string;
}

/**
 * The audit's HEADLINE deliverable: not per-story fixes (stories are never
 * retro-edited) but the recurring failure PATTERN behind the findings and the
 * engine check that would prevent it recurring. `mechanism` uses the CHECKS.md
 * taxonomy — under-fire / invention / drift — plus engine-gap for a missing
 * affordance in the rules themselves.
 */
export interface AuditPattern {
  /** The recurring failure mode, stated generally ("prose asserts deal terms no system stores"). */
  pattern: string;
  mechanism: "under-fire" | "invention" | "drift" | "engine-gap";
  /** Which findings above evidence it (short refs, not re-quotes). */
  evidence?: string;
  /** The concrete guard: an engine check, a deterministic backstop, a prompt rule. */
  proposedCheck?: string;
}

export interface DailyAuditReport {
  /** 3-6 sentences: where this campaign STANDS — the story so far, current stakes. */
  storyContext: string;
  inconsistencies: AuditInconsistency[];
  droppedThreads: AuditDroppedThread[];
  frustrations: AuditFrustration[];
  /** The systemic causes behind the findings + the check that prevents each. */
  patterns: AuditPattern[];
  /** Legacy field (pre-patterns reports); kept so old rows still render. */
  adjustments: string[];
  /** Continuity fills, applied via the analyst machinery (same shapes/guards). */
  npcs: NpcAnalysis[];
  threads: ThreadAnalysis[];
}

export interface DailyAuditResult {
  report: DailyAuditReport;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  raw: string;
}

// ── Model ───────────────────────────────────────────────────────────────────────

/** Default: Sonnet — with the pattern taxonomy, live sheet, and evidence
 *  structure all scaffolded in the prompt, the audit is classification-with-
 *  evidence, well within Sonnet at ~40% of Opus's rate (~$0.05-0.09/campaign
 *  day-sliced). The orchestrator ESCALATES to Opus for campaigns that filed an
 *  APPEAL that day — the days deep root-cause diagnosis actually pays. */
export function defaultAuditModel(): string {
  return process.env.DAILY_AUDIT_MODEL ?? "claude-sonnet-5";
}

/** The escalation model for appeal days (see auditCampaign). */
export function escalationAuditModel(): string {
  return process.env.DAILY_AUDIT_ESCALATION_MODEL ?? "claude-opus-4-8";
}

// ── Prompt ──────────────────────────────────────────────────────────────────────

const AUDIT_SYSTEM =
  'You are the nightly continuity auditor for DRIFT, an AI-narrated space-opera TTRPG. A deterministic engine owns all mechanics (dice, HP, credits, items); a cheap narrator model writes the prose. You are the strong model reading one player\'s ENTIRE recent campaign once a day to catch what the per-scene passes miss. Reply ONLY with one JSON object:\n' +
  '{"storyContext": string (3-6 sentences, present tense: where this campaign STANDS — who the character is now, what they\'re pursuing, what\'s at stake, who matters),\n' +
  ' "inconsistencies": [ CROSS-SCENE contradictions in the STORY — a fact asserted then contradicted, an NPC acting as a stranger to someone they know, a place/time impossibility, an item or promise that flickered in and out of existence. {"severity": "low"|"medium"|"high" (high = a player would notice and lose trust), "what": string (one concrete sentence: X contradicts Y), "evidence": string (short quotes or turn references for both sides), "suggestedFix": string (how the narrator should reconcile it in-fiction going forward)} — report REAL contradictions only, never style nitpicks. ],\n' +
  ' "droppedThreads": [ story lines that went QUIET without resolution — a promise made and forgotten, a hook raised then never mentioned again, an NPC who asked for something and vanished, a tracked objective circling with no path forward. {"title": string, "lastSeen": string (what state it was left in), "suggestedBeat": string (one concrete scene beat that would revive or close it)} ],\n' +
  ' "frustrations": [ moments the PLAYER was frustrated. Evidence: APPEAL lines (the player escalating a wrong outcome — always include these), typing the same intent repeatedly, arguing with the narrator ("I already did that", "that makes no sense"), system error lines, rage-quit patterns (long engaged session ending abruptly right after a sour beat). {"signal": string (what happened), "quote": string (the player\'s own words, short), "cause": string (your best diagnosis: narrator under-fired a field, engine rule surprised them, unclear affordance), "suggestedFix": string} ],\n' +
  ' "patterns": [ THE HEADLINE. The devs never retro-edit a story that already played — the only durable fix is a CHECK, so distill the findings above into the recurring failure PATTERNS behind them (one pattern often explains several findings, sometimes across the whole report). {"pattern": string (the failure mode stated GENERALLY — "narrated deal terms have no durable home, so later scenes contradict them" — not a one-off story note), "mechanism": one of "under-fire" (the narrator did not emit a structured field the engine needed: threads, items, npcs, standing), "invention" (the narrator asserted state the engine never granted: a heal, a death, a name, an item, a price), "drift" (prose written before/against an engine-resolved result contradicts it), "engine-gap" (the engine itself lacks the affordance — nothing stores the state or resolves the action), "evidence": string (short refs to the findings above, not re-quotes), "proposedCheck": string (the concrete guard: an engine-owned mutation, a deterministic backstop on typed intent, a re-narration pass, a context pin, a validation rule — name where it would fire)}. 1-4 patterns; prefer ONE well-evidenced pattern over many thin ones. ],\n' +
  ' "npcs": [ continuity FILLS the running cast is missing, same shape as the scene analyst: {"name": string (REQUIRED), "id": string (a KNOWN id only if clearly the same person; omit for new), "presence": "mentioned" (audits run offline — never mark anyone present), "role": string, "oneBreath": string (who they really are), "note": string (one concrete beat of what passed between them and the player), "relationship": string (short label)}. Only figures that CLEARLY matter and are missing/thin in the KNOWN list. Usually 0-3. ],\n' +
  ' "threads": [ quest-tracking corrections against the OPEN THREADS list: {"op":"open","title":string,"body":string} for a real commitment that is NOT tracked; {"op":"resolve","id":string (exact id)} for a tracked thread the story clearly finished or abandoned. Usually 0-2. ]}\n' +
  'Ground EVERYTHING in the transcript — quote it. Never invent a person, event, or complaint. Do not list the player\'s own character in npcs. Omit-empty: use [] freely; a quiet, coherent campaign should produce a short report. Severity discipline: most days have ZERO high-severity findings.';

export interface AuditInputs {
  /** Character + campaign header ("Vess — Hollow Crown courier at Meridian Ring, tenday 4"). */
  header: string;
  /** The full recent transcript window, PLAYER:/DM:/SYSTEM: prefixed. */
  transcript: string;
  /** KNOWN NPC roster: "id = name (role): oneBreath [standing]". */
  npcRoster: string;
  /** OPEN THREADS list: "id = title (status)". */
  threadRoster: string;
  /** Active + recently completed jobs. */
  jobs: string;
  /** Older context: recent scene summaries, oldest→newest. */
  recentScenes: string;
  /** The day's APPEAL calls + turn errors, verbatim-ish. */
  appeals: string;
  /** Bugs already fixed in the engine/prompt — the transcript window can span
   *  weeks, so without this the audit re-reports solved failures as live. */
  recentlyFixed?: string;
}

/** Keep CURRENT as fixes ship — one line each. Fed to the auditor so findings
 *  about already-patched failure modes get filtered at the source. */
export const RECENTLY_FIXED_NOTE =
  "- Typed 'use stim'/'use medkit' now applies deterministically (phantom narrated heals with no HP change: FIXED)\n" +
  "- Typed suicide intent now gets an engine confirmation and a REAL death (narrated deaths/resurrections the sheet ignored: FIXED)\n" +
  "- Bleeding Out death saves are engine-rolled (downed players are no longer improvised)\n" +
  "- NPC home stations are pinned; someone based elsewhere can't be inferred into the scene by a comms quote (FIXED)\n" +
  "- Two different people sharing a name no longer merge into one NPC record (FIXED)\n" +
  "- Job offers are engine-generated with giver/adversary coherence (Crown-smuggles-past-Crown postings: FIXED)";

export function buildAuditUser(i: AuditInputs): string {
  return (
    `CAMPAIGN: ${i.header}\n\n` +
    `KNOWN NPCs (id = name: description):\n${i.npcRoster || "(none)"}\n\n` +
    `OPEN THREADS (id = title):\n${i.threadRoster || "(none)"}\n\n` +
    `JOBS (engine-tracked):\n${i.jobs || "(none)"}\n\n` +
    `EARLIER SCENES (summaries, oldest first):\n${i.recentScenes || "(none)"}\n\n` +
    `TODAY'S APPEALS + ERRORS (the player escalating or the system failing):\n${i.appeals || "(none)"}\n\n` +
    `RECENTLY FIXED (do NOT report these already-patched failure modes unless the transcript shows them recurring AFTER the fix — prefer findings from the most recent play):\n${i.recentlyFixed || "(none)"}\n\n` +
    `TRANSCRIPT (the recent window, oldest first):\n${i.transcript}`
  );
}

// ── Parse (pure, unit-tested) ───────────────────────────────────────────────────

const str = (v: unknown, n: number) => (v ? String(v).trim().slice(0, n) : undefined);

/** Parse + bound the model's raw JSON into a DailyAuditReport. Never throws —
 *  unparseable output degrades to an empty report with the raw text as context. */
export function parseAuditReport(raw: string): DailyAuditReport {
  const empty: DailyAuditReport = {
    storyContext: "",
    inconsistencies: [],
    droppedThreads: [],
    frustrations: [],
    patterns: [],
    adjustments: [],
    npcs: [],
    threads: [],
  };
  // Strip markdown code fences (the model sometimes wraps the JSON despite the
  // contract) before extracting the object.
  const unfenced = stripCodeFences(raw);
  let parsed: Record<string, unknown>;
  try {
    const match = unfenced.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : unfenced);
  } catch {
    // Truncated output (hit the token cap mid-object) — salvage what parsed.
    const repaired = repairTruncatedJson(unfenced);
    if (!repaired) return { ...empty, storyContext: raw.slice(0, 500) };
    parsed = JSON.parse(repaired);
  }
  const arr = (v: unknown): Record<string, unknown>[] =>
    (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object");

  const inconsistencies: AuditInconsistency[] = arr(parsed.inconsistencies)
    .map((x) => ({
      severity: (["low", "medium", "high"].includes(String(x.severity)) ? x.severity : "low") as AuditInconsistency["severity"],
      what: str(x.what, 300) ?? "",
      evidence: str(x.evidence, 500),
      suggestedFix: str(x.suggestedFix, 300),
    }))
    .filter((x) => x.what)
    .slice(0, 10);

  const droppedThreads: AuditDroppedThread[] = arr(parsed.droppedThreads)
    .map((x) => ({ title: str(x.title, 120) ?? "", lastSeen: str(x.lastSeen, 300), suggestedBeat: str(x.suggestedBeat, 300) }))
    .filter((x) => x.title)
    .slice(0, 8);

  const frustrations: AuditFrustration[] = arr(parsed.frustrations)
    .map((x) => ({
      signal: str(x.signal, 200) ?? "",
      quote: str(x.quote, 300),
      cause: str(x.cause, 300),
      suggestedFix: str(x.suggestedFix, 300),
    }))
    .filter((x) => x.signal)
    .slice(0, 10);

  const MECHANISMS = ["under-fire", "invention", "drift", "engine-gap"] as const;
  const patterns: AuditPattern[] = arr(parsed.patterns)
    .map((p) => ({
      pattern: str(p.pattern, 300) ?? "",
      mechanism: (MECHANISMS.includes(p.mechanism as (typeof MECHANISMS)[number])
        ? p.mechanism
        : "engine-gap") as AuditPattern["mechanism"],
      evidence: str(p.evidence, 300),
      proposedCheck: str(p.proposedCheck, 400),
    }))
    .filter((p) => p.pattern)
    .slice(0, 4);

  // Legacy field — older reports (and a model ignoring the new contract).
  const adjustments = (Array.isArray(parsed.adjustments) ? parsed.adjustments : [])
    .map((a) => str(a, 400))
    .filter((a): a is string => !!a)
    .slice(0, 5);

  // Same bounds as the scene analyst; presence is forced to "mentioned" — an
  // offline audit must never mark someone into the live Here & now.
  const npcs: NpcAnalysis[] = arr(parsed.npcs)
    .map((u): NpcAnalysis => ({
      id: str(u.id, 80),
      name: str(u.name, 60),
      presence: "mentioned",
      role: str(u.role, 40),
      oneBreath: str(u.oneBreath, 200),
      note: str(u.note, 160),
      relationship: str(u.relationship, 60),
    }))
    .filter((u) => u.id || u.name)
    .slice(0, 5);

  const threads: ThreadAnalysis[] = arr(parsed.threads)
    .map((t): ThreadAnalysis | null => {
      if (t.op === "open") {
        const title = str(t.title, 80);
        return title ? { op: "open", title, body: str(t.body, 200) } : null;
      }
      if (t.op === "resolve") {
        const id = str(t.id, 80);
        return id ? { op: "resolve", id } : null;
      }
      return null;
    })
    .filter((t): t is ThreadAnalysis => t !== null)
    .slice(0, 4);

  return {
    storyContext: str(parsed.storyContext, 1500) ?? "",
    inconsistencies,
    droppedThreads,
    frustrations,
    patterns,
    adjustments,
    npcs,
    threads,
  };
}

// ── Call ────────────────────────────────────────────────────────────────────────

/**
 * Run one campaign's nightly audit. Falls back DeepSeek-reasoner → Haiku if the
 * strong model errors, so a provider hiccup degrades the report, not the run.
 */
export async function runDailyAudit(inputs: AuditInputs, opts: { model?: string } = {}): Promise<DailyAuditResult> {
  const primary = resolveModel(opts.model ?? defaultAuditModel());
  const candidates = [primary];
  if (!isDeepSeekModel(primary) && process.env.DEEPSEEK_API_KEY) candidates.push("deepseek-reasoner");
  if (process.env.ANTHROPIC_API_KEY && primary !== "claude-haiku-4-5-20251001") candidates.push("claude-haiku-4-5-20251001");

  const user = buildAuditUser(inputs);
  const started = Date.now();
  let raw = "{}";
  let usedModel = primary;
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  for (const model of candidates) {
    try {
      if (isDeepSeekModel(model)) {
        const resp = await deepseekChat({
          model,
          maxTokens: 6000,
          system: [{ type: "text", text: AUDIT_SYSTEM }],
          messages: [{ role: "user", content: user }],
        });
        const text = resp.content.find((b) => b.type === "text");
        raw = text && text.type === "text" ? text.text : "{}";
        usage.inputTokens = resp.usage?.input_tokens ?? 0;
        usage.outputTokens = resp.usage?.output_tokens ?? 0;
        usage.cacheReadTokens = resp.usage?.cache_read_input_tokens ?? 0;
      } else {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const resp = await client.messages.create({
          model,
          max_tokens: 6000,
          system: AUDIT_SYSTEM,
          messages: [{ role: "user", content: user }],
        });
        const text = resp.content.find((b) => b.type === "text");
        raw = text && text.type === "text" ? text.text : "{}";
        usage.inputTokens = resp.usage.input_tokens;
        usage.outputTokens = resp.usage.output_tokens;
        usage.cacheReadTokens = resp.usage.cache_read_input_tokens ?? 0;
        usage.cacheWriteTokens = resp.usage.cache_creation_input_tokens ?? 0;
      }
      usedModel = model;
      break;
    } catch (e) {
      console.error(`[dailyAudit] model ${model} failed:`, e instanceof Error ? e.message : e);
    }
  }

  return {
    report: parseAuditReport(raw),
    model: usedModel,
    usage,
    latencyMs: Date.now() - started,
    raw,
  };
}
