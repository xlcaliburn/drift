# DRIFT

A shared-world, AI-narrated space-opera TTRPG webapp. The **engine** (pure code)
does all dice, combat, progression, clocks, and economy — deterministic, honest,
free. The **narrator** (a cheap LLM) only tells the story and proposes mechanics
via structured turns. This is what keeps token cost flat and the dice auditable.

The core platform is built and playable; what's left to build is tracked in
`../STATUS.md` / `../IMPLEMENTATION.md`.

## Quick start

```bash
npm install
npm test                 # 256 engine/llm tests — no keys needed
cp .env.example .env.local   # add DEEPSEEK_API_KEY (cheapest) or ANTHROPIC_API_KEY to play
npm run dev              # http://localhost:3000
```

The app runs **without Supabase** (in-memory state seeded from the save file) and
renders the character sheet **without an API key** — you only need a key to
narrate. Without Supabase there is **no login**: everyone is a stub dev
admin and nothing survives a restart. Add the Supabase env vars for
persistence + auth (below).

## Auth & multiplayer setup (Supabase)

One-time setup, in this order:

1. **Run the SQL** — Supabase SQL editor → paste `db/schema.sql` (fresh project)
   or just `db/migrations/002_auth.sql` (existing project). Must run **before**
   the first sign-in so the profile trigger exists.
2. **Google OAuth** — Google Cloud console → create an OAuth client
   (web application) with authorized redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`. Then Supabase
   dashboard → Authentication → Providers → enable Google with that client
   id/secret.
3. **Redirect URLs** — Supabase → Authentication → URL Configuration →
   add `http://localhost:3000/auth/callback` (and your deployed origin's
   `/auth/callback`) to Additional Redirect URLs.
4. **Sign in once** with the owner Google account — the trigger makes it
   admin + approved automatically. Then claim the seeded campaigns
   (one-liner documented at the bottom of `002_auth.sql`).

How access works: anyone can sign in with Google, but new accounts land
**pending** until approved at `/admin` (Users tab). Each player sees only
their own campaigns. Every narrated turn is metered into `turn_usage`;
players are hard-capped per month (default **2M tokens / $5.00**, editable
per user in the admin panel) and get a clear "budget reached" error when
spent. `/admin` also shows usage-by-model and the feature-request review
queue (formerly `/requests`).

## Layout

```
engine/     pure TypeScript rules — rolls, combat matrix, ticks, clocks, economy, sceneEnd
content/    the save file's rules tables as versioned JSON (weapons, matrix, tiers, ...)
shared/     Zod schemas — single source of truth for state shape
scripts/    seedData.ts (universe seed) + import-save.ts (validate/push)
llm/        jsonTurn (structured turns), promptBuilder, engineBridge, deepseek, summarizer, combatTurn
db/         Supabase schema.sql + query helpers (snake<->camel mapping)
app/, components/   Next.js App Router UI + API routes
```

## Design invariants

- The LLM never does math; the engine never writes prose.
- Every roll returns a full breakdown (`d20(14) +8 = 22 vs DC 15 → success`).
- Skill modifiers are always LIVE-derived (attribute mod + compressed proficiency
  + passives) so level-ups always count. `actionModifiers` only backs NON-skill
  action keys (deathSave, shipSensors, initiative) that have no derivation.
- `log_world_event` fires in solo play so the shared-universe canon feed has
  history the day a friend joins. Faction *lore* crosses campaigns; *mechanics*
  never do.
