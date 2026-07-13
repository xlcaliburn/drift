# ECONOMY.md — Income, Upkeep, and Path Balance

*Ties together ITEMS.md (sinks), CREW.md (upkeep), COMBAT.md (risk), and
WORLD_SYSTEMS.md (artifact returns). Status: draft for review.*

---

## 0. The structural problem to fix first

**Income is currently narrator-invented and unclamped.** Every payout is
whatever DeepSeek says (`adjust_resource credits +N`), so any balance math is
fiction until payouts are engine-clamped — the same lesson as dice, menus, and
damage: *if it matters, the engine owns it.* The core change of this doc:

> **Engine-clamped payout bands by job tier.** The model picks the tier and
> narrates; the engine rolls the payout inside the band. Negotiation checks
> shift position *within* the band (±20%), never outside it. Direct credit
> grants above a small cap (say ¢50 flavor money) are rejected.

Without this, a "trading lean" is just prompt-injection for money.

## 1. Baseline numbers (current facts)

- Start: **¢120**, flat (thin by design — a minion's pocket).
- Sinks today: dock fee 15, repair **18/HP**, missiles 51. (Barely anything —
  credits currently accumulate meaninglessly; items/crew are the missing sinks.)
- Observed real-play payout: courier run **¢200** over ~3 days. Anchor point.

## 2. Income — job tiers (the clamp tables)

| Tier | Payout band | In-world time | Risk | Gate |
|---|---|---|---|---|
| T0 errand | ¢40–80 | same day | none | none |
| T1 standard run | ¢150–250 | ~3 days | danger rolls | none |
| T2 professional | ¢350–600 | ~4–5 days | combat plausible | rep ≥ +2 with issuer |
| T3 major score | ¢900–1500 | an arc | severe | story-gated / rep ≥ +4 |

Standing **contracts** (the dormant table) = passive ¢/tenday for prior work
(e.g. a secured route pays ¢50–150/tenday until events break it). Contracts are
how big crews get funded and what the consequence web can attack.

**Reference income per tenday (10 in-world days), net of fees/repairs:**

| Profile | Net ¢/tenday | Variance |
|---|---|---|
| Fresh minion (T1 odd jobs) | ~¢400–450 | low |
| **Commerce lean, mid** (T2 access + negotiation + 1 contract) | ~¢850–1000 | low |
| Commerce lean, late (hauler, routes, 2–3 contracts) | ~¢1500–2000 | low-mid |
| Exploration lean (dives + salvage, see §5) | ~¢450 EV + artifact lottery | **very high** |
| Combat lean (bounties = T2-band jobs + loot) | ~¢700–900 | high (repair/death costs) |

## 3. The expense stack — can people afford things?

Checked against the profiles above (rule of thumb: a purchase class should be
a *decision*, not a rounding error or a wall):

- **Consumable kit-out** (2 stims + medkit + grenade + smoke ≈ ¢240): ~55% of a
  fresh tenday, ~25% of mid. Right zone — a real choice early, routine later.
- **Crew upkeep** (CREW.md tables): 1×T1 = ¢25+0 → trivial (first companion is
  nearly free — good, it's the fun unlock). 3-crew (T1+2×T2 ≈ ¢189/tenday) ≈
  45% of fresh income → **you need T2 jobs before a third crew member**; that's
  the intended gate. 6-crew corvette (~¢665/tenday) needs late-trade income or
  a contract portfolio — exactly the "new solutions for upkeep" pressure.
- **Repairs at 18/HP**: a real fight (~15 hull) costs ¢270 — more than a T1 job
  pays. Verdict: fights must either pay (T2+ bounty) or be fled. Consistent
  with flee-or-die, and it makes combat-lean income *feel* high-variance even
  when the band is the same.
- **Missiles ¢51**: 2–3 per professional job is affordable; spamming them on
  errand-tier work is ruinous. Correct.
- **Ship upgrade / hull** (future trade loop): should sit at multiple tendays of
  late income (¢3000+) — the long-horizon sink that keeps late trade motivated.

## 4. Trading lean — how money-maximizing plays out

Compounding levers, all legible to the engine: negotiation levels (band
position), rep (tier access), contracts (passive layer), hull (cargo volume —
**needs cargo capacity rules eventually**, else "trade" is vibes), route
knowledge. Result: **the trader is the richest profile and SHOULD be** — a
money lean must win money, roughly **2× a fresh player and ~1.5× other leans**
at equal progression. The cap on that dominance is structural:

- Everything a trader buys is **catalog-purchasable** — and the best rewards
  in the game (artifact weapon mods, lore keys, faction leverage) are
  **explicitly not for sale** (WORLD_SYSTEMS balance rule).
- The consequence web taxes success: saturated lanes tick "fat target" clocks
  → predation → the trader either hires guns (upkeep ↑) or loses margins.
  Wealth generates its own drag, narratively, with no meters.

## 5. Exploration/artifact lean — the comparison

Per-dive model (Shear, 2–3 days): salvage band ¢100–500 gross, minus ~¢120
expected repair (the Shear bites) and ~¢60 consumables → **EV ≈ ¢150/dive,
~¢450/tenday** — *below* the dedicated trader, with brutal variance including
zero-payout and lose-the-hull tails.

The artifact lottery is the point. Proposed tuning: a true artifact every
**5–8 focused dives** (≈ one per 2 tendays of committed exploration). Branch
values:
- **Sell**: commodity worth **¢800–1500** (the T3 band — one artifact ≈ one
  major score) *plus* a made enemy (world_event). Selling converts exploration
  time to money at roughly **trader-equivalent rates** — no better. An explorer
  who liquidates everything earns ≈ what a trader earns, with more variance.
- **Weaponize / Leverage**: returns **money can't buy** — a trait sidegrade or
  faction/lore position. This is the real yield of the path.

**The balance thesis:** each lean maximizes a different currency —
**trade → ¢**, **exploration → unpurchasable power/story options**,
**combat → board control (bounties, route safety) at high cost-variance**,
**diplomacy → standing**. Raw ¢ ranking: trader > combat > explorer ≈ fresh,
kept within ~2× so no lean is priced out of items/upkeep. Cross-conversion
exists but at par-or-worse rates (artifact→sell ≈ trader time; trader→power
impossible), so no lean dominates another on its home turf.

## 6. Tuning policy

All knobs live in content JSON (payout bands, wage tables, item prices,
artifact frequency/value, salvage bands) — playtest data moves numbers without
code changes. Same policy as CREW C-1 / ITEMS IT-4.

## ⚠ Flags

- **E-1 — RESOLVED (implemented 2026-07-13).** Money moves through the engine:
  `TurnPlan.payout {tier}` → `award_payout` rolls inside the band in
  `content/economy.json` (`jobPayouts`), with negotiation shading (a successful
  negotiation check the same turn → upper half of the band; failed → lower).
  Model credit grants via `adjust_resource` are clamped to `flavorGrantCap`
  (¢50) and debits to `maxDebitPerTurn` (¢500). This also closed a real hole:
  the structured JSON path previously had **no income mechanism at all**.
- **E-2 — RESOLVED BY CLARIFICATION.** The 14-day "season" is a **player-time
  cap** — an arbitrary real-world end date (per MULTIPLAYER.md's fixed season
  ends) — and is a *different axis* from in-game time (`tendaysElapsed`).
  Upkeep charges on **in-game tendays** as CREW.md specifies; no conflict.
  Residual note: the Fault Line clock currently advances off in-game
  `tendaysDelta` in code — if the season end is meant to be a real-world date,
  the reckoning trigger needs a wall-clock check at season close (shared-world
  runtime work), not a change to upkeep.
- **E-3 — RESOLVED (dock always cheaper + debt instead of soft-lock).**
  Dock repair drops to **¢12/HP** (content change applied); the hull patch kit
  heals **1d6+2** (≈ ¢14.5/HP — a field-emergency premium, never the efficient
  choice). **Docks extend credit:** repair is never refused for lack of funds —
  the balance goes **negative** (debt). While credits < 0, the engine ensures a
  "Dock debt" thread and the narrator is directed to offer a simple T0/T1
  payoff job; payouts auto-clear debt first. (Implementation lands with items
  v1's dock services, where repair becomes an engine action.)
- **E-4: double wage charging.** `crewWagePerPayingJob` (¢50/job at scene end)
  and CREW.md's per-tenday wages would BOTH fire. The per-job wage must be
  retired when crew upkeep lands (it becomes the upkeep system).
- **E-5: trade compounding needs cargo rules** (hold capacity by hull) to be
  engine-honest; until then T2/T3 job gating carries the progression alone.
- **E-6: variance floor.** Exploration's zero-payout tail must never strand a
  player unable to afford dock fees + repairs. Largely covered by E-3's dock
  credit/debt loop; keep the salvage minimum (~¢60 floor) and T0 errands as
  recovery income so debt spirals stay shallow.
