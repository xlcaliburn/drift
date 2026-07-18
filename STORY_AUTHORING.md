# STORY_AUTHORING.md — writing a season's chapters

*Owner-facing guide (HANDOFF_STORY_1.md Task D). The machinery this doc
describes SHIPPED 2026-07-18 — `content/pack/drift/storyline.ts` still ships
`{ chapters: [] }` (dormant, no season written yet). This is the reference
for when a season IS written: Fable drafts a first pass, you edit the file
directly, same as any other pack file.*

## The one thing to internalize

**Chapter ids are forever. Everything else is safe to rewrite, anytime,
including mid-campaign.** A live campaign stores only *pointers* — which
chapter ids are active/complete, which objective/beat ids are done/delivered,
which choice option id was picked (`shared/storyline.ts`'s `StorylineState`).
It never stores a copy of a chapter's title, prose, or objectives. That means:

- Rewriting a beat's `directive` text changes what every campaign sees on its
  very next turn — no migration, no backfill.
- Adding a NEW objective to an in-progress chapter is safe — progress is
  matched by objective `id`, not array position, so inserting one ahead of an
  already-completed objective never un-completes it.
- Renaming a chapter's `title` is safe. Renaming (changing) a chapter's `id`
  is NOT — any campaign with that id already recorded as active/complete
  loses the link. If a chapter needs a fresh start, give it a new id and
  leave the old one in place (or delete it — see "removing a chapter" below).

## Where to edit

`drift/content/pack/drift/storyline.ts` exports `driftStoryline: PackStoryline`
— literally `{ chapters: [...] }`. Add, edit, or reorder entries in that array
directly. Array ORDER only matters for two things: how the file reads
top-to-bottom (author convenience) and `requiresChapterId` (a chapter's
prerequisite must appear EARLIER in the array — `validatePack` enforces this
and will fail the test suite if you get it backwards).

Run `npm test` after editing — `content/pack/pack.test.ts` validates the whole
storyline (unique ids, every referenced npc/location/faction/chapter actually
exists, the mortal-NPC rule, at most one choice point per chapter) the same
way it validates the rest of the pack.

## The chapter shape, field by field

```ts
{
  id: "ch-ledger-1",           // FOREVER. Never reuse; never repurpose.
  act: 1,                      // 1 | 2 | 3 — for display/organization only.
  title: "The Ledger",         // Player-facing. Freely editable.

  trigger: {
    // ALL specified conditions must hold (AND). Every field is a STATE
    // PREDICATE re-evaluated fresh every turn — never an event a campaign
    // could have already missed. This is what makes retrofit automatic: a
    // campaign already past every threshold opens the chapter the moment
    // this ships, with no special-casing.
    requiresChapterId: undefined,   // omit for an opening chapter
    tendaysAtLeast: 2,               // in-world tendays elapsed
    atLocationId: "loc-meridian",    // currently AT this location
    factionRepAtLeast: { factionId: "f-crown", rep: 1 },
    npcTrustAtLeast: { npcId: "npc-ilyana", disposition: 1 },
    hasFact: "sided-crown",          // substring match, case-insensitive
  },

  // The FIXED cast — "use exactly these people, invent no one else" (the same
  // cast-manifest rule QUESTS.md jobs use). Reference existing pack.cast ids;
  // don't invent a new NPC inline here — add them to the pack's cast list
  // first, with a backstory/secret/arc if the season needs one.
  castNpcIds: ["npc-ilyana"],

  // ORDERED, completed one at a time, same completion rules the procedural
  // job board uses (shared/quests.ts's objectiveMet) — travel/deliver = an
  // arrival, eliminate/survive = a fight resolved alive, investigate/persuade/
  // sabotage = a matching skill SUCCESS, report = sharing a scene with npcId.
  objectives: [
    { id: "o1", kind: "travel", summary: "Reach Rook Station", locationId: "loc-b" },
    { id: "o2", kind: "report", summary: "Report to Ilyana", npcId: "npc-ilyana" },
  ],

  // Fed to the narrator VERBATIM, one at a time, in array order, marked
  // delivered once actually sent. `aboutNpcId` + `fallbackDirective` are a
  // PAIR — see "the mortal-NPC rule" below.
  beats: [
    { id: "b1", directive: "Ilyana greets you warily — she doesn't trust easily." },
    {
      id: "b2",
      directive: "She finally asks you outright: what do you know about the ledger?",
      aboutNpcId: "npc-ilyana",
      fallbackDirective: "A note in Ilyana's effects raises the same question she never got to ask.",
    },
  ],

  // OPTIONAL. At most one per chapter ("branch light" — STORY.md). Shown as
  // real chips once every objective is done; picking one records `fact` on
  // the ledger (later chapters' triggers/beats can `hasFact` on it) and
  // completes the chapter.
  choicePoint: {
    id: "c1",
    prompt: "Where do you point the finger?",
    options: [
      { id: "crown", label: "The Crown", fact: "sided-crown" },
      { id: "chain", label: "The Chain", fact: "sided-chain" },
    ],
  },

  // Paid the moment every objective is done AND the choice (if any) is
  // picked. Flat numbers — no RNG band like job rewards; write the exact
  // amount a chapter of this weight should pay.
  reward: { credits: 100, factionRep: { factionId: "f-crown", delta: 1 } },
}
```

## The mortal-NPC rule

Any beat can name `aboutNpcId` — the cast member it's centered on. If that
NPC is dead or gone (`Npc.status` matching dead/gone/killed/removed/inactive/
departed/left — `shared/npcFate.ts`) by the time this beat comes up, the
engine swaps in `fallbackDirective` instead and still marks the beat
delivered. **A beat with `aboutNpcId` and no `fallbackDirective` fails
validation** — every beat about a mortal person needs a way to land if
they're not around to deliver it in person. Write the fallback as "how the
same information reaches the player without them" (a note in their effects,
someone else who knew, a recording) — never just "they're not here, skip
this," which reads as a plot hole.

## How triggers compose

Every field on `trigger` is optional; only the fields you set are checked,
and ALL of them must hold (AND, never OR — for an "either/or" opener, write
two separate opening chapters with the two different triggers; only the
first to qualify opens, since at most one chapter opens per evaluation).
Common patterns:

- **An opening chapter**: no `requiresChapterId`, maybe a light
  `tendaysAtLeast` so it doesn't fire literally turn one.
- **A direct sequel**: just `requiresChapterId: "<the prior chapter's id>"`.
- **A reputation-gated chapter**: `requiresChapterId` + `factionRepAtLeast`.
- **A branch-flavored chapter**: `requiresChapterId` + `hasFact` (checking a
  fact a previous chapter's choicePoint recorded).

## Patient pacing — what the player actually sees

An open chapter is never a hard gate on the sandbox. It surfaces as a "Season"
line in the narrator's context (the active chapter's title, current
objective, cast, and this turn's beat) and a "Season" block in the Story tab
(objective checklist, choice made). If a chapter sits with no undelivered
beats and no progress for a few tendays, the world nudges once with a short
reminder derived from the pending objective — it never repeats itself and
never blocks anything else the player is doing.

## Removing or changing a chapter mid-season

- **Editing prose, triggers, rewards, adding objectives/beats**: always safe,
  applies live, no special handling.
- **Deleting a chapter entirely**: if no campaign has it active yet, just
  delete the array entry. If a campaign might already have it ACTIVE, the
  engine drops the orphaned progress record itself the next time triggers are
  evaluated (a log line, not a crash) — the campaign's slate just frees up for
  whatever opens next. A chapter already marked COMPLETE in some campaign
  keeps its record even if deleted from the pack, since a later chapter's
  `requiresChapterId` may still need to resolve it.
- **Changing an id**: don't. Give the new version a new id instead.

## Trying a chapter locally

`shared/storyline.test.ts` is the reference — it builds a small 2-chapter
fixture and drives it through the full loop (trigger → beats → objectives →
choice → reward → next chapter) with plain function calls, no server, no
model. Copy that pattern to sanity-check a real chapter's shape before it
ever reaches a live campaign: build a `PackStoryline` with your chapter(s),
call `evaluateTriggers`/`advanceStoryline`/`nextBeat` against a fixture
`CampaignState`, and watch what comes out. `npm test` also runs the full
storyline schema against `content/pack/pack.test.ts`'s validator, which is
the same check that gates the real pack.

## What this slice does NOT do (yet)

No unique-item rewards (credits + faction rep only). No typed-text choice
inference — the choicePoint only resolves from a clicked chip. No
season/end-date concept. No NPC-initiated contact (a chapter can't reach out
to the player between turns; it waits for the trigger to hold and then
patiently nudges). These are tracked in `STORY.md`'s backlog, not blockers for
writing a season with what's here.
