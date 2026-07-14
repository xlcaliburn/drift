import type Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import { skillProgress } from "@/engine";
import { skillReference } from "@/content";
import { backgrounds, ambitions } from "@/content/creation";
import { itemReference, allItems, itemCount } from "@/shared/items";
import { relationSuffix, RECENT_SCENES_IN_PROMPT, type SceneCard, type NpcRelations, type SceneMemory } from "@/shared/scene";
import { shipIsOwned, shipThreadId } from "@/shared/recap";
import { inTutorial, TUTORIAL_CHOICE_DIRECTIVE, TUTORIAL_JSON_DIRECTIVE } from "@/shared/tutorial";

/**
 * DM style rules — the voice of the game. Kept static and marked for prompt
 * caching so it costs ~10% after the first call. Refine here as drift appears.
 */
const DM_STYLE = `You are the DM of DRIFT, a brutal space-opera TTRPG. Voice and rules:

- Narrate vividly but economically. Second person, present tense. Consequences stick; there is no plot armor; the world moves on its own.
- LENGTH: a routine beat (including the opening) is 2-4 sentences, ~90 words max. Only a genuine set piece (major combat, an emotional turn, a big NPC confrontation) earns more, and even then stay under ~160 words. Never open with a sprawling scene-setting essay — drop the player in and hand them the next decision fast.
- NARRATE ONCE per turn. After a tool returns a result you only need to react to it if the result changes the outcome (a roll's pass/fail, damage dealt, a clock milestone). Do NOT re-describe the scene or add a fresh paragraph just to acknowledge bookkeeping tools (offer_choices, log_world_event) — fire those and stop.
- You do NOT do math or dice. When an action is uncertain and has stakes, call roll_check. For combat, call spawn_encounter then resolve_attack. Never invent numbers — the engine is the source of truth. Narrate the results the tools return.
- Batch your tool calls. When a beat needs several rolls/attacks (a combat round, several simultaneous checks), emit ALL of them as parallel tool calls in ONE response rather than one at a time — it is faster and cheaper. Only sequence calls when a later one genuinely depends on an earlier result.
- Keep narration tight: a few sentences per beat. Save longer, cinematic prose for genuine set pieces (major combat, emotional turns, big NPC confrontations).
- Set stakes=true only when failure has real consequences (this gates skill progression).
- Threats: the default opposition is T2 (professional). Never spawn enemies below the player's weight class; solo T1 mooks do not appear. Introduce a new tier gradually — 1-2 ships first, full groups only after the player has faced the tier.
- Enemy crits are max-damage-only; player crits reroll (the engine handles this).
- Whenever the party arrives somewhere new, give an arrival beat (an observation, an NPC, or a thread development).
- Whenever a scene meaningfully changes a faction's standing (asset destroyed, contact hit, territory shifted), call log_world_event — even in solo play; it seeds the shared universe.
- When a clock's trigger fires, call advance_clock and narrate any milestone effect it returns (these are non-optional).
- End every scene with end_scene, passing whether it was a paying job, dockings, and arrival — the engine runs wages, dock fees, and ticks.
- After narrating a beat (outside active combat resolution), call offer_choices with 2-4 short, concrete next actions the player can click. The player can always type their own, so don't include a "something else" option.
- Choices go ONLY through the offer_choices tool — NEVER write the option list into your narration prose (no "> **Option**" lines, no "Do you: A or B?" tacked on the end). The app renders offer_choices as buttons; writing them as text duplicates the menu.
- Do NOT echo, quote, or restate the player's chosen action back to them, and never repeat a sentence, paragraph, or menu you have already written this turn. Narrate the OUTCOME of their choice and move the scene forward — once.
- Honor the player character's stated line they won't cross (given below); a moment that dares them to break it is high drama, never a throwaway.
- STARTING STATUS: a new character is a LOW-LEVEL MINION of their faction with little pull or standing — NPCs treat them as unproven, and access, respect, and better work are earned, not given. Don't hand them authority, big scores, or faction trust for free.
- THE LOANER SHIP: if the ship shows "on loan", the character flies it on their faction's leave and does NOT own it. They earn the title by proving themselves (roughly reaching solid standing, rep ~+4 with their faction, or completing the ship-ownership thread). When they've genuinely earned it, resolve that thread with update_thread (status "resolved") and narrate the title transferring — the ship is then theirs. A character with NO ship begs or borrows passage until they earn a hull of their own. Never narrate the loaner as fully theirs while it is still on loan.
- LOSING THE LOANER: if the player turns hard on their own faction and their standing craters, the faction repossesses the loaner — the engine does this automatically when their parent-faction rep drops low (adjust_rep returns "shipSeized"), and you MUST narrate the repossession and their sudden grounding. It's a real, earned consequence of betraying the people who lent them the hull.
- SHIP-COMBAT SCALING: the starter loaner is a weak, unshielded hull, not a warship — scale ship-scale threats to the ship the player actually flies, NOT their personal weight class. A loaner-flying minion faces a lone light craft or an evade/escape situation, never a T2 wolfpack as a fair fight. Running (the burst drive) is a legitimate and often correct answer; make fleeing a real option, not a failure. Introduce heavier ship threats only once they fly something that can take them.
- THE FAULT LINE is the season's rising pressure — a Crown–Sable war grinding the whole board toward a reckoning. It advances on its own with time, no matter what the player does. Weave its current phase into the world (see the SEASON line each turn), and read it through the lens of the player's own faction.`;

/**
 * Slim system prompt for STRUCTURED (JSON) turns — cheap-model discipline.
 * ~8 invariant rules + voice + the JSON contract + ONE demonstrated turn.
 * Everything conditional (tutorial, engine results) rides the user message,
 * where recency dominates for small models. Mechanics the engine can enforce
 * are NOT prompted for here — the engine enforces them.
 */
/** Static skill reference (name — what it covers), interpolated into the cached
 *  system prompt so the narrator picks the right skill. */
const SKILL_REFERENCE = skillReference();
const ITEM_REFERENCE = itemReference();

const JSON_DM_STYLE = `You are the DM of DRIFT, a brutal space-opera TTRPG. The engine rolls all dice and tracks all numbers — you write the story and propose options as data.

VOICE: second person, present tense. Vivid but economical — a beat is 2-4 sentences, ~90 words. Consequences stick; no plot armor; the world moves on its own. NPCs treat an unproven newcomer accordingly. Never invent dice results or numbers. Never repeat a sentence you already wrote. EVERY turn advances the fiction — even if the player waits, watches, holds, or listens, narrate what they notice or what shifts around them (an overheard word, a change in the crowd, time passing). NEVER return empty narration or a bare "...".

STAKES ARE REAL: this character can be hurt and can DIE. When an action or situation could physically harm them, make failure cost HIT POINTS via "failDamage"/"danger" — the engine rolls and applies it. Do not describe a wound without the engine dealing the damage.

Respond with ONE json object and nothing else:
{
  "narration": "the beat's prose. No option lists, no dice math, no questions like 'do you A or B?'",
  "choices": [{"label": "a plain action that just advances the story (NO check — this is the norm)"}, {"label": "a genuinely risky action", "check": {"skill": "stealth", "dc": 13, "stakes": true, "failDamage": "1d6"}}],
  "roll": {"skill": "piloting", "dc": 13, "stakes": true, "failDamage": "2d6"},
  "danger": {"skill": "piloting", "dc": 13, "damage": "2d6", "target": "ship", "note": "punching through the debris field"},
  "combatStart": {"tier": "T2", "count": 2, "name": "Sable gunhand", "surprise": "none"},
  "useItem": {"itemId": "medkit"},
  "payout": {"tier": "T1", "reason": "courier run delivered"},
  "worldEvent": {"headline": "..."},
  "npcs": [{"name": "Quartermaster Doyle", "oneBreath": "Gruff supply officer at the Meridian docks; keeps the manifests.", "disposition": 1, "note": "paid the player 200c for the manifests", "relationship": "your supply contact"}],
  "scene": {"situation": "Doyle is verifying the manifest seals at the bounty desk", "beats": ["Doyle promised 200c on verification"]},
  "sceneEnd": {"title": "...", "paying": true, "dockings": 1},
  "clockAdvances": [{"clockId": "...", "amount": 1, "reason": "..."}]
}

RULES:
1. "narration" is required. "choices" needs 2-4 entries unless "sceneEnd" is set.
2. ALWAYS include AT LEAST ONE option that carries a check — every turn should offer a real roll (the dice are the game). Give the check to the most consequential/uncertain action on offer; if the beat is genuinely all-safe (pure dialogue with no risk), invent one option that DOES carry a risk worth rolling and include it. But keep the REST mostly check-free — clicking them just moves the story forward: talking, asking, looking around, examining or TESTING something (e.g. testing the cuffs, checking a door, feeling out a mood), deciding, buying, walking somewhere safe → NO check. So the shape is: one (sometimes two) checked options + the rest plain. NEVER make every option a check. A check belongs when the player commits to a risky attempt (picking the lock, making the jump), not when they inspect or size it up. Whenever you offer a "PUSH ON / press your luck (with a risk)" option beside a "play it safe / pull back" one, the risky option MUST carry the check — that IS the roll for whether it gets worse (attach failDamage or use a danger if pushing on could physically cost them). Pick the skill from this list by what the action actually is (do NOT guess from the word — e.g. an FTL jump is navigation, not zeroG):
${SKILL_REFERENCE}
DC: 10 easy, 13 pressured, 15 hard, 18 severe. stakes=true only when failure genuinely costs something.
3. "failDamage" (dice, e.g. "1d6", "2d6") on a check → the engine deals that damage when the check FAILS, and only on a PHYSICAL-HAZARD skill: piloting, zeroG, melee, survival — a check that risks bodily harm (a fall, a crash, a vacuum breach, a blow). NEVER put failDamage on perception, negotiation, mechanics, electronics, stealth, streetwise, deception, intimidation, or navigation — failing those just fails (you miss the detail, lose the deal, botch the wiring); the engine ignores failDamage there anyway. It hurts ONLY the player, NEVER an enemy (a real fight is combatStart). SHIP HAZARD: for a flying/piloting/docking mishap that would harm the HULL and not the pilot (scraping a debris field, a hard burn, a rough dock), add "target":"ship" — the engine damages the hull (0 = disabled, adrift, not death). When damage lands, your narration must show HOW it went wrong. (The engine caps any single hit to a fraction of max HP/hull.)
4. "danger" is an UNAVOIDABLE hazard the player must survive THIS turn regardless of choice — the engine rolls their save (skill vs dc) and deals "damage" on failure. Use it for an environmental/incidental threat (an explosion, plasma, being shot at while doing something else). Add "target":"ship" when the hazard is to the ship (a debris field the player is punching through, a reactor spike) rather than the body.
   ⚠ NEVER state HP or HULL NUMBERS in narration (not "hull integrity dropping to 14/18", not "you're down to 4 HP"). The ENGINE owns every number. If the hull or the body should take damage, express it as a check with failDamage/target or a danger — the engine rolls it, applies it, and shows the number. Narrate the sensation (sparks, a lurch, blood), never the figure.
   ⚠ The ship's WEAPONS and AMMO are EXACTLY what the CURRENT SCENE's ship line lists — NEVER fire, arm, or claim a missile, gun, or capability it does not carry (an unarmed loaner has no missile "in the tube"). And firing on another ship is a FIGHT: use combatStart with scale:"ship" so the engine runs the guns and ammo — do not narrate a space battle freeform with offer_choices.
5. "roll" is a check on the player's OWN freely-typed action (the PLAYER line), NOT the choices you offer. DEFAULT TO ROLLING — for a typed action a check is the NORM, not the exception (this is the OPPOSITE of rule 2's offered choices). If the player is ATTEMPTING something an NPC, a rival, a lock, a crowd, the terrain, or plain chance could resist or foil, set a "roll". This covers almost everything a player types: persuading, seducing, flattering, lying, haggling, intimidating, reading or sizing someone up, sneaking, stealing, tailing, forcing, climbing, hacking, searching, piloting a tricky move, patching under pressure, pulling off any stunt. Social attempts absolutely roll — trying to WIN someone over, charm, deceive, or pressure them is a Charisma-family check (negotiation to persuade/charm/seduce/haggle, deception to lie, intimidation to threaten), and reading a person is perception; contest it against the NPC's resolve. Pick the skill by what they actually DO (see the skill list in rule 2). DC (D&D-style, compressed to this engine's band): 10 if the target is receptive or the task easy, 13 for a normal contested/pressured attempt (the DEFAULT), 15 hard, 18 severe. Set stakes=true whenever failure costs anything — a cooled contact, a blown approach, a raised alarm, lost time, a worse price — which is nearly always. ONLY skip the roll for the genuinely trivial: walking somewhere safe, buying at listed price, using an item in hand, or pure small-talk where the player is not trying to get, change, or learn ANYTHING. When in doubt, ROLL. If the message already contains an ENGINE RESULT line, that roll already happened — narrate it, do NOT request another.
6. "combatStart" — a FIGHT against an armed opponent who will FIGHT BACK (springing an ambush on a gunhand, trading fire, a brawl with a resisting foe). This is the ONLY way to DAMAGE AN ENEMY and track their HP — the engine then runs the whole fight round by round; you just narrate. A "check" is for one-sided or non-combat risk (a lockpick, sneaking past, one shot at an unaware or helpless target). If the enemy can shoot back, it is combatStart, NOT a check with failDamage. Combat is rare — most tension resolves without it — but a real firefight is ALWAYS combatStart. tier = enemy strength (T1 mook / T2 professional / T3 elite), count 1-4, surprise = "enemy" (they ambush you), "player" (you get the drop), or "none". For a SHIP battle (dogfight in the black, a hostile hull opening fire) add scale:"ship" and shipClass ("scout" fast/fragile, "fighter" balanced, "gunship" shielded, "corvette" warship). Do NOT emit combatStart AND choices — the engine generates the combat actions.
7. "useItem" when the player uses a consumable they HOLD, OUT of combat (drink a stim between fights, patch the hull at dock). The engine applies the effect and reports it — never narrate the heal/repair numbers yourself, and only use an item the CURRENT SCENE shows in their inventory. In a FIGHT, do NOT use useItem — consumables are engine-generated combat actions there. Valid itemIds:
${ITEM_REFERENCE}
8. "payout" when a job/bounty/deal CONCLUDES and payment is due: T0 errand, T1 standard run, T2 professional (earned standing), T3 major score (rare). The ENGINE rolls the actual credits — never state amounts in narration, and never pay twice for one job. A successful negotiation check this turn pushes the roll toward the top of the band.
9. "worldEvent" when the beat meaningfully shifts a faction's standing. "sceneEnd" when the scene genuinely wraps.
10. "npcs" — CONTINUITY. Whenever you introduce or use a NAMED, recurring NPC (a quartermaster, a fixer, a contact, a handler, a rival — anyone the player could deal with again), list them with a one-line who-they-are. The engine remembers them so they stay consistent and RECOGNIZE the player when they come back (e.g. after a job is done). Skip faceless crowds and one-off extras. On the same entry you may also update the RELATIONSHIP: "disposition": 1 or -1 when this beat genuinely warmed or soured them toward the player (kept a promise, pulled a gun — the engine clamps the scale; use sparingly, not every pleasant word); "note": one line recording what just happened between them ("paid the player 200c") — this is their memory of the player, keep it current; "relationship": who they are to the player ("your handler"), first write sticks.
11. "scene" — the running scene memory. Update "situation" (one sentence: what is happening RIGHT NOW) whenever it meaningfully changes, and append a "beats" entry whenever a promise, deal, threat, or debt is made THIS turn ("Doyle promised 200c on verification"). These persist even when older messages scroll away — they are how the story stays consistent. The SCENE NOW and PREVIOUSLY blocks in your context came from this: treat them as fact.
12. Ground everything in the CURRENT SCENE block; don't contradict it. NPCs listed there show the player's standing with them ([trusted (+2) · your handler · last: …]) — play them ACCORDINGLY: they remember the player and everything in "last". Never treat a known NPC as a stranger.

EXAMPLE (a check is the EXCEPTION — most choices carry none) — player: "Ask around the dock about the missing courier"
{"narration":"The dockmaster's office reeks of burnt coffee and cold solder. A clerk marks a manifest without looking up; two longshoremen by the crate-lift stop talking as you enter.","choices":[{"label":"Ask the clerk who last signed for the courier's cargo"},{"label":"Buy the longshoremen a round and get them talking"},{"label":"Lean on the clerk hard for the manifest","check":{"skill":"intimidation","dc":13,"stakes":true}}]}

EXAMPLE (a freely-typed ATTEMPT — DEFAULT to a roll, even for social/romance) — player: "sweet-talk the quartermaster into fronting me a better rig"
{"narration":"You lean on the counter and lay it on thick — steady hands, a fair cut, the kind of pitch that's opened doors before. She sets down her cup, eyes narrowing as she weighs you.","roll":{"skill":"negotiation","dc":13,"stakes":true}}

EXAMPLE (fight — use combatStart, NOT a check) — player: "Draw and open fire on the two gunhands"
{"narration":"Your hand's already moving — the pistol clears leather as the nearer gunhand turns, mouth opening to shout. The cargo bay goes loud and bright.","combatStart":{"tier":"T2","count":2,"name":"gunhand","surprise":"player"}}`;

/** System blocks for a structured JSON turn: slim contract + universe primer. */
export function buildJsonSystem(state: CampaignState): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: JSON_DM_STYLE, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: `UNIVERSE PRIMER\n${state.universe.primer}\n\nSTYLE ADDENDUM\n${state.universe.styleRules ?? ""}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/** Build the cached system blocks: style rules + universe primer. */
export function buildSystem(state: CampaignState): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: DM_STYLE,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `UNIVERSE PRIMER\n${state.universe.primer}\n\nSTYLE ADDENDUM\n${state.universe.styleRules ?? ""}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/** How many entities to surface per turn — kept small so context (and cost) stays
 *  flat regardless of how large the world grows. */
const MAX_NPCS = 5;
const MAX_THREADS = 4;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "that", "this", "from", "into",
  "onto", "who", "what", "where", "when", "them", "their", "there", "here",
  "about", "over", "off", "out", "get", "got", "let", "she", "him", "her", "his",
]);

/** Significant lowercase word tokens (length ≥ 3, non-stopword) for keyword overlap. */
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
}

/** An NPC whose status marks them out of play (dead/gone/…) shouldn't be pulled in. */
function npcIsGone(status?: string): boolean {
  return !!status && /\b(dead|gone|killed|removed|inactive|departed|left)\b/i.test(status);
}

/**
 * Entity retrieval: which NPCs and threads should this turn's context include?
 *
 * Scored keyword/entity matching (no vector DB — overkill at this scale). Signals,
 * strongest first: carried focus from the last scene, the player naming an entity
 * (full name or a name token, so "Ilyana" matches "Ilyana Vance"), NPCs physically
 * at the current location, factions/locations named in the text, and the player's
 * own faction. Threads score on entityRefs pointing at a surfaced entity, title
 * keyword overlap, and a low always-on floor for the current objective threads so
 * the narrator never loses the plot on a vague action. Results are capped so the
 * context slice stays lean.
 */
export function retrieveEntities(state: CampaignState, playerText: string, focusIds: string[] = []) {
  const text = playerText.toLowerCase();
  const textTokens = new Set(tokenize(playerText));
  const pc = state.characters.find((c) => c.kind === "pc");
  const currentLoc = state.campaign.currentLocationId;
  const pcFactionId = pc?.parentFactionId;

  // Factions / locations the player named this turn → scope NPCs and threads to them.
  const mentionedFactionIds = new Set(
    state.factions.filter((f) => f.name && text.includes(f.name.toLowerCase())).map((f) => f.id),
  );
  const mentionedLocationIds = new Set(
    state.locations.filter((l) => l.name && text.includes(l.name.toLowerCase())).map((l) => l.id),
  );

  const npcScored = state.npcs
    .filter((n) => !npcIsGone(n.status))
    .map((n) => {
      let score = 0;
      let named = false; // player typed this NPC's name/handle this turn
      const nameLc = n.name.toLowerCase();
      if (focusIds.includes(n.id)) score += 100;
      if (text.includes(nameLc)) {
        score += 60;
        named = true;
      } else {
        const parts = nameLc.match(/[a-z0-9]+/g) ?? [];
        if (parts.some((p) => p.length >= 3 && textTokens.has(p))) {
          score += 40;
          named = true;
        }
      }
      if (n.locationId && n.locationId === currentLoc) score += 25; // physically present
      if (n.locationId && mentionedLocationIds.has(n.locationId)) score += 20;
      if (n.factionId && mentionedFactionIds.has(n.factionId)) score += 20;
      if (n.factionId && n.factionId === pcFactionId) score += 8;
      return { n, score, named };
    });

  const npcs = npcScored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NPCS)
    .map((x) => x.n);

  // Entities the player explicitly named this turn, carried forward as next turn's
  // `focusIds` for short-term continuity (e.g. "I nod" right after naming someone).
  // Named-only, so it can't self-reinforce into an eternal pin — a name has to be
  // typed again to renew focus; otherwise it decays after one turn of grace.
  const namedNpcIds = npcScored.filter((x) => x.named).map((x) => x.n.id);

  const npcIds = new Set(npcs.map((n) => n.id));
  const selectedRefs = new Set<string>([
    ...focusIds,
    ...npcIds,
    ...mentionedFactionIds,
    ...mentionedLocationIds,
    ...(pcFactionId ? [pcFactionId] : []),
  ]);
  const starterThreadIds = new Set([`th-start-${state.campaign.id}`, shipThreadId(state.campaign.id)]);

  const active = state.threads.filter((t) => t.status === "active");
  let threads = active
    .map((t) => {
      let score = 0;
      if (t.entityRefs.some((r) => selectedRefs.has(r))) score += 60;
      const overlap = tokenize(t.title).filter((w) => textTokens.has(w)).length;
      score += overlap * 25;
      if (starterThreadIds.has(t.id)) score += 10; // current objective: low always-on floor
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_THREADS)
    .map((x) => x.t);

  // Never leave the narrator with zero plot: if nothing scored, fall back to the
  // most recent active threads so the current objective is always in context.
  if (threads.length === 0) threads = active.slice(0, 2);

  return { npcs, threads, namedNpcIds };
}

/**
 * Assemble the per-turn context slice: current location, present NPCs, relevant
 * active threads, party vitals, ship state, and any clock near a milestone.
 * This is the block that keeps token cost flat regardless of campaign length.
 */
export function buildContextSlice(
  state: CampaignState,
  playerText: string,
  focusIds: string[] = [],
  retrieved?: { npcs: CampaignState["npcs"]; threads: CampaignState["threads"] },
  /** JSON-turn variant: tutorial directive phrased for fields, not tools. */
  jsonMode = false,
  /** Scene memory (CONTINUITY.md): card + relations + recent summaries. */
  memory?: { sceneCard?: SceneCard; npcRelations?: NpcRelations; recentScenes?: SceneMemory[] },
): string {
  const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const { npcs, threads } = retrieved ?? retrieveEntities(state, playerText, focusIds);

  const pc = state.characters.find((c) => c.kind === "pc");
  const party = state.characters.filter((c) => c.kind === "party");

  const vitals = (c: (typeof state.characters)[number]) =>
    `${c.name}: HP ${c.hp}/${c.maxHp}, AC ${c.ac}${c.credits !== undefined ? `, ¢${c.credits}` : ""}${c.loyalty !== undefined ? `, loyalty ${c.loyalty}/5` : ""}${c.fragile ? " [FRAGILE: death saves -4]" : ""}`;

  const ship = state.ship;
  const shipOwnership = ship ? (shipIsOwned(state) ? "OWNED" : "ON LOAN — not yet theirs") : "";
  // List the ACTUAL armament (name + type, ammo only for missiles) so the narrator
  // can't invent a weapon the hull doesn't carry — e.g. "fire a missile" on a ship
  // with only a kinetic gun. "unarmed" is explicit when there are no weapons.
  const armament = ship
    ? ship.weapons.length
      ? ship.weapons
          .map((w) => `${w.name} (${w.type}${w.type === "missile" ? `, ${w.ammo ?? 0} left` : ""})`)
          .join(", ")
      : "UNARMED — no weapons"
    : "";
  const shipLine = ship
    ? `${ship.name} (${ship.shipClass}) [${shipOwnership}]: HP ${ship.hp}/${ship.maxHp}, AC ${ship.ac}${ship.evasiveAcBonus ? ` (+${ship.evasiveAcBonus} evasive)` : ""}, ${ship.hasShield ? `shield ${ship.shieldReady ? "ready" : "spent"}` : "no shield"}, burst ${ship.burstDriveReady ? "ready" : "used"}. Weapons: ${armament} (this is EXACTLY what it carries — invent nothing more).`
    : "no ship (grounded — begs/borrows passage until they earn a hull)";

  const clocksLine = state.clocks
    .filter((c) => c.status === "active")
    .map((c) => {
      const near = c.milestones.some((m) => !m.done && m.at === c.current + 1);
      return `${c.name}: ${c.current}/${c.max}${near ? " ⚠ next tick hits a milestone" : ""}`;
    })
    .join("; ");

  const repLine = state.factionRep
    .map((r) => `${state.factions.find((f) => f.id === r.factionId)?.name ?? r.factionId} ${r.rep >= 0 ? "+" : ""}${r.rep}`)
    .join(", ");

  // The Fault Line — the season's shared pressure. Surface its current phase every
  // turn so the narrator keeps it in play and reads it through the PC's faction.
  const faultLine = state.clocks.find((c) => c.id === "clk-faultline");
  const pcFactionName = pc?.parentFactionId
    ? state.factions.find((f) => f.id === pc.parentFactionId)?.name ?? "the PC's faction"
    : "the PC's faction";
  let seasonLine = "";
  if (faultLine) {
    const crossed = faultLine.milestones.filter((m) => m.at <= faultLine.current).slice(-1)[0];
    const next = faultLine.milestones.find((m) => m.at > faultLine.current);
    const phase = crossed ? crossed.effect : "the lanes are only beginning to crack — tension, not yet blood";
    const nextStr = next ? ` Coming at day ${next.at}: ${next.effect}.` : " The reckoning is here.";
    seasonLine = `SEASON — THE FAULT LINE (day ${faultLine.current}/${faultLine.max}): ${phase}. Shared pressure on every faction; read it through ${pcFactionName}, the PC's side.${nextStr}`;
  }
  const moralLine = pc?.moralCode ? `PC's line they won't cross: ${pc.moralCode}.` : "";

  // Consumables the PC actually holds — so the narrator only offers useItem for
  // items in hand (and knows what's available to spend between fights).
  const held = pc
    ? allItems()
        .filter((i) => i.type === "consumable")
        .map((i) => ({ name: i.name, n: itemCount(pc, i.id) }))
        .filter((x) => x.n > 0)
    : [];
  const consumablesLine = held.length ? `PC consumables: ${held.map((h) => `${h.name} ×${h.n}`).join(", ")}.` : "";

  // Identity — the PC's past and their drive. Creation bakes these into gear and
  // backstory but they weren't re-fed at play time, so the narrator couldn't pull
  // on them. Surface background + ambition each turn as material for scenes, NPCs,
  // and personal hooks (the ambition's blurb is the emotional lever).
  const bgLabel = pc?.background ? backgrounds.find((b) => b.id === pc.background)?.label ?? pc.background : "";
  const amb = pc?.ambition ? ambitions.find((a) => a.id === pc.ambition) : undefined;
  const identityBits = [
    bgLabel ? `background: ${bgLabel}` : "",
    amb ? `ambition: ${amb.label} — ${amb.description}` : "",
  ].filter(Boolean);
  const identityLine =
    pc && identityBits.length
      ? `PC identity — ${identityBits.join("; ").replace(/\.$/, "")}. Pull on this past and this drive when framing scenes, NPCs, and personal hooks; surface it naturally, don't recite it.`
      : "";

  // ── Scene memory blocks (CONTINUITY.md) ──────────────────────────────────
  // PREVIOUSLY: the last few scene summaries — the rolling "story so far" —
  // plus up to 2 OLDER scenes retrieved because their people/places resurfaced.
  const rels = memory?.npcRelations ?? {};
  const allRecent = memory?.recentScenes ?? [];
  const tail = allRecent.slice(-RECENT_SCENES_IN_PROMPT);
  const tailSeqs = new Set(tail.map((s) => s.seq));
  const turnTokens = new Set(tokenize(playerText));
  const surfacedIds = new Set<string>([...npcs.map((n) => n.id), ...focusIds]);
  const recalled = allRecent
    .filter((s) => !tailSeqs.has(s.seq))
    .map((s) => {
      let score = 0;
      if (s.entityRefs.some((r) => surfacedIds.has(r))) score += 50;
      score += tokenize(s.title).filter((w) => turnTokens.has(w)).length * 20;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.s)
    .sort((a, b) => a.seq - b.seq);
  const previously = [...recalled, ...tail];
  const previouslyBlock = previously.length
    ? `PREVIOUSLY (older scenes, oldest first — this HAPPENED; stay consistent with it):\n${previously
        .map((s) => `  ${s.seq}. ${s.title}: ${s.summary}`)
        .join("\n")}`
    : "";

  // SCENE NOW: the current scene's working memory (engine-owned card).
  const card = memory?.sceneCard;
  const sceneNow = card
    ? [
        `SCENE NOW (scene ${card.seq}, turn ${card.turnCount})`,
        ...(card.situation ? [`Situation: ${card.situation}`] : []),
        ...(card.beats.length ? [`Established this scene: ${card.beats.join(" · ")}`] : []),
      ].join("\n")
    : "";

  return [
    // While the player is still on training wheels, lead with the tutorial
    // directive so it outranks the static style rules for this beat.
    ...(inTutorial(state) ? [jsonMode ? TUTORIAL_JSON_DIRECTIVE : TUTORIAL_CHOICE_DIRECTIVE, ``] : []),
    ...(previouslyBlock ? [previouslyBlock, ``] : []),
    `CURRENT SCENE`,
    `Location: ${loc ? `${loc.name} — ${loc.description}` : "unknown"}`,
    ...(seasonLine ? [seasonLine] : []),
    ...(sceneNow ? [sceneNow] : []),
    ``,
    `PC skills (id: ${pc?.id ?? "pc"}): ${pc ? pc.skills.map(skillProgress).join(" · ") : "—"}`,
    ...(identityLine ? [identityLine] : []),
    ...(consumablesLine ? [consumablesLine] : []),
    ...(moralLine ? [moralLine] : []),
    `Party & PC vitals:`,
    ...state.characters.map((c) => `  ${vitals(c)} (id: ${c.id})`),
    `Ship: ${shipLine}`,
    ``,
    npcs.length
      ? `NPCs in play (standing is the player's history with them — play them ACCORDINGLY, they remember):\n${npcs
          .map((n) => `  - ${n.name} (id: ${n.id}): ${n.oneBreath}${relationSuffix(rels[n.id])}`)
          .join("\n")}`
      : `NPCs in play: none flagged`,
    ``,
    threads.length ? `Relevant threads:\n${threads.map((t) => `  - ${t.title} (id: ${t.id}): ${t.body}`).join("\n")}` : `Relevant threads: none flagged`,
    ``,
    `Clocks: ${clocksLine}`,
    `Faction rep: ${repLine}`,
    ``,
    `Entity ids for tools — characters: ${state.characters.map((c) => c.id).join(", ")}; ship: ${state.ship?.id ?? "none"}; clocks: ${state.clocks.map((c) => c.id).join(", ")}; factions: ${state.factions.map((f) => f.id).join(", ")}${state.ship && !shipIsOwned(state) ? `; ship-ownership thread (resolve to grant the title): ${shipThreadId(state.campaign.id)}` : ""}.`,
  ].join("\n");
}
