# DRIFT — Status & Resume Notes

*Snapshot for picking work back up. Last updated 2026-07-12.*

## TL;DR

The app is **built and playable in-memory**. Engine is fully tested (59 tests). The
big remaining work is **Supabase persistence + Google auth** (nothing multiplayer
survives a server restart until then). Three setup items are half-done and need
you: GitHub push (auth mismatch), the `claude` CLI (PATH/reboot), and running the
DB schema.

## How to run / verify

```bash
cd drift
npm install
cp .env.example .env.local     # add DEEPSEEK_API_KEY (cheapest) or ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000 → "+ Create a character"
npm test                       # 59 engine tests, no keys needed
npm run build                  # required before any commit
```
If you see a Next.js error right after code changes: `rm -rf .next && npm run dev` + hard refresh. It's almost always stale cache, not a bug.

## What's built

**Core engine** (`drift/engine/`, pure + 59 vitest tests) — dice/rolls with the
Quick Reference Card modifiers, ship+personal combat (interaction matrix, shields,
PD, crits), tick/level progression, clocks, economy, scene-end checklist pipeline.
Deterministic, seeded RNG. The LLM never does math.

**Character creation** (`/create`) — 5-step flow: world intro → faction pick →
questionnaire (name, background, focus, code, ambition, line-you-won't-cross) →
**unique signature skill** → review. `engine/creation.ts` maps answers to a sheet
(equal footing: +3/+1/-1 attrs, flat ¢300, no starting ship).

**Unique skill** — two shapes, both balance-capped: *passive* (skill +2 / attribute
+1, wired into `computeModifier`) or *trigger* (nat-20 in a narrow GM-judged
scenario, via `forceNat20`/`forceCrit`, uses-per-scene cap).

**Narrator loop** (`drift/llm/`) — one tool-use loop serving two providers.
**DeepSeek is the default** (cheapest); Haiku fallback; Sonnet for "cinematic"
turns (toggle + auto-detect on combat words). `deepseek.ts` translates the
Anthropic tool shapes to DeepSeek's OpenAI-style API. Prompt caching across
tool-loop rounds (Anthropic), model-scaled output caps, batched tool calls.

**Play UI** (`/play/[id]`) — chat with streaming-style narration, clickable
suggested actions (free-form always available), character/ship/clocks sidebar,
dice log, cinematic toggle + per-turn cost readout. Opening recap is rendered
**free from stored state** (no tokens). Transcript persists across refresh
(in-memory server session).

**Feature requests** — 💡 button in play → free-text → cheap-LLM formats it →
owner reviews at `/requests` (approve/decline/done). `feature_requests` table in
schema. `TODO(auth)` to gate to owner.

**Multiplayer foundations (schemas only, not yet wired at runtime)** —
`shared/multiplayer.ts`: Dossier (public NPC-play profile), LedgerEntry
(who-knows-what relationship log), Season, CreationInput. See `MULTIPLAYER.md`.

## Key files

- `drift/shared/schemas.ts` — core game state (single source of truth)
- `drift/shared/multiplayer.ts` — dossier, ledger, season, creation input
- `drift/engine/` — the whole rules engine + tests
- `drift/llm/{narrator,deepseek,tools,promptBuilder,engineBridge,summarizer}.ts`
- `drift/lib/{state,newCampaign,feedback}.ts` — in-memory stores (swap for Supabase)
- `drift/db/schema.sql` — full Postgres schema (run this in Supabase)
- `drift/db/queries.ts` — snake/camel mappers + load/save helpers (partially wired)
- `drift/scripts/seedData.ts` + `import-save.ts` — Vess seed, `--push` to DB
- Docs: `ARCHITECTURE.md`, `IMPLEMENTATION.md`, `MULTIPLAYER.md`

## Open action items (need you)

1. **GitHub push blocked (403).** Repo `github.com/xlcaliburn/drift.git`; commit
   `45566b6` is made locally but push failed — this machine's cached credential is
   for account **todomichael**, not xlcaliburn. Fix: Windows Credential Manager →
   Windows Credentials → remove the `github.com` entry → `git push -u origin main`
   (re-auth as xlcaliburn in the browser). Or add todomichael as a collaborator.
   Untracked-but-safe extras to add when ready: `.mcp.json`, `.agents/`, `skills-lock.json`.

2. **`claude` CLI "not recognized."** It IS installed (v2.1.207) and PATH is
   correct; your terminal has a stale environment block. Fix: **reboot or sign
   out/in**. Immediate workaround: `& "$env:APPDATA\npm\claude.cmd" --version`.
   Only needed for MCP auth — optional (see below).

3. **Supabase not set up yet.** Fastest path, no CLI/MCP needed: Supabase project →
   SQL Editor → paste all of `drift/db/schema.sql` → Run. Then `.env.local` gets the
   3 Supabase vars. (MCP server config is in `.mcp.json`; auth via `/mcp` after reboot,
   but the SQL editor makes it unnecessary for now.)

## Next build phase — Supabase persistence & auth (the critical path)

In rough order:
1. Run `db/schema.sql` in Supabase; `npm run import-save -- --push` to seed.
2. Swap `lib/state.ts` in-memory store → `loadCampaignState`/`saveCampaignState`
   (mappers already exist in `db/queries.ts`). Persist transcript + dice log + a
   per-scene snapshot. Add an `updated_at` version check to avoid last-write-wins
   clobbering on concurrent turns.
3. Persist `/api/create` characters and `/api/feedback` requests to tables.
4. **Google OAuth** via Supabase Auth (player_id columns already exist). Then
   tighten the placeholder RLS policies and gate `/requests` to the owner.
5. Per-player API budget cap (token usage already logged per turn) so friends
   don't run up your keys.

## Then — shared-world runtime (engine-side, mostly DB-independent)

- Auto-maintain **dossiers** (derive capability tier from stats; append deeds from
  world_events) and **relationship ledgers** (who-knows-what) during play.
- **Cross-campaign reads**: pull another player's dossier + your ledger into the
  prompt builder so characters can meet (GM plays them as NPC, gated by what your
  ledger knows).
- **Break-away-from-faction** story trigger (ambition/loyalty driven).
- **Season-end reckoning** generator (fixed date → "state of the universe" writeup).
- Consider a canon review queue if full-AI-run produces odd lore (reuse the
  `/requests` approve/decline pattern; `world_events.visibility` flag exists).

## Design decisions locked (don't re-litigate)

- Engine does all math; LLM only narrates + proposes via tools.
- Multiplayer = shared **narrative** world, NOT a strategy game. No meters/scores/
  planet-capturing. Influence is emergent story outcome.
- Each player = a character embedded in a canon faction, own private campaign in a
  shared universe; async free-play; fully AI-run (no human referee yet); seasons
  with a fixed end date. Cross-player contact via dossiers + ledgers.
- Cheapest-model-first (DeepSeek default). Equal footing at character creation.
- Persistence is mandatory for multiplayer (Supabase, in progress).

## Watch-outs

- DeepSeek's multi-turn tool-calling is less disciplined than Claude's; failure
  mode is a turn that narrates without rolling. Can't corrupt state (engine is the
  only mutator), but tighten the prompt if it shows up.
- Created characters + feature requests are in server memory → lost on dev-server
  restart until Supabase is wired. The Vess example campaign always regenerates.
- Rotate the Anthropic key at some point — never committed (verified clean), but it
  briefly lived in an unignored file.
