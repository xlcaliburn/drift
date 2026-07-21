# HANDOFF — Playtest polish 1: prologue presentation, resume history, patron gate, crew aim/cover

*Strategy phase output (Fable, 2026-07-20). Read `WORKFLOW.md` first, then this
doc fully. Source: owner playtest of the freshly shipped prologue
(HANDOFF_STORY_4) + a resumed-session pass. Verified against Ludo Duross's live
run (`camp-mrr5dyb7-rack`): the prologue MACHINERY works — the intro directive
introduced Juno Vex in the very first narration, free-typed squad orders
worked, the campaign is mid-shipFight — every issue below is presentation,
gating, or a known-absorbed order, not stage-machine logic. Do not touch
`advancePrologue`'s stage transitions, signals, or `allyDeparts`.*

## The findings (each verified in code / live data)

1. **🎓 stage-transition lines are meta-noise, mis-ordered.** Ludo's turn 1:
   player's first click → `🎓 Time to see how you handle yourself — a fight's
   coming.` printed ABOVE the narration that then introduces the ally (engine
   lines precede DM text in the transcript). The stage directives already
   steer the narration; the interim lines just duplicate them confusingly.
2. **The ally sits in the sidebar at turn 0 with zero fiction.** Seeding at
   creation is CORRECT (squad orders need a real character; decision stands) —
   but nothing on screen explains them until the first turn's narration.
3. **Sidebar party presentation**: `StatusTab` renders `state.characters` in
   raw array order (DB load order unguaranteed — PC not reliably first), every
   member as a co-equal card, no collapse, no Details view. A temporary ally
   also shows loyalty dots (meaningless — they can't desert) via the generic
   crew path.
4. **`Rest up with Old Pell (free)` shows at full HP.** `patronHelp`
   (`shared/netWorth.ts:129`): `needsHelp = hp < maxHp || stims <
   PATRON_STIM_FLOOR` — the stim clause alone triggers it at full health.
5. **Ally combat orders**: no default selection (un-ordered = invisible
   auto-act), and aim/cover orders "silently absorb as a hold" (crewPhase's
   own doc comment) — no per-member combat state was built in V2_1.
6. **Resume shows no history.** `/api/state` already returns the FULL
   transcript (cap 400), but `PlayClient` keeps only `lastExchanges(t, 5)` and
   prepends `buildOpeningRecap` — the stale creation-time situation blob the
   owner flagged — on EVERY load, not just fresh campaigns.
7. **No story-so-far.** Scene summaries are already persisted (`scenes` table,
   `loadRecentScenes` exists) — nothing surfaces them to the player.

## Decisions (locked — do not re-litigate)

1. **Interim prologue lines die; graduation keeps ONE house-style line.**
   `advancePrologue` returns `lines: []` for intro→groundFight,
   groundFight→shipFight, and shipFight→graduation. The graduation→complete
   transition returns exactly:
   `— your escort ships out · training's over — the Drift is yours —`
   (em-dash house style, replacing the 🎓 wording). Stage logic untouched.
2. **Ally stays seeded at creation.** The turn-0 gap is closed by the recap
   (below) + sidebar presentation, not by deferring the character insert.
3. **Opening recap becomes fresh-campaign-only, and names the ally.**
   `buildOpeningRecap` gains one deterministic line when a `temporary` party
   character exists: `${ally.name} is riding with you on your first runs.`
   (derived from state — still zero API cost). PlayClient shows the recap
   ONLY when the restored transcript is EMPTY; a resumed session gets the
   full transcript instead, no recap.
4. **Full history on resume.** Drop `lastExchanges` entirely — restore the
   whole transcript (≤400 entries; plain divs, no virtualization needed).
   Initial render must land scrolled to the BOTTOM (instant jump, not smooth
   — the existing `chatEndRef` effect covers new messages; make sure the
   restore path triggers it before paint, e.g. `scrollIntoView()` in a
   layout effect on first load).
5. **Sidebar party block.** PC always first (stable sort: `kind === "pc"`
   first, others in array order). Below the PC card, a `Party (N)` subheader
   with a chevron toggle wraps ALL non-PC cards; default open, plain
   `useState` (not persisted). A `temporary` member shows `escort · riding
   along` where crew show loyalty dots, and never shows a wage.
6. **Details tab.** `DetailsTab` union gains `"party"` (additive — do not
   reorder existing ids), tab label "Party", placed after "ship". Full cards:
   name, tier/role (or "escort — riding along"), HP bar, AC, skills
   (name Lv), gear list, loyalty/wage for real crew. Reuse StatusTab's
   existing sub-components where they extract cleanly; don't rebuild bars.
7. **Patron gate: hurt only.** `needsHelp = !!pc && pc.hp < pc.maxHp`. The
   stim floor no longer TRIGGERS the chip (`PATRON_STIM_FLOOR` stays — the
   rest itself still restocks stims when taken). Update the affected
   netWorth/patron tests to pin: full HP + 0 stims → not eligible; hurt →
   eligible.
8. **Crew aim/cover become REAL orders.** New optional field on
   `CombatState`: `memberMods?: Record<string, { aim?: number; coverAc?:
   number }>` — rides the runtime jsonb like every other CombatState field
   (cast on load, so ALL reads defensive: `combat.memberMods?.[id]?.aim ??
   0`; no migration, no normalization). Semantics mirror the PC exactly:
   - order `aim` → `memberMods[id].aim = 2`, consumed (reset to 0) by that
     member's next attack roll (feeds `playerAttack`'s aim arg, currently
     hardcoded 0 for crew); sets `coverAc = 0`.
   - order `cover` → `memberMods[id].coverAc = 2`, `aim = 0`; cleared when
     that member next attacks. Enemy volley's crew branch reads it:
     `enemyAttack(enemy, pick.ac + (combat.memberMods?.[pick.id]?.coverAc ?? 0), …)`.
   - Both act lines go through the round's crew summary (`acts`), e.g.
     `Juno steadies her aim` / `Juno takes cover`.
   - Medic unconditional stabilize, un-ordered auto-act, and ship scale:
     all unchanged. No protocol change — `MemberOrderSpec` already passes
     aim/cover through (crewPhase was absorbing them; verify, don't assume).
9. **Crew chips + default selection.** `crewActionChips` adds two static
   chips per member: `Take aim (+2 next hit)` → `{type:"aim"}` and `Take
   cover (+2 AC)` → `{type:"cover"}` (after the attack chips, before items).
   PlayClient pre-stages `{type:"attack", enemyId: <first living enemy>}`
   for EVERY standing member whenever a new round's chips arrive (fight
   start + each round result); the player can change or clear (clear =
   auto-act, as today). Pre-staged orders are sent exactly like manually
   staged ones.
10. **Story so far.** New route `app/api/summary/route.ts`:
    - GET `?campaignId=` → `{ scenes: [{seq,title,summary}] }` oldest→newest
      via `loadRecentScenes(db, campaignId, 200)`; keyless mode → `{scenes:
      []}`. Auth: `requireApprovedUser` + `canAccessCampaign` (house pattern).
    - POST `{campaignId}` → a ≤200-word second-person "story so far"
      composed by the CHEAP model from the scene summaries +
      `campaign.situation`; reuse the summarizer's existing model/call
      pattern (`llm/summarizer.ts`) — do NOT hand-roll a new client. Meter
      it: `checkBudget` gate, `recordAiCall` (kind `"recap"`),
      `recordTurnUsage` (skip dev user) — copy the appeal route's metering
      shape. Failure/keyless → 400; the client falls back to the list.
    - UI: a "Story so far" button in the play header row → modal: the
      deterministic scene list (title + summary, oldest→newest), with a
      "Retell as a story" button that swaps in the POST result above the
      list. Empty scenes → "Nothing recorded yet — play a few scenes."

## ⚠ Traps

1. **Don't touch the stage machine.** Only `advancePrologue`'s `lines`
   values change. `allyDeparts`, stage transitions, signals: frozen. Update
   `shared/prologue.test.ts`'s line assertions (empty on interim, the ONE
   line at graduation) without weakening the stage-walk pins.
2. **The recap is the ONLY content on a fresh campaign.** Removing it must
   be conditional on `transcript.length > 0` — a brand-new campaign still
   needs the opening situation + ally line + starter choices.
3. **`CombatState` loads as a jsonb CAST, not a Zod parse** (the standing
   watch-out): every `memberMods` read must tolerate `undefined`. Mutate it
   only inside crewPhase/enemyVolley where `combat` is already the live
   object.
4. **Aim consumption order**: a member ordered `aim` this round must NOT
   spend it in the same round's attack (they aimed INSTEAD of attacking —
   exactly like the PC's `aim`/`cover` branch at `runtimeCombat.ts:1145`).
   It applies to their next round's attack (ordered or auto-act).
5. **Golden untouched.** Nothing in this handoff edits prompt sections or
   `jsonSystem`. If `contextSlice.golden.test.ts` moves, stop.
6. **`DetailsTab` is a string union used by openDetails callers** — additive
   only; check every switch over it still compiles (`tsc` will).
7. **Patron test fixtures** may rely on the stim-floor trigger — fix the
   fixtures to the new rule, don't re-add the clause.
8. **Full-transcript render + `atBottom` logic**: the existing scroll-pinning
   effect assumes short chats; verify resuming a 400-entry campaign lands at
   the bottom and the "jump to latest" affordance still works.

## Task breakdown (one commit each)

- **Task A — pure/shared fixes:** decision 1 (`shared/prologue.ts` + test
  updates), decision 7 (`shared/netWorth.ts` + tests), decision 3's recap
  line (`shared/recap.ts` + tests if any pin recap output).
- **Task B — crew aim/cover:** decisions 8-9's engine half — `CombatState.
  memberMods`, crewPhase consume/clear, enemyVolley cover read,
  `crewActionChips` additions. Tests: ordered aim boosts the NEXT round's
  attack and clears; cover raises the member's effective AC in the enemy
  volley until they attack; medic/auto-act regressions pinned.
- **Task C — PlayClient resume + default orders:** decisions 3-4 (full
  history, conditional recap, bottom-scroll), decision 9's UI half
  (pre-staged attack orders).
- **Task D — sidebar + details:** decisions 5-6 (StatusTab sort/collapse/
  escort badge, DetailsModal "party" tab).
- **Task E — story so far:** decision 10 (route + modal + button).
- **Task F — docs:** STATUS.md (playtest-polish shipped note), CHECKS.md
  (patron-gate row update if §7 lists it; the crew aim/cover order note in
  the combat family), annotate THIS handoff per WORKFLOW.md Phase 2.

## Explicitly OUT of scope

Deferring ally seeding to mid-campaign insert; any stage-machine change;
crew switch/flee orders (still absorb as hold — note stays in crewPhase's
comment); persisting sidebar collapse state; transcript virtualization;
a model-generated recap on load (the POST is player-initiated only).

## Definition of done

- `tsc` clean; full suite green (1133 baseline + new); golden BYTE-IDENTICAL.
- A resumed campaign scrolls back through its full stored transcript with no
  recap blob; a fresh campaign still opens with the recap INCLUDING the ally
  line.
- Interim prologue turns print no 🎓 lines; graduation prints the one locked
  line.
- Full-HP PC never sees the patron rest chip; hurt PC does (patron present +
  under cap).
- An ally ordered to aim hits harder next round; ordered to cover, enemies
  need more to hit them; every standing member defaults to a staged attack
  order each round in the UI.
- One commit per task; annotate this handoff per WORKFLOW.md Phase 2.
