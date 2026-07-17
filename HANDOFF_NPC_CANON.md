# HANDOFF — finish the NPC canon work (drift-audit findings #3–#5 + quest cast manifests)

*Written 2026-07-17 for the implementing session. This is a COMPLETE spec: the
design decisions are already made and owner-approved — implement, don't
re-litigate. Read CLAUDE.md first (invariants, commands, multi-window rules),
then this doc top to bottom before writing code.*

## Context: what this finishes

A live audit found the places the narrator model could still contradict NPC canon
because nothing engine-owned pinned the fact. Five findings; #1 (engine-recorded
deaths) and #2 (sex pin) SHIPPED in commit `5da1a93`. This handoff covers the
rest:

- **Task A** — combat capability tier stamped on cast NPCs (finding #3)
- **Task B** — faction allegiance set-once for generated NPCs (finding #4)
- **Task C** — voice + age facets in npcFlavor (finding #5)
- **Task D** — quest CAST MANIFESTS (owner-locked direction, QUESTS.md "What's
  LEFT"; kills the 4-5-randos-per-quest failure)

Do them in that order — A/B/C are small and independent; D is the big one and
builds on patterns A–C reinforce.

## Non-negotiables (violating any of these is a do-over)

1. **The engine does all math; the model only narrates + proposes.** Never let
   the model author a mechanical fact. Every new canon field is engine-written.
2. **Set-once.** Canon fields never silently overwrite (`n.field ?? newValue`,
   never `newValue`). See `registerNpc` in `drift/llm/runtimeNarrative.ts` for
   the house pattern (locationId/role/quirk/backstory/appearance are all
   set-once there).
3. **One write path per fact.** When two writers exist (deterministic + analyst
   backstop), both call the SAME function — see `markNpcFate` in
   `drift/shared/npcFate.ts`. Never duplicate the write logic.
4. **Conservative matching.** A wrong pin is worse than a late one. Copy the
   caution of `matchCastCasualty` (exact base-name, exclusion lists) and
   `inferNpcSex` (strict majority, ambiguity → undefined, retries next turn).
5. **Pure and tested.** New logic lives in `drift/shared/` as pure functions
   with vitest coverage (no API keys, no DB). Model-free tests only.
6. **CHECKS.md is the registry.** Every new guard gets a row in the right
   section (§2 People for A/B/C, §4 Story structure for D) AND an
   incident-lineage line at the bottom. Follow the exact style of the recent
   rows ("NPC fate", "NPC sex pin").
7. **Canon ids come from `@/content/pack`** — `canonLint.test.ts` FAILS CI if a
   canon id (loc-*, f-*) is hardcoded outside `content/`. Import, never inline.

## House workflow (read before touching anything)

- **Verify with** `npx tsc --noEmit` + `npx vitest run` (from `drift/`). NEVER
  `npm run build` while a dev server runs (spurious .next errors — CLAUDE.md).
- **Golden test**: `llm/contextSlice.golden.test.ts` pins the prompt bytes. If
  you change any `promptSections/` output or `jsonSystem.ts`, the golden FAILS —
  inspect the diff (`npx vitest run contextSlice.golden`), confirm every changed
  line is exactly your intended edit and nothing else, then `-u` to update.
  Never `-u` blind.
- **Migrations**: files in `drift/db/migrations/`, numbered `NN_name.sql`. Pick
  the number with `node scripts/next-migration.mjs` (from `drift/`), then
  RECONCILE against the live log (Supabase MCP `list_migrations`, project
  `mgsogqnrpvoblqxkfgge` — the "drift" project) before applying with
  `apply_migration`. Do NOT trust the numbers named in this doc (028/029) —
  parallel windows have ALREADY collided here twice (the live log carries two
  026s and two 027s; harmless since names differ and all applied, but don't add
  a third pair). The NAME part is what matters; take whatever number the helper
  + live log agree is free at the moment you apply.
- **Multi-window git**: another Claude window may share this working tree.
  Before committing: `git fetch && git status --short` — if files you did NOT
  touch are dirty, they're the other window's WIP: commit ONLY your paths
  (`git add <paths> && git commit -- <paths>`), and diff-check each shared file
  first (`git diff -- <file>`) to confirm every hunk is yours. Sync
  (`git pull --rebase origin main`) immediately before commit AND push.
- **Windows shell traps**: bash heredocs (`cat << 'EOF'`) mangle backslashes in
  this environment — regex `\\b` becomes `\b` and breaks the file. Use the
  Write/Edit tools for file content, never heredocs. PowerShell here-strings
  are not Bash. Commit messages: repeated `-m` flags; backticks inside `-m`
  get shell-executed, so avoid them.
- **Live DB edits** race the warm in-memory session cache (`drift/lib/state.ts`)
  — a playing player's next turn can clobber a direct DB write. Schema DDL is
  safe; data edits to active campaigns are not (use the admin editor pattern or
  wait for idle).

---

## Task A — combat tier stamp on cast NPCs

**Failure class:** spawned enemies have tiers (T1–T3) but a *cast* NPC has no
stored tier, so every `combatStart` naming a known NPC lets the model re-pick
their toughness — Calvo is a T3 boss in one fight and re-spawns T1 later.

**Design (decided):**
- New optional field `tier: z.enum(["T1","T2","T3"])` on `Npc`
  (`drift/shared/schemas.ts`, next to `sex`). Migration `028_npc_tier.sql`:
  `alter table npcs add column if not exists tier text;`
- In the `combatStart` handler — `drift/llm/applyPlan/combat.ts` (personal-scale
  branch, where `rawGroups` is built from `cs.enemies`, around line 66): for each
  group with a `name`, resolve it against the cast with **`matchCastCasualty`**
  from `@/shared/npcFate` (reuse it — it already does base-name matching,
  PC/crew exclusion, and skips the dead; do NOT write a second matcher).
  - If the matched NPC has a stored `tier` → **override the group's tier with
    it** (stored canon beats the model's pick). A stored tier also beats the
    net-worth clamp — it plays the same role as `major` (an established person
    is who they are; the clamp exists for generic spawns).
  - If the matched NPC has NO tier → spawn as today (model tier + clamp), then
    after `startCombat` returns, stamp the tier that ACTUALLY spawned
    (post-clamp) set-once on the NPC. Post-clamp is deliberate: canon is what
    the player actually fought.
- Stamping needs a state write from applyPlan: add a tiny set-once function
  `setNpcTier(rt, npcId, tier)` in `runtimeNarrative.ts` (copy `setNpcSex`
  verbatim, swap the field) + the one-line `engineBridge.ts` wrapper.
- Context feed: in `drift/llm/promptSections/world.ts`, extend the `looks` tag
  for present/companion NPCs: when `n.tier` is set, append `— a ${n.tier} threat`
  inside the existing `[looks: …]` bracket (don't add a new bracket; the line is
  long already).

**Tests** (`drift/llm/applyPlan.test.ts` has the harness — `run(state, plan)`):
1. combatStart naming a cast NPC with stored `tier: "T3"` and model tier T1 →
   spawned enemy is T3 (check `ctx.combat.enemies`).
2. combatStart naming an un-tiered cast NPC → after the fight starts, the NPC
   record carries the spawned (post-clamp) tier.
3. A generic name ("Thug") stamps nothing, matches nothing.
4. A second combatStart with a different model tier re-uses the stored tier
   (set-once proven).

**Done when:** tests pass, golden updated if the world.ts line changed, CHECKS.md
§2 row + lineage line added, migration applied live and committed.

---

## Task B — faction allegiance set-once for generated NPCs

**Failure class:** `registerNpc` never sets `factionId` (only hand-seeded canon
has one), so a generated fixer's allegiance is whatever this scene implies —
Sable one scene, Crown the next. Allegiance changes should be story events, not
drift.

**Design (decided):**
- No schema/migration work — `Npc.factionId` and the `faction_id` column exist.
- **Writer = the scene analyst** (capture-from-fiction, like sex — the live turn
  is too noisy to trust):
  1. `drift/llm/summarizer.ts` — `NpcAnalysis` gains
     `factionId?: string`. In the npcs instruction block (the big prompt string
     ~line 94), add: `"factionId": string (ONLY if the scene made this person's
     faction allegiance concrete — one of the KNOWN FACTION IDS provided; omit
     when unsure or unaligned)`. Feed the analyst the faction list:
     `analyzeScene` has grown an OPTIONS bag as its last parameter (currently
     `{ establishedFacts }` — check the live signature, it moves) — add
     `factions: {id, name}[]` to that bag and thread it from the callers
     (`app/api/turn/route.ts` `compressClosedScene` and `lib/analystRun.ts`
     `runOpenSceneAnalyst` — both have `state.factions` in reach). Render one
     line in the prompt:
     `KNOWN FACTION IDS: f-crown=Hollow Crown, …`. Parse-side: accept the field
     only if it matches a real faction id from that list (same trust pattern as
     `fate` gating on `knownIds`).
  2. `drift/lib/analystRun.ts` `applyAnalystUpdates` — for a KNOWN npc with
     `u.factionId` and `!known.factionId`, set it set-once. Add
     `setNpcFaction(rt, npcId, factionId)` to `runtimeNarrative.ts` (again: copy
     `setNpcSex`, swap field) + bridge wrapper. NEVER overwrite an existing
     factionId — an allegiance CHANGE is out of scope (deferred to the
     consequence-web work).
- Context feed: `world.ts` NPC line — when `n.factionId` resolves to a faction
  name, append ` · ${factionName}` right after the `plays:` clause closing
  paren. Resolve names via `state.factions` (already in the section's ctx).

**Tests:**
1. Pure: summarizer parse accepts a valid faction id, drops an invented one
   (extend the existing summarizer parse tests if present; else test through
   `applyAnalystUpdates` with a hand-built `NpcAnalysis[]`).
2. `applyAnalystUpdates` sets factionId once; a second update with a different
   id does NOT overwrite.
3. world.ts renders the faction suffix (golden will pin it if a fixture NPC has
   a factionId — check fixtures; if none do, add a unit assertion instead).

**Done when:** tests pass, CHECKS.md §2 row + lineage, golden reconciled.

---

## Task C — voice + age facets in npcFlavor

**Failure class:** quirk pins demeanor + a tell, but not HOW they talk (clipped
vs. florid, slang, formality) or their age — "the old man" drifts young, a
dockworker speaks like a poet one scene and a soldier the next.

**Design (decided):**
- `drift/shared/npcFlavor.ts`:
  - New `VOICES` pool (~14 entries, one line each): speech-pattern descriptions
    like "clipped sentences, dock slang", "over-formal, never contracts words",
    "slow drawl, picks words carefully", "rapid-fire, swallows word endings",
    "spacer cant thick enough to cut", "quiet, makes you lean in", "florid,
    loves a metaphor", "blunt monosyllables", "constant profanity, oddly
    warm", "asks rhetorical questions", "third-person about themselves",
    "quotes prices/odds for everything", "old lane-freighter slang", "precise,
    like reading a manifest". Keep them role-agnostic and sex-neutral.
  - New `generateVoice(seed)` — copy `generateQuirk`'s shape exactly (key
    normalization, `pick(VOICES, "voice:" + key)`).
  - New `AGES` pool folded into **`generateAppearance`** (not a new field):
    ~6 bands — "young, barely past apprentice age", "in their thirties",
    "mid-forties and weathered", "in their fifties", "grey and past sixty",
    "old enough that people wonder". Compose:
    `"${build}, ${pick(AGES, "age:" + key)}, with ${face} and ${mark}."` —
    UPDATE the existing appearance tests' regex to the new shape.
  - `generateNpcFlavor` returns `{ quirk, backstory, appearance, voice }`.
- `Npc` schema: `voice: z.string().optional()`. Migration `029_npc_voice.sql`
  (`alter table npcs add column if not exists voice text;`). (Age needs no
  field — it lives inside `appearance`.)
- `registerNpc` (both the set-once backfill branch and the new-NPC branch):
  `voice: n.voice ?? generateVoice(n.id)` / spread from `generateNpcFlavor`.
  Note the backfill branch gates backstory/appearance on `originCampaignId` —
  do the SAME for voice (hand-seeded canon may already imply voice in oneBreath).
- `world.ts`: render-time fallback like looks — for present/companion NPCs
  append ` [voice: ${n.voice ?? generateVoice(n.id)}]` after the looks tag.
- **Appearance note:** existing stored appearances (set-once, no age) stay as
  they are; only new generations carry age. That asymmetry is accepted — do NOT
  write a data migration to regenerate stored appearances.

**Tests:** extend `drift/shared/npcFlavor.test.ts` — determinism, shape regexes
(appearance regex now includes the age clause), variety, `generateNpcFlavor`
includes voice. Update the appearance-shape assertions that Task C breaks.

**Done when:** tests pass, golden reconciled (the voice tag WILL change golden —
fixture NPCs are present), CHECKS.md updated (extend the existing "Fixed NPC
appearance + origin backstory" row rather than adding a new one), migration
applied + committed.

---

## Task D — quest cast manifests (the big one)

**Owner's words:** "predetermine for quests, how many and which characters
should exist for each quest. there could be variations on the quest details,
but they should follow some predetermined formula so that there will not be a
reason for 4 or 5 people to randomly spawn in." Locked design bullet already in
QUESTS.md "What's LEFT" — read it before starting.

**Failure class:** a running job accretes model-invented randos (a live campaign
had 8 thin "Spoke with the player" shells out of 22 cast). The quest's PEOPLE
must be constants like its objectives and payout.

**Design (decided):**

1. **Archetype cast specs** — in `drift/shared/quests.ts`, extend the
   `Archetype` interface with `cast: CastRole[]` where
   `type CastRole = "giver" | "target" | "contact" | "ward"`. Per archetype:
   - courier: `["giver"]` · smuggling: `["giver", "contact"]` (contact =
     receiver at the drop) · bounty: `["giver", "target"]` · protection:
     `["giver", "ward"]` · heist: `["giver", "contact"]` (inside contact) ·
     recon: `["giver"]` · broker: `["giver", "target"]` (the counterparty —
     note broker's persuade step already says "Close the deal with {target}") ·
     salvage: `["giver"]`.
2. **Job schema** — `Job` gains
   `cast: z.array(z.object({ role: z.enum([...]), npcId: z.string(), name: z.string() })).default([])`.
   Jobs are a jsonb slice (`campaign_runtime.jobs`) — **no migration needed**.
3. **Generation** (`generateJob`): for each cast role, generate a person:
   - Name: reuse `suggestName` from `@/content/examples` — it takes a 0..1
     seed; feed it `rng.int(0, 100000)/100000` style values from the job's rng
     (stay deterministic, NEVER Math.random). Retry (bounded, ~5 tries) if the
     name collides (case-insensitive base-name) with `state.npcs` or
     `state.characters` — on exhaustion, suffix with a surname pick. This
     respects the name-collision guard by construction.
   - Id: `npc-job-<jobId>-<role>` (a NEW prefix). **Update `isCampaignNpc` in
     `drift/lib/state.ts`** to include `npc-job-` so these persist on the
     campaign runtime and promote like other generated NPCs.
   - The `{target}` placeholder in objective summaries: when the archetype's
     cast includes a target, fill `{target}` with the generated target's NAME
     (not the generic `TARGETS` pool line — keep the pool as fallback for
     archetypes without a cast target). The pool line can become the target's
     `role` handle instead ("a Wrecker enforcer").
4. **Materialization** — cast members become real cast NPCs **on ACCEPT, not at
   offer** (an unaccepted offer's people would bloat the cast). New pure
   function in `drift/shared/quests.ts`:
   `materializeJobCast(state, job): CampaignState` — for each cast entry not
   already in `state.npcs` (by id — idempotent), append an `Npc`:
   `{ id, universeId, name, oneBreath: role-appropriate one-liner naming the
   job, role: <CastRole-appropriate handle>, locationId: <giver → the posted
   location; target/contact/ward → the job's destination locationId>,
   originCampaignId: campaign.id, ...generateNpcFlavor(id) }`.
   Wire it where cargo is granted on accept — BOTH accept paths in
   `drift/app/api/turn/route.ts`: the chip path AND the typed-accept backstop
   (search `grantJobCargo` — mirror its placement), plus `applyJobClick` in
   `drift/shared/jobsRuntime.ts` if that path also accepts (check it).
5. **Cleanup on completion/abandon:** do NOT delete the people (they existed;
   deleting breaks history). On job completion, append a relation note to the
   giver ("paid out the <title> job") via the existing `npcRelations` plumbing
   in `resolveJobsTurn` if cheap to do; otherwise skip — NO stronger cleanup.
6. **Context feed** — `drift/llm/promptSections/quests.ts`:
   - `activeJobs`: for each active job with a cast, append
     ` [cast — use EXACTLY these people, invent no one for this job: giver
     Sera Vantry (fixer, at Rook Station); target Bram Volkov (bail-runner, at
     The Shear)]`. Resolve locations to names via `state.locations`.
   - `offeredJobs`: append the giver's name to the offer line
     (`from ${giverName} for ${faction}`) so the diegetic pitch has a person.
7. **Prompt rule** — `jsonSystem.ts` rule 8: after "never invent a different
   paying job", add: "A job's CAST is fixed data (listed with the job) — use
   exactly those people for its beats; never invent additional gang members,
   middlemen, or contacts for a tracked job." Golden will change; reconcile.
8. **NPC-given jobs note:** `giver` stays `"board"` in the `Job.giver` field
   (the 1b NPC-given-jobs slice is SEPARATE — don't do it); the cast giver is
   the PERSON who fronts the board posting in the fiction.

**Tests** (`drift/shared/quests.test.ts` has extensive fixtures to copy):
1. Every archetype generates exactly its spec'd cast; ids are
   `npc-job-<jobId>-<role>`; names never collide with existing cast/characters.
2. Deterministic: same seed → same cast names.
3. `{target}` in summaries equals the cast target's name for bounty/broker/
   protection.
4. `materializeJobCast` is idempotent (double-accept adds nothing) and pins
   home locations as spec'd.
5. Route-level: accept → cast in `state.npcs` (mirror the `grantJobCargo`
   route test if one exists; else test `materializeJobCast` + `applyJobClick`
   integration purely).
6. Prompt section renders the cast line (unit-assert the section output).

**Done when:** tests pass, golden reconciled, QUESTS.md "What's LEFT" entry
moved to SHIPPED with a date + summary (match the ~~inventory-tracked cargo~~
entry's style), CHECKS.md §4 row + lineage line, `isCampaignNpc` updated, no
migration needed (assert that in the commit message).

---

## Explicitly OUT of scope (do not touch)

- NPC-given jobs (`giver` = npc id), faction arcs, betrayal/favor ledger —
  separate backlog slices with their own docs.
- Allegiance CHANGES (Task B is set-once only).
- The incidental-NPC reusable pool (QUESTS.md mentions it alongside manifests —
  it's a later slice).
- Regenerating stored appearances for age (Task C note).
- Anything in `MULTIPLAYER.md` §4–6, `WORLD_SYSTEMS.md`, `LOCATIONS.md` Phase 2.

## Definition of done (whole handoff)

- `npx tsc --noEmit` clean; `npx vitest run` fully green (was 806 at last verification).
- Golden diffs inspected line-by-line before every `-u`.
- Migrations 028/029 applied live (reconciled first) AND committed.
- CHECKS.md rows + incident lineage for A, B, D; C folded into the appearance row.
- One commit per task (A, B, C, D), path-scoped, synced before commit and push,
  conventional message style (`feat(quests): …`, `feat(continuity): …`) with the
  failure class in the body — read `git log` for the house voice.
