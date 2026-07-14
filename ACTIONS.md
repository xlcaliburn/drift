# ACTIONS.md — Verb-Driven Action Resolution

*Status: **decisions locked, building.** Move skill-selection off the model and onto the engine.*

**Locked (2026-07-14):** add an **athletics** skill (might, hazard) for physical
feats; detect actions via a **structured `verb` field** on choices (not label
regex); the verb **overrides** whatever skill the model guessed.

---

## 1. The problem

DeepSeek picks the wrong skill and inconsistently attaches checks:

- "Move the fallen shelving to clear a path" → tagged **zeroG** (should be a
  strength feat, not zero-g movement).
- "Circle around the pool…" and "Pick up the data shard and examine it" got **no
  check** at all, when both plausibly want one.

The engine already OWNS the roll math — but the model still owns *which skill* and
*whether to roll*, and it's unreliable at both. The fix: give the model a small,
fixed **verb vocabulary**, and let the ENGINE map verb → skill → check. The model
picks a verb; it can no longer pick zeroG for lifting a shelf.

## 2. Design: an action-verb catalog the engine resolves

`content/actions.json` — a versioned verb table, each entry:

```jsonc
{ "verb": "force",   "aliases": ["move","shove","lift","haul","pry","break","smash","wrench"],
  "skill": "athletics", "defaultDc": 13, "hazard": true },
{ "verb": "examine", "aliases": ["inspect","study","read","scan","check"],
  "skill": "perception", "defaultDc": 12 },
{ "verb": "loot",    "aliases": ["search","scavenge","salvage","strip","rifle"],
  "skill": "scavenging", "defaultDc": 12 },
{ "verb": "sneak",   "aliases": ["slip","creep","tail","shadow"], "skill": "stealth", "defaultDc": 13 },
{ "verb": "climb",   "aliases": ["vault","scramble","scale","cross","clamber"],
  "skill": "athletics", "defaultDc": 13, "hazard": true },
{ "verb": "hack",    "aliases": ["slice","override","bypass","jack","splice"], "skill": "electronics", "defaultDc": 14 },
{ "verb": "repair",  "aliases": ["patch","fix","rig","jury-rig","weld"], "skill": "mechanics", "defaultDc": 13 },
{ "verb": "pilot",   "aliases": ["fly","dock","burn","evade","thread"], "skill": "piloting", "defaultDc": 13 },
{ "verb": "spacewalk","aliases": ["float","eva","drift","tether"], "skill": "zeroG", "defaultDc": 13, "hazard": true },
{ "verb": "plot",    "aliases": ["navigate","jump","chart"], "skill": "navigation", "defaultDc": 13 },
{ "verb": "persuade","aliases": ["convince","talk","charm","haggle","negotiate","reason"], "skill": "negotiation", "defaultDc": 13 },
{ "verb": "lie",     "aliases": ["bluff","con","deceive","disguise","feign"], "skill": "deception", "defaultDc": 13 },
{ "verb": "threaten","aliases": ["intimidate","menace","press","strong-arm"], "skill": "intimidation", "defaultDc": 13 },
{ "verb": "endure",  "aliases": ["survive","forage","brace"], "skill": "survival", "defaultDc": 13, "hazard": true },
{ "verb": "attack",  "aliases": ["shoot","fire","gun","draw on","open fire","strike"], "combat": true }
```

### The one new skill: `athletics` (might-governed)

Physical feats — force a door, lift wreckage, climb, vault — have **no home skill
today** (melee is combat-only). Add `athletics` (attribute: might, hazard: true).
This is the piece the current 16 skills are missing, and the "move the shelving"
bug is the symptom.

## 3. Resolution (engine-owned, regex)

The model is fed the verb list and told: **an attemptable option's label STARTS
with one of these verbs.** Then, when the engine finalises choices (and when it
resolves a freely-typed action):

1. Regex the leading word of the label/text against the verb+alias table.
2. On a match → look up `{skill, defaultDc, hazard, combat}`.
   - `combat: true` (attack/shoot) → this is a fight: route to combatStart, not a check.
   - otherwise → attach `check: { skill, dc, stakes: true }`, **skill from the verb
     (overriding any skill the model guessed)**. DC = the model's dc if it gave one
     (its difficulty judgement is kept), else the verb's `defaultDc`. `hazard`
     drives failure damage (a failed climb can hurt; a failed examine can't).
3. No verb match → no check (it's dialogue/navigation: "Wait", "Agree", "Head to Rook").

Net effect: skill selection becomes deterministic and correct, and any verb-led
option is guaranteed a check — which also satisfies "always at least one check"
structurally (the enforce-check retry becomes a rare fallback, not the norm).

## 4. What the model still owns

- **Phrasing** — natural, vivid labels that happen to start with a verb.
- **Difficulty** — an optional `dc` (or easy/normal/hard) per option; the engine
  keeps it, only the skill is overridden.
- **Which options to offer** and the narration. Everything mechanical is engine.

## 5. Integration points

- `content/actions.json` + `resolveVerb(label)` selector in `shared/actions.ts`.
- `skills.json`: add `athletics`.
- Choice finalisation (jsonTurn/route): run `resolveVerb` over each choice label,
  attach/override the check; over the typed `playerText` for the current action.
- Prompt: replace the "pick the skill by what the action is" guidance with "lead
  each attemptable option with one of these VERBS" + the fed verb list. Shrinks the
  prompt (the engine no longer needs the skill-disambiguation lecture).
- The existing free `check.skill` stays valid as an escape hatch for the rare
  action no verb covers; the verb override just wins when a verb is present.

## 6. Build order

1. Add `athletics` skill + `actions.json` + `resolveVerb`.
2. Wire `resolveVerb` into choice + typed-action finalisation (override skill,
   attach check, route combat verbs).
3. Swap the prompt to verb-led labels; feed the verb list.
4. Retire most of the skill-picking prose once verbs prove reliable.

## ⚠ Flags

- **A-1 label discipline.** Regex needs the verb at (or near) the FRONT. If the
  model buries it ("Quietly, you could slip past…"), the match misses. Mitigation:
  the prompt example + a light normaliser that also scans the first ~3 words, not
  only word 1.
- **A-2 ambiguous verbs.** "check" = examine or… a poker tell? "cross" = climb or
  just walk? Keep the alias list tight and skew safe (unmatched = no check rather
  than a wrong one).
- **A-3 difficulty still model-set.** DC quality depends on the model's judgement
  (or the flat default). Fine — that's a number, not a skill; a wrong DC is a
  smaller error than a wrong skill, and defaults are safe.
- **A-4 double-gating with combat.** `attack`/`shoot` verbs must route to
  combatStart (engine-run), not a self-check — reuse the existing smallArms/gunnery
  reroute so there's one combat entry path.
