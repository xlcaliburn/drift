import type { AttributeKey } from "@/shared/schemas";

/**
 * Character-creation content: how questionnaire answers map to a starting sheet.
 * Tuned for EQUAL FOOTING — every background grants the same net attribute
 * points (+3) and comparable gear; answers change your shape, not your power.
 */

export type Bias = "commerce" | "combat" | "intrigue" | "piloting" | "diplomacy";

/** Skill levels granted by focus/bias (total 4 levels across each). */
export const biasSkills: Record<Bias, { name: string; level: number }[]> = {
  combat: [
    { name: "smallArms", level: 2 },
    { name: "gunnery", level: 1 },
    { name: "melee", level: 1 },
  ],
  commerce: [
    { name: "negotiation", level: 2 },
    { name: "streetwise", level: 1 },
    { name: "mechanics", level: 1 },
  ],
  intrigue: [
    { name: "stealth", level: 2 },
    { name: "deception", level: 1 },
    { name: "electronics", level: 1 },
  ],
  piloting: [
    { name: "piloting", level: 2 },
    { name: "navigation", level: 1 },
    { name: "zeroG", level: 1 },
  ],
  diplomacy: [
    { name: "negotiation", level: 2 },
    { name: "streetwise", level: 1 },
    { name: "intimidation", level: 1 },
  ],
};

export interface BackgroundDef {
  id: string;
  label: string;
  primary: AttributeKey; // +3
  secondary: AttributeKey; // +1
  weakness: AttributeKey; // -1
  signatureSkill: string; // +1 level
  gear: { name: string; detail?: string; damage?: string; acBonus?: number }[];
  hook: string;
}

export const backgrounds: BackgroundDef[] = [
  {
    id: "ex-military",
    label: "Ex-military contractor",
    primary: "reflex",
    secondary: "might",
    weakness: "presence",
    signatureSkill: "smallArms",
    gear: [
      { name: "Sidearm", damage: "1d8" },
      { name: "Combat rifle", damage: "2d6" },
      { name: "Ballistic vest", detail: "+2 AC", acBonus: 2 },
    ],
    hook: "You mustered out of a war nobody won, with skills that only pay in the wrong places.",
  },
  {
    id: "dock-rat",
    label: "Dock rat",
    primary: "reflex",
    secondary: "intellect",
    weakness: "presence",
    signatureSkill: "streetwise",
    gear: [
      { name: "Multitool" },
      { name: "Cracked datapad" },
      { name: "Sidearm", damage: "1d8" },
    ],
    hook: "Raised half-feral on the dock levels; you know every vent and every debt.",
  },
  {
    id: "corporate-insider",
    label: "Corporate insider",
    primary: "intellect",
    secondary: "presence",
    weakness: "might",
    signatureSkill: "negotiation",
    gear: [
      { name: "Encrypted datapad", detail: "clean corporate contacts" },
      { name: "Fine jacket", detail: "+1 AC", acBonus: 1 },
      { name: "Credchip" },
    ],
    hook: "You left with more than you were supposed to — and someone noticed.",
  },
  {
    id: "salvager",
    label: "Wreck-field salvager",
    primary: "intellect",
    secondary: "might",
    weakness: "presence",
    signatureSkill: "mechanics",
    gear: [
      { name: "Cutting tool", damage: "1d6" },
      { name: "Sealed vac suit", detail: "vacuum-rated" },
      { name: "Salvage scanner" },
    ],
    hook: "You've pulled value and bodies out of dead ships. Some of them talked back.",
  },
  {
    id: "fixer",
    label: "Station fixer",
    primary: "presence",
    secondary: "intellect",
    weakness: "might",
    signatureSkill: "streetwise",
    gear: [
      { name: "Sidearm", damage: "1d8" },
      { name: "Little black book", detail: "favors owed and owing" },
      { name: "Credchip" },
    ],
    hook: "You make problems disappear for a cut. The favors are stacking up.",
  },
  {
    id: "void-marine",
    label: "Void marine",
    primary: "might",
    secondary: "vitality",
    weakness: "intellect",
    signatureSkill: "melee",
    gear: [
      { name: "Riot gun", damage: "2d6" },
      { name: "Combat knife", damage: "1d6" },
      { name: "Heavy plate", detail: "+2 AC", acBonus: 2 },
    ],
    hook: "Boarding actions and breach-and-clears were your trade. The war ended; the reflexes didn't.",
  },
  {
    id: "long-hauler",
    label: "Long-haul crewer",
    primary: "vitality",
    secondary: "perception",
    weakness: "presence",
    signatureSkill: "navigation",
    gear: [
      { name: "Sealed vac suit", detail: "vacuum-rated" },
      { name: "Route ledger", detail: "clean lanes and quiet ports" },
      { name: "Sidearm", damage: "1d8" },
    ],
    hook: "Years in the black on someone else's hull taught you patience — and every trick to survive it.",
  },
  {
    id: "scout-surveyor",
    label: "Deep-range scout",
    primary: "perception",
    secondary: "reflex",
    weakness: "might",
    signatureSkill: "survival",
    gear: [
      { name: "Marksman carbine", damage: "2d6" },
      { name: "Scout armor", detail: "+1 AC", acBonus: 1 },
      { name: "Recon optics & survival kit" },
    ],
    hook: "You went out ahead of everyone, into places with no name yet. Something out there still owes you answers.",
  },
];

export interface OptionDef {
  id: string;
  label: string;
  description: string;
}

export const alignments: OptionDef[] = [
  { id: "ruthless", label: "Ruthless", description: "Whatever it takes. Rivals learn to fear you; allies keep one eye open." },
  { id: "pragmatic", label: "Pragmatic", description: "The job comes first. You bend, but you don't break your word." },
  { id: "principled", label: "Principled", description: "A code you won't cross. It costs you, and it earns rare trust." },
];

export const ambitions: OptionDef[] = [
  { id: "wealth", label: "Wealth", description: "Enough credits to never take orders again." },
  { id: "command", label: "Command", description: "Your own faction, your own name on the door." },
  { id: "freedom", label: "Freedom", description: "No masters, no debts, no leash." },
  { id: "revenge", label: "Revenge", description: "Someone owes a debt in blood or ruin." },
  { id: "cause", label: "A cause", description: "The lanes could be fairer. You mean to make them." },
  { id: "belonging", label: "Belonging", description: "A crew that stays. A place that's yours." },
];

/** Base attribute spread before background is applied (equal for everyone). */
export const attributeBaseline: Record<AttributeKey, number> = {
  might: 0,
  reflex: 0,
  vitality: 0,
  intellect: 0,
  perception: 0,
  presence: 0,
};
