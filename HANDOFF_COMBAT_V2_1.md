# HANDOFF — Combat V2 slice 1: lexicon seed + CombatSystem seam (M5) + squad orders

*Strategy phase output (Fable, 2026-07-18). Read `WORKFLOW.md` first, then this
doc fully. Designs are DECIDED (owner approved COMBAT_V2.md's resolved
decisions). Worked examples of the process: `HANDOFF_NPC_CANON.md`,
`HANDOFF_MODULARITY_M1.md`.*

## Context

COMBAT_V2.md is the design; this handoff is its first slice. Three tasks:
the M2 lexicon SEED (so new combat code doesn't deepen the wording debt), the
M5 **CombatSystem seam** (extraction shaped by its two designed consumers —
NOT speculative abstraction; ground combat today + ship-power next slice), and
**squad orders** (the first player-visible payoff: order every party member).
The ship system itself is slice 2 — do not start it here.

**Why the seam now:** every fight path already crosses ONE dispatcher
(`resolveCombatRound` in `llm/runtimeCombat.ts` — combat turns, the gun-skill
reroute in `openFight.ts`, downed-turn hostiles), and the NPC-fate hook
already lives AT that dispatcher. The extraction formalizes what exists and
reshapes the round signature to the form BOTH systems need: orders-per-member.

## ⚠ THE TRAPS for this handoff

1. **In-flight fights are persisted jsonb** (`campaign_runtime.combat`, loaded
   UNPARSED — the house jsonb rule). Live campaigns may be mid-fight at
   deploy. `CombatState` gains a `system` discriminator; loads MUST normalize
   `system: c.system ?? "classic"` in `lib/state.ts` (both branches of
   getSession) AND anywhere else combat state enters memory. Defensive read
   at the dispatcher too (`state.system ?? "classic"`).
2. **Zero behavior change through Tasks A+B.** The existing combat tests
   (combatTurn/runtimeCombat/openFight/downedTurn/applyPlan/combatRoster/
   crew tests) are the pins — run full suite before starting, after each task.
   Task C changes behavior (that's its point) and adds its own tests.
3. **Interface-level guards stay interface-level.** The fate recording, loot
   award, and net-worth clamps must remain at the DISPATCHER / combatStart
   layer, never move into a per-system implementation (review-checklist
   class 2: a second system must be unable to skip them).

---

## Task A — seed the lexicon facade (`shared/lexicon.ts`)

**Why:** M2 (moving tenday/¢/world-noun WORDS into the pack) stays deferred,
but this effort writes many NEW engine lines. Every new hardcoded "¢"/"tenday"/
"hull" deepens the debt M2 must migrate. Seed the facade now; new code uses it.

**Design (decided):** a small pure module — NOT yet pack-backed (M2 does that;
leave a `TODO(M2)` header note):
- `fmtCredits(n: number): string` → `¢${n}` (match current formatting exactly
  — grep a live engine line to confirm shape before writing).
- `TENDAY = "tenday"`, `TENDAYS = "tendays"` constants.
- `WORLD_NOUNS = { ship: "ship", hull: "hull", dock: "dock", station: "station" } as const`.
- Unit test: exact outputs.
- **The rule** (add to WORKFLOW.md house mechanics, one line): "new engine/UI
  strings use `shared/lexicon.ts` — never a bare ¢/tenday/hull literal; M2
  migrates old call sites." Do NOT migrate existing call sites here.

**Done when:** module + test + WORKFLOW.md line; suite green; nothing else
touched.

## Task B — the CombatSystem seam (M5, extraction only)

**New `llm/combat/types.ts`:**
```ts
export type CombatSystemId = "classic" | "ship2"; // ship2 arrives in slice 2
export interface MemberOrder { memberId: string; action: CombatActionSpec }
export interface RoundResult { combat: CombatState; lines: string[]; outcome: CombatOutcome; loot: number }
export interface CombatSystem {
  resolveRound(rt: CombatRT, state: CombatState, orders: MemberOrder[]): RoundResult;
}
```
(`chips()` joins the interface in slice 2 when ship chips exist — today's
`combatActions` in `shared/combat.ts` stays put, noted as a slice-2 move.)

**Changes:**
1. `shared/combat.ts`: `CombatState` gains `system?: CombatSystemId`
   (optional — legacy). `beginCombat` sets `system: "classic"`.
2. **Dispatcher** (`resolveCombatRound`): becomes the registry lookup —
   `SYSTEMS[state.system ?? "classic"].resolveRound(rt, state, orders)` —
   with the NPC-fate block staying in the dispatcher AFTER the system call
   (verbatim — it must fire for every system). The classic implementation is
   the existing `resolvePersonalRound`/`resolveShipRound` pair wrapped as one
   `CombatSystem` object; today it reads ONLY the PC's order:
   `orders.find(o => o.memberId === pc.id)?.action` — crewPhase untouched.
   Prefer wrapping in place over a big file move (churn is risk, not value;
   a physical `llm/combat/` split can ride slice 2).
3. **Back-compat adapter:** keep the old single-action signature as an
   overload/wrapper (`action → [{ memberId: pcId, action }]`) so
   `combatTurn.ts`, `openFight.ts`, and `downedTurn.ts` compile UNCHANGED in
   this task (Task C migrates combatTurn to real orders).
4. **Load normalization** (`lib/state.ts`, both branches):
   `combat: runtime.combat ? { system: "classic", ...runtime.combat } : null`
   (spread order matters: a stored `system` must win).

**Tests:** existing suite green UNCHANGED (the pin); plus 2 new: a legacy
CombatState without `system` resolves via classic; a `MemberOrder[]` carrying
only the PC's order behaves byte-identically to the old single-action call
(same seeded RNG → same lines).

## Task C — squad orders (ground)

**Behavior:** the player may order EVERY standing party member each round;
un-ordered members keep today's auto-act (`crewPhase`) so combat never stalls
and a solo PC is byte-identical to today.

1. **Classic system, real orders:** for each standing crew member WITH an
   order, execute it (reuse the action handlers the PC path uses — attack/
   aim/cover/stim/item; medic `help` maps to the existing stabilize); members
   WITHOUT orders fall through to `crewPhase` exactly as now. Enemy phase
   unchanged. One round still = one request.
2. **Protocol:** the turn route accepts `combatActions?: MemberOrder-shaped[]`
   (zod: array of `{ memberId, action: CombatActionSpec }`, cap ~6) alongside
   the existing single `combatAction` (kept for back-compat; maps to the PC).
   Parse next to the existing `combatAction` parsing in
   `app/api/turn/route.ts`; thread to `runCombatTurn`.
3. **Chips UI (`PlayClient.tsx` + `shared/combat.ts` `combatActions`):**
   per-member chip GROUPS — the PC's chips as today, plus a compact row per
   crew member (name + attack/aim/cover/role-special). Client-side: selecting
   a crew chip STAGES that member's order; submitting any PC chip sends the
   staged set as `combatActions`. No staged order = that member auto-acts.
   Keep it modest — tabs/rows, no drag-drop; the design doc's "grouped chips".
4. **Temporary allies:** `Character` gains `temporary?: boolean` (schema +
   migration `NN_character_temporary.sql` — reconcile numbering per WORKFLOW;
   column `temporary boolean`). `chargeCrewUpkeep` SKIPS temporary members
   (no wages); they're otherwise normal kind-"party" members (controllable,
   can be downed, fate rules apply). Nothing spawns them yet — STORY.md's
   prologue does; this just makes the shape real and tested.

**Tests:** orders-per-member applied (2 crew, distinct orders, seeded RNG →
expected lines); un-ordered member auto-acts identically to today; solo-PC
round byte-identical to pre-slice behavior; temporary member pays no wages;
route zod rejects a malformed order and accepts the legacy single action.

---

## Explicitly OUT of scope

The ship-power system, dice profiles, customization slots (slice 2);
chips()-in-interface (slice 2); the prologue and any STORY.md machinery;
migrating existing ¢/tenday call sites (M2); M3/M4.

## Definition of done

- `tsc` clean; full suite green (862 baseline + new tests); golden
  BYTE-IDENTICAL (nothing here touches prompts — if golden moves, stop).
- Live-data check before finishing: confirm a campaign mid-fight (if any)
  still loads (the normalization) — query `campaign_runtime` where
  `combat is not null`.
- One commit per task; CHECKS.md row for the load-normalization guard
  (§0 architecture family) + squad-orders note in COMBAT_V2.md marking
  Part A shipped; annotate THIS handoff per WORKFLOW.md Phase 2.
