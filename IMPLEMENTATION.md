# DRIFT Webapp — Technical Implementation Plan

*Companion to ARCHITECTURE.md. Milestones are ordered; each has a "done when" so progress is checkable. Multiplayer is out of scope to build, but two seams (world events, universe faction ledger) are built into the schema from day one so faction spillover later is additive, not a migration.*

---

## Repo layout

```
drift/
├── app/                      # Next.js App Router
│   ├── page.tsx              # campaign picker
│   ├── play/[campaignId]/    # main play screen
│   └── api/
│       ├── turn/route.ts     # the narrator loop (streaming)
│       └── scene-end/route.ts
├── engine/                   # PURE TypeScript, no imports from app/ or db/
│   ├── rolls.ts              # d20 checks, modifiers, advantage
│   ├── combat.ts             # personal + ship scale, interaction matrix
│   ├── progression.ts        # ticks, level-ups, caps
│   ├── clocks.ts             # trigger evaluation, milestone effects
│   ├── economy.ts            # wages, dock fees, repairs, ammo
│   └── sceneEnd.ts           # the DM checklist as a pipeline
├── content/                  # versioned game rules as data (JSON)
│   ├── skills.json
│   ├── weapons.json          # types, damage, traits
│   ├── matrix.json           # interaction matrix
│   ├── shipClasses.json
│   ├── enemyTiers.json
│   └── economy.json          # ¢ constants
├── llm/
│   ├── tools.ts              # tool definitions handed to Claude
│   ├── promptBuilder.ts      # system prompt + context assembly
│   ├── narrator.ts           # Anthropic SDK loop
│   └── summarizer.ts         # Haiku scene/session summaries
├── db/
│   ├── schema.sql            # Supabase migrations
│   └── queries.ts
├── shared/
│   └── schemas.ts            # Zod schemas — single source of truth
└── scripts/
    └── import-save.ts        # one-time: vess-karo-save_1.md → seed data
```

Engine purity rule: `engine/` takes state in, returns new state + events out. No DB, no fetch, no randomness except through an injected RNG (so tests can seed dice).

---

## Milestone 0 — Project scaffold (half a day)

1. `create-next-app` with TypeScript, App Router, Tailwind.
2. Supabase project (free tier); store `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` in `.env.local`. API key is used **only** in route handlers (server), never client components.
3. Install: `@anthropic-ai/sdk`, `zod`, `@supabase/supabase-js`.
4. Vercel project linked, env vars mirrored.

**Done when:** deployed hello-world reachable, Supabase connects from a route handler.

---

## Milestone 1 — Zod schemas + database (1–2 days)

### Entity model

```
universes        id, name, owner_id, primer (text), created_at
factions         id, universe_id, name, description, default_rep
locations        id, universe_id, name, description, tags[]
npcs             id, universe_id, name, one_breath (text), status,
                 faction_id?, location_id?, notes
campaigns        id, universe_id, name, player_id, status,
                 current_location_id, tendays_elapsed (for time triggers)
characters       id, campaign_id, kind ('pc'|'party'), name,
                 attributes jsonb, hp, max_hp, ac, credits, loyalty?,
                 backstory, gear jsonb, injuries jsonb, stims
skills           id, character_id, name, level, ticks
                 (row per skill; max ticks derivable: next_level × 3)
ships            id, campaign_id, name, class, hp, max_hp, ac,
                 loadout jsonb (weapons, shield, DR, thrusters…),
                 buyout_remaining, missiles
faction_rep      campaign_id, faction_id, rep (−5..+5), notes
                 -- CAMPAIGN-level rep. Universe-level standing lives in
                 -- the faction ledger (Milestone 8 seam).
clocks           id, campaign_id, name, current, max, trigger_text,
                 milestones jsonb, status
threads          id, campaign_id, title, body, status ('active'|'resolved'),
                 entity_refs uuid[]   -- npcs/factions/locations it touches
contracts        id, campaign_id, name, payout_range, notes, status
scenes           id, campaign_id, seq, title, location_id?,
                 summary (2–3 sentences), entity_refs uuid[],
                 full_transcript jsonb, started_at, ended_at
turns            id, scene_id, seq, player_text, narration_text,
                 tool_calls jsonb, token_usage jsonb
rolls            id, scene_id, character_id, skill, d20, modifier, total,
                 dc, outcome, stakes bool, ticked bool, created_at
world_events     id, universe_id, source_campaign_id, faction_ids uuid[],
                 headline (one sentence), detail, visibility
                 ('private'|'canon'), created_at
                 -- THE SPILLOVER SEAM. Written from day one, read by
                 -- other campaigns only in the multiplayer phase.
```

### Tasks
1. Write Zod schemas in `shared/schemas.ts` first; generate/hand-write matching SQL. Zod is authoritative — DB jsonb columns validate through it on read/write.
2. Supabase migration for all tables. Add RLS policies now but permissive single-user (`owner_id = auth.uid()` on universes, cascade via joins) — tightening later is policy edits, not schema changes.
3. `content/*.json`: transcribe the save file's rules tables verbatim — weapon types, interaction matrix, ship classes, enemy tiers, crit rules, economy constants (¢18/HP repair, ¢15 dock, ¢51 missile, ¢50 wage), tick rule (DC 13+, stakes, 1/skill/scene, cost = new level × 3).

**Done when:** `zod.parse` round-trips a hand-built Vess character; migrations apply clean to a fresh Supabase instance.

---

## Milestone 2 — Engine (2–4 days, the heart of the token savings)

All pure functions: `(state, action, rng) → { state', events[] }`. Events are typed records like `{ type: 'roll', ... }`, `{ type: 'clock_advanced', ... }` — they feed the UI dice log, the DB `rolls` table, and the narrator's tool results.

### `rolls.ts`
- `computeModifier(character, skill, context)` — attribute mod + skill level + gear bonuses (nav computer +2, sensor suite +3, assist bonuses). Reproduce every line of the save's Quick Reference Card as a test.
- `rollCheck({ character, skill, dc, stakes, situational })` — returns full breakdown `d20(X) + mods(+Y) = Z vs DC`, success/fail, and *tick eligibility* (stakes && dc >= 13 && !alreadyTickedThisScene).

### `combat.ts`
- Two scales, one shape: `resolveAttack({ attacker, weapon, target, scale })`.
- Ship scale applies `matrix.json` (kinetic vs evasion −2 hit, energy vs armor +2 dmg, ion strips shields, etc.), DR (−2 plating), shield capacitor (negate first hit, mark spent), PD rolls vs missiles.
- Crit rules: player crit = max + reroll; enemy crit = max only.
- `spawnBudget(tier, shipClass)` helper that instantiates enemies from `enemyTiers.json` + `shipClasses.json` — the narrator asks for "T2 gunship", engine returns statted ship. Enforces ramp rule (first encounter with new tier = 1–2 ships) via campaign flags.

### `progression.ts`
- `awardTick(character, skill, sceneId)` — enforces caps, returns `"Gunnery (lvl 2): 5→6/9"` formatted string (the save file's disambiguation rule, now guaranteed).
- `levelUp` when ticks reach `newLevel × 3`.

### `clocks.ts`
- `evaluateTriggers(campaign, sceneEvents)` — pattern-match scene events against clock triggers (bulk run completed → Sable Chain +1; visit Talos → Talos +1; tendays elapsed → time-based ticks). Returns advances + milestone effects to surface to the narrator.

### `sceneEnd.ts` — the DM Checklist as a pipeline
Ordered steps mirroring the save file: (1) persist state deltas, (2) resolve tick awards, (3) apply costs (wages if paying job, dock fee if docked, ammo spent), (4) evaluate clocks, (5) flag "arrival beat owed" if campaign location changed, (6) emit scene summary request.

### Testing
Vitest. Seeded RNG. Golden tests from the save file: Vess's modifier card line-by-line, a full ship combat round vs a T2 gunship, Josen's death-save at −4, shield-then-DR damage order, tick cap enforcement.

**Done when:** every Quick Reference Card row reproduces from raw character data; a scripted combat replays with expected numbers.

---

## Milestone 3 — Save import (half a day)

`scripts/import-save.ts`: don't parse the markdown generically — hand-transcribe `vess-karo-save_1.md` into one big typed seed object (validated by Zod), script inserts it. One universe ("DRIFT"), one campaign ("Vess Karo"), 3 characters, the Lark, 8 factions with rep, 3 clocks, ~10 threads, cast as NPCs, contracts, and the resolved archive as pre-summarized `scenes` rows so the narrator has history.

**Done when:** the play screen (Milestone 5) can render Vess's sheet from the DB matching the markdown exactly.

---

## Milestone 4 — Narrator loop (3–5 days, the hard part)

### Request lifecycle (`POST /api/turn`, streaming)

```
player text
  → load campaign state (one query batch)
  → promptBuilder assembles messages
  → Anthropic SDK stream, tool-use loop:
      while (stop_reason == 'tool_use'):
        engine executes tool → tool_result → continue stream
  → narration streams to client via SSE/ReadableStream as it generates
  → persist turn (narration, tool calls, roll rows, state deltas) in one tx
```

### Prompt assembly (`promptBuilder.ts`) — with cache breakpoints

| Block | Content | ~Tokens | Cache |
|---|---|---|---|
| System 1 | DM style & narration rules (tone, arrival beats, ramp rule, "never spawn below weight class", dice-honesty, no-plot-armor) | ~1,200 | ✅ cached, changes rarely |
| System 2 | Universe primer + rules the LLM must *reference* not compute (what tools exist, when to call them) | ~800 | ✅ cached |
| Context | **State slice**: current location card, present NPCs' one-breath cards, active threads touching this scene, party vitals one-liner, active clock states | ~600–1,200 | per-scene |
| History | Running scene summary + last 6–10 exchanges verbatim | ~1,000–2,000 | rolling |
| Turn | Player message | small | — |

Target: ≤5k input/turn, ≥60% cache-discounted. Log `token_usage` per turn from day one so drift is visible.

### Tool definitions (`tools.ts`)

| Tool | Input | Engine behavior |
|---|---|---|
| `roll_check` | character, skill, dc, stakes, situational_mod, reason | Roll, record, return breakdown + tick eligibility |
| `resolve_attack` | attacker, weapon, target, scale | Full matrix/DR/shield/crit resolution |
| `spawn_encounter` | tier, composition request | Statted enemies within budget; enforces ramp |
| `adjust_resource` | target, field (hp/credits/ammo/stims/missiles), delta, reason | Validated mutation |
| `advance_clock` | clock, reason | Validates against trigger table; returns milestone effect if crossed |
| `adjust_rep` | faction, delta, reason | Clamped ±5; writes campaign rep |
| `update_thread` | create/develop/resolve, title, body, entity_refs | Thread CRUD |
| `log_world_event` | headline, detail, faction_ids | **Spillover seam** — writes `world_events` |
| `end_scene` | title | Triggers scene-end pipeline (Milestone 4b) |
| `dm_override` | description, reason | Escape hatch for rules-bending; logged, applied verbatim |

Every tool result is also emitted to the client stream so the dice log renders in real time.

The narrator is *instructed* (System 2) to call `log_world_event` whenever a scene meaningfully changes a faction's position (asset destroyed, contact hit, territory shifted) — this builds the spillover corpus from session one, even solo.

### Scene end (`POST /api/scene-end`)
Runs `engine/sceneEnd.ts`, then one Haiku call: input = turn transcripts of the scene, output = 2–3 sentence summary + `entity_refs` extraction (which NPCs/factions/locations/threads appeared — ask for JSON). Writes the `scenes` row. Every ~10 scenes, a second Haiku pass compresses older scene summaries into a chapter summary to keep the History block flat.

### Model routing
- Narration: `claude-sonnet-5` default; per-campaign setting to swap up (Opus for set pieces) or down (Haiku for shopping trips).
- Summaries/extraction: `claude-haiku-4-5`.

**Done when:** a full scene plays end-to-end in a raw dev UI — rolls resolve via tools, scene-end applies wages/clocks, summary lands in DB, per-turn token usage logged under budget.

---

## Milestone 5 — Play UI (3–5 days)

Single play screen, three regions:
1. **Chat pane** — streaming narration (markdown), player input, "End Scene" button. Tool activity renders inline as compact chips ("🎲 Piloting d20(14)+8=22 vs DC 15 — success").
2. **Right sidebar (tabs)** — Character sheet (Vess + party, live HP/credits/skills+ticks), Ship (Lark loadout, shield/missile state), Clocks & Factions (progress bars, rep table), Threads (active list).
3. **Dice log drawer** — every roll's full breakdown, filterable; the honesty audit.

Plus: campaign picker page, a read-only campaign journal (scene summaries as a timeline), and a state-inspector page (raw JSON view + manual edit for fixing narrator mistakes — you *will* need this; it replaces editing the markdown by hand).

State sync: after each turn the API returns the state delta; sidebar updates optimistically from tool-result stream events.

**Done when:** you can play a whole session without touching the markdown file or the database console (except deliberately, via the inspector).

---

## Milestone 6 — Durability & trust (1–2 days)

1. **Transactional turns**: all writes from one turn commit atomically; a failed LLM call leaves no partial state.
2. **Snapshots**: full campaign-state JSON snapshot at each scene end → `scene.snapshot` column. "Rewind to scene N" = restore snapshot. This is your save-file safety net, better than the markdown ever was.
3. **Export**: button that renders current state back into the v2 markdown format — escape hatch if you ever want to play in chat again, and a trust-builder during migration (diff it against your real save).

**Done when:** kill the server mid-turn → state is consistent; rewind works; export diff vs `vess-karo-save_1.md` is clean.

---

## Milestone 7 — DM quality / retrieval (ongoing, start ~1–2 days)

1. **Entity retrieval**: `entity_refs` on scenes/threads (extracted at scene end) + simple keyword match on the player's message → pull matching NPC cards, thread bodies, and *the last 2 scene summaries mentioning them* into the Context block. No embeddings — at hundreds of scenes, keyword+ref matching is enough; revisit only if it misses.
2. **Prompt tuning loop**: keep System 1/2 prompts in versioned files (`llm/prompts/`), note drift you observe in play (forgot arrival beat, spawned T1 solo, tone slipped) and patch the prompt; golden-transcript test: replay a saved scene's inputs and eyeball outputs after prompt changes.
3. **Clock pressure surfacing**: promptBuilder always includes any clock within 1 of a milestone as an explicit "the DM should feel this pressure" line — this is how the save file's "world moves on its own" survives the migration.

---

## Milestone 8 — Multiplayer seams (design now, ~0 extra build)

Built already by earlier milestones — listed here so nothing erodes them:
- `world_events` written from session one (Milestone 4's `log_world_event`).
- Faction identity lives at **universe** level; rep at **campaign** level (Milestone 1). Universe-level faction *standing* later = aggregation over `world_events`.
- RLS policies exist from day one; multiplayer = add `universe_members` table + invite flow + widen read policies for `visibility='canon'` rows.

### Spillover, when you build it (sketch only)
1. Player 2 joins universe → own campaign + character; sees shared primer, factions, locations, canon NPCs.
2. On their scene start, promptBuilder adds a **canon feed block**: recent `world_events` where `visibility='canon'` AND (faction overlaps scene factions OR location matches), *excluding their own campaign's events*, capped at 3, as one-line rumors: "Word on Rook: someone torched a Sable Chain scout near the Meridian lanes."
3. Narrator instruction: weave at most one in as background color; never override local campaign state.
4. A universe-owner review queue (you) marks events `canon` vs `private` — you stay editor-in-chief of what spills over.
That's the whole feature: one prompt block, one policy change, one moderation toggle. No live sync, no shared scenes, no conflict resolution — faction *lore* spills over, faction *mechanics* stay per-campaign.

---

## Order of attack & effort

| # | Milestone | Effort | Playable? |
|---|---|---|---|
| 0 | Scaffold | 0.5 d | — |
| 1 | Schemas + DB + rules content | 1–2 d | — |
| 2 | Engine + tests | 2–4 d | — |
| 3 | Save import | 0.5 d | — |
| 4 | Narrator loop | 3–5 d | dev-UI playable |
| 5 | Play UI | 3–5 d | **fully playable — retire markdown** |
| 6 | Durability | 1–2 d | trustworthy |
| 7 | Retrieval & tuning | ongoing | feels like chat again |
| 8 | Multiplayer | later | seams already in place |

Roughly two to three weeks of evenings to Milestone 5. If that feels long: after Milestone 4 you can play through the dev UI while building 5–7.

## Decisions locked by this plan
- Faction spillover = async lore via `world_events` + canon feed; no shared scenes, no live sync.
- Campaign mechanics never cross campaigns; only narrative events do.
- Universe owner curates canon (review queue) — protects everyone's story from a rogue campaign.
- `log_world_event` runs from session one so your solo play seeds the shared universe's history.
