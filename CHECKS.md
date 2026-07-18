# CHECKS.md — The Continuity Check Registry

Continuity is the product. An AI-narrated game lives or dies on whether the world
*remembers* — people, promises, wounds, money, time. The cheap narrator forgets,
invents, and contradicts; every check below exists because the engine cannot trust
it, and most were born from a specific live failure (§ "born from" notes).

**How to use this doc:** it is the single registry of every continuity/consistency
mechanism in the game. When adding a feature, walk the families below and ask which
ones it needs (usually: a deterministic path for the player's click, a backstop for
the model under-firing its field, and a re-narration when the prose can drift from
the mechanics). When a playtest surfaces a contradiction, find the family that
should have caught it — the fix is usually a new row here, not a prose rule.

The three recurring failure modes every family defends against:

1. **Under-fire** — the model doesn't emit the structured field (threads, useItem,
   sceneEnd, npcs…). Fix: deterministic detection or a retrospective analyst pass.
2. **Invention** — the model asserts state the engine never granted (a heal, a
   credit figure, an item, a death). Fix: engine-only mutation + prose scrubbing +
   re-narration.
3. **Drift** — prose written before the engine resolved (roster, roll outcome)
   contradicts the result. Fix: engine-first re-narration.

---

## 0. The architecture that makes checks possible

| Mechanism | Where | What it guarantees |
|---|---|---|
| Engine owns ALL math | `engine/`, `llm/runtime*` | The model can propose, never compute — no state mutation exists outside the engine, so a narrated lie can't corrupt state |
| Structured JSON turns | `llm/jsonTurn.ts`, `shared/turnPlan.ts` | Every turn is a validated `TurnPlan`: parse → one retry with the specific error → repair; a no-output turn ABORTS and persists nothing (`TurnGenerationError`) |
| Canonical history | `jsonTurn` (persist step) | Raw model output is never fed back as context — the user side carries the action + a compact engine summary, the assistant side only the cleaned narration; one violation can't become few-shot evidence |
| Ordered apply registry | `llm/applyPlan/index.ts` | Plan intents apply in a fixed order (money → trade → npcs → gear → continuity → quests → sceneEnd → combatStart LAST), unit-tested model-free |
| History structural repair | `llm/history.ts` `sanitizeHistory` | Orphan tool_use/tool_result pairs are repaired on read so one bad old turn can't wedge a campaign (400s) |
| Turn-failure rollback | `app/api/turn/route.ts` `memorySnapshot` | Scene card / npcRelations / npcs are snapshotted per turn and restored on error — a failed turn *never happened*; retry resumes exactly |
| **`campaign_runtime` CAS** | `db/queries.saveCampaignRuntime` (`updated_at` compare-and-swap) + `lib/state.persistSession` (conflict → merge → retry once → force-write) + `shared/runtimeMerge.ts` (pure facts/npcs/recentScenes merges) | every persist | last-write-wins clobber — writers on this row multiplied (live turn, scene compression, mid-scene analyst, degraded repair, manual re-sync); `updated_at` used to be written but never checked, so a background pass finishing mid-turn could silently overwrite fresher facts/npcs with a stale copy. A CONFLICT now reloads + merges the background-owned slices before one retry; a second conflict force-writes rather than blocking a turn |
| **The continuity gym** | `llm/continuityGym.test.ts` — model-free, drives real `TurnRuntime`/`applyPlan`/`buildContextSlice`/`inferPresentNpcs` through scripted multi-scene sessions | every test run | PROACTIVE coverage — every other row here was born from a live incident already happening to a player; the gym replays the SHAPE of those incidents (facts surviving 15+ scene closes, alias-forked NPCs, scene-summary decay vs. fact durability, transcript-trim safety, home-gate + companion presence, the facts cap) before a future regression reaches one. Also the acceptance harness for a world reboot and the gate for the D-3 history-window shrink |
| **CombatState.system load normalization** | `lib/state.ts` `getSession` (`system: "classic", ...runtime.combat`) + a defensive `combat.system ?? "classic"` fallback at the `resolveCombatRound` dispatcher (`llm/runtimeCombat.ts`) | every session load / every round | `combat` is persisted jsonb loaded UNPARSED (the house jsonb rule) — a fight persisted before the CombatSystem seam shipped (Modularity M5, HANDOFF_COMBAT_V2_1) has no `system` field. Without normalization a legacy in-flight fight would hit an undefined registry entry the moment the round dispatcher looked it up. `beginCombat` stamps `system:"classic"` on every NEW fight; this guard covers everyone already mid-fight at deploy |
| **ship2 allocation clamp** | `shared/ship2.ts` `validateAllocation` (mounts→shields→engines spend order, dry-rack/unowned-mount/overspend all silently dropped — never throws) called at the TOP of `resolveShip2Round` (`llm/runtimeCombat.ts`) before anything resolves | every ship2 round | The client stages a power allocation and the route only bounds its SHAPE (`AllocationSpec` in `shared/turnPlan.ts` — array/number caps), never its legality against the ship's actual reactor/mounts/caps. A crafted or stale payload (a dock upgrade shrank a cap since the chip was drawn, a missile rack ran dry mid-fight) could otherwise overspend the reactor or fire a mount the ship doesn't own. The engine re-derives the live profile and re-validates every round — the client's numbers are always a proposal, never trusted |
| **shipyard tier/slot/already-fitted re-validation** | `shared/ship2.ts` `shipyardStock` — the ONE truth table both the chip layer (`shipyardChips`) and the buy/sell runtime (`llm/runtimeEconomy.ts` `buyShipItem`/`sellShipItem`) read from | every shipyard buy | A shipyard chip (HANDOFF_COMBAT_V2_3.md) is drawn once per turn but can be clicked later — a dock upgrade since then could have filled the last slot, or fitted the system already. `buyShipItem` re-derives `shipyardStock` from the LIVE ship at click time and checks `canBuy` itself rather than trusting the chip's own label; a stale/crafted `buyShipItem`/`sellShipItem` id that no longer qualifies (or never did) errors with a line instead of corrupting the ship |
| **Last-mount strip refusal** | `llm/runtimeEconomy.ts` `sellShipItem` (guard before the write) + `shipyardChips` (the chip is never offered) | every mount sell | An empty `weapons[]` is indistinguishable from "stock loadout" — `deriveShip2Profile`'s fallback re-derives the class defaults, so stripping a ship's ONLY gun resurrected it next fight (keep the refund AND the gun), and a crafted request could loop materialize→strip→empty for unbounded credits (the V2_3 review catch — the original test suite had pinned the exploit as intended). The yard now refuses the last strip; empty `weapons[]` only ever means "stock" |
| **Frozen ship2 profile key backfill** | `shared/ship2.ts` `normalizeFrozenShip2`, called at `lib/state.ts`'s combat load seam (beside the `system` normalization above) | every session load with a live fight | `combat.ship2.player` is FROZEN persisted jsonb — HANDOFF_COMBAT_V2_3 Task A added a required mount `key` that every allocation lookup uses, so a ship2 fight mid-flight across that deploy would silently lose ALL player fire (validateAllocation drops key-less mounts) and dead the PowerPanel. The backfill assigns `key = id` on load, idempotent. THE LESSON, twice-learned now: "no Ship schema change" does not mean "no persisted-shape change" — a profile derived from safe columns and then frozen into jsonb is jsonb, and every field added to it needs a load-time answer |
| **Storyline load normalization** | `lib/state.ts` `getSession` (`runtime.storyline?.chapters ? runtime.storyline : freshStorylineState()`) | every session load | `campaign_runtime.storyline` (migration 031) is UNPARSED jsonb, defaulted to `'{}'::jsonb` at the column level — a row with no `chapters` map would crash the first `storyline.chapters[...]` read. Same house rule as jobs/combat/ship2 above: a new jsonb slice always needs a load-time answer, never just a schema field |
| **Beat-delivery rollback safety** | `shared/storylineRuntime.ts` `resolveStorylineTurn` (only ever called with LOCAL storyline/facts variables, committed to `session.storyline` at the SAME final-assembly point `jobs`/`state` land) + `app/api/turn/route.ts` `memorySnapshot`/catch restore `session.storyline` explicitly too (belt-and-suspenders) | every turn / turn failure | HANDOFF_STORY_1.md's trap 4: a beat fed to the narrator this turn must be marked delivered ONLY if the turn actually landed — a thrown error before the final assembly must never burn a beat (delivered-but-never-narrated) the same way a failed turn must never burn a job payout |

---

## 1. Memory — does the world remember what happened?

Three tiers (design: `CONTINUITY.md`): **NOW** (scene card) → **PREVIOUSLY**
(scene summaries) → **CANON** (relations, threads, clocks).

| Check | Where | Fires | Catches |
|---|---|---|---|
| Scene card (situation/beats/place/dangers/present) | `shared/scene.ts`, mutated by `runtime.updateScene` | every turn | the working memory the model reads back as fact (prompt rule 10) |
| **Facts ledger (CANON v2)** | `shared/facts.ts` + `applyPlan/facts.ts` + `promptSections/facts.ts`, on `campaign_runtime.facts` (migration 025) | every turn | durable facts DYING with their scene — born from the audit pattern "narrated deal terms have no home" (the live 50/50 → 30% renegotiation; Dex's overwritten Rust Bucket meet). Model proposes `facts:[]`; engine caps at 20, dedupes (a restated deal REPLACES its older wording — subject-key match), evicts oldest, and feeds all back as ESTABLISHED FACTS the narrator must honor exactly |
| **Facts grounding + pinning (CONTINUITY_HARDENING.md Task 5)** | prompt: `jsonSystem.ts` rule 10 + `summarizer.ts` `ANALYST_SYSTEM` both spell out GROUNDING (never inferred, never a prediction, never scene color); ledger: `Fact.pinned` + `applyFactUpdates` eviction (`shared/facts.ts`) | every fact write / every cap eviction | facts are durable canon written by a CHEAP model — poisoning (an ungrounded guess promoted to canon) and eviction-of-load-bearing-facts (a deal's exact terms LRU'd out at the 20-cap) were both live risks with nothing guarding them. Eviction now prefers oldest UNPINNED first — pinned facts (deal terms, debts, kinship) only evict once everything is pinned. Pinned capped at 8 (a 9th pin bumps the oldest pinned) so a cheap model over-pinning can't defeat the point. ONLY the analyst may set `pinned:true` — the live turn's `TurnPlan` has no such field, so a single per-turn model call can never unilaterally declare something load-bearing. `promptSections/facts.ts` renders pinned facts first |
| **Player memory-correction loop (CONTINUITY_HARDENING.md Task 6)** | `app/api/state/route.ts` exposes `facts` (mirrors `jobs`/`playerLedger`); `components/sidebar/StoryTab.tsx` `FactsMemory` ("The game remembers", pinned first with 📌) inside `DetailsModal`'s Story tab; per-fact "flag" posts to the EXISTING `app/api/feedback` endpoint, prefilled `Memory correction: "<text>" is wrong — ` | player opens Story tab / clicks flag | players are the best inconsistency detector — three appeals found the Ren/Renwick tangle before any tooling caught it, but until now the facts ledger was invisible to them, so a wrong memory could only surface by accident. Read-only: a flag is TRIAGE input into the review queue, never a direct state write (engine-owns-writes invariant holds) — no new endpoint, no new table |
| **Analyst facts backstop** | `analyzeScene` emits `facts[]` (fed ESTABLISHED FACTS to avoid re-emits) → `applyAnalystUpdates` → `applyFactUpdates` | scene close + mid-scene + re-sync + repair | the turn path UNDER-FIRING `facts` — live evidence: ZERO facts emitted across Lyra's 164-turn campaign while the Ren/Renwick kinship reveal died with its scene. The retrospective pass is the ledger's real writer, same as it backstops threads |
| Scene auto-close cap | `applyPlan/world.ts` `sceneEnd`, `SCENE_TURN_CAP = 12` | turn 12 of a scene | DeepSeek under-firing `sceneEnd` — without the cap a scene never turns over and memory never compresses |
| Move = scene boundary | route, `isSceneMove` | place/location change | the model moving the player without closing the scene; memory tier turns over anyway (economic checklist still only fires on a real `sceneEnd`) |
| Place carry | `carryScene` | scene close | whereabouts never blank between scenes |
| Situation refresh backstop | `jsonTurn` → `runtime.refreshSituation` | model set no `scene.situation` this turn | "Here & now" going stale (the cheap model rarely sets it) |
| Scene compression + F-3 fallback | route `compressClosedScene` | background, on close | every closed scene becomes a summary; on summarizer failure a deterministic first-action+last-beat stub — never a hole |
| **Self-healing degraded summaries** | `scenes.degraded` + `raw_slice` (migration 026), `analystRun.repairDegradedScenes`, triggered by the next healthy scene close (2/run) + manual re-sync (3/run) | analyst failure | an F-3 stub living FOREVER as the scene's memory — born from the Lyra campaign (12 of 14 summaries junk; the narrator improvised the Ren/Renwick/dead-brother tangle over the invisible hole). A failed compression now keeps its raw transcript slice and gets re-summarized once the analyst is healthy; only pre-026 rows are unrecoverable (their slices are gone) |
| **Summary telemetry** | `SummaryTelemetry` on every `analyzeScene` → `recordSummaryCall` → `ai_calls` kind `summary` | every analyst call | the memory tier failing INVISIBLY — it was the only unaudited model path in the system; `/admin/ai-calls` (filter: summary) is now the memory-health dashboard (model, fallback, jsonRepair salvage, hard errors) |
| History window | route (`slice(-20)` = ~10 exchanges) | persist | context stays bounded; older context rides summaries (Continuity v2 wants ~6, GATED on Task 3+summary telemetry — see CONTINUITY_HARDENING.md Task 7) |
| **Transcript cap + index rebase** | `shared/chat.appendTranscript` (`TRANSCRIPT_CAP`), all 4 append sites in the turn route | every persist | the trim-drift bug — `sceneCard.startTranscriptIdx` is a POSITIONAL index into `transcript`; trimming old entries off the front used to leave it unadjusted, so an at-cap campaign sliced the WRONG (or, once drift exceeded the scene's length, an EMPTY) window at scene close — a silent, unflagged memory hole. Born from the Lyra Vale analysis (`camp-mrnw51dj-ac2a`, at exactly 400 entries): drift is zero until the cap, then grows every turn, which is why the heaviest campaigns lost the most memory. `appendTranscript` now rebases the index by the dropped count on every append; `compressClosedScene` also has a defense-in-depth fallback (transcript tail + forced `degraded`) if an empty slice ever recurs, so a hole can never be silent again |

## 2. People — does the cast stay real?

| Check | Where | Fires | Catches / born from |
|---|---|---|---|
| Register dedupe + set-once identity | `runtimeNarrative.registerNpc` | any NPC write | the same person re-created under a second id; a real oneBreath/role never clobbered |
| **PC-name guard** | `registerNpc` (CANON.md Phase 1) | any NPC write | the player's own character registered as an NPC ("another NPC called Wren") |
| **Name-collision guard** | `registerNpc` → `resolveNpcNameMatch` | any NPC write | TWO DIFFERENT people sharing a name silently merging into one record — born from the live "a courier Ren, then the model introduces an unrelated bar-fixer also called Ren" case. Role-aware: same name + differing KNOWN roles → a distinct NPC, disambiguated as "Name (role)"; same name + matching/absent role → still one person, merged as before. Schema: `turnPlan.npcs[].role` gives the model the field to flag it; prompt rule 9 asks it to pick a different name or set `role` on both when a coincidence is unavoidable |
| **NPC aliases** | `Npc.aliases` (migration 027), harvested by `extractNameAliases` (longer capitalized EXTENSIONS of the first name in oneBreath — never shorter prefixes) in `registerNpc`/`setNpcOneBreath`; honored by register-dedupe, retrieval, presence, speaker attribution, dialogue backstop; `(aka … — the SAME person)` on the prompt line; rule 9 forbids new names extending existing ones | any NPC write / every name match | ONE person split across names — the Lyra tangle: the record was "Ren (fixer)" while prose called him "Renwick", so retrieval/presence keyed on the wrong name and a "Renwick" mention could fork a fourth Ren. Every known name now resolves to the same record |
| **Retrieval by role token** | `llm/retrieval.ts` `retrieveEntities` (CONTINUITY_HARDENING.md Task 4) | every turn's context-slice scoring | a role-only reference ("ask the harbormaster") scored zero and dropped the NPC from context entirely — players address people by their HANDLE as often as their name. Role tokens (≥4 chars) now score 30, below name/alias (60/40) so an explicit name always wins; patron-excluded (same rationale as co-location, below) so a generic "the patron" mention can't summon them |
| **Seed-only load + provenance persist filter** | `db/queries.loadCampaignState`, `lib/state.persistSession` (CANON.md Phase 1) | load/save | cross-campaign NPC bleed — foreign generated NPCs flooding every player's cast |
| `shortRole` sanitizer | `shared/scene.ts`, applied in `registerNpc`/`setNpcOneBreath` | any role write | a role stored as a truncated SENTENCE — born from the live "Meridian Trade-House Broker Giving You A" label |
| Plan-npcs narration gate | `applyPlan/world.ts` `npcs` | apply | the model declaring an NPC that never appears in this turn's prose (phantom cast) |
| Person-shape guards | `shared/npcExtract.ts` (`isPlausibleNpcName`, `isCollectiveName`, non-person names) | apply + analyst | factions/ships/locations/junk words ("Clean") becoming NPCs |
| Dialogue-speaker backstop | `jsonTurn` post-narration (`extractDialogueNpcs`) | model forgot `npcs[]` | a named speaker with attributed dialogue joins the cast anyway; passing MENTIONS never do |
| Presence-by-speech backstop | `jsonTurn` post-narration | a known NPC speaks | whoever you're actually dealing with shows in Here & now; a merely-referenced off-screen name does NOT get dragged into the room |
| **NPC home is SET-ONCE** | `registerNpc` (`locationId: n.locationId ?? here`) | any re-registration | a mere mention/quote silently RELOCATING a known NPC's home to wherever the player stands — born from the live "Steward still nearby at Halcyon" bug (the patron's table row was then re-promoted with the corrupted home every save) |
| **Home-location presence gate** | `jsonTurn` presence loop + `inferPresentNpcs(currentLocationId)` | every presence inference | an NPC BASED at another station dragged into the scene by a comms call or a remembered quote (the live "Ilyana in the scene at Halcyon" bug). The model's explicit `npcs[]` path stays ungated — deliberate travel beats still work |
| **Companion continuity (home-gate exemption)** | `carryScene` → `sceneCard.prevPresentNpcIds`; exempts in the presence loop + `inferPresentNpcs(companionIds)`; `[WITH the player]` proximity tag; folded into retrieval focus | scene turnover | a TRAVELING COMPANION stranded by the home gate the moment the party arrives somewhere new — born from the live "courier Ren rode the shuttle with Lyra for 150 turns, presentNpcIds empty at Halcyon" gap. Whoever was present in the scene that just closed stays inferable (and surfaced in context) for one more scene; absent a full scene → decays naturally |
| **Home-base context tags** | `promptSections/world.ts` `proximityTag` | every turn | the model guessing a recalled NPC into the scene: every NPC line now says `[HERE — in this scene]` / `[based here at X — NOT in this scene unless sought out]` / `[based at X — NOT here]` — silence never means "maybe here". Backed by prompt rule 11's PEOPLE HAVE HOMES clause (comms or travel, never appearing) |
| **Fixed NPC appearance (+ age) + origin backstory + voice** | `shared/npcFlavor.ts` `generateAppearance` (build + AGE band + face + mark; ORIGINS in `generateBackstory`) + `generateVoice` (speech-pattern pool, HANDOFF Task C), fed as `[looks: …]`/`[voice: …]` for present/companion NPCs in `world.ts`, persisted set-once in `registerNpc`, `npcs.appearance`/`npcs.voice` columns (migrations 026, 029) | every turn an NPC is present | the model re-inventing the same person's BODY (or age — "the old man" drifting young) scene to scene and improvising contradictory personal history/speech — deterministic build+age+face+mark off the NPC's id (~14000 combos, universe-shared: the same person for every player), with the context header ordering "describe them from this and ONLY this" / "keep it CONSISTENT scene to scene" for voice. Backstory leads with an origin sentence so history questions draw from canon, not improv. Voice is distinct from `quirk`'s demeanor+tell — it pins HOW they talk (rhythm, formality, slang), not their personality. Render-time fallback means every existing NPC has a look/voice immediately; no data migration |
| First-meeting relation seed | `jsonTurn` (same block) | first dealing with an NPC | a blank People panel — seeds "You first dealt with the ‹role› at ‹place›." |
| **PC sex pin** | `promptSections/pcSheet.ts` + `creationFinalize` Sex line | every turn + creation pass | the PC's sex was never fed to the narrator, so it coin-flipped gender off the NAME — a live PC (Wren, legacy `sex` NULL) got "hips swaying" one scene and "stubble… a man who's spent too long staring at himself" at the mirror the next. Known sex → a hard directive (pronouns, body descriptions, NPC address); unset → explicit NEUTRALITY (no gendered anatomy/facial hair/sir/ma'am) until the player establishes it. Creation's backstory/voice/opening pass now receives Sex too, so new characters are consistent from turn one |
| **PC-name pin** | `promptSections/pcSheet.ts` | every turn | the narrator drifting to ANOTHER character's name for the player — born from the live "Harrow calls Cali 'Vess'" (an NPC coincidentally named like a past example PC surfaced in context; the summarizer then baked the wrong name into a scene summary). The sheet now states THE PLAYER CHARACTER IS "‹name›" — never another character's name |
| **Dossier-name registration guard** | `registerNpc` (`protectedNames` from reachable dossiers, wired in `jsonTurn`) | any NPC write | ANOTHER PLAYER'S character forked into a local npc-gen record — born from the live `npc-gen-wren-31` (Ekko's game registered Wren Sung after a cameo; the duplicate promoted universe-wide and later walked up to Wren's own player). Cameos ride dossiers, never a fork |
| **Scene analyst** (reasoning model) | `llm/summarizer.analyzeScene` via `lib/analystRun` — on scene close, every `ANALYST_INTERVAL = 10` turns mid-scene, and manual re-sync | retrospective | everything the live turn missed: unregistered figures (present vs mentioned), placeholder identities refreshed, relationship notes, legit flavor props |
| Faction-shaped NPC filter | `PeopleTab` | render | a faction leaking into the people roster |
| **NPC fate — engine-recorded death** | `shared/npcFate.ts` (`applyCombatDeaths`/`markNpcFate`), wired in `resolveCombatRound` (the single dispatcher every fight path crosses, ONE layer above the `CombatSystem` registry — classic AND ship2 both flow through it, personal scale only); analyst `fate` backstop (`summarizer` → `applyAnalystUpdates`) for narrated deaths no fight recorded | fight end + scene analysis | `Npc.status` existed and retrieval FILTERED gone NPCs, but nothing ever WROTE it — a named cast NPC killed in combat stayed "alive" forever, free to be re-narrated later (the cast-level "dead guard comes back" class). Now a defeated enemy matching a living cast NPC (exact base name, never PCs/crew, never generic mooks) is recorded dead with a relation-log note the People panel shows; the analyst records deaths/departures the scene showed. THE DEAD STAY DEAD: gone NPCs can't be re-marked present by inference (`jsonTurn` gate) or by the model's explicit `npcs[]` (`applyPlan` gate). A second `CombatSystem` (ship2, HANDOFF_COMBAT_V2_2.md) couldn't skip this even if it tried — the check lives at the dispatcher, not inside any system's own `resolveRound` |
| **NPC sex pin (capture-from-fiction)** | `shared/npcExtract.ts` `inferNpcSex` → `setNpcSex` (set-once) in the presence loop; fed as `(she/her)`/`(he/him)` on every NPC context line; `npcs.sex` column (migration 027) | every turn until pinned | the model regendering the same NPC scene to scene (same class as the PC sex-pin bug, one record over — courier Ren narrated she, nothing stopping a later he). Conservative capture of the narration's OWN first pronouns: only sentences naming this NPC and nobody else (plus an unambiguous following sentence), strict majority required, unset until it lands — never guessed from the name |
| **NPC combat-tier pin** | `shared/npcFate.ts` `matchCastCasualty` reused by `llm/applyPlan/combat.ts` `resolveGroupTier` + post-spawn `runtime.setNpcTier` (set-once); fed as `— a T‹n› threat` inside the `[looks: …]` bracket; `npcs.tier` column (migration 028) | every `combatStart` naming a cast NPC | a named cast member's combat capability was re-decided by the model every fight — Calvo could be a T3 boss once and a re-spawned T1 mook later. A canon-pinned tier now overrides BOTH the model's pick and the net-worth clamp (the same exemption `major` already gets); an un-tiered match is stamped from whichever tier actually ended up spawning (post-clamp — canon is what the player fought, not what the model asked for) |
| **NPC faction allegiance pin (capture-from-fiction)** | scene analyst `NpcAnalysis.factionId`, gated to a real `KNOWN FACTION IDS` list fed in the prompt (`llm/summarizer.ts`); applied set-once via `runtime.setNpcFaction` in `applyAnalystUpdates`; fed as ` · ‹faction name›` on every NPC context line; `npcs.faction_id` column (pre-existing) | scene close + mid-scene analyst passes | `registerNpc` never sets `factionId` for a generated NPC, so a fixer's allegiance was whatever THIS scene implied — Sable one scene, Crown the next. The analyst now pins it once the fiction makes it concrete (never a live-turn guess — the live turn path has no such field), gated to a faction id the prompt actually offered; allegiance CHANGES are a separate, unbuilt slice, so an already-pinned faction is never overwritten |
| Prompt rules 9 + 11 | `llm/jsonSystem.ts` | every turn | the cast contract: list who's in the scene; known NPCs RECOGNIZE the player; the model may never unilaterally kill/retire a known contact (now engine-backed: an analyst-confirmed death is RECORDED, an unconfirmed one stays non-canon) |

## 3. Relationships — does standing mean something?

| Check | Where | Fires | Catches |
|---|---|---|---|
| Engine-clamped disposition | `runtimeNarrative.updateNpcRelation` / `nudgeStandingFromCheck` | ±1 max, once per NPC per turn, ONLY on a quest completion or a PASSED social check | the model handing out trust for idle chat; standing is earned through the dice |
| Relation log + rolling note | same | every meaningful beat | the relationship reads as a story, not one stale line |
| **Second-person notes** | `shared/scene.toSecondPerson`, applied at every note write | any note | "Player handed over X" / the PC's own name in their own memory — notes read as "what YOU know" |
| Trust-tier gates | `shared/scene.TRUST_THRESHOLD` (+2) | chips | personal jobs and crew recruitment only unlock at earned trust |
| Cross-player ledger | `shared/ledger.ts`, `advanceLedger` in the route | every turn with reachable dossiers | cameos gated to what the character KNOWS (firsthand / heard-of / unknown); meeting someone promotes them permanently |

## 4. Story structure — do quests survive?

| Check | Where | Fires | Catches / born from |
|---|---|---|---|
| Thread open dedupe | `applyPlan/world.ts` `quests` | model `threads:[]` | a re-narrated job doubling up |
| **Analyst thread reconciliation** | `llm/threadReconcile.applyThreadUpdates`, analyst fed the OPEN THREADS list | scene close + mid-scene | the model under-firing `threads:open` — born from the live Fingers→Yarl→loot chain that ran dozens of turns untracked and fell out of the window |
| **Nightly audit** (strong model, cross-cutting) | `llm/dailyAudit.ts` + `lib/auditRun.ts` + `/api/cron/daily-audit` (~3am) → `daily_audits` + `/admin/audits` | daily, per campaign that played | everything the LIVE passes miss because they're scene-scoped: cross-scene story INCONSISTENCIES (severity-ranked), DROPPED story lines (with a revival beat), and PLAYER FRUSTRATION (appeals, retries, complaints — with root-cause + fix). Its HEADLINE deliverable is **patterns**: the recurring failure mode behind the findings, tagged with this doc's taxonomy (under-fire / invention / drift / engine-gap) + a concrete proposed check — because stories are never retro-edited; the only durable fix is a check. Judges sheet-vs-prose against the LIVE sheet fed in the header (in-transcript sheets are historical snapshots — that gap produced a false "dropped gun still on sheet" finding). Auto-applies npc/thread fills via the same analyst machinery (presence forced to "mentioned"); the rest is an admin report, never an action |
| Engine-owned job board | `shared/quests.ts` + `shared/jobsRuntime.ts` | every turn | quest STRUCTURE off the model entirely: generation, per-objective tracking, completion detected from REAL signals (arrival / won fight / matching skill success), guaranteed payout |
| **`report` objective — presence, not self-report** | `shared/quests.ts` `objectiveMet` (`report` → `s.presentNpcIds.has(obj.npcId)`), `TurnSignals.presentNpcIds` sourced from `sceneCard.presentNpcIds` (the same truth the People panel uses) | every turn with an active `report` objective (QUESTS.md 1b; authored content only — the procedural generator never emits it) | a "talk to X" objective completing on the model's SAY-SO — sharing a scene is real, engine-verified signal; a model's self-report isn't. Reused as-is by `shared/storyline.ts`'s chapter objectives (HANDOFF_STORY_1.md), same completion rule, never duplicated |
| Engine-owned main questline | `shared/storyline.ts` + `shared/storylineRuntime.ts` | every turn | authored quest STRUCTURE off the model, same invariant as the job board: state-predicate triggers (retrofit-safe), objective completion matched by id (an inserted objective never un-completes what's done), a mortal-NPC fallback for a beat about a cast member who died, and a patient nudge — the model dramatizes, never advances, a chapter itself |
| Station-local board + expiry | `quests.refreshBoard` (`postedLocationId`, `expiresTenday`) | board refresh | a global static board; offers from stations you left |
| **Job coherence (alignment model)** | `quests.canOffer` + `FACTION_ALIGNMENT` + adversary pick in `generateJob` | generation | an incoherent posting — born from the live "Hollow Crown pays you to smuggle past the Hollow Crown watch, paying Crown rep": givers must plausibly offer the archetype, an adversarial job's `{faction}` opponent is never the giver, and the PC's faction biases giver (4:1) + work kind (+2) |
| **Diegetic-offer contract** | `promptSections/quests.offeredJobs` + `jsonSystem` rule 8 | every turn with local offers | the model inventing paying work the engine never generated (untrackable, unpayable) — paid work comes ONLY from the WORK ON OFFER list, surfaced through the world, taken via a choice carrying `acceptJob` |
| **Quest CAST MANIFESTS** | `shared/quests.ts` `CastSlot`/`generateJob`/`materializeJobCast`, fed via `promptSections/quests.ts` cast lines + `jsonSystem` rule 8 | job generation + every active/offered turn | a running job accreting 4-5 model-invented randos — born from a live audit finding 8-of-22 cast NPCs on one campaign were thin "Spoke with the player" shells from unnecessary jobs. Each archetype has a FIXED cast (courier: giver; bounty: giver+target; heist: giver+contact; protection: giver+ward…) decided ONCE at generation — the model narrates them, it never invents an additional gang member/middleman/contact for a tracked job. Real NPC records materialize only on ACCEPT (idempotent) so an untaken offer never bloats the cast. Review-pass hardening: materialization ADOPTS an existing same-base-name record (the giver who spoke in the pitch and got dialogue-registered — never a duplicate person); cast names never share a FIRST name with the player's characters/crew (the pools overlap with player naming) and never repeat across one board's offers; legacy cast-less jobs are normalized at session load (raw-jsonb, no Zod parse) with defensive reads in the sections |
| Dock-debt thread sync | `runtimeEconomy.syncDockDebt` | after any money move | negative credits always carry a visible payoff loop; auto-resolves when cleared |
| Clock preview-then-commit | `runtimeNarrative.advanceClock` → commit at `end_scene` | mid-scene | clock effects double-applying before the scene settles |

## 5. Prose ↔ mechanics — does the narration tell the truth?

The drift family: prose is written BEFORE (or instead of) the engine's resolution.

| Check | Where | Fires | Catches / born from |
|---|---|---|---|
| `outcomeDirective` coda | `jsonTurn` | every engine-result narration | narrating a success the dice denied — born from a MISSED stealth kill read as a clean assassination, then the "dead" guard shot back |
| Combat-open realign | `jsonTurn` (post-`combatStart`) | fight spawned by the model | prose foes ≠ engine roster — re-narrated against the RESOLVED roster ("narrated two guards + a broker, engine placed one Thug") |
| Gun-skill reroute + re-narration | `llm/openFight.ts` + `jsonTurn` | player-typed violence | a "skill check" resolving an act of war; the opening exchange re-narrated from the real dice |
| **Resolved-fight realign** | `jsonTurn` `combat_resolved_realign` (+ aftermath choices adopted when the plan left none) | a reroute fight that OPENED AND ENDED in one turn (opening-shot kill / player dropped in the counter) | outcome INVERSION — born from the live Piotr turn: his crit killed Doran (`☠ Doran is down`), DeepSeek narrated *Piotr* shot down + "killed in action" + zero choices. No active fight meant combat_open_realign never fired; this one always does, with an explicit the-PLAYER-WON directive when the engine says they're standing |
| **Death-title scrub** | `jsonTurn` `scrub_death_title` (pre-applyPlan) | any model `sceneEnd` while the PC is alive & standing | a FALSE death immortalized in scene memory — the model's "Piotr Calloway — killed in action" title would have ridden the scene summary forever; only the engine kills a character |
| **Denied-intent reconcile** | `applyPlan/inventory.ts` → `ApplyCtx.reconcile` → `jsonTurn` re-narration | a `useItem`/heal the engine refused | prose claiming a heal that never happened — born from Fingers "patching up" a player with a medkit they didn't own while HP never moved |
| Anti-echo | `jsonTurn.isEchoOfPrevious` (last 4 narrations) | verbatim repeat | the "same answer 3 times" bug — worse, re-firing that beat's payout |
| `redactMoney` | `jsonTurn` | every narration | ANY credit figure in prose, digits or words ("eighteen hundred creds") — the engine prints every real figure on a 💰 line |
| `stripInlineMenu` | `shared/narration.ts` | every narration | prose option lists (choices are data) |
| Enforce ≥1 checked choice | `jsonTurn` | choices offered | a turn with no dice on offer (the dice are the game) |
| MIRROR rules (prompt) | `jsonSystem.ts` VOICE + rule 8 | every turn | narrated wounds/heals/item-handovers outside the engine; NPC "gifts" must fire `items:[]` the same beat; ship consumables never handed to someone on foot |
| Status narration rule | `jsonSystem.ts` rule 5 | every turn | inventing a 🔥/⚡ effect the engine didn't apply (and: describe the ones it did) |
| `trimToLastSentence` | `llm/history.ts` | `max_tokens` stops | a mid-sentence cliff persisting into canon |

## 6. Player intent — do typed actions actually happen?

The under-fire family: the player said it; the engine must not depend on the model
mapping it to a field.

| Check | Where | Fires | Catches / born from |
|---|---|---|---|
| Deterministic chips (`pre*`) | route → `jsonTurn` (`preCheck`, `preUseItem`, `preRepair`, `preRest`, `preRecruit`, `preSwap`, job/personal-job chips) | any engine chip click | a click is a CONTRACT — the engine applies it before the model ever runs |
| Typed-attempt inference | `jsonTurn` `impliedCheck` (`inferAttemptVerb`) | typed action that reads as an attempt | the model forgetting `roll` — pre-rolled like a click, so dice and prose can't desync |
| **Typed consumable backstop** | `shared/items.inferConsumableUse` → `jsonTurn` | typed "use stim"/"pop a medkit" for a HELD heal, only while hp < maxHp | the model narrating the heal without firing `useItem` — born from six live "use stim" turns with HP frozen at 1. Full-HP gate added after the Sparrow +0 HP stim (below) so a verb false-positive can't spend for nothing |
| **Full-HP heal refusal** | `llm/runtimeHeal.useItem` + the combat item branch in `llm/runtimeCombat` | any heal-consumable spend at full HP (combat: and no bleed/burn to clear) | the engine burning an item for "+0 HP" — born from the live Sparrow turn: the model VOLUNTEERED `useItem: stim` on an unrelated clicked travel choice ("Step aboard the Rust-Eye") and the engine printed "🩹 Stim: +0 HP — 18→18". Refused spends surface as ⚠ + a reconcile note (never a silent drop); prompt rule 6 also forbids volunteering an item the player didn't use |
| **Typed job-accept backstop** | `shared/quests.inferJobAccept` → route | typed "I'll take the courier run" matching exactly ONE local offer | the model narrating the hire without carrying `acceptJob` on the choice (offers are diegetic now — under-fire would leave the job forever "offered"); ambiguity or a missing accept verb → no accept |
| Combat free-text interpreter | `shared/combat.interpretCombatText` | any input during a live fight | EVERY in-combat input runs the engine round — typing "I gun them all down" can't skip the rolls. Item spends need an ITEM cue (named consumable or self-treatment phrasing, negation-guarded) — bare "use"/"patch"/"heal" used to burn the first held consumable and shadow the weapon-switch branch |
| Downed free-text interpreter | `shared/death.interpretDownedText` | any input while bleeding out | "I get up and run" can't skip death saves |
| **Self-harm gate** | `shared/selfHarm.isSelfHarm` → route intercept + `confirmDeath` chip | typed suicide intent | the model improvising skill checks around a suicide (a throat-slit resolved as an `electronics` roll, death narrated but never applied) — now an explicit engine confirmation and a REAL death |
| Appeal system | `shared/appeal.ts` → `llm/appealTurn.ts` | `APPEAL …` | the meta escape hatch: a strong judge applies engine-legal corrections when a mechanical outcome was wrong; every appeal audited + filed as an issue |

## 7. Economy & items — does the ledger stay honest?

| Check | Where | Fires | Catches / born from |
|---|---|---|---|
| Money is engine-only | payout tiers + `payoutRamp` clamp, offers-as-quotes | any payout/offer | invented/inflated figures; a rookie can't draw a T3 score; offers quote without moving credits |
| Item gains need a legit source | `runtimeEconomy.applyGearChange` | any gain | player/model-authored loot; weapons/armor need a loot roll or quest; only PERSONAL consumables pass as NPC gifts |
| **Ship consumables gated** | same | any gain | a shipless character gifted a "Missile reload" (born from Steward Harrow's gift); needs a ship AND a legit source |
| Name-resilient resolution | `shared/items.resolveGearItemId` — ONE source for count + consume | any use/count | the medkit-that-did-nothing: counted by name, consumed by id (or vice versa) |
| **Haggle moves the till** | `runtimeEconomy.buyItem` (10% off on a passed negotiation/diplomacy roll this turn, "(haggled down)" on the 🛒 line) | any purchase | the fiction/ledger split that cost a live APPEAL: player WON the haggle, narration priced ¢28, engine charged list ¢30 — the price the till charges now follows the dice |
| **Shop flow chips** | `shared/items.inferShoppingIntent` + `marketChips` → route (appended on buy/browse intent + after each chip purchase) → `jsonTurn preBuy` (deterministic till, echoed-purchase dropped) → `revalidateChoices` prune | any shopping action | shopping resolving as narrator improvisation — born from the live Piotr turn: clicked "buy a sidearm", the model improvised a counter sale (legal, but the player never SAW the stock). Buy intent now surfaces the market's actual shelf as live-priced, affordable-only Buy chips; a click IS the purchase |
| **Cargo as inventory (one crate, one fate)** | `quests.grantJobCargo`/`consumeJobCargo` (jobId-tagged gear, slot-free), sell-refusal in `sellItem`, hand-over in `jobsRuntime` (📦 line), forfeiture on abandon (route) | accept / sell / delivery / abandon | the live Wren core sold (+212) AND delivered (+155) AND later "still under your arm" — a delivery job's freight is now a real item: granted on accept, unsellable, consumed by the ENGINE when the deliver objective completes |
| Loot is engine-rolled | `engine/loot.ts` | successful loot/scavenge check | "I find a rocket launcher" turns up scrap and small money like any other pick |
| Slots + swap parking | `shared/items` slots, `sceneCard.pendingPickup` | any gain | silent item loss on a full pack — blocked visibly, offered as drop-to-take chips |
| Seeded markets | `engine/market.ts` | shelves | stock is shared canon per (location, 30-day chunk), tier-gated so top guns aren't at backwater docks |

## 8. World & time — does the setting hold still?

| Check | Where | Fires | Catches / born from |
|---|---|---|---|
| Places are canon | `shared/locations.ts` tiers + `framing.ts` location line + prompt rule 10 | every turn | the model inventing whole stations; "place" is a sub-spot WITHIN a canonical location |
| **Engine-owned location backstop** | `shared/locationSync.ts` `inferLocationFromPlace` + route wiring (pre-jobs, pre-`moved`) | every non-combat turn | `currentLocationId`'s only writer was the model's `sceneEnd.arrivedAtLocationId` — under-fired, leaving 6/10 live campaigns engine-pinned to a different station than the fiction, which silently re-broke the scene header's station+tier, retrieval co-location, the presence gate, the local job board, travel tendays, transit incidents, and market rotation. The engine now infers arrival from the scene's own "Station — spot" place line: full-name word-boundary match, earliest wins, destination phrasing ("shuttle to Halcyon") never counts, and it skips any turn the model explicitly moved the player so it can never revert the primary path |
| **Engine tenday clock** | `engine/time.ts` (travel +1; every 4th in-place scene close +1) | scene close | time frozen forever — every live campaign sat at tenday 0, so markets never rotated and offers never expired; the model's `tendaysDelta` stays additive |
| Time context line | `framing.ts` | every turn | prose inconsistent with the clock (supplies, rumors, deadlines) |
| Fault Line season clock | `engine/time.advanceTendays` + `sceneEnd` | any time advance | the shared season pressure can never be skipped |
| Net-worth enemy scaling | `shared/netWorth.ts` + combatStart clamp + spawn backstop | fight spawn | difficulty keyed to what the player owns; narrated foe counts topped up/clamped |
| Berths by hull / upkeep by clock | `shared/crew.ts` | recruit/tenday | crew growth checked by ship + income, not narration |

## 9. Life & death — is mortality real?

| Check | Where | Fires | Catches |
|---|---|---|---|
| Damage/death engine-only | `runtimeCombat.applyDamage` | any harm | narrated wounds don't exist; Downed at 0; struck-while-down = death |
| Bleeding Out | `shared/death.ts` + `llm/downedTurn.ts` | PC at 0 HP | engine-rolled 3-success/3-failure saves; chips engine-generated; tutorial-safe |
| Self-harm gate | §6 | typed intent | a real, confirmed, engine-owned death — never a narrated one |
| Terminal death state | route `pcDied` → campaign `deceased` | death turn | the story actually ends: input locked, memorial, new-character path |
| Crew mortality | `runtimeCombat` crew rules + `chargeCrewUpkeep` | fights/payroll | crew go Downed (medic can catch), desert at loyalty 0 — Character row removed, the person persists as an NPC |

---

## Known gaps (the honest backlog)

- **I-2 combat backstop** — the model narrates a fight but under-fires `combatStart`
  with no player gun-verb to reroute. The player-triggered half ships; the
  narration-triggered half doesn't.
- **Narration-only heal with NO `useItem`** — the typed backstop catches explicit
  "use X"; a pure prose heal with no field fired is only held back by the MIRROR
  prompt rule (no engine detection yet).
- **Facts ledger (Continuity v2)** — durable facts beyond scene summaries; then the
  history-window shrink (~10 → 6 exchanges).
- **Analyst inference layer** — have the analyst also infer a rolling playstyle
  read, relationship deltas, and a facts note (first slice of the facts ledger).
- **Summarizer raw-JSON bug** — a few live scene summaries persisted as truncated
  JSON; needs a repair pass + a guard.
- **Vac suit / sealed-suit hazard gating** — vacuum hazards aren't typed, so the
  suit is narrative-only.
- **Crew v1.1** — crew don't track statuses/resists; downed crew can't be finished
  off; mutiny events; ship-scale crew actions.

## Incident → check (the lineage, for the record)

| Live incident | The check it produced |
|---|---|
| Lazar's six "use stim" turns, HP frozen at 1 | `inferConsumableUse` typed backstop |
| Sparrow's stim burned at 18/18 on a clicked travel choice (model volunteered `useItem`) | full-HP heal refusal (engine, both scales) + prompt rule 6 "never volunteer" |
| Fingers "patches you up" with a medkit you don't own | denied-intent reconcile + MIRROR heal rule |
| Throat-slit resolved as an `electronics` check; death narrated, never applied | self-harm gate + `confirmDeath` |
| Fingers→Yarl→loot chain never tracked, lost to the window | analyst thread reconciliation |
| "Meridian Trade-House Broker Giving You A" | `shortRole` sanitizer |
| Steward Harrow gifts a missile reload on foot | ship-consumable gain gate |
| "Story said 4, fought 1" | combat-open realign + spawn top-up (pre-dates the fix) |
| Dead guard comes back and shoots | `outcomeDirective` + reroute re-narration |
| Every campaign frozen at tenday 0 | engine tenday clock |
| Cross-campaign NPC bleed / "another NPC called Wren" | seed-only load + provenance filter + PC-name guard (CANON) |
| Steward + Ilyana "in the scene" at Halcyon while based on Meridian | set-once NPC home + home-gated presence inference + `[based at X]` context tags + "Based at X" People labels |
| Lyra Vale's courier "Ren" and a later, unrelated bar-fixer also called "Ren" merged toward one record | `resolveNpcNameMatch` role-aware collision guard + `turnPlan.npcs[].role` + prompt rule 9 |
| 6/10 live campaigns engine-pinned to a different station than the fiction (Lyra "at Meridian" while playing Halcyon's Rust Anchor) | engine-owned location backstop (`shared/locationSync.ts`) |
| Courier Ren rode the shuttle with Lyra for ~150 turns; presentNpcIds empty at Halcyon (home gate stranded the companion) | companion continuity — `prevPresentNpcIds` carry + home-gate exemption + `[WITH the player]` tag |
| Wren narrated with "hips swaying" one scene, "stubble… a man" at the mirror the next (sex never fed; legacy NULL) | PC sex pin — every-turn sex/pronoun directive, explicit neutrality when unset, Sex fed to the creation pass |
| A named cast NPC killed in a fight stayed "alive" in the cast (status existed, nothing wrote it) | NPC fate — `applyCombatDeaths` at `resolveCombatRound` + analyst `fate` backstop + dead-stay-dead presence gates |
| NPC pronouns re-decided from the name every scene (the PC sex-pin class, one record over) | NPC sex pin — `inferNpcSex` capture-from-fiction, set-once, fed on every NPC line |
| A named cast NPC's combat toughness re-picked by the model every fight (boss once, mook later) | NPC combat-tier pin — canon overrides the model + net-worth clamp; un-tiered stamps from the actual spawn |
| A generated NPC's faction allegiance drifted scene to scene (registerNpc never set factionId) | NPC faction allegiance pin — analyst-captured, gated to a real faction id, set-once |
| An NPC's age drifted ("the old man" turning young) and the same dockworker spoke like a poet one scene, a soldier the next | age folded into `generateAppearance`; `generateVoice` speech-pattern pin (both set-once) |
| A running job accreted 4-5 model-invented randos (8-of-22 thin cast shells on one live campaign) | quest CAST MANIFESTS — a fixed per-archetype cast decided once at generation, materialized only on accept |
