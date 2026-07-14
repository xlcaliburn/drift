# ACTIONS.md — Verb-Driven Action Resolution

*Status: **shipped.** Skill selection lives on the engine, not the model. This is
a reference for the verb vocabulary — no remaining work.*

---

## What it does

The model picks a **verb** for each attemptable option; the **engine** maps
verb → skill → check. The model can no longer pick the wrong skill (e.g. zeroG
for lifting a shelf) or silently skip a roll — any verb-led option is guaranteed
a check, and the skill is taken from the verb, overriding whatever the model
guessed. DC stays the model's judgement (or the verb default); `hazard` drives
failure damage.

- Catalog: `ACTION_VERBS` + `FREE_VERBS` (`content/actions.json` / `shared/actions.ts`).
- Selectors: `checkFromVerb` (verb → skill + DC), `verbFromLabel` inference,
  `verbRolls`.
- Skills added for this: **athletics** (might, hazard — physical feats: force a
  door, lift wreckage, climb, vault) and **scavenging** (loot/search/salvage).
- `attack`/`shoot`/`fire` verbs route to `combatStart` (the combat engine), not a
  self-check — one combat entry path, shared with the smallArms/gunnery reroute.
- No verb match → no check (dialogue/navigation: "Wait", "Agree", "Head to Rook").
- The chip badge is the contract: a clicked checkless choice never gets a
  surprise roll.

## Verb → skill map (current vocabulary)

| Verb | Skill | Notes |
|---|---|---|
| force / move / lift / pry / break | athletics | hazard |
| climb / vault / scramble / scale | athletics | hazard |
| examine / inspect / study / scan | perception | |
| loot / search / scavenge / salvage | scavenging | |
| sneak / slip / creep / tail | stealth | |
| hack / slice / override / bypass | electronics | |
| repair / patch / fix / rig / weld | mechanics | |
| pilot / fly / dock / evade | piloting | |
| spacewalk / eva / float / tether | zeroG | hazard |
| plot / navigate / jump / chart | navigation | |
| persuade / convince / haggle / negotiate | negotiation | |
| lie / bluff / con / deceive | deception | |
| threaten / intimidate / menace | intimidation | |
| endure / survive / forage / brace | survival | hazard |
| attack / shoot / fire / open fire | — | routes to combat, not a check |

The free `check.skill` field stays valid as an escape hatch for the rare action
no verb covers; the verb override wins when a verb is present.
