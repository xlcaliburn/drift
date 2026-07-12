/**
 * Static creation-inspiration content — canon names, example signature skills,
 * and example moral codes. Hand-authored so character creation never has to
 * spend tokens generating throwaway suggestions. Everything here is in-world for
 * the DRIFT lanes: names read as people (Vess Karo, Silas Corr), not usernames.
 */

import type { UniqueSkill } from "@/shared/schemas";

// ── Names ────────────────────────────────────────────────────────────────────
// Mixed-origin given names + surnames that fit a hard, polyglot frontier. Kept
// grounded — no fantasy apostrophe-soup. suggestName() combines them; a handful
// of these double as the lone-callsign names some spacers actually go by.

const GIVEN_NAMES = [
  "Vess", "Silas", "Rell", "Denna", "Josen", "Kira", "Marn", "Sable", "Tovic",
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
];

// ── Optional flavor prompts (leave blank → the lanes invent one) ──────────────

/** A defining loss or scar. */
export const exampleLosses: string[] = [
  "A ship, and the crew that went down with it.",
  "The person who raised me on the dock levels.",
  "A hand, taken by a debt collector.",
  "My old name — I buried it to get out.",
  "A partner who flew off with the only score that mattered.",
];

/** A debt or tie — someone owed, or who owes them. */
export const exampleTies: string[] = [
  "I owe a Rook fixer my life, and they know it.",
  "A Crown handler vouched for me once — I still owe that.",
  "Someone died so I could make the jump. I don't know their name.",
  "My old crew thinks I'm dead. I'd like to keep it that way.",
  "A sibling somewhere in Talos I've never been brave enough to find.",
];

/** A habit or mannerism that makes them recognizable. */
export const exampleTells: string[] = [
  "I always sit facing the exit.",
  "I flip a spent round between my fingers when I think.",
  "I never give my real name first.",
  "I count the exits before I sit down.",
  "I talk quietest right before it goes bad.",
];
