# WORKFLOW.md — how features get built (strategy → implement → review)

The house development loop, proven on the NPC-canon effort (`HANDOFF_NPC_CANON.md`
is the worked example — read it once to see every part of this in action):

1. **STRATEGY** (strong model, e.g. Fable/Opus) — analyze, decide, write a handoff.
2. **IMPLEMENT** (fast model, e.g. Sonnet) — execute the handoff task by task.
3. **REVIEW** (strong model) — adversarial pass over the diffs; fix what it finds.

Why this split works: a decision-final spec makes the fast model reliable on
pattern-shaped work, and the closing review catches what a spec-faithful
implementer structurally cannot — the seams the spec didn't mention. On the
worked example, phases 1+2 produced four clean tasks and phase 3 caught five
defects, one of which would have crashed every live campaign on deploy.

Everything both phases keep repeating lives HERE, once. A handoff doc should
contain only what's specific to its feature — it REFERENCES this file for the
rest.

---

## The non-negotiables (every phase, every task)

1. **The engine does all math; the model only narrates + proposes.** Every new
   canon fact is engine-written. Never let the narrator author a mechanical fact.
2. **Set-once.** Canon fields never silently overwrite (`n.field ?? newValue`).
   House pattern: `registerNpc` / `setNpcSex` in `drift/llm/runtimeNarrative.ts`.
3. **One write path per fact.** Deterministic writer + analyst backstop call the
   SAME function (house pattern: `markNpcFate` in `drift/shared/npcFate.ts`).
4. **Conservative matching.** A wrong pin is worse than a late one (house
   patterns: `matchCastCasualty`, `inferNpcSex` — strict, ambiguity → retry).
5. **Pure and tested.** New logic is pure functions in `drift/shared/` with
   model-free vitest coverage.
6. **CHECKS.md is the registry.** Every new guard gets a row in its family
   section AND an incident-lineage line.
7. **Canon ids import from `@/content/pack`** — `canonLint.test.ts` fails CI on
   hardcoded ids outside `content/`.
8. **Don't add prose rules for things the engine can enforce.**

## House mechanics (commands, migrations, git)

- Verify: `npx tsc --noEmit` + `npx vitest run` from `drift/`. NEVER
  `npm run build` while a dev server runs (spurious `.next` errors).
- **Golden test** (`llm/contextSlice.golden.test.ts`) pins prompt bytes: any
  `promptSections/` or `jsonSystem.ts` change fails it. Inspect the diff
  line-by-line, confirm every change is yours and intended, THEN `-u`. Never
  `-u` blind.
- **Migrations**: `drift/db/migrations/NN_name.sql`. Number via
  `node scripts/next-migration.mjs`, then RECONCILE against the live log
  (Supabase MCP `list_migrations`, project `mgsogqnrpvoblqxkfgge`) before
  `apply_migration`. Parallel windows have already minted duplicate numbers
  twice — the helper + live log at apply time are the only truth.
- **Multi-window git**: another session may share this working tree. Before
  committing: `git fetch && git status --short`; dirty files you didn't touch
  are someone else's WIP — commit ONLY your paths and diff-check every shared
  file first. Sync (`git pull --rebase origin main`) before commit AND push.
  One commit per task, house message style (read `git log`).
- **Windows traps**: never write file content via bash heredocs (backslashes
  get mangled — use Write/Edit tools); no backticks inside `git commit -m`
  strings; PowerShell here-strings are not Bash.
- **Live DB edits race the warm session cache** (`drift/lib/state.ts`) — DDL is
  safe; data edits to an actively-played campaign get clobbered. Use the admin
  campaign editor (writes through the session store) or wait for idle.
- **jsonb slices load UNPARSED** (`campaign_runtime` — jobs, sceneCard,
  npcRelations…): Zod defaults never run on load, so a NEW field on a persisted
  type MUST ship with load-time normalization (see `jobs` in `lib/state.ts`).
  This exact miss was the review-pass critical on the worked example.

---

## Phase 1 — STRATEGY (strong model)

**Inputs:** CLAUDE.md → the relevant feature docs → CHECKS.md (which check
families exist / which one should have caught the live incident) → **live data**
(Supabase MCP: real campaign state, transcripts, `ai_calls` — ground every
claimed failure in an actual row before designing around it).

**Output:** `HANDOFF_<NAME>.md`, structured like the worked example:

- *Context*: what live failure(s) this fixes, in one paragraph each, with the
  evidence.
- *Task list in build order* — small/pattern tasks first, the novel
  cross-system slice last. Per task: **failure class → design (decided — the
  implementer never re-litigates) → exact file anchors → house pattern to copy
  by name → tests to write → done-criteria** (tests green, golden reconciled,
  CHECKS.md row, migration applied+committed).
- *Explicitly OUT of scope* — named, so the implementer doesn't wander.
- *Definition of done* for the whole handoff.

**Spec-quality bar:** name the exact functions to copy ("copy `setNpcSex`,
swap the field"), not just the behavior. Include a "legacy data" note for any
task touching a persisted type. Reference this file for everything generic —
do NOT restate the non-negotiables per handoff.

Register the handoff in CLAUDE.md's docs map before handing off.

## Phase 2 — IMPLEMENT (fast model)

**Read order:** CLAUDE.md → WORKFLOW.md (this file) → the handoff, fully,
before writing code.

**Rules:**
- Implement tasks in the handoff's order; **one commit per task**, path-scoped.
- The designs are decided. If reality contradicts the spec (an anchor moved, a
  signature changed), adapt mechanically and note it — don't redesign. If the
  contradiction is architectural, STOP and flag rather than improvise.
- **Annotate the handoff at ship time**: mark each task ✅ SHIPPED with a short
  note of what you decided in the gaps (these annotations are what make the
  review fast).
- Investigate flagged oddities you hit (dead code, stale docs) enough to report
  them; fixing beyond the spec is the reviewer's call.
- Full verify before every commit: `tsc` clean + full vitest green + golden
  diff inspected.

## Phase 3 — REVIEW (strong model)

Review the implementation commits diff-by-diff **against the original
objective** (the live failure, not just the handoff text). Then fix what you
find, in the same session — review without fix-forward wastes the context.

**The checklist** (each item has caught a real defect):
1. **Legacy data shapes** — anything loaded without a Zod parse: does new code
   read a field old rows don't have? Check LIVE data, not fixtures
   (`execute_sql` on real campaigns). ← caught the would-be full outage.
2. **Bypassed guards** — does any new path create/mutate entities without going
   through the existing guard functions (registerNpc dedupe, PC-name guard,
   clamps)? ← caught the giver-duplication + PC-first-name bugs.
3. **Backstops firing INTO the new feature** — existing machinery (dialogue
   backstop, analyst, presence inference) reacting to the new feature's output
   before/after it runs. ← the giver was registered by the pitch before accept.
4. **Sibling-instance collisions** — two instances of the new thing generated
   in one pass sharing state they shouldn't. ← same-board cast name reuse.
5. **Admin/cleanup reachability** — can the admin editor see/fix/delete what
   the feature creates (id-prefix guards, `isCampaignNpc`-style filters)?
6. **Objective check** — does the change actually close the ORIGINAL live
   failure end to end, and are deliberate deferrals honestly recorded in the
   feature doc?
7. Golden diffs, migration log reconcile, full suite, `tsc`.

**Close-out:** annotate the handoff with what the review caught; update the
CHECKS.md rows; flip the CLAUDE.md docs-map pointer from "ready-to-implement"
to "shipped record"; update STATUS.md's backlog.

## Routing guidance (when to use which lane)

- **Pattern-replication tasks** (copy an existing house pattern, swap fields):
  fast model solo is reliable; review can be light.
- **Novel slices crossing seams** (persistence, registration/presence
  machinery, prompt contract, multiple systems at once): full three-phase loop,
  review non-negotiable. On the worked example, 100% of defects were in the one
  task of this shape.
- **Hotfixes / live triage**: strong model end-to-end; too much live-data
  judgment per step to hand off.
