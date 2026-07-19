# HANDOFF — Story slice 3b: SEASON ONE "FAULT LINE" — the authored content pass

*Strategy phase output (Fable, 2026-07-18). Read `WORKFLOW.md` and
`STORY_AUTHORING.md` first, then this doc fully. This is a CONTENT handoff:
the machinery (HANDOFF_STORY_1 + _2) is fully shipped and dormant; this
slice ARMS it. The division of labor is deliberate — every expensive
decision is LOCKED in this doc (the plot, every id, every trigger, every
fact string, every secret, every reward number); the implementer's job is
PROSE EXPANSION inside those rails, never invention. If a beat outline
below feels wrong to expand, flag it in the annotation — do not redesign.*

## What's LOCKED vs what's YOURS

**LOCKED (verbatim from this doc, typos included — ids are forever):**
chapter/sidequest/choice/option ids, act numbers, triggers, fact strings,
objective ids/kinds/locationIds/npcIds/requiredSkills/enemyTiers, cast
assignments, every reward number/tier/itemId/crewUnlock, the CONTENT of
every secret, the beat COUNT and what each beat must accomplish.

**YOURS (write within the rails):** titles' final phrasing may be polished
but the ones given are fine — keep them unless one collides with existing
prose; all directive/fallback/blurb/summary/backstory/arc WORDING; the
tone (see the style sheet). Summaries are player-facing; directives are
instructions to the narrator.

## ⚠ THE TRAPS for this handoff

1. **This slice ends dormancy — three tests EXIST TO FAIL and must be
   REWRITTEN, never deleted.** `content/pack/pack.test.ts`: "the live pack
   ships an EMPTY storyline", "the live pack ships ZERO sidequests", "the
   live pack ships ZERO authored depth". Each flips to pin the NEW reality
   structurally (11 chapters; 12 sidequests; the six principals carry
   depth). "The active pack has no integrity problems" (validatePack → [])
   is the real gate and must pass with the full season in.
2. **The golden moves ONCE, deliberately.** Authoring `backstory` for
   `npc-broker` changes the hook line the golden fixture renders. Re-pin in
   the SAME commit as Task A (cast depth), and eyeball the golden diff:
   ONLY hook-line changes are legitimate. Any other movement = stop.
3. **Content-only slice.** Files you may touch: `content/pack/drift.ts`
   (cast entries), `content/pack/drift/storyline.ts`,
   `content/pack/drift/sidequests.ts`, the three flipped tests + the golden
   fixture, and docs. If you find yourself editing `shared/`, `llm/`,
   `engine/`, or `app/` — stop and re-read this line.
4. **Spoiler discipline (the Task A/B contract).** `backstory` surfaces in
   the always-on hook line — it must read true WITHOUT revealing the
   secret. `secret` is the reveal itself. Never let secret content leak
   into backstory, a blurb, an objective summary, or an early beat.
5. **Every beat with `aboutNpcId` gets a `fallbackDirective`** (validatePack
   enforces it): the same information reaching the player WITHOUT that
   person — a note, a record, someone else who knew. Never "they're gone,
   skip it".
6. **Fact strings are load-bearing and matched by SUBSTRING.** The four
   season facts are `faultline-confided-ilyana`,
   `faultline-stonewalled-crown`, `faultline-armed-the-chain`,
   `faultline-buried-with-crown`, `faultline-broadcast-open` — copy them
   character-for-character everywhere they appear (choice options, finale
   triggers, the two fact-gated sidequests). A typo strands a finale.
7. **The finale variants are mutually exclusive BY CONSTRUCTION** — all
   three require ch-8 plus one of three facts only one of which can exist.
   Keep all three AFTER ch-8 in the array (validatePack's earlier-chapter
   rule) and do not add any other trigger fields to them.
8. **Objective kinds must stay engine-verifiable as specced.** Where this
   doc says `persuade (negotiation, diplomacy)`, those exact
   requiredSkills. The six proven skills are: perception, streetwise,
   electronics, mechanics, negotiation, diplomacy — no others. The two
   `eliminate` objectives keep their specced enemyTier.
9. **Prose length caps (soft, reviewer-enforced):** directive/fallback
   ≤ ~220 chars; blurb ≤ ~140; objective summary ≤ ~80; backstory ≤ ~200;
   secret ≤ ~240; each arc line ≤ ~120. One beat = one narrator turn's
   worth of material.
10. **Owner reads before it's real.** The season goes live to every
    campaign on deploy (retrofit is automatic). The phase-3 review reads
    the whole script in the pack files before it ships anywhere.

## Style sheet (match the primer's voice)

Hard, lawless, consequences stick. No melodrama, no exclamation marks, no
purple prose. Directives are imperative instructions to the narrator:
"Have Ilyana ask what was IN the logs — her interest is personal, not
procedural." Summaries are terse second-person: "Reach Rook Station."
Blurbs are one-line pitches a fixer would actually say. Secrets are stated
as flat fact, not drama.

## THE SEASON — premise (context for the prose, grounded in existing canon)

The Wake is a colony-ship graveyard; the Reclaimers have always suspected
the wrecks were sabotage, and Kesh holds proof (all already canon in the
primer and cast). Season One surfaces it: the Hollow Crown's founding
houses filed salvage claims on colony ships that were still IN TRANSIT —
they engineered the disaster their debt empire was built on, then indebted
the survivors. The wrecked ship at the season's center is the **Verity**
(new name, yours to keep consistent). The Sable Chain wants the proof as a
weapon; the Crown wants it buried; the player ends the season deciding
where it lands.

## Cast depth (Task A) — exact assignments

Six principals get `backstory` + `secret` + `arc[3]`; two get `backstory`
only. Secrets below are CONTENT-locked; word them flatly.

| npc | backstory (spoiler-safe gist) | secret (locked content) | arc gist (act1 / act2 / act3) |
|---|---|---|---|
| npc-ledger | No-name fixer; carries every side's secrets and none of their colors; the symbol they mark cargo with is older than their career | The mark is the Verity's hull registry — the Ledger is a grandchild of its survivors; the famous neutrality is a long game aimed at the Crown | broker curiosity / quiet urgency, calling in old favors / all-in, it was always personal |
| npc-ismay | Logs every hull in the graveyard; her superstitions have kept salvage crews alive | She scrubbed the pod's berth-of-origin from her own ledgers decades ago — silence traded for the Crown leaving the graveyard and its dead alone | guarded gatekeeper / shaken, ledgers reopened / makes her peace, testifies to what she hid |
| npc-kesh | (extends canon oneBreath) years assembling the sabotage case, undecided what to do with it | She took Crown hush money once, early — signed silence over a "salvage anomaly." They believe she stayed bought | hunted researcher / commits, burns the nondisclosure / hands over custody, all trust |
| npc-ilyana | Pragmatic Crown debt handler; believes the ledger system is at least honest | Six years ago she flagged a claim DATED BEFORE its wreck; the flag vanished and she was demoted to the collections floor. She kept a copy | loyal professional / privately re-opens her old flag / picks a side with her copy in hand |
| npc-osk | Twenty years of slag and short pay; shields his crews where he can | His apprentice-mark is milled inside the Verity's detonator housings — a "lane-clearance" job he ran at nineteen, spec'd blind | weary foreman / implicated, afraid for his crews / defiant, hands over the work order |
| npc-brekk | Runs Coldharbor's staging docks with cold efficiency; pays fast, asks twice as much next time | His bid for the proof is his own play — no Chain sanction, no backstop; if it sours, Coldharbor never knew him | opportunist / over-extended, pressing harder / exposed — ally or enemy by the player's choice |
| npc-quist | backstory only: keeps Halcyon neutral because he once watched a neutral port burn | — | — |
| npc-broker | backstory only: a standing-contracts broker who has started quietly re-checking old Crown claim dates | — | — |

## The chapters (Tasks B) — 11 entries, 9 played

All in `content/pack/drift/storyline.ts`, array order = the order below.
Rewards are flat credits (+ listed extras). Chain triggers exactly as
given. Beat ids `b1..bN` per chapter; objective ids `o1..oN`.

**ch-1 "The Mark on the Manifest"** — act 1. trigger `{ tendaysAtLeast: 2 }`.
cast [npc-ledger]. objectives: o1 travel loc-rook "Make for Rook Station";
o2 report npc-ledger. beats: b1 — word reaches the player (by reputation)
that the Ledger is asking for them by name; b2 (about npc-ledger,
fallback) — the Ledger lays out the find: a Wake salvage pod carrying
Hollow Crown claim-seals DATED BEFORE the wreck it came from went down;
they want it verified quietly, off every book. reward { credits: 100 }.

**ch-2 "Graveyard Shift"** — act 1. trigger `{ requiresChapterId: "ch-1" }`.
cast [npc-ismay]. objectives: o1 travel loc-wake; o2 report npc-ismay; o3
investigate (perception, electronics) "Pull the pod's provenance from the
wreck logs". beats: b1 — the Wake's mood; Ismay's rules for salvagers;
b2 (about npc-ismay, fallback) — her ledgers LIE: the pod's berth-of-origin
was scrubbed years ago, by someone with authority to do it, and she is too
careful to be surprised; b3 — a second skiff is shadowing the player's
work, running no transponder. reward { credits: 150 }.

**ch-3 "What Kesh Knows"** — act 1 close. trigger
`{ requiresChapterId: "ch-2" }`. cast [npc-kesh]. objectives: o1 report
npc-kesh; o2 persuade (negotiation, diplomacy) "Convince Kesh to open her
archive". beats: b1 (about npc-kesh, fallback) — Kesh finds the PLAYER:
she has tracked that pod for years and wants to know who else is pulling
its thread; b2 — the case laid out: charge patterns, milled detonator
housings, claim dates — deliberate sabotage under Crown-pattern seals;
b3 (about npc-kesh, fallback) — why she sat on it: the hush money she took
once, and what it cost her to keep. reward { credits: 200, factionRep:
{ factionId: "f-reclaimers", delta: 1 } }.

**ch-4 "The Handler's Price"** — act 2. trigger
`{ requiresChapterId: "ch-3" }`. cast [npc-ilyana]. objectives: o1 travel
loc-meridian; o2 report npc-ilyana. choicePoint `{ id: "c1", prompt:` what
do you give the Crown's handler? `, options: [ { id: "confide", label:
"Tell Ilyana what you found", fact: "faultline-confided-ilyana" },
{ id: "stonewall", label: "Give the Crown nothing", fact:
"faultline-stonewalled-crown" } ] }`. beats: b1 — the summons: the Crown
noticed the Wake trip; b2 (about npc-ilyana, fallback) — her questions are
wrong for a debt handler: she asks what was IN the logs, not what the
player was doing there; b3 (about npc-ilyana, fallback) — pressed, she
lets one thing slip: she flagged a manifest discrepancy once, six years
back, and spent the years since paying for it. reward { credits: 200 }.

**ch-5 "Milled at Cinderhaul"** — act 2. trigger
`{ requiresChapterId: "ch-4" }`. cast [npc-osk]. objectives: o1 travel
loc-cinder; o2 report npc-osk; o3 investigate (mechanics, streetwise)
"Trace the detonator housings to their work order". beats: b1 — the
housings carry a Cinderhaul guild-stamp; the trail runs through the dock
floor; b2 (about npc-osk, fallback) — Osk recognizes the work: his own
apprentice-mark is inside the housing — a job spec'd to him blind as lane
clearance, a lifetime ago; b3 — someone has been buying up and burning the
old work-order archives all year; the player's copy may be the last.
reward { credits: 250 }.

**ch-6 "The Quartermaster's Offer"** — act 2 close. trigger
`{ requiresChapterId: "ch-5" }`. cast [npc-brekk]. objectives: o1 travel
loc-sable; o2 report npc-brekk; o3 persuade (negotiation, streetwise)
"Refuse the Chain's terms without starting a war". beats: b1 — Coldharbor
at strength; the pitch is triple pay and Chain "handling" of the Crown
response, for the whole case; b2 (about npc-brekk, fallback) — the tell:
no Chain seal on any of it — personal guard, not station troops; this is
Brekk's own play; b3 — leaving, a Crown fast-packet sits on the docks.
Both sides now know exactly who holds the thread. reward { credits: 300 }.

**ch-7 "Verity's Last Run"** — act 3. trigger
`{ requiresChapterId: "ch-6" }`. cast [npc-kesh]. objectives: o1 travel
loc-shear; o2 investigate (electronics, perception) "Cut the flight
recorder core out of the Verity's spine"; o3 report npc-kesh. beats: b1 —
the Verity's hulk itself, the graveyard's founding wound; b2 (about
npc-kesh, fallback) — the recorder matched against her archive: course
orders diverting the convoy INTO the Shear, under a Crown founding-house
cipher; b3 (about npc-kesh, fallback) — she hands the player custody of
the entire case. Her name stays off it. Whoever holds it decides what the
Drift becomes. reward { credits: 350, crewUnlock: "npc-kesh" }.

**ch-8 "Where It Breaks"** — act 3. trigger
`{ requiresChapterId: "ch-7" }`. cast [npc-quist, npc-ledger]. objectives:
o1 travel loc-freeport; o2 report npc-quist. choicePoint `{ id: "c1",
prompt:` the proof of the Verity sabotage — where does it land? `,
options: [ { id: "chain", label: "Arm the Sable Chain with it", fact:
"faultline-armed-the-chain" }, { id: "crown", label: "Sell the Crown its
silence", fact: "faultline-buried-with-crown" }, { id: "open", label:
"Broadcast it to the whole Drift", fact: "faultline-broadcast-open" } ] }`.
beats: b1 — Halcyon under strain: Crown and Chain packets both in dock,
Quist enforcing neutrality at gunpoint; b2 (about npc-quist, fallback) —
Quist's counsel: choose, because an undecided holder is everyone's target;
b3 (about npc-ledger, fallback) — the Ledger arrives with the last piece:
survivor-debt ledgers tying the Crown's oldest accounts to Verity
families. reward { credits: 400 }.

**ch-9a "Fault Line: The New Chain"** — act 3 finale. trigger
`{ requiresChapterId: "ch-8", hasFact: "faultline-armed-the-chain" }`.
cast [npc-brekk]. objectives: o1 travel loc-sable; o2 report npc-brekk; o3
eliminate (enemyTier T2) "Break the Crown's answer at Coldharbor". beats:
b1 — the proof lands like a detonation; the Chain moves openly on the
lanes; b2 (about npc-brekk, fallback) — Brekk, vindicated and terrified:
his off-book play just became Chain doctrine, and the player made him;
b3 — the Crown's reprisal arrives; the season ends in the fight for
Coldharbor's approach. reward { credits: 600, factionRep: { factionId:
"f-sable", delta: 2 }, itemId: "combatArmor" }.

**ch-9b "Fault Line: The Quiet Ledger"** — act 3 finale. trigger
`{ requiresChapterId: "ch-8", hasFact: "faultline-buried-with-crown" }`.
cast [npc-ilyana]. objectives: o1 travel loc-meridian; o2 report
npc-ilyana; o3 persuade (negotiation, diplomacy) "Set the terms of the
Crown's silence". beats: b1 — the Crown pays best for what never
happened; the negotiation is the battlefield; b2 (about npc-ilyana,
fallback) — what burying it costs HER: she finally learns her six-year-old
flag was this, and watches it buried twice; b3 — the season closes on the
weight of the price: the Drift stays the Crown's, and the player is owed
by the house that owns everything. reward { credits: 800, factionRep:
{ factionId: "f-crown", delta: 2 }, itemId: "poweredCarapace" }.

**ch-9c "Fault Line: Open Sky"** — act 3 finale. trigger
`{ requiresChapterId: "ch-8", hasFact: "faultline-broadcast-open" }`.
cast [npc-ledger]. objectives: o1 travel loc-rook; o2 report npc-ledger;
o3 investigate (electronics, streetwise) "Get the broadcast out through
Rook's relays ahead of the jammers". beats: b1 — the race to transmit:
every relay between Rook and the Drift is suddenly contested; b2 (about
npc-ledger, fallback) — the Ledger unmasks at the transmitter: the symbol,
the Verity's registry, the family — this was always theirs to finish;
b3 — the truth lands everywhere at once. No side owns the player, and
every side knows their name. reward { credits: 400, factionRep:
{ factionId: "f-free", delta: 2 }, itemId: "sealedHardsuit" }.

## The sidequests (Task C) — 12, exact specs

All in `content/pack/drift/sidequests.ts`. Blurb/summaries yours; the rest
locked. (Reminder: credits roll from `tier`'s band automatically.)

| id | posted | giver | tier | trigger | objectives (kinds locked) | extras |
|---|---|---|---|---|---|---|
| cold-comfort | loc-rook | npc-ledger | T1 | — | o1 deliver loc-freeport | cargo: "a sealed courier packet" |
| collections-floor | loc-meridian | npc-ilyana | T1 | — | o1 persuade (negotiation, diplomacy) | a defaulting dock family's case argued down |
| quists-tariff | loc-freeport | npc-quist | T1 | — | o1 report npc-quist; o2 investigate (streetwise, perception) | who's skimming berth fees |
| chromes-parcel | loc-rook | npc-chrome | T1 | — | o1 deliver loc-talos | cargo: "a refrigerated case, no questions" |
| wake-vigil | loc-wake | npc-ismay | T1 | — | o1 investigate (perception, electronics) | chart a newly-shifted wreck field |
| osks-quota | loc-cinder | npc-osk | T2 | actAtLeast: 2 | o1 eliminate (enemyTier T2) | run off the collectors squeezing his crews |
| brekks-manifest | loc-sable | npc-brekk | T2 | actAtLeast: 2 | o1 deliver loc-nest | cargo: "unmarked drive components"; complication: "no flight plan, no records" |
| undertow-marker | loc-rook | npc-undertow | T2 | — | o1 travel loc-undertow; o2 eliminate (enemyTier T2) | a bounty gone to ground at the outpost |
| keshs-samples | loc-talos | npc-kesh | T1 | actAtLeast: 2 | o1 travel loc-shear; o2 investigate (electronics, mechanics) | recover her instrument packages |
| confidence-kept | loc-meridian | npc-ilyana | T2 | hasFact: "faultline-confided-ilyana" | o1 investigate (streetwise, perception) | who else in the Crown reads her files |
| no-friends-in-collections | loc-rook | npc-ledger | T2 | hasFact: "faultline-stonewalled-crown" | o1 persuade (streetwise, negotiation) | the Crown's quiet marker on the player, countered |
| gravedigger | loc-wake | npc-ismay | T2 | actAtLeast: 3 | o1 travel loc-shear; o2 eliminate (enemyTier T2) | Wreckers stripping the Verity's sister ship |

## Decisions already made (do not re-litigate)

- **One neutral opener, not per-faction variants.** The trigger schema has
  no faction predicate and this slice adds no code; the Ledger is canon
  "trusted by all sides", so ch-1 works for every faction. The
  faction-flavored-openings ideal from STORY.md is DEFERRED, noted in docs.
- **The finale is three full chapter variants** (9a/9b/9c), fact-gated —
  verified safe against the engine (one-active-chapter + array-order scan +
  mutually exclusive facts).
- **`persuade` over `survive`/`eliminate` for non-finale "pressure"
  objectives** — a skill success is a reliable engine signal every scene
  can produce; a required fight that never starts stalls a chapter. The
  two `eliminate` finale/sidequest uses are deliberate (a fight is the
  point there), and hot-editable if a playtest shows stalls.
- **Reward curve** 100→800 across the season (~2.4k credits total) — sits
  inside the existing economy; hot-editable later without migration.

## Task breakdown (one commit each)

- **Task A — cast depth:** the 8 cast entries per the table; flip the
  "zero authored depth" test to pin the six principals carrying
  backstory+secret+arc[3]; re-pin the golden (trap 2) in this commit.
- **Task B — the storyline:** all 11 chapter entries; flip the "empty
  storyline" test to structural pins (11 entries, ordered ch-1..ch-9c,
  exactly two choicePoints, three fact-gated finales); `validatePack` → [].
- **Task C — the sidequests:** all 12; flip the "zero sidequests" test to
  structural pins (12, unique ids, the two fact-gated entries' facts match
  ch-4's option facts character-for-character).
- **Task D — docs close-out:** STORY.md build order 3b SHIPPED (note the
  neutral-opener deferral); STATUS.md; CLAUDE.md docs map; annotate THIS
  handoff per WORKFLOW.md Phase 2 (flag any beat outline you had to bend).

## Definition of done

- `tsc` clean; full suite green (1095 baseline; the three flipped tests
  rewritten, none deleted); golden re-pinned exactly once, hook-lines-only
  diff.
- `validatePack(pack)` returns `[]` with the full season in.
- Every id, trigger, fact string, and reward matches this doc exactly.
- No file outside `content/pack/drift*`, the three tests + golden fixture,
  and docs was touched.
- The season is READABLE as a story straight from the two pack files — the
  owner reviews it there before it deploys (patient pacing means nothing
  fires mid-scene on live campaigns; ch-1 will open on their next quiet
  turn).
