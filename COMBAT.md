# COMBAT.md — Multi-Turn Combat Design

*Multi-turn engine-owned combat is **shipped** at both scales (personal + ship),
along with the **balance pass** (player base HP 18; uniform enemy HP per tier —
T1 8 / T2 14 / T3 24; a `major` boss flag = 1.8× HP). This doc holds the remaining
combat work and the design principles that still govern combat and the systems
built on it (ITEMS, CREW).*

---

## Remaining work

### 1. Net-worth enemy scaling (approved design, not built)

Enemy tier is gated by the player's **net worth**, not the model's whim — a fresh,
under-equipped character faces weak opposition, and difficulty ramps as they arm
up. This is the engine ceiling on what `combatStart` can spawn.

**`netWorth(state)` — pure:**
- credits at face value;
- gear — catalog items (`content/items.json`) at `price × qty`; flavor gear (no
  catalog id) via a heuristic: a weapon by its damage die (1d6 ≈ low … 2d8 ≈ high),
  armor by `acBonus × ~150`;
- owned ship value (a **loaner** counts 0 — it isn't theirs).
- A fresh character lands ~400–500.

**`maxThreatTier(netWorth)` — the spawn ceiling:**
- **< 600 → T1 only** (fresh characters: winnable early fights)
- **600–2500 → T2 unlocks**
- **> 2500 → T3 unlocks**
- a `major` boss may exceed the band as a flagged set-piece.

**Net worth ALONE drives it** — no combat-skill floor (decided: a maxed fighter
with no gear is still limited, and gear *is* the progression gate). Cutoffs are a
starting point to tune in play.

**Enforcement (engine-owned, not model trust):**
- `combatStart` and the gun-skill reroute (`openFightFromSkill`) **clamp** each
  enemy group's tier to ≤ `maxThreatTier(state)`.
- the prompt feeds the player's current threat band so narration matches what will
  actually spawn (no "hardened professional" when only a mook appears).

This **subsumes** two earlier asks: "early = T1, slightly weaker than the player"
(a band-0 character only ever sees T1), and shield standardization (shields become
a T3/`major`-only defense under the same tiering — see below).

### 2. Enemy count enforcement — "two wreckers, one spawned"

The model narrates N foes but under-fills `combatStart.enemies` (count 1). The
`enemies[]` array lets it spawn multiple groups, but it's unreliable. **Backstop:**
on a `combatStart` turn, scan the narration for a stated foe count (a number-word
or digit + a foe noun) and force the spawn total to match — at least the narrated
count, capped at the total-of-5 clamp.

### 3. Shield standardization

Shields currently land on any T2+ enemy (first hit negated), making early fights
harder and inconsistent. **Standardize:** no shields on T1/T2 mooks — a shield is a
**T3/`major`-only** defense, deterministic (not a spawn roll).

### 4. I-2 backstop — model under-fires `combatStart`

The player-triggered half shipped: a combat/attack choice or clearly aggressive
free text starts a fight engine-side (gun-skill reroute), and typed text during a
fight routes through `interpretCombatText`. The still-open half is the *model*
side: if the narrator describes a fight breaking out (a genuine ambush) but never
emits `combatStart`, nothing mechanical happens. Backstop to add: detect
narrate-violence-without-`combatStart` and auto-start combat engine-side. Risk to
manage: false positives ("I don't want to shoot"). Measure for a session, add if it
recurs.

---

## Governing principles (locked — combat and the systems on top of it rely on these)

**Balance: net-worth-scaled, early fights WINNABLE.** Enemies are gated by the
player's net worth (Remaining §1): a fresh, under-equipped character faces T1
opposition that is *slightly weaker than they are* — early fights are meant to be
won. Difficulty ramps as the player arms and banks (T2 then T3 unlock at net-worth
thresholds). Uniform HP per tier keeps general fights consistent; a `major` boss
(1.8× HP, the only shielded enemy) is the wall. Player base HP is 18. **This
REPLACES the old "canon numbers, no rebalance, a fresh character cannot win,
flee-or-die" model** — deadly-by-default early combat is gone.

**Escape-by-disparity (still applies when you punch above your band).** Flee is a
check the engine makes easier the more outmatched you are — the safety valve when a
player takes on a `major` boss or a tier above their net-worth band:

```
threat        = max enemy tier present (T1=1, T2=2, T3=3)
playerCombat  = max level among {smallArms, gunnery, melee} (0 for a rookie)
disparity     = max(0, threat - playerCombat)
fleeDC        = clamp( 10 + 2*fleeAttempts - 3*disparity, 5, 20 )
```

The same formula generalizes to ship encounters (threat = enemy ship class tier);
the starter loaner's whole identity is "its defense is running" (flee = burst drive).

**Downed halt rule.** The enemy volley **halts** the instant the player drops — the
fight pauses and the PC enters **Bleeding Out** (below) rather than being finished
off. Ship-scale analog: hull 0 = disabled/adrift → aftermath (boarded, captured,
towed), never a silent hull-zero death.

**Bleeding Out — D&D-style death saves** (`shared/death.ts`, `llm/downedTurn.ts`).
At 0 HP the PC is Downed and the engine starts a death-save track. While Downed,
EVERY input (clicked chip or free text) runs one engine-rolled death save — the
state is engine-owned exactly like combat, so typing "I get up and run" can't skip
the dice. Each turn the player picks a desperate act:
- **Hold on** — a raw d20 save (10+ success). **Nat 20 → rally to 1 HP** (up; the
  fight already ended when they dropped). **Nat 1 → two failures.**
- **Crawl to cover** — a save at +2 edge (success on 8+).
- **Reach for a held stim/medkit** — auto-rescue: heal + up, item spent. The
  equipped escape hatch.
- **Call for help** — a save; offered only when a friendly NPC is present.

**3 successes → stabilise** (black out, patched to 1 HP, scene ends). **3 failures
→ dead.** A **hostile standing over you** (disposition ≤ −2) or an **active hazard**
adds +1 failure a turn — the pressure that makes bleeding out lethal (the D&D
"attack on a downed creature = auto-fail"). The **tutorial never tips into death**
(failures ride to the wire but resolve to stabilise). The chips are engine-generated
(`downedActions`) so a cheap model can't derail a life-or-death moment; the model
only narrates the beat. The sidebar shows the pip track (`saves ●●○ / fails ✕○○`).

**Telegraphing obligation.** Because losing a fight can still be fatal, narration
MUST make a fight's danger obvious, and an outmatched player must always be offered
a visible, easy flee option (escape-by-disparity guarantees the math side).

**Engine owns all combat mechanics.** The model emits `combatStart` and narrates
results; it never controls whether damage happens, the enemy count/tier (both
engine-clamped), or the credits. During combat the model's choices are ignored —
the engine generates the action list. The freeform tool loop is retired; all turns
run the JSON path (cinematic = Sonnet).
