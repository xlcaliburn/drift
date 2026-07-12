# DRIFT — World Systems Design

*Game-design counterpart to [ARCHITECTURE.md](ARCHITECTURE.md) (which is technical). This
doc specifies three connected systems — **Exploration**, **Artifacts**, and the
**Cross-Path Consequence Web** — that together make DRIFT a world where a player's
chosen path is a lens on one reactive universe, not a siloed minigame.*

*Status: design proposal, not yet built. Drafted 2026-07-12.*

---

## 1. The core principle: paths are lenses, not silos

A player who commits to **trading** should still bend the fate of **pirates**,
**explorers**, and **factions** — without ever touching combat themselves. The
world is a single reactive system; each path is a different way of pushing on it.

This is the concrete expression of a locked design decision (see STATUS.md):

> Multiplayer = shared **narrative** world, NOT a strategy game. No meters / scores /
> planet-capturing. Influence is emergent story outcome.

**Everything below honors that.** Cross-path impact is expressed through the
primitives the engine already has — `world_events`, faction `rep`, and **clocks** —
never a visible dashboard. The player sees the world *react*; they never watch a
"route heat: 7/10" bar.

### Design invariants this must not break
- **The engine does all math; the LLM only narrates + proposes via tools.** Any new
  system lands as engine state + a tool, not as narrator freestyle.
- **Equal footing / no power creep.** New rewards (artifact weapons) are *sidegrades
  with traits*, never raw stat spikes. Their cost is the time and risk you spent
  *not* doing something else.
- **Ticks stay honest.** New skill loops earn progression only on DC13+ stakes rolls,
  same as everything else ([economy.json](drift/content/economy.json)).
- **Cheapest-model-first.** Systems must be legible to a cheap narrator model from
  compact state; no system should require large prompts to run.

---

## 2. Exploration — the fourth path

Today the recognized biases are commerce / combat / intrigue / piloting / diplomacy
(`Character.bias`). **Exploration** becomes a first-class way to play, alongside
combat and trade, embodied by the **Reclaimers** faction and staged in **the Shear**.

### 2.1 What already exists to build on
- **The Reclaimers** — salvage-tech faction; canon suspicion that "the Shear wrecks
  aren't all accidents" ([seedData.ts](drift/scripts/seedData.ts)).
- **The Shear** — a lethal debris field (`loc-shear`) and the raider **Nest**
  (`loc-nest`) hidden inside it.
- **Kesh** — an NPC already holding "proof a colony ship's accident was decades-old
  sabotage," undecided what to do with it. A ready questline seed.
- **The skill kit** — navigation, electronics, mechanics, zeroG, survival, perception
  form a discovery loop distinct from gunnery/negotiation.

### 2.2 The discovery loop
A wreck site is a short, self-contained scene chain:

1. **Find it** — navigation / shipSensors / perception in a hazard region. Rolls gate
   *how much* you find and *whether you're noticed*.
2. **Reach it** — the Shear is deadly; piloting / zeroG under environmental threat.
   Failure has real teeth (this is the risk that balances the reward).
3. **Work it** — mechanics / electronics to extract hardware; survival to last.
   Yields **salvage** (raw value) and, rarely, an **artifact** (§3) or a **lore
   fragment** (advances the meta-mystery).
4. **Get out** — wrecks are contested: the **Wreckers** nest there, the **Reclaimers**
   work there, and whoever *sank* the ship may not want it found.

### 2.3 Wreck sites — how they exist
Open design question (see §6), but the intended shape: a small pool of **hand-seeded
signature wrecks** (tied to canon, e.g. Kesh's colony ship) plus **procedurally
flagged sites** the narrator can spin up in hazard regions on an exploration roll.
Signature wrecks carry the story; procedural ones carry the economy.

### 2.4 Risk/reward framing
Exploration trades **certainty for upside**: a trade run pays reliably; a Shear dive
might pay nothing, cost the hull, or surface a game-changing artifact. That variance
*is* the identity of the path — and the reason the other paths want what explorers
bring back.

---

## 3. Artifacts — the dual-use object

An **artifact** is unidentified salvage with a hidden nature and a short refinement
questline. It is the **wedge** that ties all three systems together: exploration
produces it, a questline shapes it, and spending it ripples across paths.

### 3.1 The refinement questline
```
  Recover (exploration)
      │
      ▼
  Identify   — electronics / research + a Reclaimers or Ledger contact
      │        (reveals the artifact's nature and its branch options)
      ▼
  Source     — rare parts OR lost knowledge:
      │        a TRADE leg (buy/route the components) or a FACTION favor
      ▼
  Restore    — mechanics; the artifact becomes usable
      │
      ▼
  BRANCH — the player chooses one payoff:
```
- **Weaponize** → a unique weapon **mod** — a sidegrade with a *trait*, bound to the
  existing scale (kinetic/energy/missile/ion, see [weapons.json](drift/content/weapons.json)).
  Example: an ion-derived "system-killer" round — situationally brutal (strips a
  system) but weak vs bare hull. **Not** a damage spike.
- **Sell** → a high-value **commodity** anchoring a trading run — but off-loading a
  hot artifact emits a `world_event` that makes an enemy of whoever buried it.
- **Leverage** → a **lore key** that advances the "wrecks aren't accidents" meta-arc
  and/or buys standing with a faction that wants it (or wants it silenced).

**Same object, three payoffs by path.** That's what makes an explorer's find matter
to a trader, a fighter, and an intriguer — they all want it for different reasons.

### 3.2 Data model sketch
A new item class (extends the existing `gear` idea; artifacts are inventory items
with a lifecycle). Rough shape, to be finalized against `shared/schemas.ts`:

```ts
Artifact = {
  id, campaignId,
  name,                       // "Corroded ion lattice"
  originWreckId?,             // provenance — who sank it matters
  buriedByFactionId?,         // the enemy you make by surfacing it
  stage: "unidentified" | "identified" | "sourced" | "restored" | "spent",
  nature?: "weapon" | "commodity" | "lorekey",   // revealed at Identify
  // branch outcomes, resolved at Restore:
  weaponMod?: { scale: "ion"|"kinetic"|"energy"|"missile", trait, damage },
  commodityValue?: number,    // ¢ if sold
  loreRef?: string,           // thread/world_event it unlocks
}
```
The **engine** owns stage transitions and the weapon-mod stat block (so balance is
enforced in code); the **narrator** only calls tools to advance the questline and
narrates outcomes.

### 3.3 Balance rules (non-negotiable)
- A weapon artifact is a **trait sidegrade**, never a flat +damage. It must fit inside
  the published scale bands so no artifact out-scales a bought weapon of its class.
- The artifact's power is **paid for in opportunity cost** — the scenes and risk spent
  recovering + refining it are scenes not spent earning ¢ or rep elsewhere.
- One **restored** artifact at a time (a soft cap), so the path is a through-line, not
  a stockpile.

---

## 4. The Cross-Path Consequence Web

The connective tissue: how an action on one path propagates to others — as **story**,
via clocks + rep + world_events, with **no visible meters**.

### 4.1 Pressure clocks (the mechanism)
Generalize the **Fault Line** pattern (the season clock built in
[newCampaign.ts](drift/lib/newCampaign.ts) / advanced in
[sceneEnd.ts](drift/engine/sceneEnd.ts)). The Fault Line is *time-driven and global*.
The new clocks are **action-driven and local** — attached to a faction or a route:

- **Route pressure** — e.g. a "fat target" clock on a lane. Rises when a path makes
  the lane richer or busier; at thresholds, spawns predation.
- **Faction strength/heat** — rises/falls as any path helps or harms a faction.

These are ordinary `Clock`s ([schemas.ts](drift/shared/schemas.ts)); the player never
sees the numbers. They exist so the narrator has a **deterministic reason** to make
the world react.

### 4.2 Propagation rules (worked examples)
Every significant act emits a `world_event` **and** ticks the relevant clock. The
narrator reads clock thresholds to introduce consequences — possibly in a *different*
path's scenes, even a different player's campaign (the shared-world vision).

| A player does… (path) | Ticks… | Other paths feel… |
|---|---|---|
| Saturates a lane with cheap cargo (**trade**) | that route's "fat target" clock | **pirates/Wreckers** get a lucrative target → **combat** players see new bounties there |
| Wipes a pirate crew (**combat**) | route-safety ↑, Wreckers strength ↓ | **trade** prices on that lane normalize; **Reclaimers** dive more freely |
| Strips a Shear wreck (**exploration**) | Reclaimers strength ↑; the burier-faction's hostility ↑ | **intrigue** players gain a lever; the burier hunts the artifact |
| Brokers a faction favor to Source an artifact (**diplomacy**) | that faction's debt-to-you ↑ | later calls on that debt reshape **everyone's** standing with them |

### 4.3 Why this respects "no strategy game"
There is no economy simulation and no win condition. Clocks are **narrative fuses**,
not scores; they exist only to give the LLM honest, consistent cause→effect. The
player experiences a world that remembers and reacts — the strategy-game feeling
without the strategy-game machinery.

---

## 5. How the three connect (the wedge)

```
   EXPLORATION ──produces──► ARTIFACT ──refined via──► TRADE / FACTION legs
        │                        │                          │
        │                   BRANCH: weapon / sell / leverage │
        ▼                        ▼                          ▼
   ticks route & faction  emits world_events         shifts faction rep
   pressure clocks  ─────────────► CROSS-PATH WEB ◄───────────┘
                         (other paths & players feel it)
```
Build the artifact vertical slice and you necessarily exercise all three systems at
once — which is why it's the recommended first prototype.

---

## 6. Open decisions (deferred — not yet chosen)

1. **Wreck sites:** fully hand-authored, fully procedural, or the hybrid in §2.3?
2. **Artifact scarcity:** how rare is a true artifact vs plain salvage? (Sets the
   whole path's tempo.)
3. **Pressure-clock authoring:** a fixed roster of route/faction clocks seeded per
   campaign, or created on demand when a route first "matters"?
4. **Cross-campaign propagation:** intra-campaign only for v1, or wire into the
   shared-world `world_events` corpus immediately? (Depends on Supabase persistence,
   which is the current critical path in STATUS.md.)
5. **Weapon-mod cap:** how many artifact mods can a ship carry, given the existing
   "one hardpoint" ship constraints?

---

## 7. Suggested build order

1. **Artifact vertical slice** (engine-first): `Artifact` schema + stage machine +
   the refine tools + one signature artifact (Kesh's colony-ship tech) that can branch
   into a weapon-mod *or* a commodity. Proves the loop end-to-end.
2. **Exploration loop**: wreck-site scenes + the discovery skill chain that yields
   salvage/artifacts/lore, staged in the Shear.
3. **Pressure clocks + propagation**: generalize the Fault Line into action-driven
   route/faction clocks; add the propagation rules to the narrator's toolset and
   prompt.
4. **Shared-world wiring**: once Supabase persistence lands, let these clocks +
   world_events cross campaigns so paths impact *other players'* worlds.

Each phase is independently valuable and testable; #1 is the wedge that makes the
rest concrete.
