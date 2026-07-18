import type { AttributeKey } from "@/shared/schemas";
import { pack } from "@/content/pack";

/**
 * Character-creation content: how questionnaire answers map to a starting sheet.
 * Tuned for EQUAL FOOTING — every background grants the same net attribute
 * points (+3) and comparable gear; answers change your shape, not your power.
 *
 * World-flavored data (backgrounds, alignments, ambitions, patron templates,
 * faction starter-gear flavor) now lives in the pack
 * (content/pack/drift/creation.ts — Modularity M1 Task D); this file is the
 * RULESET: the equal-footing attribute math, focus→attribute/skill wiring, and
 * the mechanics functions that read the pack's data (patronFor,
 * factionStarterGear). content/creation.test.ts pins the world-flavored data;
 * engine/creation.test.ts pins the built-character output that proves the
 * ruleset math is unaffected.
 */

export type Bias =
  | "commerce"
  | "combat"
  | "intrigue"
  | "piloting"
  | "diplomacy"
  | "engineering"
  | "survival"
  | "brawn";

/**
 * A FOCUS — the player's main build choice. It drives the primary attribute (+3)
 * and grants a signature skill spread (4 levels). This is the SINGLE SOURCE OF
 * TRUTH the wizard imports for display; the engine reads the `biasAttribute` /
 * `biasSkills` records DERIVED from this list below, so display and mechanics can
 * never drift. Primaries are chosen to reinforce each focus's skills: combat and
 * piloting lean reflex, intrigue and engineering take intellect (operator/hacker
 * / wrench), the social focuses lean presence, survival leans perception, and
 * brawn leans might.
 */
export interface FocusDef {
  id: Bias;
  label: string;
  description: string;
  primary: AttributeKey; // +3
  skills: { name: string; level: number }[]; // 4 levels total
}

export const focuses: FocusDef[] = [
  {
    id: "commerce",
    label: "Commerce",
    description: "Deals, cargo, and coin. You win with leverage and a good margin.",
    primary: "presence", // deals are made face to face
    skills: [
      { name: "negotiation", level: 2 },
      { name: "streetwise", level: 1 },
      { name: "mechanics", level: 1 },
    ],
  },
  {
    id: "combat",
    label: "Combat",
    description: "Guns and gunnery. When talk fails, you're already moving.",
    primary: "reflex", // shooting + reflexes win firefights
    skills: [
      { name: "smallArms", level: 2 },
      { name: "gunnery", level: 1 },
      { name: "melee", level: 1 },
    ],
  },
  {
    id: "intrigue",
    label: "Intrigue",
    description: "Shadows, secrets, and systems. You'd rather never be seen.",
    primary: "intellect", // the hacker/operator
    skills: [
      { name: "stealth", level: 2 },
      { name: "deception", level: 1 },
      { name: "electronics", level: 1 },
    ],
  },
  {
    id: "piloting",
    label: "Piloting",
    description: "The cockpit is where the world slows down. You fly like breathing.",
    primary: "reflex", // hands and instincts at the stick
    skills: [
      { name: "piloting", level: 2 },
      { name: "navigation", level: 1 },
      { name: "zeroG", level: 1 },
    ],
  },
  {
    id: "diplomacy",
    label: "Diplomacy",
    description: "Words as weapons. You move people, not just cargo.",
    primary: "presence", // words as weapons
    skills: [
      { name: "negotiation", level: 2 },
      { name: "streetwise", level: 1 },
      { name: "intimidation", level: 1 },
    ],
  },
  {
    id: "engineering",
    label: "Engineering",
    description: "Reactors, breaches, and dead systems. You speak the ship's language, and it answers.",
    primary: "intellect",
    skills: [
      { name: "mechanics", level: 2 },
      { name: "electronics", level: 1 },
      { name: "zeroG", level: 1 },
    ],
  },
  {
    id: "survival",
    label: "Survival",
    description: "Cold vac, empty lanes, no rescue coming. You read the danger early and outlast the rest.",
    primary: "perception",
    skills: [
      { name: "survival", level: 2 },
      { name: "perception", level: 1 },
      { name: "athletics", level: 1 },
    ],
  },
  {
    id: "brawn",
    label: "Brawn",
    description: "Up close and physical. You settle things with your hands, and rooms go quiet when you stand.",
    primary: "might",
    skills: [
      { name: "melee", level: 2 },
      { name: "athletics", level: 1 },
      { name: "intimidation", level: 1 },
    ],
  },
];

/**
 * The attribute each FOCUS makes you strong in (+3) — DERIVED from `focuses` so
 * it can never diverge from the wizard's display. The background then adds a
 * secondary (+1) and a weakness (-1) for texture.
 */
export const biasAttribute: Record<Bias, AttributeKey> = focuses.reduce(
  (acc, f) => {
    acc[f.id] = f.primary;
    return acc;
  },
  {} as Record<Bias, AttributeKey>,
);

/** Skill levels granted by focus/bias (4 levels each) — DERIVED from `focuses`. */
export const biasSkills: Record<Bias, { name: string; level: number }[]> = focuses.reduce(
  (acc, f) => {
    acc[f.id] = f.skills;
    return acc;
  },
  {} as Record<Bias, { name: string; level: number }[]>,
);

// ── World-flavored creation content (content/pack/drift/creation.ts) ─────────

export type BackgroundDef = (typeof pack.creation.backgrounds)[number];
export const backgrounds = pack.creation.backgrounds;

export type OptionDef = (typeof pack.creation.alignments)[number];
export const alignments = pack.creation.alignments;
export const ambitions = pack.creation.ambitions;

/** Base attribute spread before background is applied (equal for everyone). */
export const attributeBaseline: Record<AttributeKey, number> = {
  might: 0,
  reflex: 0,
  vitality: 0,
  intellect: 0,
  perception: 0,
  presence: 0,
};

/** Where each faction plants a new recruit — the patron lives here too. Authored
 *  on the content pack's factions (`homeLocationId`); re-exported for importers. */
export { FACTION_HOME } from "@/content/pack";

export type PatronDef = (typeof pack.creation.defaultPatron);

/**
 * The faction PATRON — a safe-harbor mentor who keeps a green recruit alive while
 * they find their feet (STARTER.md): rests them to full, spots stims, floats a few
 * credits when broke, and hands out safe starter work. Flavor per faction; the
 * mechanics (the free safety net) are engine-owned and cut off at net worth ¢600.
 */
export const FACTION_PATRON: Record<string, PatronDef> = pack.creation.patrons;

export function patronFor(factionId?: string): PatronDef {
  return FACTION_PATRON[factionId ?? ""] ?? pack.creation.defaultPatron;
}

/**
 * Starting loadout FLAVOR by faction (names only). Every recruit ships with the
 * SAME statline — a sidearm (1d8), light armor (+1 AC), and a utility tool — so no
 * build ever starts gunless or under-equipped; only the outfit's flavor differs by
 * faction (the user's "same stat-wise, different outfit" rule). Stats are hardcoded
 * below (itemId/damage/acBonus), not in the pack, so they can't drift apart.
 */

/** The standardized starting gear for a faction — identical stats for everyone
 *  (a sidearm, +1 armor, a tool), faction-flavored names. Catalog ids attach the
 *  mechanics (net worth, shops, combat). */
export function factionStarterGear(
  factionId?: string,
): { name: string; itemId?: string; damage?: string; acBonus?: number; detail?: string }[] {
  const f = pack.creation.starterGearFlavor[factionId ?? ""] ?? pack.creation.defaultStarterGear;
  return [
    { name: f.gun, itemId: "sidearm", damage: "1d8", detail: "faction-issue sidearm" },
    { name: f.armor, itemId: "paddedJacket", acBonus: 1, detail: "+1 AC" },
    { name: f.tool, detail: "part of your starting kit" },
  ];
}
