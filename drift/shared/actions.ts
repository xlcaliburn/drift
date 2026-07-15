/**
 * Action verbs (ACTIONS.md) — a fixed vocabulary the narrator tags choices with,
 * so the ENGINE (not the unreliable model) owns which skill a check uses. The
 * model picks a verb; the engine maps verb → skill + DC and builds the check.
 * This kills the "zeroG to move a shelf" class of bug: the verb decides the skill.
 */

export interface ActionVerbDef {
  /** Skill the engine rolls for this verb. */
  skill: string;
  /** DC when the model gives no difficulty. */
  defaultDc: number;
  /** Failing can physically hurt (a fall, a crush, a vacuum slip). */
  hazard?: boolean;
  /** This verb is an act of violence — routes to combat, not a self-check. */
  combat?: boolean;
  /** This verb is an attempt to acquire loot: on success the ENGINE generates the
   *  reward (scrap + creds), so the player can't name their own prize. */
  loot?: boolean;
  /** Synonyms shown to the model so it maps its phrasing to the verb. */
  aliases: string[];
  /** One-liner for the fed verb list in the prompt. */
  hint: string;
}

export const ACTION_VERBS: Record<string, ActionVerbDef> = {
  examine: { skill: "perception", defaultDc: 12, aliases: ["inspect", "study", "read", "scan", "check"], hint: "look something over for detail" },
  loot: { skill: "scavenging", defaultDc: 12, loot: true, aliases: ["search", "scavenge", "salvage", "strip", "rifle"], hint: "strip a wreck/body/stash for value" },
  force: { skill: "athletics", defaultDc: 13, hazard: true, aliases: ["move", "shove", "lift", "haul", "pry", "break", "smash", "wrench"], hint: "muscle a heavy or stuck thing" },
  climb: { skill: "athletics", defaultDc: 13, hazard: true, aliases: ["vault", "scramble", "scale", "clamber", "cross"], hint: "climb or vault across risky terrain" },
  sneak: { skill: "stealth", defaultDc: 13, aliases: ["slip", "creep", "tail", "shadow", "hide"], hint: "move unseen / tail someone" },
  hack: { skill: "electronics", defaultDc: 14, aliases: ["slice", "override", "bypass", "jack", "splice"], hint: "breach a system, lock, or comms" },
  repair: { skill: "mechanics", defaultDc: 13, aliases: ["patch", "fix", "rig", "jury-rig", "weld"], hint: "fix or jury-rig machinery" },
  pilot: { skill: "piloting", defaultDc: 13, aliases: ["fly", "dock", "burn", "evade", "thread"], hint: "fly/dock/evade at the stick" },
  spacewalk: { skill: "zeroG", defaultDc: 13, hazard: true, aliases: ["float", "eva", "tether", "drift"], hint: "move in vacuum / zero-g / EVA" },
  plot: { skill: "navigation", defaultDc: 13, aliases: ["navigate", "chart", "jump"], hint: "plot a course / FTL jump" },
  persuade: { skill: "negotiation", defaultDc: 13, aliases: ["convince", "talk", "charm", "haggle", "negotiate", "reason", "sweet-talk", "sweettalk", "plead", "coax", "appeal", "flatter"], hint: "win someone over / haggle" },
  network: { skill: "streetwise", defaultDc: 13, aliases: ["ask around", "work", "canvass", "fence", "case", "sniff around"], hint: "work the underworld — rumors, contacts, fences, the word on the street" },
  lie: { skill: "deception", defaultDc: 13, aliases: ["bluff", "con", "deceive", "disguise", "feign"], hint: "lie / bluff / con" },
  threaten: { skill: "intimidation", defaultDc: 13, aliases: ["intimidate", "menace", "press", "strong-arm"], hint: "threaten / strong-arm" },
  endure: { skill: "survival", defaultDc: 13, hazard: true, aliases: ["survive", "forage", "brace"], hint: "endure a hostile environment" },
  attack: { skill: "smallArms", defaultDc: 13, combat: true, aliases: ["shoot", "fire", "gun", "strike", "open fire"], hint: "open fire / attack — STARTS A FIGHT" },
};

export type ActionVerb = keyof typeof ACTION_VERBS;

/**
 * FREE verbs — actions that DON'T map to a skill, so they carry NO check. They
 * keep the vocabulary complete: an option is either an attempt (a check-verb) or
 * one of these (just advances). Guarantees some options stay check-free (ACTIONS.md).
 */
export const FREE_VERBS: Record<string, { aliases: string[]; hint: string }> = {
  go: { aliases: ["travel", "head", "approach", "walk", "enter", "leave", "board", "return"], hint: "move somewhere safe / travel / enter or leave" },
  talk: { aliases: ["ask", "greet", "chat", "reply", "say", "answer"], hint: "simple talk — ask, greet, reply (NOT persuading/lying/threatening)" },
  wait: { aliases: ["observe", "hold", "listen", "watch", "rest", "linger"], hint: "wait, watch, or listen — let the moment pass" },
  take: { aliases: ["grab", "pocket", "collect", "gather"], hint: "pick up something with no resistance (a loose shard, an offered item)" },
  give: { aliases: ["offer", "hand", "pay", "drop", "show"], hint: "give / offer / hand something over" },
  use: { aliases: ["activate", "press", "open", "flip", "pull"], hint: "use an item or control that just works" },
};

/** Runtime tuple for z.enum (schema) — every verb key, attempt + free. */
export const VERB_LIST = [...Object.keys(ACTION_VERBS), ...Object.keys(FREE_VERBS)] as [string, ...string[]];

const DIFFICULTY_DC = { easy: 10, normal: 13, hard: 16 } as const;
export type Difficulty = keyof typeof DIFFICULTY_DC;

export interface VerbCheck {
  skill: string;
  dc: number;
  stakes: boolean;
  /** Hazard verbs carry a danger level (1-5): failure deals (0..2) × level.
   *  Shown to the player as ⚠ on the chip BEFORE they commit. */
  hazardLevel?: number;
  /** Attack verbs route to combat via the existing gun-skill reroute. */
  combat?: boolean;
  /** Loot verbs: a successful check makes the ENGINE generate the reward. */
  loot?: boolean;
}

/** Build the engine's check spec for a verb-tagged action (null if unknown verb). */
export function checkFromVerb(verb: string, difficulty?: string): VerbCheck | null {
  const def = ACTION_VERBS[verb];
  if (!def) return null;
  const dc = difficulty && difficulty in DIFFICULTY_DC ? DIFFICULTY_DC[difficulty as Difficulty] : def.defaultDc;
  return {
    skill: def.skill,
    dc,
    stakes: true,
    ...(def.hazard ? { hazardLevel: 2 } : {}), // verb default: dangerous (⚠⚠); model may override
    ...(def.combat ? { combat: true } : {}),
    ...(def.loot ? { loot: true } : {}),
  };
}

/** Attempt-verb "verb (hint)" list — these ROLL a check (engine picks the skill). */
export function verbReference(): string {
  return Object.entries(ACTION_VERBS)
    .map(([v, d]) => `${v} (${d.hint})`)
    .join("; ");
}

/** Free-verb "verb (hint)" list — these carry NO check (the action just advances). */
export function freeVerbReference(): string {
  return Object.entries(FREE_VERBS)
    .map(([v, d]) => `${v} (${d.hint})`)
    .join("; ");
}

/** Whether a verb is an attempt (rolls a check) vs. a free action (no check). */
export function verbRolls(verb: string | undefined | null): boolean {
  return !!verb && verb in ACTION_VERBS;
}

// Alias → verb lookup for label inference (multi-word aliases included).
const ALIAS_TO_VERB: [string, string][] = (() => {
  const pairs: [string, string][] = [];
  for (const [verb, def] of Object.entries(ACTION_VERBS)) {
    pairs.push([verb, verb]);
    for (const a of def.aliases) pairs.push([a.toLowerCase(), verb]);
  }
  for (const [verb, def] of Object.entries(FREE_VERBS)) {
    pairs.push([verb, verb]);
    for (const a of def.aliases) pairs.push([a.toLowerCase(), verb]);
  }
  // Longest alias first so "open fire" beats "open", "ask around" beats "ask".
  return pairs.sort((a, b) => b[0].length - a[0].length);
})();

/**
 * Infer the verb from a choice label the model forgot to tag ("Search the
 * lockers" → loot). Matches verb/alias at the START of the label (first ~3
 * words, so "Try to force the hatch" still hits "force"). Conservative: no
 * match → null → the option stays a plain, check-free choice.
 */
export function verbFromLabel(label: string): string | null {
  const head = label
    .toLowerCase()
    .replace(/^["'“”]+/, "")
    .replace(/^(try to|attempt to|carefully|quietly|quickly)\s+/, "")
    .slice(0, 40);
  for (const [alias, verb] of ALIAS_TO_VERB) {
    if (head.startsWith(alias + " ") || head === alias) return verb;
  }
  return null;
}

/** Leading filler stripped off a TYPED action before matching its verb — first-
 *  person framing ("I'll", "let me", "I try to") + soft adverbs, peeled a few
 *  times so "I'm gonna carefully sneak…" reduces to "sneak…". */
const TYPED_FILLER_RE =
  /^(i['’]?ll|i['’]?m going to|i am going to|i['’]?d like to|i['’]?m gonna|i want to|i wanna|i will|i try to|i attempt to|i'?m trying to|let me|let['’]?s|i|we['’]?ll|we|then|and|first|now|just|try to|attempt to|carefully|quietly|quickly|slowly|cautiously|quick)\s+/;

/**
 * Infer a NON-COMBAT attempt verb from a player's TYPED action, so a custom action
 * that reads as an attempt (persuade / sneak / force / hack / lie / threaten …)
 * gets a check even when the model forgets to set `roll`. Strips first-person
 * filler, then matches an attempt verb/alias at the head of the phrase. Returns
 * null for pure dialogue / free verbs ("greet the bartender") and for combat
 * (which has its own routing) — so it never manufactures a false check or a fight.
 */
export function inferAttemptVerb(text: string): string | null {
  let head = (text ?? "").toLowerCase().replace(/^["'“”\s]+/, "");
  for (let i = 0; i < 4; i++) {
    const stripped = head.replace(TYPED_FILLER_RE, "");
    if (stripped === head) break;
    head = stripped;
  }
  head = head.slice(0, 50);
  for (const [alias, verb] of ALIAS_TO_VERB) {
    if (!(verb in ACTION_VERBS)) continue; // free verbs carry no check
    if (ACTION_VERBS[verb].combat) continue; // combat routes itself, never here
    if (head.startsWith(alias + " ") || head === alias) return verb;
  }
  return null;
}
