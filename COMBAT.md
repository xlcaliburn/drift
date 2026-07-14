# COMBAT.md — Multi-Turn Combat Design

*Multi-turn engine-owned combat is **shipped** at both scales (personal + ship).
This doc now holds only the remaining backstop and the design principles that
still govern combat and the systems built on top of it (ITEMS, CREW).*

---

## Remaining work

**I-2 backstop — model under-fires `combatStart`.** The player-triggered half
shipped: a combat/attack choice or clearly aggressive free text starts a fight
engine-side (gun-skill reroute via `openFightFromSkill`), and typed text during a
fight routes through `interpretCombatText`. The still-open half is the *model*
side: if the narrator describes a fight breaking out (a genuine ambush) but never
emits `combatStart`, nothing mechanical happens. Backstop to add: detect when the
model narrates violence without `combatStart` and auto-start combat engine-side.
Risk to manage: false positives ("I don't want to shoot"). Proposal stands —
measure for a session, add the backstop if narrate-without-fighting recurs.

---

## Governing principles (locked — combat and the systems on top of it rely on these)

**Balance: canon numbers, no rebalance, no count-scaling.** Every enemy type
exists "in the wild" at full strength. Lethality is managed by two levers:
deadly encounters are **rare**, and **escape is scaled to level disparity**.
Accepted consequence — **a fresh character cannot win a straight fight**; early
game is avoid/flee until you level and gear up (flee-or-die by design). This is
why CREW's medic (stabilize a downed PC) and ITEMS' consumables (stim, smoke,
grenade) matter so much early: they are how a weak crew survives fights it can't
win outright.

**Escape-by-disparity.** Flee is a check the engine makes easier the more
outmatched you are:

```
threat        = max enemy tier present (T1=1, T2=2, T3=3)
playerCombat  = max level among {smallArms, gunnery, melee} (0 for a rookie)
disparity     = max(0, threat - playerCombat)
fleeDC        = clamp( 10 + 2*fleeAttempts - 3*disparity, 5, 20 )
```

A rookie vs a T2 (disparity 2): DC 4 — almost always escapes. An even fight
(disparity 0): DC 10, rising each retry. "Run from the pros" is the reliable,
intended play when outclassed, without nerfing enemies. The same formula
generalizes to ship encounters (threat = enemy ship class tier); the starter
loaner's whole identity is "its defense is running" (flee = burst drive).

**Downed halt rule.** The enemy volley **halts** the instant the player drops —
an aftermath beat (robbed / captured / left for dead) rather than a silent kill.
Hit-while-already-downed still kills, so death stays reachable but most losses
generate story. The ship-scale analog: hull 0 = disabled/adrift → aftermath
(boarded, captured, towed), never a silent hull-zero death.

**Telegraphing obligation.** Because losing a fight can be fatal, narration MUST
make a fight's danger obvious, and an outmatched player must always be offered a
visible, easy flee option (escape-by-disparity guarantees the math side).

**Engine owns all combat mechanics.** The model emits `combatStart` and narrates
results; it never controls whether damage happens. During combat the model's
choices are ignored — the engine generates the action list. The freeform tool
loop is retired; all turns run the JSON path (cinematic = Sonnet).
