# CREW.md — Recruitment & Scaling Upkeep Design

*SLICE 1 SHIPPED (2026-07-16): recruitment + per-tenday wages. Locked decisions:
(1) recruitment flows through the RELATIONSHIPS trust tier — a trusted (+2) PRESENT
NPC surfaces an engine-generated `Hire <name> (tier role — ¢X/tenday)` chip
(`shared/crew.recruitOffer` → `llm/runtimeCrew.recruitCrew`); +3 hires at T2; T3 is
never a routine hire. No model `recruit` field in v1 (every model-emitted field so
far has under-fired). (2) Per-tenday wages REPLACE the old flat ¢50-per-paying-job
wage (which would double-charge) — upkeep = wages + superlinear overhead, charged by
the turn route as the ENGINE-OWNED tenday clock advances (`engine/time.ts` — travel
costs a tenday, every 4th in-place scene close ticks one; before this every campaign
sat frozen at tenday 0). (3) The nonpayment cascade v1 is TRIMMED to loyalty decay +
desertion (mutiny deferred). Tables live in `content/crew.json` (C-1: tune from play
data); crew metadata on characters via migration 022 (`crew_role`/`crew_tier`/`wage`).
COMBAT PARTICIPATION SHIPPED (same day): crew fight beside the PC in personal combat
(`llm/runtimeCombat.ts` — muscle/gunner auto-attack on a crew phase after the player,
ONE summary line per round per C-3; engineer/pilot/face hold position, their value is
passives). Enemies SPLIT FIRE at random across the standing party; a crew member at
0 HP goes Downed and stops being a target. The **medic stabilize** is live: a medic
catches the PC as they drop (1d4, Downed + death-saves cleared, ONCE per fight per
medic — `combat.medicSpentIds`) so the fight continues instead of halting into
Bleeding Out; on the crew phase they patch a downed crewmate. v1 gaps (deliberate):
crew don't track statuses/armor resists, enemies never finish a downed crew member
(death path exists via struck-while-down but isn't reachable yet), ship-scale crew
actions (gunner turret) not in.
CASCADE + PASSIVES + UI SHIPPED (same day) — **crew v1 is COMPLETE**: the trimmed
nonpayment cascade lives in `chargeCrewUpkeep` (pay the expensive specialist first;
every unpaid member loyalty −1; unpaid at 0 rolls d20 ≤10 → DESERTS, Character row
removed, the shared NPC stays in the world; credits never go negative on payroll;
overhead only charges when the full payroll cleared; mutiny stays deferred). Role
PASSIVES: engineer→mechanics +1, pilot→piloting +1, face→negotiation/streetwise +1
(`crewAssistBonus`, non-stacking per role, rides the auditable `situational` slot),
and an engineer cuts dock repair 25% (¢12→¢9, quote + charge). UI: crew cards show
tier/role/wage + loyalty pips (●●●○○), and the PC line shows `crew ¢X/tenday`.
DEFERRED to v1.1: mutiny events, medic between-scene recovery passive, ship-scale
gunner turret, crew statuses/resists, finishing off downed crew.*

---

## 1. Concept

Any campaign can grow from a solo operator into a crew. Crew members are real
`Character` rows (`kind: "party"`) — they fight, get targeted, and die. Growth
is checked by a **scaling upkeep economy**: a big crew is powerful but
expensive, and the pressure compounds so that "recruit everyone" is a strategy
you must *fund*, not a free win. Unpaid crews rot — loyalty decays into
desertion or mutiny.

The seeded Vess campaign (Denna, Josen) already plays this shape; this design
makes it a system every campaign can reach.

## 2. What exists already (build on, don't duplicate)

- `Character` supports `kind: "party"`, `loyalty` (0–5), full stats/skills/gear.
- `economy.crewWagePerPayingJob = 50` — wages already charged at scene end for
  paying jobs (`runSceneEnd`).
- `contracts` table — standing income, the natural counterweight to upkeep.
- Combat v1 (shipped): the engine-owned round loop crew members plug into —
  party members auto-act each round and are targetable/killable.

## 3. Recruitment

**In-story, engine-clamped.** The narrator proposes; the engine instantiates.

- `TurnPlan.recruit: { name, role, tier: "T1"|"T2"|"T3", wage? }` — emitted when
  the story reaches a genuine recruitment moment (rescued deckhand, hired gun,
  faction-assigned specialist).
- The engine builds the character from a **crew tier table** (mirrors
  `enemyTiers`: HP, attack skill level, one role skill), ignoring any
  model-supplied stats. Tier gates: T1 anywhere; T2 requires the player to have
  standing (rep ≥ +2 with someone) or a completed arc; T3 only via major story
  beats (never a routine hire).
- **The player always confirms** — recruitment is a choice chip
  (`Hire Vex (T1 muscle — 25¢/tenday upkeep)`), never automatic.
- **Berth cap** (see §5) blocks recruitment when full: the offer becomes
  narrative ("she'd join, but you've nowhere to put her").

## 4. Roles (one each, mechanical + small)

| Role | Combat action (auto, per round) | Passive |
|---|---|---|
| Muscle | attacks with best weapon | — |
| Gunner | attacks; on ship: crews a turret (extra ship attack) | — |
| Medic | **stabilizes a downed PC/crewmate** (heal 1d4, once per fight) | +1 to recovery between scenes |
| Engineer | — (defends) | ship repairs cheaper; +1 mechanics checks assist |
| Pilot | — (defends) | +1 ship flee/evasive checks |
| Face | — (defends) | +1 negotiation/streetwise assist out of combat |

The **medic's stabilize** is deliberately the strongest hook: with the downed
halt rule, a medic is the difference between "left for dead" and back on your
feet — crew directly mitigates the flee-or-die early game.

## 5. Caps: berths by hull

Crew size is capped by the ship (grounded = 1 companion max):

| Hull | Berths (PC + crew) |
|---|---|
| none (grounded) | 2 |
| scout | 2 |
| fighter | 2 |
| hauler | 5 |
| gunship | 4 |
| corvette | 6 |

Wanting a bigger crew ⇒ needing a bigger hull ⇒ needing income — the loop that
drives the mid-game.

## 6. Upkeep (the scaling check)

Charged by the engine at scene end whenever in-world time advances
(`tendaysDelta > 0`), per tenday:

```
memberWage(tier) = T1: 25¢ · T2: 60¢ · T3: 150¢
crewOverhead     = ceil( totalWages × 0.15 × (crewCount − 1) )   // supplies, berth costs
upkeep(tenday)   = totalWages + crewOverhead
```

The overhead term makes cost **superlinear in headcount** — five T1s cost
meaningfully more than 5× one T1. Big crews demand standing contracts, not
odd jobs.

**Nonpayment cascade** (engine-enforced, deterministic):
1. Can't pay in full → pay partially in wage order (lowest tier first unpaid);
   every unpaid member: `loyalty −1`, event logged.
2. `loyalty 0` at upkeep time → **departure roll** (d20 + loyalty history):
   low = deserts (takes gear), mid = stays one grace tenday, high = demands
   back-pay ultimatum thread.
3. Two consecutive unpaid tendays with 3+ unpaid members → **mutiny risk**
   event (a thread + a confrontation scene the narrator must play out).

Loyalty also moves narratively (model proposes ±1 via a clamped plan field for
story beats: shares of a big score, honoring the code, betrayals).

## 7. Death & replacement

Crew death is permanent (same `Dead` injury). No respawn; recruitment refills
the roster. Killing off a loyal crew member should hurt — the narrator gets the
death event and the crew's loyalty context to play the fallout.

## 8. UI

- Status tab: crew list = HP bar + role + loyalty pips + wage; upkeep/tenday
  total shown next to credits.
- Recruitment offers appear as choice chips with cost inline.

## 9. Build order & dependencies

Depends on combat v1 (shipped: auto-act, targeting) and benefits from ITEMS.md
(medkits vs medic role). Crew v1 is the last of the three: **combat → items →
crew.**

## ⚠ Flags

- **C-1 upkeep tuning is guesswork** until real play data — expose the wage
  table + overhead factor in content JSON for cheap iteration.
- **C-2 model discipline**: `recruit` proposals depend on the model emitting the
  field; if it under-fires, recruitment moments may need choice-side detection
  ("Hire …" labels) as a backstop — same pattern as combatStart.
- **C-3 party scaling in combat**: 5 auto-attacking crew + enemies makes rounds
  long (many lines). Cap displayed lines / summarize crew volleys in one line.
- **C-4 grounded-companion edge**: crew with no ship (repossession!) — upkeep
  still charges; berth cap shrinks to 2 → excess crew generate a forced
  "who do you keep" beat. Deliberate drama, but the engine must handle the
  overflow state gracefully (no silent deletion).
