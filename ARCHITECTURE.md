# DRIFT Webapp — Architecture Plan

*Goal: keep playing the Vess Karo campaign (and future campaigns) without burning chat tokens, with a path to sharing the universe with friends.*

---

## 1. The core idea: split the DM in two

Playing in claude.ai chat, one "DM" does everything. That's the expensive part. The app splits it:

| Layer | Does | Costs |
|---|---|---|
| **Game engine** (app code) | Dice rolls, modifiers, combat matrix, HP/credits/ammo bookkeeping, tick & level-up rules, clock triggers, wages/dock fees, faction rep, enemy tier budgets | Zero tokens, deterministic, honest dice |
| **Narrator** (Claude API) | Scene description, NPC voices, consequences, plot, tone ("consequences stick, the world moves on its own") | Small, cacheable prompts |

Rule of thumb: **the LLM never does math; the engine never writes prose.**

Everything in the save file that is a table — the Quick Reference Card, the interaction matrix, enemy tiers, ship classes, crit rules, the economy costs, the level-up formula — becomes code and data. Everything that is *voice* — the world primer, cast descriptions, DM style rules — becomes a system prompt.

## 2. How a turn flows

1. Player types an action.
2. Server assembles the prompt:
   - **System prompt** (~2k tokens): world tone, DM style rules, narration guidelines. Marked for **prompt caching** — after the first call it costs ~10% of normal.
   - **State slice**: only what's relevant now — current location, active scene participants, the 2–3 NPCs/threads that matter, Vess's vitals. Not the whole save.
   - **Recent context**: last handful of exchanges + a running scene summary (not full history).
3. Claude narrates, and when mechanics arise it calls **tools** instead of doing math:
   - `roll_check(character, skill, dc, stakes)` → engine rolls, applies precomputed modifiers, returns the full breakdown
   - `attack(attacker, weapon, target)` → engine applies the interaction matrix, DR, crit rules
   - `apply_costs(...)`, `advance_clock(...)`, `award_tick(...)`, `adjust_rep(...)`
   - Engine executes, validates (e.g. rejects a second tick on the same skill this scene), returns results; Claude narrates the outcome.
4. On **scene end**: the engine runs your DM Scene Checklist automatically — wages, dock fees, clock trigger evaluation, tick caps, save state. Claude (a cheap model) writes a 2–3 sentence scene summary appended to the campaign log.

Result: a turn goes from tens of thousands of input tokens to roughly **2–6k, mostly cache-discounted**, plus a few hundred output.

## 3. Data model (the save file becomes a schema)

The v2 save file maps almost 1:1 onto tables. The key structural decision — make it now, even playing solo — is the three-level split that makes multiplayer a feature instead of a rewrite:

```
Universe            ← shared canon: locations, factions, cast, world rules,
│                     faction reputation baselines, enemy tier tables
├── Campaign        ← one playthrough: clocks, active threads, resolved
│   │                 archive, scene log, campaign-local NPC state
│   └── Character   ← Vess: attributes, skills+ticks, inventory, HP,
│       ├── Party    credits, injuries
│       └── Ship    ← the Lark: HP, loadout, upgrades, buyout progress
```

Concrete entities: `universes`, `campaigns`, `characters` (PC + party members share a shape — Denna and Josen level identically anyway), `ships`, `npcs`, `factions` (+ per-campaign rep), `clocks`, `threads`, `scenes` (log + summaries), `rolls` (audit log — every die roll recorded and displayable), `contracts` (standing income).

Rules data (weapon types, interaction matrix, ship classes, tier budgets) lives as versioned JSON/config, not DB rows — it's game content, editable as the system evolves.

## 4. Recommended stack

Optimized for solo-dev simplicity and free-tier hosting:

- **Next.js** (App Router) — one deployable covering UI + API routes, streaming responses built in. Host on **Vercel** (free tier fine).
- **Supabase** — Postgres + auth + row-level security in one free tier. Auth sits unused until Phase 3, then it's already there for invites.
- **Anthropic API** direct (server-side key only, never in the browser):
  - Narration: **Sonnet** (good voice, ~5× cheaper than Opus). Try Opus for big set-piece scenes if Sonnet's prose disappoints.
  - Scene summaries / log compression: **Haiku** — near-free.
  - **Prompt caching** on the system prompt and rules block.
- **Zod** schemas shared between engine, API, and DB — one source of truth for game state shape.
- Engine = plain TypeScript module, pure functions, unit-testable without any UI or API.

## 5. Cost reality check

With caching and trimmed context, a Sonnet narration turn ≈ **$0.01–0.03**. A long evening of play (~100 turns) ≈ **$1–3**, independent of how long the campaign gets (summaries keep context flat). Compare against burning through a subscription's limits in one session. Cheap scenes (shopping at Rook, routine dockings) can drop to Haiku for pennies.

## 6. Build phases

**Phase 0 — Schema + engine (no UI).** Define the Zod schemas, port `vess-karo-save_1.md` into structured JSON (a one-time import script), implement the engine functions (rolls, combat, ticks, clocks, economy) with unit tests against known cases from the save file ("Gunnery lvl 1: 4→5/6"). This is testable and useful before a single pixel exists.

**Phase 1 — Playable MVP.** Chat UI with streaming narration; the tool-use loop; a dice-log panel (every roll's full breakdown, visible — honest dice you can audit); character sheet + ship sidebar; scene-end button that runs the checklist; save/load. *You can retire the markdown file here.*

**Phase 2 — DM quality.** This is where chat-play magic gets recovered:
- Retrieval: when the scene touches Rell or the Sable Chain, their cards + related threads get pulled into context automatically (tag scenes with entities; no vector DB needed at this scale — keyword/entity match is enough).
- Clock dashboard with trigger warnings; combat tracker UI (initiative, HP bars, shield/DR state).
- Session summaries and a browsable campaign journal built from scene logs.
- Prompt tuning pass: the DM style rules (arrival beats, difficulty ramp, "never spawn below weight class") live in the system prompt and get refined as you notice drift.

**Phase 3 — Shared universe (deferred; seams built early).** Minimum viable multiplayer = **faction lore spillover**: each friend plays their own Campaign + Character in the shared universe, and narrative events that touch shared factions (`world_events`, logged from session one even in solo play) surface in other campaigns as rumors/background color — mechanics never cross campaigns, only lore does. Universe owner curates which events become canon. Same-scene co-op play is explicitly out of scope. Detailed steps in IMPLEMENTATION.md Milestone 8.

## 7. Design decisions (defaults chosen, flag if you disagree)

| Decision | Default | Why |
|---|---|---|
| Who rolls dice | Engine, always | Honest, auditable, free |
| LLM state changes | Proposes via tools, engine validates | Prevents drift (double ticks, forgotten wages) |
| Combat resolution | Engine resolves, LLM narrates results | The matrix/DR/crit rules are pure math |
| When rules bend | LLM can request `override` with a stated reason, logged | Keeps DM flexibility without silent drift |
| Context strategy | Rolling scene summaries + entity retrieval | Flat cost regardless of campaign length |
| Multiplayer shape | Async, campaign-per-player, shared canon | 10% of the effort of shared-scene play |

## 8. Risks

- **Narrator quality dip.** In chat, Claude sees *everything*; here it sees slices. Mitigation is Phase 2 retrieval + good scene summaries — expect a few sessions of tuning what goes in the context window.
- **Over-engineering the engine.** Port the rules as they are in the save file; resist redesigning the game system while building the app.
- **API key hygiene.** Key lives server-side only. If friends join later, either you eat their costs, or add per-user BYO-key — decide then.
- **Scope creep at Phase 3.** Async shared canon first; real-time co-op only if the async version leaves people wanting it.
