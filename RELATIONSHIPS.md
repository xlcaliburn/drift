# RELATIONSHIPS.md — NPC depth & relationship tiers

*PHASE 1 SHIPPED (2026-07-15): deepening a bond now unlocks content. At **trusted
(+2)** a present NPC raises their backstory want (the `npcTiers` prompt section) and
the engine offers a **personal-favor chip**; accepting generates their personal job
(`generatePersonalJob`) straight to ACTIVE — private, never on the public board.
Completing it resolves the arc campaign-side (`arcStage`/`arcNote` on `NpcRelation`,
disposition bumped toward ally); the universe-shared `Npc` is never mutated per-player.
Phase 2 (betrayal, favor ledger, reputation-aware greetings, ally-tier mechanics,
hostility escalation) is below.*

*Original design follows. The problem: NPCs read flat, especially as the bond
deepens. Today disposition is a single scalar (`-3..+3`) with seven fixed labels
([`shared/scene.ts`](drift/shared/scene.ts)); at the top it just prints "ally". The
`quirk` + `backstory` flavor is frozen at birth ([`shared/npcFlavor.ts`](drift/shared/npcFlavor.ts))
and never evolves, and the `backstory` "want + complication" is a latent hook nothing
ever consumes. This doc locks how deepening a relationship UNLOCKS content and turns
the dead backstory into a personal, tracked arc.*

## The one invariant (same as everywhere)

The engine owns the structured state — the disposition scalar, the tier→unlock map,
the personal-job objectives and reward, the arc resolution. The LLM only narrates it:
it dramatizes the NPC opening up, raising their stake, taking a risk. It never decides
a tier is reached, never grants the reward, never resolves the arc itself.

## The relationship ladder (disposition → unlocks)

Disposition is already tracked per-player on `NpcRelation` (campaign-side overlay,
`-3..+3`, model proposes ±1 nudges, engine clamps). We keep the scalar; we give each
threshold **concrete engine-granted unlocks**, surfaced to the narrator as context.

| tier | disp | what it unlocks |
|------|------|-----------------|
| warm | +1 | uses your name; volunteers one personal detail (teases the want, doesn't offer it yet) |
| **trusted** | **+2** | **offers their backstory want as a personal job** (below); standing discount if they're a vendor; shares a rumor/secret (a lead) |
| ally | +3 | takes a real risk for you — combat assist / covers a debt / vouches to their faction (a rep bump); confides a vulnerability that becomes **betrayable** (Phase 2) |
| — | 0 | neutral: board work only, no personal content |
| wary→hostile | −1…−3 | guarded → worse prices/less info → actively works against you / may turn enemy (Phase 2) |

Depth needs downside: a ceiling you can't fall from is flat. Betrayable trust and the
negative-side escalation are Phase 2, but the ladder is designed for them from the start.

## The personal job — private offer, tracked execution (LOCKED)

Every NPC carries a `backstory` — a "want + complication" seeded at birth (e.g. *"is
scraping together the price of a ship of their own, but owes the wrong people and the
clock is running"*). Today it's inert flavor text. At **trusted**, it becomes a real job —
but NOT a public board listing (that would read as impersonal radiant work and break
the fiction). The locked mechanism:

- **The offer is private + diegetic.** When the player is **in a scene with the NPC**
  (present) AND disposition **≥ trusted** AND the NPC's want is **unconsumed** AND no
  personal job from them is already active, the engine injects a per-scene directive:
  *"NPC X trusts you — have them raise their personal stake and offer you help with it,
  in their own voice."* It never appears on the offered board; it surfaces because you
  are **with them**, at trust — not on a menu anyone could browse.
- **Acceptance is a reliable click** (Phase-1-friendly — no model-signal dependency).
  Alongside the directive the engine surfaces an **accept / not now chip** right in the
  scene, reusing the existing `acceptJob` plumbing. "Not now" leaves the want available
  to re-raise later (no penalty).
- **Execution is a fully tracked job.** On accept, the engine generates a `Job` with
  `giver = npc.id`, status **active** — it **skips the offered board and enters straight
  as active** (the board already has two surfaces: *offered* vs *active*; a personal job
  uses only the second). From here it's identical to a board score: ordered objectives,
  engine-detected completion, guaranteed reward (`shared/quests.ts` + `jobsRuntime.ts`).
  Mechanically it's a normal 1–2-step score; what makes it *personal* is that it's gated
  on trust, offered in the NPC's voice, and pays off their arc.
- **Completion resolves the arc — this is where the relationship visibly deepens.**
  Besides credits/rep, finishing a personal job resolves the NPC's want: their demeanor
  shifts, disposition may bump toward ally, and the want is marked **consumed** so it's
  never re-offered. "You helped Kessa clear the debt; next time you see her she has her
  own ship and greets you like family."

### Architectural nuance — the arc is CAMPAIGN-SIDE, never on the shared NPC

NPCs are **universe-shared**: the same `Npc` row is canon for every player, and seed/
shared NPCs must never be mutated per-player ([`shared/scene.ts`](drift/shared/scene.ts)
lines 9-11). So Kessa can't "get her ship" globally the moment one player helps her — in
another player's campaign she's still grounded until *they* help too. Therefore the arc
state lives on the **per-player `NpcRelation`**, not the shared `Npc`:

- The shared `Npc` (`oneBreath`, `quirk`, `backstory`, `status`) stays stable canon.
- New campaign-side fields on `NpcRelation` carry the arc: an `arcStage`
  ("`teased` → `offered` → `active` → `resolved`") and an `arcNote` (the campaign-
  specific outcome, e.g. *"got her ship with your help"*).
- The narrator is fed the relation's `arcNote` **layered over** the shared `oneBreath`,
  so this player sees the resolved Kessa while everyone else sees the canonical one.

## Where it lives (build seams — all outside the engine-split hot files)

- `shared/scene.ts` — add `arcStage?` / `arcNote?` to `NpcRelation` (campaign-side).
- `shared/quests.ts` — a `generatePersonalJob(npc, state, rng)`: a standard archetype
  score whose fiction is wrapped around the NPC's want; `giver = npc.id`, enters active.
- `llm/promptSections/npcTiers.ts` (new registry entry) — feeds the tier unlocks + the
  trusted "raise your want" directive + the campaign-side `arcNote` layer.
- `app/api/turn/route.ts` — the personal-job **offer chip** generator, gated on
  present-&-trusted-&-unconsumed, added alongside the existing patron/repair chips (my
  zone — NOT `engineBridge`/`runtime*`/`applyPlan`).
- `shared/jobsRuntime.ts` — on a personal job's completion, resolve the arc
  (set `arcStage = resolved`, write `arcNote`, bump disposition, mark want consumed).

## Phasing

- **Phase 1 (SHIPPED):** the tier-unlock prompt section (`llm/promptSections/npcTiers.ts`
  — warm/ally narration-only for now) + the trusted personal-job offer chip
  (`acceptPersonalJob`, gated by `personalJobAvailable`) + `generatePersonalJob` +
  campaign-side arc resolution in `resolveJobsTurn` (`arcStage`/`arcNote`, disposition
  bump). The core "deepening unlocks their story" loop. Covered by `quests.test.ts` +
  `jobsRuntime.test.ts`; the cues block is pinned by the context-slice golden.
- **Phase 2:** ally-tier concrete mechanics (combat assist, debt cover, faction vouch =
  rep), **betrayable** secrets (breaking trust craters disposition + spawns a persistent
  grudge via `world_events`), an asymmetric **favor ledger** (favors owed each way, acted
  on not just recalled), **reputation-aware greetings** (feed the player's deeds/rep so
  strangers react to who they are), and negative-side hostility escalation.

## Open questions (resolve during Phase 1)

- **One personal arc per NPC per campaign** for Phase 1 (a resolved want isn't re-offered;
  a second arc could unlock at ally later).
- Personal jobs are **active, not offered** — they don't count against the board's size-4
  offered cap.
- If disposition **drops below trusted after accept**, the active job stands; only an
  un-offered want waits for trust to return.
- **1b crossover:** once the model-signalled accept ships (QUESTS.md Phase 1b), the offer
  can degrade gracefully into a pure prose "yes" instead of the chip.
