import type { PackPrologue } from "../types";

/**
 * THE PROLOGUE (STORY.md §3, HANDOFF_STORY_4.md) — a per-faction temporary
 * ally + four stage directives. NOT a `pack.storyline` chapter: no trigger
 * predicate can distinguish a brand-new campaign from a veteran one, so this
 * rides its own persisted `Campaign.prologueStage` instead
 * (shared/prologue.ts owns the stage machine). `{patron}`/`{ally}`
 * placeholders are filled at render time from `pack.creation.patrons` and
 * the stage's own ally name.
 */
export const driftPrologue: PackPrologue = {
  allies: {
    "f-crown": {
      name: "Sergeant Vale",
      role: "Crown escort",
      oneBreath: "A by-the-book Crown escort assigned to break in new hands — thorough, unhurried, impossible to rattle.",
      crewRole: "muscle",
    },
    "f-sable": {
      name: "Cutter Rhee",
      role: "Sable minder",
      oneBreath: "A Sable Chain minder who's shepherded more new hands than she can count — sharp-tongued, and good at keeping people breathing.",
      crewRole: "medic",
    },
    "f-undertow": {
      name: "Warrant Dask",
      role: "Undertow escort",
      oneBreath: "An Undertow collections escort who runs every job by the book, because the book is the only thing that's never gotten anyone killed.",
      crewRole: "muscle",
    },
    "f-free": {
      name: "Juno Vex",
      role: "freelance pilot",
      oneBreath: "A freelance pilot working off an old favor to the patron — easy company, sharp reflexes, loyal to no one in particular.",
      crewRole: "pilot",
    },
    "f-wreckers": {
      name: "Korr",
      role: "raid partner",
      oneBreath: "A Wrecker who partners every green raider on their first run — tradition, not kindness, though it reads the same.",
      crewRole: "gunner",
    },
    "f-reclaimers": {
      name: "Sova",
      role: "field tech",
      oneBreath: "A Reclaimer field tech assigned to chaperone new salvagers through their first runs — methodical, patient, allergic to shortcuts.",
      crewRole: "engineer",
    },
  },
  stages: {
    intro:
      "{patron} makes the introductions: {ally} is riding along with the player for their first runs. Establish {ally} as PRESENT, at the player's side. End the scene pointing at trouble nearby worth handling.",
    groundFight:
      "Steer this scene into a SMALL, forgiving fight — call combat.start, tier T1, 1-2 foes, scale personal — with {ally} fighting alongside the player. The player can ORDER {ally} once the fight opens (squad orders).",
    shipFight:
      "Steer this scene into a WEAK ship engagement on the player's own hull — combat.start, scale \"ship\", a lone T1 scout-class opponent. Keep stakes low: power allocation is the lesson, not a real threat. Fleeing counts as surviving it.",
    graduation:
      "{ally}'s unit recalls them — write one clean departure beat, warm, not final. Have {patron} hand the player off to the open Drift. This is the last turn {ally} rides along.",
  },
};
