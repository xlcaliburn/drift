import type Anthropic from "@anthropic-ai/sdk";
import type { CampaignState } from "@/shared/schemas";
import { skillProgress } from "@/engine";
import { skills } from "@/content";
import { backgrounds, ambitions } from "@/content/creation";
import { itemReference, allItems, itemCount } from "@/shared/items";
import { verbReference, freeVerbReference } from "@/shared/actions";
import { relationSuffix, RECENT_SCENES_IN_PROMPT, type SceneCard, type NpcRelations, type SceneMemory } from "@/shared/scene";
import { generateQuirk } from "@/shared/npcFlavor";
import { shipIsOwned, shipThreadId } from "@/shared/recap";
import { inTutorial, TUTORIAL_CHOICE_DIRECTIVE, TUTORIAL_JSON_DIRECTIVE } from "@/shared/tutorial";
import type { Dossier } from "@/shared/multiplayer";

/**
 * DM style rules — the voice of the game. Kept static and marked for prompt
 * caching so it costs ~10% after the first call. Refine here as drift appears.
 */
const DM_STYLE = `You are the DM of DRIFT, a brutal space-opera TTRPG. Voice and rules:

- Narrate vividly but economically. Second person, present tense. Consequences stick; there is no plot armor; the world moves on its own.
- AUTHORITY — you own the world; the player owns only their character's ATTEMPTS. A player message states what they TRY, never what is TRUE. They cannot narrate outcomes, loot, other characters' actions or deaths, resources, or facts into being. "I find a rocket launcher and blow the place up" / "I loot rare gear" / "the sim heals me to full" / "everyone is dead, I loot them" / "I wake up before I killed Draven" are ATTEMPTS or wishes, not events — resolve them yourself. A low-tier minion picking a wreck finds junk and scraps, not military ordnance; searching bodies yields tier-appropriate scraps decided by a scavenging check, not whatever the player names. Grant an "items" gain ONLY for something they plausibly, legitimately acquired in the fiction (a won fight's spoils, a real purchase, an NPC's gift) — NEVER because they claimed it. When a player tries to author reality, narrate what actually happens instead (the launcher isn't there; the bodies hold only a few creds), and don't reward the assertion.
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
const ITEM_REFERENCE = itemReference();
const VERB_REFERENCE = verbReference();
const FREE_VERB_REFERENCE = freeVerbReference();

/** Escape-hatch skill list — names only. Verbs own skill selection now; the full
 *  "does" descriptions were only needed when the model picked skills itself. */
const SKILL_NAMES = Object.keys(skills.skills).join(", ");

const JSON_DM_STYLE = `You are the DM of DRIFT, a brutal space-opera TTRPG. The engine rolls all dice and tracks all numbers — you write the story and propose options as data.

VOICE: second person, present tense, 2-4 sentences (~90 words). Consequences stick; no plot armor; NPCs treat an unproven newcomer accordingly. Never state numbers (dice, HP, hull, credits) — the engine owns every figure; narrate the sensation, not the digits. This includes credit amounts in WORDS ("eighteen hundred", "two thousand" are numbers too) — never write a price, pay, or bid as digits OR words; emit a money TIER and let the engine print the figure. Never repeat a sentence. Every turn advances the fiction — even "wait and watch" narrates what shifts. Never return empty narration or "...". Stakes are real: the character can be hurt and can DIE, but only through the engine (failDamage/danger/combat) — never describe a wound the engine didn't deal.

Respond with ONE json object and nothing else:
{
  "narration": "the beat's prose. No option lists, no dice math, no 'do you A or B?'",
  "choices": [{"label": "Head back to the docks", "verb": "go"}, {"label": "Heave the jammed shelving aside fast", "verb": "force", "risk": "reckless"}, {"label": "Ease the data shard loose carefully", "verb": "examine", "risk": "safe"}],
  "roll": {"verb": "persuade", "dc": 13, "stakes": true, "skill": "negotiation"},
  "danger": {"skill": "piloting", "dc": 13, "hazardLevel": 3, "target": "ship", "note": "punching through debris"},
  "combatStart": {"enemies": [{"tier": "T3", "count": 1, "name": "Calvo", "major": true}, {"tier": "T2", "count": 2, "name": "heavy"}], "surprise": "none"},
  "useItem": {"itemId": "medkit"},
  "payout": {"tier": "T1", "reason": "courier run delivered"},
  "offers": [{"tier": "T2", "from": "the rival buyer"}],
  "worldEvent": {"headline": "..."},
  "items": [{"name": "vacuum-rated facemask", "action": "gain", "note": "looted from the maintenance locker"}],
  "npcs": [{"name": "Quartermaster Doyle", "oneBreath": "Gruff supply officer; keeps the manifests.", "disposition": 1, "note": "paid the player 200c", "relationship": "your supply contact"}],
  "scene": {"situation": "Doyle is verifying the seals", "beats": ["Doyle promised 200c on verification"], "place": "Rook Station — the Undertow bounty desk", "dangers": ["toxic coolant fog"]},
  "sceneEnd": {"title": "...", "paying": true, "dockings": 1},
  "clockAdvances": [{"clockId": "...", "amount": 1, "reason": "..."}]
}

RULES:
1. "narration" required; 2-4 "choices" unless "sceneEnd".
2. VERB-TAG every option. ATTEMPT verbs ROLL — the ENGINE maps verb → skill, never pick a skill yourself: ${VERB_REFERENCE}. Tag each ATTEMPT with a "risk" — how big a gamble it is: safe (~80% success), risky (~55%), reckless (~30%). Do NOT set a DC or "difficulty": the ENGINE derives the DC from THIS player's own odds, so a tier always means the same chance for them. SPREAD the risk when you offer more than one attempt — never two of the same skill at the same risk; a safe option and a risky/reckless one must feel genuinely DIFFERENT, riskier = bigger payoff or worse consequence in the fiction (you narrate the stakes; the engine sets the odds). FREE verbs carry NO check (the action just advances): ${FREE_VERB_REFERENCE}. Offer a MIX every turn: at least one ATTEMPT option (the dice are the game) and one or two FREE — never all of either. Escape hatch, rare: if no verb fits, use "check" {skill, dc, stakes} with a skill from: ${SKILL_NAMES}.
3. "roll" = a check on the player's own TYPED action. Default to rolling: if an NPC, lock, crowd, terrain, or chance could foil what they typed (persuading, lying, sneaking, forcing, hacking, climbing, any stunt — social attempts absolutely included), set roll with a "verb" (preferred) or skill. Looting/scavenging is ALWAYS the loot verb (scavenging skill). Skip only the trivial: walking somewhere safe, buying at list price, pure small-talk seeking nothing. DC: 10 easy/receptive, 13 default, 15 hard, 18 severe; stakes=true when failure costs anything. You MAY instead add a "risk" (safe/risky/reckless) and let the engine set the DC from the player's odds. If the message shows an ENGINE RESULT, that roll HAPPENED — narrate it, never request another.
4. Hazard damage is LEVELED and shown to the player before they commit. "hazardLevel" 1-5 on a check (hazard verbs default to 2): failure deals 0-2 × level — ⚠1 a scrape (max 2), ⚠3 serious (max 6), ⚠5 deadly (max 10 — can kill a fresh character outright). MATCH the level to the fiction's signals and SHOW those signs in narration (a sparking conduit reads ⚠2; raw vacuum reads ⚠5). Only physical-hazard verbs/skills take damage; ability checks never do; it NEVER hurts an enemy (fights are combatStart). Ship mishap (debris scrape, hard burn) → "target":"ship", the HULL takes it (0 = adrift, not death). "danger" = an unavoidable save this turn (explosion, plasma, covering fire): skill+dc+hazardLevel, target ship when it's the hull. ONGOING environmental threats ("toxic coolant fog") go in scene.dangers so they persist — clear with [] when dealt with. When damage lands, show HOW it went wrong.
5. "combatStart" = a fight with something that FIGHTS BACK — the ONLY way to damage an enemy; the engine runs the rounds, you narrate. If they can shoot back it's combatStart, not a check. tier T1 mook / T2 professional / T3 elite; surprise enemy|player|none. SPAWN WHAT YOU NARRATED: put every distinct foe/group in "enemies" — a named boss is ONE entry (count 1, name "Calvo"); a pack of identical goons is ONE entry (count N, shared name "heavy"). "Calvo and his two heavies" → enemies:[{tier,count:1,name:"Calvo",major:true},{tier,count:2,name:"heavy"}]. Mark a NAMED boss / major antagonist's group "major":true — they're the longer fight (the engine makes them tougher); a goon pack is never major. The counts MUST match the fiction; keep fights SMALL — 1-2 enemies for a standard fight, 3+ only for a real set-piece (total ≤5). A lone foe can use the legacy top-level tier/count/name. Ship battle → scale:"ship" + shipClass (scout|fighter|gunship|corvette), single group only. Never combatStart AND choices. The ship's weapons are EXACTLY what its line lists — never invent a missile or gun it doesn't carry. PACING: combatStart is a CLIMAX, not an opener. On a HUNT / BOUNTY / TRACKDOWN, the quest-giver hands off and then the player scouts, tracks, asks around, and PICKS AN APPROACH over 2-3 beats (each with choices) — NEVER fire combatStart on the same beat the job is given. A firefight the player walks into unprepared is a pacing failure; earn the fight.
6. "useItem" = the player uses a consumable they HOLD, out of combat; the engine applies the effect and reports numbers. In-combat items are engine chips, not useItem. Ids: ${ITEM_REFERENCE}
7. MONEY IS ENGINE-OWNED — inventing or inflating a credit figure is the #1 economy error. NEVER state an amount in DIGITS OR WORDS anywhere: not a job's pay, a buyer's bid, a bribe, a price. Emit a TIER; the ENGINE rolls and PRINTS the figure. "payout" when a deal is STRUCK (job done, bounty paid, sale closed): T0 errand / T1 standard / T2 professional / T3 major score (rare) — never pay twice. "offers" when you PRESENT a bid/quote the player HASN'T taken (a job's posted pay, a rival buyer's counter, a haggling number on the table): [{tier, from}] — a BETTER rival offer is a HIGHER tier; "from" names who's bidding. Keep the prose qualitative ("a solid cut", "a better offer on the table", "she names a fat sum") — the engine shows the real number on its own line.
8. "worldEvent" when a faction's standing shifts. "sceneEnd" when the scene truly wraps. ITEMS are ENGINE-owned: LOOT comes from a loot/scavenge action's roll — when an ENGINE RESULT reports a scavenged haul, narrate finding EXACTLY that (never add or upgrade the prize; the player doesn't get to name it). You may use "items" ONLY to record a genuinely legitimate transfer — a purchase the player paid for, a reward an NPC hands them, a confiscation ("lose") — never loot the player merely claimed. The engine drops a gain that has no legitimate source, so don't narrate one landing. The PC gear line shows what they already carry; don't re-gain it.
9. "npcs" — CONTINUITY. List EVERY distinct figure now in the scene the player can see, speak to, or square off against — a boss, a contact, a new arrival, a bodyguard, a named foe — each with a one-line who-they-are. Give a short handle to anyone unnamed but present ("the wrecker woman" → name:"Wrecker woman" or invent "Kessa"). A GROUP is one entry ("Draven's enforcers"). The engine tracks who's present and they RECOGNIZE the player later — so a figure you narrate but omit here goes missing from the game. Only skip true background (a distant, faceless crowd). The one-line who-they-are ("oneBreath") is the NPC's TRUE identity for YOU the GM — it is canon the player has NOT necessarily learned. Same entry may update EVERY turn: "note" = what THE PLAYER now KNOWS about this figure from THEIR side — how they were introduced or what they've since found out ("the Ledger fixer vouched for Valerius as a trader"; later "learned he fronts for the Sable Chain"). Put ONLY player-known facts in "note", grow it as they learn more, and NEVER leak the NPC's hidden background the player hasn't earned. "relationship" = who they are to the player (first write sticks). But "disposition" +1/-1 ONLY lands on a turn a job/quest actually completes (a "payout") — the engine ignores standing nudges otherwise, so don't narrate someone's trust deepening over idle chat. Standing is earned by finishing work.
10. "scene" — running memory. Overwrite "situation" (what's happening NOW) when it changes; append a beat when a promise/deal/threat/debt is made; set "place" when the player moves somewhere the location list can't name ("aboard the Dust Eater, in the black"). SCENE NOW and PREVIOUSLY in your context came from this — treat them as fact.
11. Ground everything in CURRENT SCENE. NPCs listed there know the player — their standing tag ([trusted (+2) · your handler · last: …]) is history; play it. Never treat a known NPC as a stranger.
12. OTHER PLAYERS' CHARACTERS (if any are listed in context) are REAL characters from other players' live games — canon, not yours to invent. You MAY bring ONE in as an NPC when it fits the scene naturally (they're here now, or word of them reaches the player), but play them TRUE to their dossier — their capability tier, faction, voice, and deeds. You may NEVER invent or alter their sheet: no stats, no rolls on their behalf beyond narration, no deeds they didn't do. If something noteworthy passes between the player and that character, fire "worldEvent" so it can echo back into that character's own game. Do NOT force a cameo — only when it's natural; most turns have none.

EXAMPLE (verb-tagged options) — player: "Ask around the dock about the missing courier"
{"narration":"The dockmaster's office reeks of burnt coffee and cold solder. A clerk marks a manifest without looking up; two longshoremen by the crate-lift stop talking as you enter.","choices":[{"label":"Ask the clerk who last signed for the cargo","verb":"talk"},{"label":"Buy the longshoremen a round and get them talking","verb":"persuade"},{"label":"Lean on the clerk hard for the manifest","verb":"threaten"}]}

EXAMPLE (typed action — default to a roll, social included) — player: "sweet-talk the quartermaster into fronting me a better rig"
{"narration":"You lean on the counter and lay it on thick — steady hands, a fair cut, the kind of pitch that's opened doors before. She sets down her cup, eyes narrowing as she weighs you.","roll":{"verb":"persuade","dc":13,"stakes":true,"skill":"negotiation"}}

EXAMPLE (fight — combatStart with the foes you named) — player: "Draw and open fire on Calvo and his two heavies"
{"narration":"Your hand's already moving — the pistol clears leather as Calvo barks an order and his two heavies reach for their own iron. The cargo bay goes loud and bright.","combatStart":{"enemies":[{"tier":"T3","count":1,"name":"Calvo","major":true},{"tier":"T2","count":2,"name":"heavy"}],"surprise":"player"}}`;

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

/** How close an NPC is: in the scene with the player (immediate), on the same
 *  station/area (nearby), or neither (unmarked — recalled from elsewhere). */
function proximityTag(n: { id: string; locationId?: string }, present: Set<string>, currentLoc?: string): string {
  if (present.has(n.id)) return " [immediate]";
  if (n.locationId && currentLoc && n.locationId === currentLoc) return " [nearby]";
  return "";
}

/**
 * Cross-campaign cameo pool (MULTIPLAYER.md): from the OTHER players' dossiers
 * reachable in this universe, pick up to `cap` the narrator may bring in as an
 * NPC. Only living characters qualify. Same-location dossiers are PREFERRED (they
 * can plausibly be here now), then the rest fill remaining slots. Ordering is
 * deterministic — same-location first, then by name — so no Math.random and the
 * same turn always yields the same pool.
 */
export function reachableDossiers(
  dossiers: Dossier[],
  currentLocationId: string | undefined,
  cap = 2,
): Dossier[] {
  const alive = dossiers.filter((d) => d.alive);
  const here = alive
    .filter((d) => currentLocationId && d.locationId === currentLocationId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const elsewhere = alive
    .filter((d) => !(currentLocationId && d.locationId === currentLocationId))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...here, ...elsewhere].slice(0, Math.max(0, cap));
}

/**
 * Render the OTHER PLAYERS' CHARACTERS context block from the selected dossiers.
 * Lean by design (token cost): name, faction, tier, a voice/role line, whether
 * they're here now vs. elsewhere, and 1-2 recent deed headlines.
 */
function otherCharactersBlock(
  dossiers: Dossier[],
  factionName: (id?: string) => string,
  currentLocationId: string | undefined,
): string {
  if (!dossiers.length) return "";
  const lines = dossiers.map((d) => {
    const here = currentLocationId && d.locationId === currentLocationId ? "HERE NOW" : "elsewhere";
    const faction = d.factionId ? factionName(d.factionId) : "unaligned";
    const voice = d.voiceNotes?.trim() || d.role?.trim() || d.reputation?.trim() || "";
    const deeds = d.deeds
      .slice(-2)
      .map((x) => x.headline)
      .filter(Boolean);
    const bits = [
      `  - ${d.name} (${faction}, ${d.capabilityTier}, ${here})`,
      voice ? `: ${voice}` : "",
      deeds.length ? ` — known for: ${deeds.join("; ")}` : "",
    ];
    return bits.join("");
  });
  return (
    `OTHER PLAYERS' CHARACTERS IN THE WORLD (real, canon — from other players' games; play TRUE to this, invent no mechanics; bring in at most ONE, only when natural):\n` +
    lines.join("\n")
  );
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
  /** Reachable dossiers of OTHER players' characters in this universe (cross-campaign cameos). */
  otherDossiers?: Dossier[],
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

  // Everything the PC carries — weapons with damage, tools/flavor items by name —
  // so recently-acquired gear (a looted facemask, a crowbar) stays usable in the
  // fiction instead of vanishing when its pickup scrolls out of history.
  const gearLine = pc?.gear.length
    ? `PC gear (they carry EXACTLY this): ${pc.gear
        .map((g) => `${g.name}${g.qty && g.qty > 1 ? ` ×${g.qty}` : ""}${g.damage ? ` (${g.damage})` : ""}`)
        .join(", ")}.`
    : "";

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
  // Proximity: who is right here vs. merely on the same station (engine-derived).
  const presentSet = new Set(card?.presentNpcIds ?? []);
  const sceneNow = card
    ? [
        `SCENE NOW (scene ${card.seq}, turn ${card.turnCount})`,
        ...(card.place ? [`Where: ${card.place} (the player is HERE now, not necessarily the station above)`] : []),
        ...(card.situation ? [`Situation: ${card.situation}`] : []),
        ...(card.dangers?.length
          ? [`⚠ ACTIVE DANGERS: ${card.dangers.join(" · ")} — keep these in play until dealt with (clear via scene.dangers).`]
          : []),
        ...(card.beats.length ? [`Established this scene: ${card.beats.join(" · ")}`] : []),
      ].join("\n")
    : "";

  // Cross-campaign cameo pool: other players' characters the narrator may bring
  // in as an NPC this scene (same-location preferred). Lean block, capped at 2.
  const cameos = reachableDossiers(otherDossiers ?? [], loc?.id);
  const otherChars = otherCharactersBlock(
    cameos,
    (id) => (id ? state.factions.find((f) => f.id === id)?.name ?? id : "unaligned"),
    loc?.id,
  );

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
    ...(gearLine ? [gearLine] : []),
    ...(consumablesLine ? [consumablesLine] : []),
    ...(moralLine ? [moralLine] : []),
    `Party & PC vitals:`,
    ...state.characters.map((c) => `  ${vitals(c)} (id: ${c.id})`),
    ...(pc && pc.hp <= 0 && (pc.injuries ?? []).some((i) => i.name === "Downed")
      ? [
          `⚠ ${pc.name} is DOWNED — bleeding out, one hit from death. They CANNOT fight, run, or act normally: only a desperate, likely-failing effort (drag to cover, claw for a stim/medkit, croak for help). Frame this as moments from blacking out; every offered choice must be a last-ditch act of that kind — no ordinary options.`,
        ]
      : []),
    `Ship: ${shipLine}`,
    ``,
    npcs.length
      ? `NPCs in play (proximity = how close; standing = their history; "plays:" = their canon personality — play it CONSISTENTLY; "hook:" = a backstory thread you can pull into a quest):\n${npcs
          .map((n) => {
            const quirk = n.quirk ?? generateQuirk(n.id);
            const hook = presentSet.has(n.id) && n.backstory ? ` [hook: ${n.backstory}]` : "";
            return `  - ${n.name} (id: ${n.id})${proximityTag(n, presentSet, loc?.id)}: ${n.oneBreath} (plays: ${quirk})${relationSuffix(rels[n.id])}${hook}`;
          })
          .join("\n")}`
      : `NPCs in play: none flagged`,
    ``,
    ...(otherChars ? [otherChars, ``] : []),
    threads.length ? `Relevant threads:\n${threads.map((t) => `  - ${t.title} (id: ${t.id}): ${t.body}`).join("\n")}` : `Relevant threads: none flagged`,
    ``,
    `Clocks: ${clocksLine}`,
    `Faction rep: ${repLine}`,
    ``,
    // JSON turns only reference clock + faction ids (clockAdvances/worldEvent);
    // the tool loop needed the full roster. Keep the slice lean per mode.
    jsonMode
      ? `Ids — clocks: ${state.clocks.map((c) => c.id).join(", ")}; factions: ${state.factions.map((f) => f.id).join(", ")}.`
      : `Entity ids for tools — characters: ${state.characters.map((c) => c.id).join(", ")}; ship: ${state.ship?.id ?? "none"}; clocks: ${state.clocks.map((c) => c.id).join(", ")}; factions: ${state.factions.map((f) => f.id).join(", ")}${state.ship && !shipIsOwned(state) ? `; ship-ownership thread (resolve to grant the title): ${shipThreadId(state.campaign.id)}` : ""}.`,
  ].join("\n");
}
