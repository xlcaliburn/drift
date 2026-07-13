# COMBAT.md — Multi-Turn Combat Design

*Design doc for engine-driven, D&D-style rounds with enemy turns. Status: draft
for review — see **Open decisions** at the bottom before implementation.*

---

## 1. Why (the failure this fixes)

Real-play evidence: a player "had a fight, got shot, lost — and took no damage."
Combat currently routes to the freeform tool loop on a keyword heuristic
(`isSetPiece`), where DeepSeek narrates fights **without calling
`spawn_encounter`/`resolve_attack`** (audit data: 16× offer_choices, 2×
roll_check, 0× combat tools across all real turns). Even when tools do fire,
**enemies don't survive the turn**: `TurnRuntime.enemies` is a per-turn Map on a
runtime object that is rebuilt every request, so a "fight" can never span turns.

Conclusion (same as the structured-turn shift): combat must be an
**engine-owned state machine**. The model narrates results; it never controls
whether damage happens.

## 2. Goals / non-goals

**Goals**
- Fights span multiple player turns (rounds), like D&D.
- Enemies are real: persisted HP/AC/attack; they hit back every round and their
  damage applies through `applyDamage` (can DOWN and KILL the player).
- Every roll is engine output, shown as 🎲/💥 system lines; zero narrative-only
  combat.
- Combat actions are engine-generated choices (attack / aim / cover / stim /
  flee) so the loop cannot be derailed by model indiscipline.
- Reuses what exists: `resolvePersonalAttack` (hit/crit/DR math),
  `enemyTiers.json` (HP/AC/atk/damage per tier), `applyDamage`
  (downed→dead), the JSON TurnPlan channel, `campaign_runtime` persistence.

**Non-goals (v1)**
- No initiative rolls — the player always acts first each round (see D-1).
- No enemy special abilities beyond the tier table (T3 multiAttack yes; morale
  optional, see D-6).
- No grid/positioning; "cover" is an abstract AC buff.
- Ship combat: same loop, deferred to v1.5 unless decided otherwise (D-5).

## 3. Data model

New `CombatState`, persisted in `campaign_runtime` (new jsonb column,
migration 009) and carried on `SessionData` — scene-scoped runtime data, same
tier as transcript/history, NOT part of the mechanical `CampaignState` schema:

```ts
interface CombatEnemy {
  id: string;          // "enemy-1"
  name: string;        // "Sable gunhand"
  tier: "T1"|"T2"|"T3";
  hp: number; maxHp: number;
  ac: number;
  atk: number;         // from tier
  damage: string;      // from tier ("2d8")
  shieldReady: boolean; // T2+ may carry (negates first hit)
}

interface CombatState {
  active: boolean;
  round: number;                  // 1-based
  enemies: CombatEnemy[];
  scale: "personal";              // "ship" in v1.5
  playerCoverAc: number;          // +2 while in cover, else 0
  playerAimBonus: number;         // +2 on next attack after Aim, else 0
  fleeAttempts: number;           // escalating flee DC
}
```

## 4. Flow

### 4.1 Starting combat
The model signals it structurally; the engine executes and clamps it:

- `TurnPlan.combatStart: { tier: "T2", count: 2, names?: string[] }`
- Engine spawns via the tier tables with hard clamps: ramp rule
  (`firstEncounterMaxCount` for a tier the player hasn't faced), count 1–4,
  never below weight class (no solo T1). Model-supplied stats are ignored —
  only tier/count/names pass through.
- Free-text aggression ("I open fire") without `combatStart`: the JSON prompt
  instructs the model to emit `combatStart` for violence; if it narrates a fight
  without it, nothing mechanical happens — same guarantee as today, but the
  choice-attached `failDamage`/`danger` path still covers one-off violence.
- `isSetPiece` keyword routing to the old tool loop is **removed** for combat
  (see D-7 for what remains of the tool loop).

### 4.2 The round (one player turn = one round)
When `combat.active`, `/api/turn` routes to the combat handler, NOT the normal
JSON narrator flow:

```
1. PLAYER ACTION (engine resolves, lines streamed as they happen)
   - Attack <enemy>:  resolvePersonalAttack(player weapon vs enemy AC)
                      + playerAimBonus, then reset aim. Crit = max + reroll.
   - Aim:             +2 to next attack (persists in CombatState).
   - Take cover:      +2 AC until player's next action replaces it.
   - Use stim:        heal (D-3) — costs 1 stim, once per round.
   - Flee:            check vs DC 12 + 2*fleeAttempts (skill: situational,
                      default reflex-family). Success → combat ends "escaped".
   - Free text:       v1 maps to a plain skill check WITHOUT attack effect
                      (engine can't safely improvise mechanics) — see D-2.
2. ENEMY DEATHS resolve (hp<=0 enemies drop; T3 morale check optional, D-6).
3. ENEMY TURN — every living enemy attacks: d20 + atk vs (player AC + cover).
   Hit → tier damage via applyDamage (downed/dead rules apply).
   HALT rule: the volley STOPS the instant the player goes down (see D-4).
4. END CHECK — all enemies dead → victory; fled → escaped; player downed/dead
   → combat ends, aftermath beat.
5. ONE model call: all ENGINE RESULT lines + combat status → 2-4 sentences of
   narration. During combat the model's choices are IGNORED; the engine
   generates the action list (attack per living enemy, aim, cover, stim if
   stims>0, flee). On combat end, normal narrator flow resumes next turn.
```

Cost note: a combat round is **one** model call (narration only) — cheaper and
more reliable than the old tool loop's N rounds.

### 4.3 Ending combat
- **Victory**: narrator narrates; loot/credits via a clamped `loot` plan field
  (D-8) or narrative-only in v1.
- **Escaped**: enemies persist? No — v1 clears CombatState; the world reacts
  narratively (rep, threads).
- **Downed**: combat ends immediately; the narrator resolves an aftermath
  (robbed / captured / left for dead) as a normal beat. HP stays 0 until
  healed; the Downed injury persists and further damage kills.
- **Dead**: permanent (existing 409 gate).

## 5. UI

- Sidebar **Status** tab gains a combat block while active: round number +
  enemy HP bars (name, hp/maxHp).
- Combat choices render like normal chips, with the attack ones badged 🎲.
- Engine lines stream as system lines: `🎲 attack: d20(14)+3 = 17 vs AC 15 →
  hit · 2d8 → 9 · Sable gunhand 15→6 HP`, `💥 Sable gunhand hits you for 7 —
  12→5 HP`.

## 6. Testing plan

Deterministic RNG throughout:
- spawn clamps (ramp rule, count, no solo T1)
- full round: player hit → enemy retaliation damages player
- aim/cover buffs apply and expire correctly
- shield negates first hit (T2)
- flee DC escalation; success ends combat
- volley halts on player downed; hit-while-downed kills (already covered)
- victory/escape clear CombatState; persistence round-trips via
  campaign_runtime

## 7. Migration & rollout

- Migration 009: `campaign_runtime.combat jsonb default null`.
- `SessionData.combat?: CombatState` + load/save plumbing.
- Route: `if (session.combat?.active) → runCombatTurn(...)` before all other
  path selection.
- No change to `CampaignState`/Zod schemas → no risk to existing saves.

---

## ⚠ Potential issues (flagged)

**I-1. Lethality spiral.** 3×T2 at 2d8 each vs a starting PC (~5–9 maxHp!) is
death in one round. Starting HP is `6 + vitality` — most builds have 5–9 HP
while T2 damage averages 9. **The current content numbers make any T2 fight
near-unsurvivable.** Mitigations to pick: scale enemy counts to PC level,
reduce personal-scale tier damage (2d8 → 1d6/1d8 personal table), and/or armor
DR. This is the single biggest design risk — the tier table was written for
the original Vess campaign (leveled, geared), not fresh creations.

**I-2. Model won't start combat.** If DeepSeek never emits `combatStart`
(pattern: it avoids mechanics), fights stay narrative. Backstop: keyword
detection on the PLAYER's action ("attack/shoot/open fire") auto-starts combat
engine-side — deterministic, but risks false positives ("I don't want to
shoot"). Proposal: model field first, measure for a session, add backstop if
needed.

**I-3. Free text during combat.** Players will type "I throw a crate at him."
V1 mapping (generic skill check, no damage) is safe but flat: creative play is
strictly worse than clicking Attack. Later: a tiny classifier call maps free
text → {action type, skill, damage-capable}. Accept flat-v1?

**I-4. Downed = near-certain death without the halt rule.** If enemies keep
attacking a downed player, hit-at-0-kills makes every loss fatal — no captures,
no robberies, no story. The halt rule preserves death (hit while already
downed still kills) while letting losses generate story. Tone call.

**I-5. Party members.** The seeded Vess campaign has party characters
(Denna/Josen); new campaigns are solo. V1 proposal: party members auto-attack
with their best weapon each round (engine-rolled) and can be targeted by
enemies (they can die — real stakes extend to them). Adds fun but also
complexity; could defer.

**I-6. Stim healing is undefined.** Stims exist only as a count; no heal rule
anywhere in content or engine. Need a number — proposal: `1d6+2`, once per
round, in or out of combat.

**I-7. Cheese risk: aim/cover loops.** Aim+cover forever is degenerate but
self-correcting (enemies keep attacking). Flee spam is bounded by the
escalating DC. Low risk, noting for completeness.

**I-8. History/context bloat.** A 6-round fight adds ~12 engine lines + 6
narrations to history. The canonical-history builder should compress finished
combat into one summary line ("[COMBAT: defeated 2 Sable gunhands in 4 rounds;
took 9 damage]") when combat ends.

## 🔲 Open decisions (need your call before build)

- **D-1 Initiative**: player-always-first each round (proposed) vs rolled
  initiative. Player-first is simpler and feels fine in chat format.
- **D-2 Free text in combat**: v1 = plain skill check without damage
  (proposed), or block free text during combat (chips only)?
- **D-3 Stim heal value**: propose `1d6+2`, 1/round.
- **D-4 Downed rule**: enemy volley halts when you drop (proposed) vs full
  volley continues (brutal: most losses = death).
- **D-5 Ship combat**: defer to v1.5 (proposed) or include now? (Same loop,
  `resolveShipAttack`, flee = burst drive.)
- **D-6 T3 morale**: implement moraleDc (enemies can break and run) in v1, or
  defer?
- **D-7 Tool loop fate**: with combat engine-owned, the old freeform tool loop
  has no remaining job (cinematic prose can run through the JSON path on
  Sonnet). Retire it, or keep as a fallback?
- **D-8 Loot**: engine-clamped `loot` field on victory (small credit range by
  tier) in v1, or narrative-only?
- **D-9 Rebalance (ties into I-1)**: adopt a personal-scale damage table
  (T1 1d4 / T2 1d6+1 / T3 2d6) + slightly higher starting HP (e.g. 8 +
  vitality), or keep canon numbers and accept brutal lethality?

---

# Review round 1 — resolutions (2026-07-13)

## Decisions locked

- **Balance (I-1 / D-9): NO rebalance, NO count-scaling.** Canon numbers stay;
  every enemy type exists "in the wild" at full strength. Lethality is managed by
  two levers instead: **(a) deadly encounters are rare**, and **(b) escape is
  scaled to the level disparity** — the more outmatched you are, the easier it is
  to run. See "Escape-by-disparity" below. Accepted consequence: **a fresh
  character cannot win a straight fight** — early game is avoid/flee until you
  level and gear up. (Flag F-1.)
- **Combat trigger (I-2): player-initiated is primary.** The model doesn't have
  to emit `combatStart`; it narrates the threat and the **player's response**
  starts the fight — a combat/attack choice (or clearly aggressive free text)
  escalates it engine-side. Model `combatStart` on a genuine ambush still works.
- **Free text in combat (I-3):** flat v1 (plain skill check, no attack effect);
  richer creative play later.
- **Downed rule (D-4):** volley **halts** when the player drops (aftermath beat;
  hit-while-already-downed still kills).
- **History (I-8):** finished combat compresses to one summary line.
- **Loot (D-8):** engine-clamped credit range by tier on victory.
- **Tool loop (D-7): deferred** — "come back to that." Keep it for now; combat
  routes engine-side regardless.
- **Ship combat (D-5): still open**, but note the "ships in the wild" framing is
  ship-centric — the escape-by-disparity mechanic is designed to serve ship
  *travel encounters* too (flee = burst drive). Leaning: personal loop v1, ship
  travel-encounters v1.5 reusing the same escape math.

## Escape-by-disparity (engine change)

Flee is a check the engine makes easier the more outmatched you are:

```
threat        = max enemy tier present (T1=1, T2=2, T3=3)
playerCombat  = max level among {smallArms, gunnery, melee} (0 for a rookie)
disparity     = max(0, threat - playerCombat)
fleeDC        = clamp( 10 + 2*fleeAttempts - 3*disparity, 5, 20 )
```

So a rookie (0) vs a T2 (disparity 2): DC 10 − 6 = **4** — almost always escapes.
An even fight (disparity 0): DC 10, rising each retry. This makes "run from the
warship / the pros" the reliable, intended play when outclassed, without nerfing
enemies. Same formula generalizes to ship encounters (threat = enemy ship class).

## Initiative / surprise (answers D-1)

Default per-round order is **player-first** (clean in a chat format). Surprise is
the exception that answers "what if the player doesn't have initiative":

- `combatStart.surprise: "player" | "enemy" | "none"` (model sets it; on a
  contested start the engine can roll the PC's `perception` vs the enemy `atk`
  to decide instead of trusting the model).
- **enemy surprise (ambush):** a free **enemy volley resolves BEFORE** the
  player's first action — they take a hit for being caught out. Then normal
  player-first rounds.
- **player surprise (you ambush):** the player gets a **free opening attack**
  before enemies act.
- **none:** straight into player-first round 1.

Rolled initiative each round was considered and rejected for v1 (turn-order
bookkeeping adds little in an async, one-action-per-turn format; surprise carries
the "who gets the drop" drama).

## Spun-off features (NOT combat v1 — their own designs)

These came out of the review and are real, separate subsystems. Combat v1 will
be built to accommodate them but will not implement them:

- **Crew recruitment + scaling upkeep (from I-5).** New campaigns can recruit
  party members in play (today they're solo). A crew can grow large, but
  **upkeep scales** (wages/supplies per tenday, rising with headcount and member
  tier) so unchecked growth becomes unpayable — forcing income growth, efficiency,
  or hard cuts (desertion/mutiny on unpaid upkeep, tied to existing `loyalty`).
  Hooks that exist: `economy.crewWagePerPayingJob`, `Character.loyalty`, the
  party/pc character shape. **Needs its own doc (CREW.md).** *Combat v1 impact:*
  party members that exist auto-attack each round and can be targeted/killed.

- **Item audit + consumables + inventory space (from I-6).** Instead of a lone
  stim number, design a small diverse set of consumables (medkit/heal, grenade,
  shield booster, breaching charge, repair kit, …) and wire **inventory slots**
  (the `Character.slots`/`maxSlots` fields already exist but are unused).
  **Needs its own doc (ITEMS.md) / audit.** *Combat v1 impact:* interim stim
  heal = **1d6+2, 1/round**; the audit refines it and adds combat-usable items
  (e.g. grenade = engine AoE damage) later.

## Newly flagged

- **F-1 (early game = flee-or-die).** With canon numbers + no rebalance, a fresh
  PC has ~6–9 HP vs T2's 2d8; there is no "scrappy winnable" early fight — the
  design intent is that early combat is avoided or fled. Confirm this is the
  desired feel (it's coherent and brutal, but new players must be clearly
  telegraphed the danger and always offered a strong flee choice).
- **F-2 (rarity is soft).** "Encounters should be rare" has no hard enforcement —
  it relies on the narrator not starting fights (which, per audit data, it rarely
  does anyway). If fights turn out too frequent, add a combat cooldown (no
  engine-forced combat within N turns of the last).
- **F-3 (telegraphing).** Because losing a fight can be fatal, the narration MUST
  make a fight's danger obvious and the flee option must always be present and
  visibly easy when outmatched — otherwise a click into combat feels unfair.

## Still open before build

- **D-5 ship scope:** personal v1 only (recommended) vs personal + ship now.
- **F-1 confirm:** accept "early combat = flee-or-die"?
- Whether to write **CREW.md** / **ITEMS.md** designs before or after combat v1.

---

# Review round 2 — final resolutions (2026-07-13)

All decisions are now locked. This doc is build-ready.

- **F-1 CONFIRMED:** early combat is flee-or-die by design. Obligations that
  follow: the narration must telegraph lethal danger, and an outmatched player
  always gets a visible, easy flee option (escape-by-disparity guarantees the
  math side).
- **D-5: BOTH scales in v1.** Personal and ship combat ship together on the one
  CombatState loop (`scale: "personal" | "ship"`). Ship specifics:
  - Enemies from `shipClasses` + tiers (existing spawn logic).
  - Player actions: fire per mounted weapon (missiles consume ammo), evasive
    (+AC), shield cell (via items), **flee = burst drive** — if
    `burstDriveReady`, flee auto-succeeds vs equal-or-lower threat (drive then
    spent); otherwise the escape-by-disparity formula (threat = ship class
    tier). The starter loaner's whole identity is "its defense is running."
  - Hull 0 ≠ auto-death: ship is **disabled/adrift** → aftermath beat
    (boarded, captured, towed, vacuum peril) — the ship-scale analog of the
    downed halt rule. Death still reachable through what follows, never as a
    silent hull-zero consequence.
- **D-7: RETIRE the tool loop.** Verdict on "is there any point keeping it?" —
  **No.** Reasoning: (1) its only remaining jobs were combat (now engine-owned)
  and cinematic turns (Sonnet follows the JSON contract *better* than DeepSeek,
  so cinematic = JSON path with the Sonnet model); (2) it's the architecture
  whose failure modes (narrate-without-rolling, inline menus) caused every bug
  this week; (3) keeping it means maintaining two prompts, two auditing shapes,
  and the tool_use history sanitizer forever. What stays: `TurnRuntime` /
  engineBridge (the combat handler and JSON path both drive it), and
  `sanitizeHistory` (legacy persisted histories still contain tool blocks).
  Retirement lands WITH combat v1 (the `isSetPiece` routing dies the same
  moment the combat handler takes over combat text).
- **Docs-first order confirmed:** COMBAT.md + **CREW.md** + **ITEMS.md** are
  written and reviewable. Build sequence: **combat v1 (both scales) → items v1
  (consumables/slots/loot) → crew v1 (recruitment/upkeep)** — each behind its
  own migration, each independently shippable.
