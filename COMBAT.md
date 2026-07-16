# COMBAT.md — Multi-Turn Combat Design

*Multi-turn engine-owned combat is **shipped** at both scales (personal + ship),
along with the **balance pass** (player base HP 18; uniform enemy HP per tier —
T1 8 / T2 14 / T3 24; a `major` boss flag = 1.8× HP), **net-worth enemy scaling**
(§1–§3 below), and **Bleeding Out death saves**. The ONLY remaining combat item is
the I-2 model-side backstop. This doc holds that item and the design principles that
still govern combat and the systems built on it (ITEMS, CREW).*

---

## Shipped since (was §1–§3)

**§1 Net-worth enemy scaling, §2 enemy-count enforcement, §3 shield standardization
— all SHIPPED** as one body of work (`shared/netWorth.ts`; CLAUDE.md "net-worth enemy
scaling"). `netWorth(state)` (credits + gear value + owned-ship, loaner = 0) →
`maxThreatTier` (< 600 → T1, < 2500 → T2, else T3); `combatStart` + the gun-skill
reroute clamp every group's tier to the band (a `major` boss may exceed it), the
prompt feeds the current threat band, the narrated-foe-count backstop tops the spawn
up to match the fiction (capped at 5), and shields are a T3/`major`-only defense.

**Engine-first combat opening — SHIPPED.** The prose used to be authored BEFORE the
engine placed the foes, so it drifted from the roster (a live fight narrated "two
guards + a broker" while the engine spawned one "Thug", named nothing the story
used). The narrated-foe-count backstop only patched *count*, and only when the prose
used a recognized foe-noun preceded by a number ("the guards" → 0 → no top-up); names
never reconciled at all. Fix (`llm/jsonTurn.ts`): once `combatStart` spawns the
authoritative roster, the engine RE-NARRATES the opening beat to match it — feeding
the resolved roster (`combatRoster()` collapses "Thug 1/2" → "2× Thug") + the opening
exchange back to the narrator with "use these names and this exact count." The
gun-skill reroute's existing re-narration got the same roster feed (free — that call
already happened); the explicit-`combatStart` path adds one re-narration call when a
fight opens. Count AND names now align by construction. `combatRoster.test.ts`.

## Remaining work

### I-2 backstop — model under-fires `combatStart`

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
