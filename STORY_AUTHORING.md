# STORY_AUTHORING.md — writing a season's chapters

*Owner-facing guide (HANDOFF_STORY_1.md Task D, extended by
HANDOFF_STORY_2.md Task D). The machinery this doc describes SHIPPED
2026-07-18 — `content/pack/drift/storyline.ts` still ships `{ chapters: [] }`
and `content/pack/drift/sidequests.ts` ships `[]` (dormant, no season written
yet). This is the reference for when a season IS written (3b): Fable drafts a
first pass, you edit the pack files directly, same as any other pack data.*

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
  // amount a chapter of this weight should pay. itemId/crewUnlock are
  // OPTIONAL "signature reward" additions — see that section below.
  reward: {
    credits: 100,
    factionRep: { factionId: "f-crown", delta: 1 },
    itemId: "combatArmor",       // optional — a real shared/items catalog id
    crewUnlock: "npc-ilyana",    // optional — a real pack cast id
  },
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

## Authored cast depth — backstory, secret, arc

`pack.cast` entries (the same array `castNpcIds` references) can carry three
OPTIONAL fields, read LIVE from the pack — never persisted, never sent to
the client (HANDOFF_STORY_2.md Task A). Editing any of them applies on a
campaign's very next turn, same as chapter prose.

```ts
{
  id: "npc-ilyana", name: "Ilyana", oneBreath: "...", /* ...existing fields... */
  backstory: "A former Crown auditor who fled a cooked ledger.",
  secret: "She's the one who cooked it — the ledger she's chasing is her own.",
  arc: [
    "Guarded, professional — still hiding the truth.",
    "Cracks start to show once you press on the ledger.",
    "Fully open with you, whatever the fallout.",
  ],
}
```

- **`backstory` is ALWAYS-ON and SPOILER-SAFE.** It surfaces in the
  narrator's `[hook: ...]` line for anyone present, and in a trusted NPC's
  personal-favor want — the SAME places the generated fallback would have
  shown. Write it as the thing the character would tell a near-stranger, not
  the truth underneath.
- **`secret` is the GATED reveal.** It surfaces ONLY while this NPC's
  entry in `castNpcIds` belongs to the ACTIVE chapter and they're PRESENT in
  the scene — both engine facts, checked by `promptSections/castReveals.ts`.
  The model still chooses WHEN and HOW within that window (never forced into
  one specific turn), but it can never fire before the chapter arms it.
  Write the reveal itself here, not a hint — the section tells the narrator
  "you may now let this surface."
- **`arc`** is one line PER ACT (index 0 = act 1, index 1 = act 2, …) — how
  this person has changed by the time the season reaches that act. Only
  rendered while a chapter of that act is active; an NPC with no entry for
  the current act simply gets no arc line (not an error).

## Sidequests — placed, authored, one-shot

`content/pack/drift/sidequests.ts` exports `driftSidequests: PackSidequest[]`
— a FLAT array (no ordering rule; each is independent). A sidequest is a
thin wrapper on the same Job machinery the procedural board runs — it
becomes a real offered job the moment its trigger holds, at its own posted
location, and the player can't tell it apart from a generated offer except
that its giver, stakes, and story are yours.

```ts
{
  id: "the-quiet-debt",         // FOREVER, unique. Runtime job id = "sq-<id>".
  title: "The Quiet Debt",
  blurb: "Ilyana needs a courier who won't ask questions.",
  giverNpcId: "npc-ilyana",      // a REAL pack.cast id — never invented here
  factionId: "f-crown",          // optional
  tier: "T1",                    // T0-T3 — YOUR call, never clamped down
  postedLocationId: "loc-meridian", // where it's OFFERED (station-local)

  trigger: {                     // OPTIONAL — omit to offer immediately
    actAtLeast: 2,                 // the season must have reached this act
    factionRepAtLeast: { factionId: "f-crown", rep: 1 },
    npcTrustAtLeast: { npcId: "npc-ilyana", disposition: 1 },
    hasFact: "sided-crown",
  },

  objectives: [                  // same shape/kinds as a chapter's — reuses
    { id: "o1", kind: "travel", summary: "Deliver the case to Rook", locationId: "loc-rook" },
  ],
  cargo: "a sealed case",         // optional — becomes real inventory on accept
  complication: "Sable eyes on the lane", // optional flavor line

  reward: { repFactionId: "f-crown", repDelta: 1 }, // credits roll from `tier`'s band
}
```

**One-shot is automatic** — once a player completes or abandons a sidequest,
it never re-offers (the completed/failed job record itself is the guard). An
OFFERED-but-ignored one that expires or gets walked away from DOES come back
on a later visit — that's by design (it's declining the offer, not the job).

**Never invent a giver inline.** `giverNpcId` must be an id already in
`pack.cast` — if the person doesn't exist yet, add them to the cast list
first (with a `backstory`/`secret`/`arc` if the season wants depth on them).

## Signature rewards — a chapter's act-finale payoff

A storyline chapter's `reward` can optionally carry:

- **`itemId`** — a real id from `shared/items.ts`'s catalog (the same ids
  the shop/loot flow use). Granted the moment the chapter completes: if it
  fits the player's pack, it goes straight into their gear; if the pack is
  full, it's parked exactly like any other full-pack pickup (a swap chip
  offers to drop something for it) — it's never silently lost.
- **`crewUnlock`** — a real `pack.cast` id. Completing the chapter raises
  that NPC's trust to the recruit-eligible threshold (never LOWERS it if
  they're already more trusted than that) — they still only actually join
  when the normal recruit chip's other conditions hold (a free berth, them
  being present). This is "you've earned the right to ask", not "they're
  now standing in front of you."

Both are optional and independent — a chapter can carry neither, either, or
both alongside its credits/rep.

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

`shared/storyline.test.ts` is the reference for a chapter — it builds a small
2-chapter fixture and drives it through the full loop (trigger → beats →
objectives → choice → reward → next chapter) with plain function calls, no
server, no model. `shared/sidequests.test.ts` is the equivalent for a
sidequest (placement, trigger gating, one-shot). Copy either pattern to
sanity-check a real entry's shape before it ever reaches a live campaign.
`npm test` also runs the full storyline + sidequest schemas against
`content/pack/pack.test.ts`'s validator, which is the same check that gates
the real pack.

## What this machinery does NOT do (yet)

No typed-text choice inference — the choicePoint only resolves from a
clicked chip. No season/end-date concept. No NPC-initiated contact (a
chapter can't reach out to the player between turns; it waits for the
trigger to hold and then patiently nudges). No secret-reveal TRACKING — the
castReveals section keeps offering a secret every turn its gate holds; it
isn't marked "delivered" the way a beat is. These are tracked in `STORY.md`'s
backlog, not blockers for writing a season with what's here.
