# HANDOFF — Modularity M1: finish the content boundary

*Strategy phase output (Fable, 2026-07-18). Process, non-negotiables, house
mechanics, and the review checklist: `WORKFLOW.md` — read it first, then this
doc fully, before writing code. Designs here are DECIDED; implement, don't
re-litigate. The worked example of this workflow is `HANDOFF_NPC_CANON.md`.*

## Context — what this fixes and why now

The goal (owner direction): one core engine, swappable stories/worlds/NPCs.
The pack seam (`drift/content/pack/`) exists and is enforced by `canonLint`,
but it only covers WHO and WHERE (universe primer, factions, locations, cast,
job flavor, services). The rest of the world still leaks around it:

- **Loose world data inside `content/` but OUTSIDE the pack**: the item/weapon
  catalogs, enemy tiers, ship classes, crew tables, economy tuning, name pools,
  creation backgrounds + starting gear + patron templates, opening/brief prose.
  `canonLint` doesn't scan `content/`, so these carry canon ids invisibly
  (`content/creation.ts` has 13 `loc-`/`f-` literals today).
- **World-flavored pools in `shared/`**: `npcFlavor.ts`'s demeanors/tells/
  origins/builds/faces/marks/voices are half-generic, half spacer ("hums old
  spacer shanties", "vacuum-frost mottling").

M1 moves ALL world-flavored DATA into the pack, so `content/pack/` becomes the
complete definition of a world and `content/index.ts` becomes a pure
engine-facing facade. Zero player-visible change; zero call-site churn outside
`content/` (the facade keeps re-exporting the same names).

**Explicitly OUT of scope** (later phases — do not touch): the lexicon layer
(tenday/¢ wording — M2), prompt voice split (M3), runtime pack selection /
`WorldContent` threading (M4), swappable combat mechanics (M5), and
`skills.json` / `matrix.json` / the verb→skill map — those are RULES vocabulary
(load-bearing mechanics ids), not world flavor; they stay global.

## The move pattern (same for every task)

1. **Pin current behavior FIRST**: before moving a category, add (or confirm)
   tests asserting exact current outputs (see each task). Move data, re-run —
   byte-identical results prove a pure data move.
2. Move the data into the pack: extend `content/pack/types.ts` with a Zod
   schema for the category, put the data in `content/pack/drift.ts` (or a
   sibling `drift.<category>.ts` imported by it when large — the JSON catalogs
   may stay `.json` files relocated under `content/pack/`, imported by the
   pack module).
3. `content/index.ts` re-exports FROM the pack under the existing names —
   consumers keep importing `@/content`; nothing outside `content/` changes.
4. Extend `pack.test.ts` (shape/referential checks) and, where the category
   carries canon ids, they're now inside the pack where they belong.
5. Task F extends `canonLint` so loose `content/` files can never accumulate
   world data again.

## ⚠ THE TRAP for this handoff: deterministic pools are ORDER-SENSITIVE

`generateQuirk`/`generateBackstory`/`generateAppearance`/`generateVoice` hash an
NPC id into pool ARRAYS by index. Persisted (set-once) values are safe, but
**render-time fallbacks** (`world.ts` falls back to `generateAppearance(n.id)`
for seed NPCs; quirk likewise) recompute every turn — if a pool's ORDER or
LENGTH changes, every seed NPC's displayed look/personality silently changes
across all live campaigns. So: the drift pack's pool arrays must be moved
**byte-identical, same order, same length**. The pin-tests in Task C make this
mechanical. (This is this handoff's equivalent of the jsonb trap — see
WORKFLOW.md house mechanics.)

---

## Task A — catalogs → `pack.catalogs`

**What moves:** `content/items.json`, `weapons.json`, `enemyTiers.json`,
`shipClasses.json`, `crew.json`, `economy.json` (world tuning: payout bands,
prices, loot bands). **Stays global:** `skills.json`, `matrix.json` (rules).

**How:** relocate the JSON files to `content/pack/drift/` (new subfolder for
the pack's data files); `types.ts` gains a `PackCatalogs` schema (shape-level:
required keys, tier enums — not every field); `drift.ts` imports and exposes
them as `pack.catalogs`. `content/index.ts` lines 9–15 re-export from
`pack.catalogs` under the SAME exported names (`economy`, `weapons`,
`enemyTiers`, `shipClasses`, `crew`) so all 12 consumer files are untouched.

**Pin first:** the full vitest suite already pins catalog behavior extensively
(items/shop/combat tests) — a data move that breaks nothing IS the pin. Run the
suite before and after; also `contextSlice.golden` must be byte-identical
(`itemReference()` feeds prompts from this data).

**Done when:** suite green, golden untouched, no `../items.json`-style imports
left outside `content/`.

## Task B — name pools + creation examples → `pack.names` / `pack.examples`

**What moves:** `content/examples.ts` — `GIVEN_NAMES`, `SURNAMES`, `MONONYMS`
(→ `pack.names`), and the example signature skills + example moral codes
(→ `pack.examples`; they're lane-flavored prose). **Stays:** `suggestName`'s
mechanics (the seed math) — it now reads pools from the pack.

**Pin first:** `suggestName(0.37)`-style assertions for ~5 seeds (exact
strings), added BEFORE the move. Same-order requirement as Task C (quest cast
generation + the creation UI both consume this).

**Done when:** pins green pre and post, `generateCastName` (shared/quests.ts)
output unchanged for a fixed rng seed (existing quests tests cover this).

## Task C — npcFlavor pools → `pack.npcFlavor` ⚠ order-sensitive

**What moves:** ALL pools in `shared/npcFlavor.ts` — `DEMEANORS`, `TELLS`,
`DRIVES`, `HOOKS`, `ORIGINS`, `BUILDS`, `FACES`, `MARKS`, `VOICES`, `AGES` —
byte-identical, same order. **Stays:** the hash + `pick` + all `generate*`
functions (mechanics), now reading `pack.npcFlavor.*`.

**Pin FIRST (this is the critical step):** extend `shared/npcFlavor.test.ts`
with exact-string assertions for known ids BEFORE touching anything, e.g.
`expect(generateQuirk("npc-broker")).toBe("<current exact output>")` and the
same for `generateAppearance("npc-patron-camp-vess")`, `generateBackstory`,
`generateVoice` on 2–3 ids each (capture the strings by running the current
code, not by guessing). These pins are what make the move provably safe for
live campaigns' render-time fallbacks.

**Schema:** `PackNpcFlavor` = ten `z.array(z.string().min(1)).min(6)` fields.
**Done when:** pins green post-move, golden untouched (fixture NPC lines embed
quirk/appearance text).

## Task D — creation world content → `pack.creation`

**What moves from `content/creation.ts`:** `backgrounds` (labels, descriptions,
starting GEAR lists), `ambitions`, `alignments` (the 14 descriptions),
`FACTION_PATRON` + `DEFAULT_PATRON` (patron templates — they carry faction ids
and flavored gear). **Stays in `content/creation.ts`:** the equal-footing
attribute math (+3 budget, baselines), focus→attribute wiring, caps — that's
the creation RULESET.

**Watch:** `creation.test.ts` pins byte-level equality of built characters —
it's the pin; must stay green untouched. `shared/backstoryPressure.ts` imports
`ambitions` from `@/content/creation` — keep that import path working via
re-export (facade rule applies inside `content/` too).

**Done when:** creation tests green unmodified, canon ids in creation data now
live inside the pack.

## Task E — openings + briefs → `pack.openings` / `pack.briefs`

**What moves:** `content/openings.ts`, `content/briefs.ts` (world prose with
canon ids; consumed by `shared/recap.ts`, `llm/creationFinalize.ts`,
`lib/newCampaign.ts`). Same facade pattern: move data, re-export, consumers
untouched.

**Done when:** suite green; `recap` tests (if any pin opening text) untouched.

## Task F — enforcement + docs close-out

1. **canonLint extension**: add loose `content/` files (everything under
   `content/` EXCEPT `content/pack/**`) to the scanned set — after Tasks A–E
   they must contain zero canon ids; the lint keeps it that way. Also assert
   (simple test) that `content/index.ts` contains no array/object literals of
   world data — imports and re-exports only. Keep skills/matrix exempt
   explicitly with a comment saying why (rules, not world).
2. **pack.test.ts**: shape checks for every new category (non-empty pools,
   catalogs parse, patron per faction exists).
3. **Docs**: ARCHITECTURE.md gets a short "content boundary" paragraph (pack =
   complete world; facade = engine-facing surface; the M-roadmap one-liner).
   CLAUDE.md's pack bullet updated to list the new categories. STATUS.md: add
   "Modularity M2-M5" to the backlog (M2 lexicon next), mark M1 shipped.
   Annotate THIS handoff per WORKFLOW.md Phase 2.

---

## Definition of done (whole handoff)

- `npx tsc --noEmit` clean; full `npx vitest run` green (~834 at handoff time —
  plus the new pins); `contextSlice.golden` BYTE-IDENTICAL (this whole handoff
  is data motion — any golden diff means a data edit slipped in; stop and fix,
  never `-u` here).
- No file outside `content/` imports moved data except via `@/content` /
  `@/content/pack` / `@/content/creation` facades.
- canonLint green WITH the Task F extension (proving the loose files are clean).
- One commit per task, house style, `Co-Authored-By` per your model.
- NO migrations, NO DB changes, NO prompt-text changes anywhere in this handoff.
