# DRIFT

A webapp for the DRIFT tabletop campaign (Vess Karo). The **engine** (pure code)
does all dice, combat, progression, clocks, and economy — deterministic, honest,
free. The **narrator** (Claude API) only tells the story and proposes mechanics
via tool calls. This is what keeps token cost flat and the dice auditable.

Built from `../IMPLEMENTATION.md`. Faithful port of `../vess-karo-save_1.md`.

## Status

| Milestone | State |
|---|---|
| M0 Scaffold | ✅ |
| M1 Schemas + rules content + DB schema | ✅ |
| M2 Pure engine + 50 passing tests | ✅ |
| M3 Save import (Zod-validated seed) | ✅ |
| M4 Narrator loop (tools, prompt cache, summarizer) | ✅ |
| M5 Play UI (chat, sheet, ship, clocks, dice log) | ✅ |
| M6 Durability (snapshots, export) | ⏳ next |
| M7 Retrieval tuning | ⏳ ongoing |
| M8 Multiplayer spillover | seams in place (`world_events`, `log_world_event`) |

## Quick start

```bash
npm install
npm test                 # 50 engine tests — no keys needed
npm run import-save      # validate the seed against Zod (dry run)
cp .env.example .env.local   # add ANTHROPIC_API_KEY to actually play
npm run dev              # http://localhost:3000
```

The app runs **without Supabase** (in-memory state seeded from the save file) and
renders the character sheet **without an API key** — you only need a key to
narrate. Add Supabase env vars later for persistence (`db/schema.sql`).

## Layout

```
engine/     pure TypeScript rules — rolls, combat matrix, ticks, clocks, economy, sceneEnd
content/    the save file's rules tables as versioned JSON (weapons, matrix, tiers, ...)
shared/     Zod schemas — single source of truth for state shape
scripts/    seedData.ts (ported save) + import-save.ts (validate/push)
llm/        tools, promptBuilder (cache breakpoints), engineBridge, narrator, summarizer
db/         Supabase schema.sql + query helpers (snake<->camel mapping)
app/, components/   Next.js App Router UI + API routes
```

## Design invariants

- The LLM never does math; the engine never writes prose.
- Every roll returns a full breakdown (`d20(14) +8 = 22 vs DC 15 → success`).
- The Quick Reference Card modifiers are authoritative (`actionModifiers`); the
  engine uses them verbatim rather than re-deriving.
- `log_world_event` fires in solo play so the shared-universe canon feed has
  history the day a friend joins. Faction *lore* crosses campaigns; *mechanics*
  never do.
