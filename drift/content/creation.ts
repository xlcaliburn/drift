import type { AttributeKey } from "@/shared/schemas";

/**
 * Character-creation content: how questionnaire answers map to a starting sheet.
 * Tuned for EQUAL FOOTING — every background grants the same net attribute
 * points (+3) and comparable gear; answers change your shape, not your power.
 */

export type Bias = "commerce" | "combat" | "intrigue" | "piloting" | "diplomacy";

/**
 * The attribute your FOCUS makes you strong in (+3). This is the player's main
 * build choice, so it drives the primary attribute — the background then adds a
 * secondary (+1) and a weakness (-1) for texture. Chosen to reinforce the focus's
 * signature skills: combat/piloting/intrigue lean reflex-adjacent, the social
 * focuses lean presence, and intrigue takes intellect (the operator/hacker).
 */
export const biasAttribute: Record<Bias, AttributeKey> = {
  combat: "reflex", // shooting + reflexes win firefights
  piloting: "reflex", // hands and instincts at the stick
  intrigue: "intellect", // the hacker/operator
  commerce: "presence", // deals are made face to face
  diplomacy: "presence", // words as weapons
};

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
    signatureSkill: "scavenging",
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
  {
    id: "smuggler-pilot",
    label: "Smuggler pilot",
    primary: "reflex",
    secondary: "perception",
    weakness: "presence",
    signatureSkill: "piloting",
    gear: [
      { name: "Sidearm", damage: "1d8" },
      { name: "Doctored transponder", detail: "spoofs a clean registry" },
      { name: "Hidden hold", detail: "a compartment the scanners miss" },
    ],
    hook: "You've run cargo nobody logs through gaps nobody charts. One run went wrong, and the wrong people remember your hull.",
  },
  {
    id: "station-mechanic",
    label: "Station mechanic",
    primary: "intellect",
    secondary: "might",
    weakness: "presence",
    signatureSkill: "mechanics",
    gear: [
      { name: "Heavy wrench", damage: "1d6" },
      { name: "Field toolkit", detail: "jury-rig almost anything" },
      { name: "Patched coveralls", detail: "+1 AC", acBonus: 1 },
    ],
    hook: "You kept other people's ships flying for scale wages and no thanks. You know exactly how easily any of them comes apart.",
  },
  {
    id: "slicer",
    label: "Black-ice slicer",
    primary: "intellect",
    secondary: "reflex",
    weakness: "might",
    signatureSkill: "electronics",
    gear: [
      { name: "Breaker deck", detail: "cracks hostile systems" },
      { name: "Holdout pistol", damage: "1d6" },
      { name: "Spoofed credentials", detail: "good until someone checks" },
    ],
    hook: "You went too deep into a system that was guarded for a reason. You got out with a fortune's worth of secrets and a bounty to match.",
  },
  {
    id: "grifter",
    label: "Grifter",
    primary: "presence",
    secondary: "reflex",
    weakness: "might",
    signatureSkill: "deception",
    gear: [
      { name: "Forged IDs", detail: "a name for every occasion" },
      { name: "Fine clothes", detail: "+1 AC (nothing's cheap)", acBonus: 1 },
      { name: "Holdout pistol", damage: "1d6" },
    ],
    hook: "You've been six different people this year, and one of them owes a debt that could get all six killed.",
  },
  {
    id: "enforcer",
    label: "Syndicate enforcer",
    primary: "might",
    secondary: "presence",
    weakness: "intellect",
    signatureSkill: "intimidation",
    gear: [
      { name: "Shock baton", damage: "1d8" },
      { name: "Armored coat", detail: "+2 AC", acBonus: 2 },
      { name: "A name that opens doors", detail: "and closes throats" },
    ],
    hook: "You collected debts and settled scores for people who never got their own hands dirty. Then you walked — and a debt of your own came due.",
  },
  {
    id: "void-diver",
    label: "Void diver",
    primary: "reflex",
    secondary: "vitality",
    weakness: "presence",
    signatureSkill: "zeroG",
    gear: [
      { name: "Hardened vac suit", detail: "+1 AC, rated for the deep", acBonus: 1 },
      { name: "Maglock boots" },
      { name: "Cutting torch", damage: "1d6" },
    ],
    hook: "You work where there's no up, no air, and no second chances — hull breaches, dead drifts, the wrecks nobody else will enter.",
  },
  {
    id: "bounty-tracker",
    label: "Bounty tracker",
    primary: "perception",
    secondary: "might",
    weakness: "presence",
    signatureSkill: "perception",
    gear: [
      { name: "Hunting rifle", damage: "2d6" },
      { name: "Stun cuffs", detail: "bring 'em in breathing (usually)" },
      { name: "Tracker kit", detail: "signatures, scents, silences" },
    ],
    hook: "You find people who don't want finding. The last mark you brought in named a name — and now that name is looking for you.",
  },
  {
    id: "cat-burglar",
    label: "Cat burglar",
    primary: "reflex",
    secondary: "intellect",
    weakness: "might",
    signatureSkill: "stealth",
    gear: [
      { name: "Grapnel line", detail: "up, over, gone" },
      { name: "Lockpick set", detail: "mechanical and otherwise" },
      { name: "Silenced pistol", damage: "1d6" },
    ],
    hook: "You take what's guarded and leave no trace — except once, you did. Someone has the recording, and they want a favor.",
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
  { id: "loyal", label: "Loyal", description: "Crew is family. You'd burn a fortune before you'd sell out your own." },
  { id: "slick", label: "Slick", description: "Words before weapons, angles before either. Everyone's a mark; nobody's an enemy — yet." },
  { id: "ghost", label: "Ghost", description: "Stay small, stay quiet, leave no name behind. The lanes never see you coming." },
  { id: "loud", label: "Loud", description: "Reputation is currency. Every job is a story, and you're the headline." },
  { id: "merciful", label: "Merciful", description: "You'll fight, but you never finish the fallen. Kindness in a hard place — some read it as weakness." },
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
