/**
 * Static creation-inspiration content — canon names, example signature skills,
 * and example moral codes. Hand-authored so character creation never has to
 * spend tokens generating throwaway suggestions. Everything here is in-world for
 * the DRIFT lanes: names read as people (Silas Corr, Denna Vale), not usernames.
 */

import type { UniqueSkill } from "@/shared/schemas";

// ── Names ────────────────────────────────────────────────────────────────────
// Mixed-origin given names + surnames that fit a hard, polyglot frontier. Kept
// grounded — no fantasy apostrophe-soup. suggestName() combines them; a handful
// of these double as the lone-callsign names some spacers actually go by.

const GIVEN_NAMES = [
  "Silas", "Rell", "Denna", "Josen", "Kira", "Marn", "Tovic", "Cassin",
  "Ana", "Corwin", "Yuki", "Dax", "Neve", "Osei", "Lena", "Bram", "Ravi",
  "Sena", "Cato", "Mira", "Halden", "Nadia", "Emil", "Zara", "Piotr", "Ludo",
  "Iona", "Garrick", "Sol", "Tamsin", "Voss", "Ekko", "Wren", "Isko", "Perla",
];

const SURNAMES = [
  "Karo", "Corr", "Vantry", "Okonkwo", "Reyes", "Ashfall", "Dresch", "Vale",
  "Kessler", "Marlow", "Sung", "Bellamy", "Draeve", "Novak", "Orsini", "Halloran",
  "Cray", "Voung", "Sabatch", "Renfield", "Duross", "Machado", "Teller", "Volkov",
  "Amari", "Sallow", "Quist", "Bex", "Radek", "Nyx", "Calloway", "Osei",
];

/** Some spacers go by one name — a handle that still sounds like a person/place. */
const MONONYMS = [
  "Rook", "Ash", "Ghost", "Deuce", "Slate", "Vane", "Cinder", "Mox", "Fen",
  "Talon", "Riven", "Sparrow", "Coll", "Nix",
];

/**
 * Deterministic-free name suggestion. `seed` (0..1) is provided by the caller
 * (e.g. Math.random() in the browser) so this stays a pure function usable on
 * the server or in tests. ~1 in 6 suggestions is a lone callsign.
 */
export function suggestName(seed: number): string {
  const r = (n: number) => Math.floor(seed * 100003 * (n + 1)) % n; // cheap spread
  if (r(6) === 0) return MONONYMS[r(MONONYMS.length)];
  return `${GIVEN_NAMES[r(GIVEN_NAMES.length)]} ${SURNAMES[r(SURNAMES.length)]}`;
}

// ── Example signature (unique) skills ─────────────────────────────────────────
// A gallery players can pull inspiration from or click to autofill the builder.
// Every entry respects the same balance caps the builder enforces (passive
// skill +≤2 / attribute +1; trigger = narrow scenario, ≤3 uses/scene).

export interface ExampleSkill {
  /** Short blurb shown on the gallery card. */
  blurb: string;
  skill: UniqueSkill;
}

export const exampleSkills: ExampleSkill[] = [
  {
    blurb: "A pilot who reads a debris field like a street.",
    skill: {
      name: "Shear-Sense",
      description: "You feel the gaps in a debris field before you see them.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "piloting",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "The first shot is always yours.",
    skill: {
      name: "First Blood",
      description: "When you spring an ambush, the opening shot lands true.",
      kind: "trigger",
      triggerScenario: "the first attack of an ambush you initiate",
      triggerEffect: "auto_crit",
      usesPerScene: 1,
    },
  },
  {
    blurb: "You've never lost a negotiation you set up.",
    skill: {
      name: "The Closer",
      description: "You read what someone wants before they say it.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "negotiation",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "Machines answer to you.",
    skill: {
      name: "Deadhand",
      description: "Wired systems do what you tell them, even the ones that shouldn't.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "electronics",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "In the dark, you're the thing that finds them.",
    skill: {
      name: "Ghost Step",
      description: "When the lights are out, you move unseen and unheard.",
      kind: "trigger",
      triggerScenario: "a stealth check made in darkness or lost power",
      triggerEffect: "auto_crit",
      usesPerScene: 2,
    },
  },
  {
    blurb: "Steady where others shake — reflexes honed hard.",
    skill: {
      name: "Cold Nerve",
      description: "Pressure slows down for you; your hands never do.",
      kind: "passive",
      passiveTargetType: "attribute",
      passiveTarget: "reflex",
      passiveAmount: 1,
      usesPerScene: 1,
    },
  },
  {
    blurb: "You talk your way past the one who'd shoot anyone else.",
    skill: {
      name: "Silver Tongue",
      description: "Cornered and outgunned, you find the words that buy a way out.",
      kind: "trigger",
      triggerScenario: "a negotiation or deception check while unarmed and outnumbered",
      triggerEffect: "auto_crit",
      usesPerScene: 1,
    },
  },
  {
    blurb: "Gunnery in your blood — the range means nothing.",
    skill: {
      name: "Long Eye",
      description: "You put rounds where they need to go, however far.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "gunnery",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "Your sidearm clears leather before they finish the threat.",
    skill: {
      name: "Fast Hands",
      description: "The draw is done before you've decided to make it.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "smallArms",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "Every machine has a song; you know the words.",
    skill: {
      name: "Wrenchsong",
      description: "You coax dead hardware back to life by feel alone.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "mechanics",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "You plot a jump others call impossible.",
    skill: {
      name: "Lanewise",
      description: "The lanes lay themselves out in your head, clean and certain.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "navigation",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "Vacuum is where you're most at home.",
    skill: {
      name: "Vacuum-Born",
      description: "In zero-G you move like the rest of us walk.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "zeroG",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "Up close, you finish it.",
    skill: {
      name: "Close Work",
      description: "In a knife's reach, no one is faster or surer than you.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "melee",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "You say a thing once and they believe it.",
    skill: {
      name: "Hard Word",
      description: "Your threats don't need repeating.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "intimidation",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "You've walked out of places that kill people.",
    skill: {
      name: "Long Hauler",
      description: "Hunger, cold, and vacuum are just weather to you.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "survival",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "The street tells you things before it tells anyone else.",
    skill: {
      name: "Streetblood",
      description: "You read a dock the way others read a map.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "streetwise",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "Nobody's ever caught you in the lie.",
    skill: {
      name: "Poker Face",
      description: "Your face gives away exactly what you choose.",
      kind: "passive",
      passiveTargetType: "skill",
      passiveTarget: "deception",
      passiveAmount: 2,
      usesPerScene: 1,
    },
  },
  {
    blurb: "You notice the thing everyone else walks past.",
    skill: {
      name: "Sharp Eye",
      description: "Details snag on you — the tell, the wire, the wrong shadow.",
      kind: "passive",
      passiveTargetType: "attribute",
      passiveTarget: "perception",
      passiveAmount: 1,
      usesPerScene: 1,
    },
  },
  {
    blurb: "You take a hit that would drop anyone else.",
    skill: {
      name: "Deep Well",
      description: "There's more left in you than there has any right to be.",
      kind: "passive",
      passiveTargetType: "attribute",
      passiveTarget: "vitality",
      passiveAmount: 1,
      usesPerScene: 1,
    },
  },
  {
    blurb: "You learn a system in the time it takes others to find the manual.",
    skill: {
      name: "Quick Study",
      description: "New tech, new tongue, new rules — you pick them up fast.",
      kind: "passive",
      passiveTargetType: "attribute",
      passiveTarget: "intellect",
      passiveAmount: 1,
      usesPerScene: 1,
    },
  },
  {
    blurb: "Cornered and bleeding is when you're most dangerous.",
    skill: {
      name: "Last Stand",
      description: "When you're hurt and out of room, the next blow lands perfect.",
      kind: "trigger",
      triggerScenario: "an attack you make while below half your HP",
      triggerEffect: "auto_crit",
      usesPerScene: 1,
    },
  },
  {
    blurb: "Once you break for open space, they don't catch you.",
    skill: {
      name: "Clean Getaway",
      description: "Give you a lane out and pursuit becomes a memory.",
      kind: "trigger",
      triggerScenario: "a piloting check to escape pursuit into open space",
      triggerEffect: "auto_crit",
      usesPerScene: 1,
    },
  },
  {
    blurb: "In a crowd, your hands are quicker than their eyes.",
    skill: {
      name: "Pickpocket's Grace",
      description: "You lift what you need and they never feel it go.",
      kind: "trigger",
      triggerScenario: "a sleight-of-hand or theft attempt in a crowd",
      triggerEffect: "auto_crit",
      usesPerScene: 2,
    },
  },
];

// ── Example moral codes ("the line you won't cross") ──────────────────────────

export const exampleMoralCodes: string[] = [
  "People aren't cargo.",
  "I don't leave crew behind.",
  "No kids, ever.",
  "A debt paid is a debt closed — I don't collect twice.",
  "I never fire first.",
  "My word, once given, holds.",
  "I don't sell out the people who trusted me.",
  "No slavers get my help, for any price.",
  "I don't shoot someone in the back.",
  "Everyone gets one warning.",
  "I don't lie to my own crew.",
  "I won't take a job that hits the desperate.",
  "No poison, no gas — I look them in the eye.",
  "I don't burn a station that took me in.",
  "The cargo is the cargo — I don't ask, I don't touch.",
  "Debts get paid: mine, and the ones owed to me.",
];

// ── Optional flavor prompts (leave blank → the lanes invent one) ──────────────

/** A defining loss or scar. */
export const exampleLosses: string[] = [
  "A ship, and the crew that went down with it.",
  "The person who raised me on the dock levels.",
  "A hand, taken by a debt collector.",
  "My old name — I buried it to get out.",
  "A partner who flew off with the only score that mattered.",
  "A homeworld I can't ever go back to.",
  "Years, to a debtor's contract I finally bought out.",
  "Half a face, to a reactor flash.",
  "The one person who vouched for me — and the trust they had.",
  "A kid I swore I'd get off-station. I didn't.",
  "My rank, and the only family the service ever gave me.",
  "A fortune, once — gone in a single bad jump.",
];

/** A debt or tie — someone owed, or who owes them. */
export const exampleTies: string[] = [
  "I owe a Rook fixer my life, and they know it.",
  "A Crown handler vouched for me once — I still owe that.",
  "Someone died so I could make the jump. I don't know their name.",
  "My old crew thinks I'm dead. I'd like to keep it that way.",
  "A sibling somewhere in Talos I've never been brave enough to find.",
  "A loan shark on Talos holds paper on my ship.",
  "I raised someone else's kid; they don't know I'm not blood.",
  "A cartel quartermaster owes me, and hates that they do.",
  "The medic who patched me up never sent a bill. That scares me.",
  "My name's on a warrant in three systems for someone else's crime.",
  "An old flame runs cargo for the other side now.",
  "A dead partner's family thinks I'm still sending the money. I am.",
];

/** A habit or mannerism that makes them recognizable. */
export const exampleTells: string[] = [
  "I always sit facing the exit.",
  "I flip a spent round between my fingers when I think.",
  "I never give my real name first.",
  "I count the exits before I sit down.",
  "I talk quietest right before it goes bad.",
  "I clean a weapon I've already cleaned.",
  "I never drink what I didn't pour.",
  "I tap two fingers when I'm lying.",
  "I stand when a stranger enters a room.",
  "I keep one hand off the table, always.",
  "I memorize names and pretend I forgot them.",
  "I whistle the same three notes when I'm working.",
];

// ── Random sampling ───────────────────────────────────────────────────────────

/**
 * Deterministic sample of `n` items from `arr`, seeded by an integer. Seed 0
 * yields a stable first result (safe for SSR — no hydration mismatch); bumping
 * the seed reshuffles. Pure, so the same seed always gives the same picks.
 */
export function sample<T>(arr: readonly T[], n: number, seed: number): T[] {
  const a = arr.slice();
  let s = (seed * 2654435761 + 1) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}
