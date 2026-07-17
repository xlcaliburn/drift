# CONTINUITY.md — Scene Memory Design

*Status: **v1 shipped.** This file now tracks only what's left of the
scene-memory system. For the shipped v1 (scene card, NPC relations, scene
summaries, present-NPC forcing), see the CONTINUITY note in CLAUDE.md.*

The scene is the unit of memory: three tiers — NOW (scene card, working
memory), RECENT (scene summaries, episodic), CANON (NPCs/threads/facts,
semantic). Engine-owned throughout (the invariant: if it matters, the engine
owns it; the model only proposes).

---

## Nightly audit — the strong-model retrospective (SHIPPED 2026-07-16)

A fourth layer above the per-scene analyst: once a day (~3am cron), a strong
model reads each campaign that PLAYED that day — the day-sliced transcript,
the LIVE sheet, cast + standings, open threads, jobs, scene summaries, and the
day's APPEAL calls/errors — and produces what a scene-scoped pass can't.
Model: **Sonnet across the board** (`DAILY_AUDIT_MODEL`, ~$0.05-0.09 per
campaign day-sliced) — no Opus tier; the pattern taxonomy + live sheet in the
prompt make this classification-with-evidence, and Opus proved overkill at
playtest scale. Fallback chain on provider error: deepseek-v4-flash → Haiku.
(The nightly CRON is currently DISABLED — vercel.json crons is empty while next
steps are decided; the admin "Run now" path still works.)

- **Inconsistencies** — cross-scene contradictions (a fact asserted then
  contradicted, an NPC playing stranger to a friend), severity-ranked.
- **Dropped story lines** — promises/hooks that went quiet, each with a
  concrete revival beat the narrator could use.
- **Player frustration** — appeals (always), repeated retries, in-game
  complaints, error lines; each with a root-cause guess and a suggested fix.
- **Story context** — a 3-6 sentence "where this campaign stands" brief.
- **Adjustments** — dev-facing tuning recommendations.
- **Continuity fills** — npc/thread updates in the SAME shapes as the scene
  analyst, auto-applied through the same guarded machinery
  (`applyAnalystUpdates`/`applyThreadUpdates`); presence is forced to
  "mentioned" so an offline pass can never write into the live Here & now.

Where it lives: `llm/dailyAudit.ts` (prompt + pure `parseAuditReport`, tested),
`lib/auditRun.ts` (campaign selection via `turn_usage`, appeals via `ai_calls`,
apply + persist), `app/api/cron/daily-audit` (CRON_SECRET bearer for the
scheduler, or an admin session — "Run now" on the admin page), `daily_audits`
table (migration 024, one row per campaign per day, reruns replace),
`/admin/audits` (the report UI). Cost ≈ $0.15–0.35/campaign/day at Opus list
rates; every call is metered into `ai_calls` as kind `audit`. Scheduling:
`vercel.json` cron at 08:00 UTC — adjust to taste, or point any scheduler at
the route with the bearer secret.

---

## Remaining work

### 1. Facts ledger — CANON tier v2 — **SHIPPED 2026-07-16 (v1)**

Standing facts that outlive scenes and fit neither NPC nor thread: struck deal
terms, appointments, bans, debts. Born urgent from the audit pattern — "50/50 —
Done" renegotiated scenes later as "30%... that was a different conversation",
and Dex's Rust Bucket meet overwritten because nothing durable remembered it.

Shipped shape: `TurnPlan.facts [{text ≤160, entityRefs}]` (model proposes, rule
10) → `applyPlan/facts.ts` handler → `shared/facts.ts` `applyFactUpdates` (pure,
tested): **capped at 20**, deduped — exact/containment, 80% token overlap, or a
matching 3-content-word SUBJECT ("split kaela crate"), so a RESTATED deal
replaces its older wording instead of contradicting it — oldest evicted. Stored
on `campaign_runtime.facts` (migration 025), session slice like jobs/relations.
Fed back every turn via the `establishedFacts` prompt section ("durable canon —
honor these exactly"). Still TODO from the original design: facts riding
retrieval by entityRef (v1 sends all 20 — ~300 tokens, fine).

### 2. Shrink the verbatim history window 10 → 6 exchanges (D-3)

Once summaries have proven out in a playtest cycle, shrink the verbatim history
from ~10 to ~6 exchanges. The 4 dropped exchanges are exactly the ones the scene
summaries now cover better than raw text did. **Not a same-commit change** — do
it after summaries have run in play, so a regression is easy to attribute.

### 3a. Self-healing memory tier — **SHIPPED 2026-07-17**

The Lyra analysis showed the real failure shape: the analyst fails, the F-3 stub
persists FOREVER, and nothing alarms — 12 of 14 summaries junk in one campaign,
invisible until three appeals. Now: (1) every analyst call is AUDITED —
`SummaryTelemetry` rides `SceneAnalysis` and lands in `ai_calls` as kind
`summary` (model, fallback, jsonRepair salvage, error) — `/admin/ai-calls`
filtered to `summary` is the memory-health dashboard; (2) a failed compression
is stamped `degraded` and keeps its raw transcript slice (`scenes.raw_slice`,
migration 026); (3) `repairDegradedScenes` re-runs the analyst from the
preserved slice — triggered by the next HEALTHY scene close (2 per run) and the
manual re-sync (3 per run) — replacing the stub and folding in the NPC/thread
updates the original failure dropped. Not retro-editing: same transcript in,
same tier written. Pre-026 stub rows have no preserved slice and stay as-is.

### 3. Bug — summarizer persists raw truncated JSON — **FIXED 2026-07-16**

Some scene summaries were persisted as **raw truncated JSON** (e.g.
`{\n "summary": "...`) instead of clean prose — and one such stub embedded a
wrong PC name into canon (the "Harrow calls Cali 'Vess'" incident). Fixed in
`llm/summarizer.ts`: both parse paths now strip code fences and run
`llm/jsonRepair.repairTruncatedJson` (salvages the complete prefix of a
token-capped response), and every terminal fallback returns an EMPTY summary —
never raw model text — so the caller's deterministic F-3 stub takes over.
Existing polluted rows are left as-is (stories are not retro-edited); they age
out of the recent-scenes window.

---

## Locked decisions (don't re-litigate)

- **D-2** Facts ledger is the deferred v2 canon slice (above).
- **D-3** Verbatim history shrinks 10 → 6 one playtest cycle after summaries
  land (not same-commit).

## Flags still relevant to unbuilt work

- **F-3 — summarizer failure loses a scene.** On summarize failure, store a
  deterministic fallback (first + last player action + engine lines) so the
  scene is never a hole. (Related to the raw-JSON bug above.)
- **F-4 — facts junk accumulation.** Caps + dedupe; facts LRU at 20.
- **F-5 — snapshot bloat.** The Scene schema has a `snapshot` field (full state
  per scene, for rewind). NOT part of this design — leave unused; summaries
  only. Revisit if rewind becomes a feature.
- **F-6 — double memory in multiplayer.** Scene rows are campaign-scoped
  (private). Cross-campaign canon stays the world_events feed (MULTIPLAYER.md);
  this system never leaks a private scene into the shared universe.
