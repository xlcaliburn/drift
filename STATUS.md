# DRIFT — Status & Resume Notes

*Snapshot for picking work back up. Last updated 2026-07-12.*

## TL;DR

The app is **built, playable, and persistent**. Engine is fully tested (64 tests).
**Supabase persistence + Google auth + a user/admin system are now wired**:
players sign in with Google, land pending until you approve them, see only their
own campaigns, and are hard-capped by a per-user monthly token/cost budget. You
manage users, spend, and feature requests at `/admin`.

**What still needs you (external dashboards — code can't do it):** set up the
Google OAuth provider in Google Cloud + Supabase, add the localhost redirect URL,
sign in once, then claim the 3 seeded campaigns. See *Open action items* below.

## How to run / verify

```bash
cd drift
npm install
cp .env.example .env.local     # DEEPSEEK_API_KEY (cheapest) or ANTHROPIC_API_KEY; + Supabase vars for auth
npm run dev                    # http://localhost:3000
npm test                       # 64 engine tests, no keys needed
npm run build                  # required before any commit
```
Without the Supabase env vars the app runs **keyless/in-memory**: no login, a stub
dev admin, nothing survives restart. With them, Google sign-in is required.
If you see a Next.js error right after code changes: `rm -rf .next && npm run dev` + hard refresh. It's almost always stale cache, not a bug. Note: don't run two dev servers against the same `.next` dir — they corrupt each other's build output.

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

**Auth + users + admin (built)** — Google sign-in via Supabase Auth
(`@supabase/ssr`, `middleware.ts`, `/login`, `/auth/callback`, sign-out). Open
signup → new accounts land **pending** → you approve/suspend at `/admin`. A
`profiles` table holds role (admin/player), status, and per-user monthly budgets.
`lib/auth.ts` (`getAuthedUser`/`requireApprovedUser`/`requireAdmin`) guards every
API route + page; campaigns are scoped per player (`campaigns.player_id`).
Authorization is server-side in the guards (all DB access uses the service key,
RLS is deny-all with no policies — intentional; Supabase advisor flags it, safe).

**Budgets (built, enforced)** — every narrated turn is metered into `turn_usage`
(tokens by type + estimated cost from `lib/pricing.ts`). `/api/turn` hard-blocks
(402) when a player hits their monthly token OR cost cap (default 2M tokens /
$5.00, editable per user in `/admin`). Keyless dev skips metering.

**Admin panel** — `/admin` with **Users** (approve/suspend + edit caps),
**Usage** (per-user spend, per-model breakdown, month picker), **Requests**
(the old `/requests` review queue moved here; `/requests` now redirects). Add a
tab in `components/AdminTabs.tsx` + a page under `app/admin/` to extend.

**Feature requests** — 💡 button in play → free-text → cheap-LLM formats it →
persisted to the `feature_requests` table (with `author_id`) → you review at
`/admin` → Requests. Submitting requires an approved account; reviewing is admin-only.

**Multiplayer foundations (schemas only, not yet wired at runtime)** —
`shared/multiplayer.ts`: Dossier (public NPC-play profile), LedgerEntry
(who-knows-what relationship log), Season, CreationInput. See `MULTIPLAYER.md`.

## Key files

- `drift/shared/schemas.ts` — core game state (single source of truth)
- `drift/shared/multiplayer.ts` — dossier, ledger, season, creation input
- `drift/engine/` — the whole rules engine + tests
- `drift/llm/{narrator,deepseek,tools,promptBuilder,engineBridge,summarizer}.ts`
- `drift/lib/state.ts` — session store (in-memory cache backed by Supabase)
- `drift/lib/auth.ts` — `getAuthedUser` + `requireApprovedUser`/`requireAdmin` guards
- `drift/lib/{usage,pricing}.ts` — token metering, cost estimates, budget checks
- `drift/lib/{newCampaign,feedback}.ts` — campaign builder; DB-backed feedback store
- `drift/lib/supabase/{server,client}.ts` + `drift/middleware.ts` — auth plumbing
- `drift/db/schema.sql` — full Postgres schema; `db/migrations/002_auth.sql` — auth migration (applied)
- `drift/db/queries.ts` — snake/camel mappers, load/save, `listCampaigns` (scoped), `getCampaignOwner`
- `drift/app/admin/*` + `drift/app/api/admin/*` — the admin panel
- `drift/scripts/seedData.ts` + `import-save.ts` — Vess seed, `--push` to DB
- Docs: `ARCHITECTURE.md`, `IMPLEMENTATION.md`, `MULTIPLAYER.md`, `WORLD_SYSTEMS.md`

## Open action items (need you)

1. **Finish Google OAuth setup (external dashboards — the only thing blocking
   real logins).** The DB migration is already applied to the `drift` Supabase
   project (`mgsogqnrpvoblqxkfgge`): `profiles`, `turn_usage`, the sign-in
   trigger, campaign-ownership FK, and `feature_requests.author_id` all exist.
   What's left:
   - Google Cloud console → OAuth client (web) → redirect URI
     `https://mgsogqnrpvoblqxkfgge.supabase.co/auth/v1/callback`.
   - Supabase → Auth → Providers → enable Google with that client id/secret.
   - Supabase → Auth → URL Configuration → add `http://localhost:3000/auth/callback`
     (and the deployed origin's `/auth/callback` when you deploy).
   - Sign in once as michaelchunkitwong@gmail.com → the trigger makes you
     admin+approved. Then claim the 3 seeded campaigns (still `player_id is null`):
     `update campaigns set player_id = (select id from profiles where role='admin' limit 1) where player_id is null;`

2. **GitHub push blocked (403).** Repo `github.com/xlcaliburn/drift.git`; this
   machine's cached credential is for account **todomichael**, not xlcaliburn.
   Fix: Windows Credential Manager → Windows Credentials → remove the `github.com`
   entry → `git push` (re-auth as xlcaliburn in the browser). Or add todomichael
   as a collaborator. Untracked-but-safe extras to add when ready: `.mcp.json`,
   `.agents/`, `skills-lock.json`.

## Next build phase — durable transcripts & shared-world runtime

Persistence + auth + budgets are done. Remaining, in rough order:
1. **Durable transcript/dice log.** `lib/state.ts` persists campaign state (HP,
   credits, rep, clocks, threads) but the chat transcript + dice log + per-scene
   snapshot still live only in the in-memory session — a server restart loses the
   narrative history (not the mechanical state). Persist scenes/turns/rolls; add
   an `updated_at` version check to avoid last-write-wins on concurrent turns.
2. **Shared-world runtime** (see below) — dossiers, ledgers, cross-campaign reads.
3. **World systems** — the exploration/artifacts/consequence-web design in
   `WORLD_SYSTEMS.md` (artifact vertical slice first).

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
- Persistence is mandatory for multiplayer (Supabase — done).
- Open signup → admin approval; players see only their own campaigns; per-user
  hard budget caps protect the API keys.

## Watch-outs

- DeepSeek's multi-turn tool-calling is less disciplined than Claude's; failure
  mode is a turn that narrates without rolling. Can't corrupt state (engine is the
  only mutator), but tighten the prompt if it shows up.
- **Transcript + dice log are still in-memory** (mechanical state persists;
  narrative history doesn't) → a server restart loses the chat scrollback until
  #1 in the next build phase lands. Created characters + feature requests DO
  persist now. The Vess example campaign regenerates from seed.
- `profiles`/`turn_usage` have RLS enabled with **no policies** (deny-all) —
  intentional (all access is server-side via the service key). Supabase's security
  advisor flags this; it's expected, not a bug. Add policies only if/when the
  publishable key is ever used for direct table reads.
- Budget check is per-turn and non-locking: two concurrent turns can both pass,
  so a cap can be overshot by ~one turn. Fine at playtest scale.
- Rotate the Anthropic key at some point — never committed (verified clean), but it
  briefly lived in an unignored file.
