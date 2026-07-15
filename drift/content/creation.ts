import type { AttributeKey } from "@/shared/schemas";

/**
 * Character-creation content: how questionnaire answers map to a starting sheet.
 * Tuned for EQUAL FOOTING — every background grants the same net attribute
 * points (+3) and comparable gear; answers change your shape, not your power.
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
  { id: "reckless", label: "Reckless", description: "Act first, reckon later — hesitation gets people killed. You'd rather burn bright than play it safe." },
  { id: "calculating", label: "Calculating", description: "Every move is three moves deep. You don't gamble; you wait for the odds to bend your way." },
  { id: "greedy", label: "Greedy", description: "There's no such thing as enough. The next score is always the one worth the risk." },
  { id: "vengeful", label: "Vengeful", description: "You keep a ledger of every wrong, and you always collect. Cross you once and you'll spend years making it right." },
  { id: "cynical", label: "Cynical", description: "Everyone's working an angle, and you've stopped pretending otherwise. Trust is a cost you rarely pay." },
  { id: "zealous", label: "Zealous", description: "You believe in something bigger than the paycheck, and you'll bleed for it. Doubt is for people with nothing to fight for." },
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

/**
 * Starting loadout FLAVOR by faction (names only). Every recruit ships with the
 * SAME statline — a sidearm (1d8), light armor (+1 AC), and a utility tool — so no
 * build ever starts gunless or under-equipped; only the outfit's flavor differs by
 * faction (the user's "same stat-wise, different outfit" rule). Stats live in
 * `factionStarterGear`, not here, so they can't drift apart.
 */
const FACTION_STARTER_FLAVOR: Record<string, { gun: string; armor: string; tool: string }> = {
  "f-crown": { gun: "Crown service pistol", armor: "Crown-issue vest", tool: "Crown ledger-chit" },
  "f-meridian": { gun: "Bonded sidearm", armor: "Broker's lined coat", tool: "Trade credentials" },
  "f-sable": { gun: "Back-alley snub pistol", armor: "Reinforced jacket", tool: "Burner comm" },
  "f-ledger": { gun: "Holdout pistol", armor: "Courier's vest", tool: "Cipher slate" },
  "f-undertow": { gun: "Collector's sidearm", armor: "Enforcer's padded coat", tool: "Debt ledger" },
  "f-talos": { gun: "Security sidearm", armor: "Frontier plate-vest", tool: "Checkpoint scanner" },
  "f-wreckers": { gun: "Salvaged slugthrower", armor: "Scrap-plate harness", tool: "Cutting torch" },
  "f-free": { gun: "Worn sidearm", armor: "Patched flak jacket", tool: "Multitool" },
  "f-reclaimers": { gun: "Reclaimer bolt pistol", armor: "Salvager's vac-vest", tool: "Salvage scanner" },
  "f-commons": { gun: "Homemade pistol", armor: "Dockworker's padding", tool: "Worn multitool" },
  "f-rook": { gun: "Street sidearm", armor: "Padded jacket", tool: "Multitool" },
};
const DEFAULT_STARTER = { gun: "Sidearm", armor: "Padded jacket", tool: "Multitool" };

/** Where each faction plants a new recruit — the patron lives here too. Mirrors
 *  FACTION_HOME in newCampaign (kept here so content owns the patron placement). */
export const FACTION_HOME: Record<string, string> = {
  "f-crown": "loc-meridian",
  "f-meridian": "loc-meridian",
  "f-sable": "loc-rook",
  "f-ledger": "loc-rook",
  "f-undertow": "loc-undertow",
  "f-talos": "loc-talos",
  "f-wreckers": "loc-nest",
  "f-free": "loc-rook",
  "f-reclaimers": "loc-rook",
  "f-commons": "loc-meridian",
  "f-rook": "loc-rook",
};

export interface PatronDef {
  name: string;
  role: string;
  oneBreath: string;
}

/**
 * The faction PATRON — a safe-harbor mentor who keeps a green recruit alive while
 * they find their feet (STARTER.md): rests them to full, spots stims, floats a few
 * credits when broke, and hands out safe starter work. Flavor per faction; the
 * mechanics (the free safety net) are engine-owned and cut off at net worth ¢600.
 */
export const FACTION_PATRON: Record<string, PatronDef> = {
  "f-crown": {
    name: "Quartermaster Vane",
    role: "Crown recruit-handler",
    oneBreath: "The Hollow Crown's recruit-handler on Meridian — gruff, fair, keeps green contractors alive long enough to be useful. Patches you up and points you at safe work until you're on your feet.",
  },
  "f-meridian": {
    name: "Steward Harrow",
    role: "trade-house steward",
    oneBreath: "A Meridian trade-house steward who takes in new hands — feeds you, mends you, and lines up honest cargo runs while you learn the lanes.",
  },
  "f-sable": {
    name: "Handler Sereda",
    role: "Sable Chain handler",
    oneBreath: "A Sable Chain handler working Rook's back rooms — cold but invested in her recruits; keeps you patched, armed, and pointed at the Chain's easy money until you prove out.",
  },
  "f-ledger": {
    name: "Old Marn",
    role: "Ledger steward",
    oneBreath: "A Ledger network steward on Rook — no-questions, no-judgment; gives couriers a berth, a meal, and a safe first run while they earn their marks.",
  },
  "f-undertow": {
    name: "Collector Roan",
    role: "Undertow desk-boss",
    oneBreath: "The Undertow's desk-boss at the outpost — grim but loyal to his own; keeps new collectors alive and fed, and starts them on small, safe debts to work.",
  },
  "f-talos": {
    name: "Sergeant Daccett",
    role: "Talos security quartermaster",
    oneBreath: "Talos security's quartermaster — hard-line but looks after the frontier's rookies; a bunk, a medbay, and safe patrol work until you can hold the line yourself.",
  },
  "f-wreckers": {
    name: "Boneyard Ma",
    role: "Wrecker den-mother",
    oneBreath: "The Nest's den-mother — the closest thing the Wreckers have to law; patches up the young raiders, shares the pot, and sends them on the safer salvage until they've got teeth.",
  },
  "f-free": {
    name: "Old Pell",
    role: "Free Drift fixer",
    oneBreath: "A Free Drift fixer on Rook, all mutual-aid and no-questions — spots a struggling independent a meal, a mend, and a milk run until they can stand on their own.",
  },
  "f-reclaimers": {
    name: "Archivist Sund",
    role: "Reclaimer steward",
    oneBreath: "A Reclaimer collective steward on Rook — patient, careful; keeps new salvagers whole and starts them on safe derelict work while they learn what the wrecks hold.",
  },
  "f-commons": {
    name: "Deacon Iyer",
    role: "Commons organizer",
    oneBreath: "A Commons organizer moving quietly through Meridian's dock levels — shelters the hunted, mends the hurt, and puts new hands to safe, useful work against the debt.",
  },
};
const DEFAULT_PATRON: PatronDef = {
  name: "The Harbor-keeper",
  role: "dockside fixer",
  oneBreath: "A dockside fixer who looks after green newcomers — a berth, a mend, a few creds, and a safe first job until they can stand on their own.",
};

export function patronFor(factionId?: string): PatronDef {
  return FACTION_PATRON[factionId ?? ""] ?? DEFAULT_PATRON;
}

/** The standardized starting gear for a faction — identical stats for everyone
 *  (a sidearm, +1 armor, a tool), faction-flavored names. Catalog ids attach the
 *  mechanics (net worth, shops, combat). */
export function factionStarterGear(
  factionId?: string,
): { name: string; itemId?: string; damage?: string; acBonus?: number; detail?: string }[] {
  const f = FACTION_STARTER_FLAVOR[factionId ?? ""] ?? DEFAULT_STARTER;
  return [
    { name: f.gun, itemId: "sidearm", damage: "1d8", detail: "faction-issue sidearm" },
    { name: f.armor, itemId: "paddedJacket", acBonus: 1, detail: "+1 AC" },
    { name: f.tool, detail: "part of your starting kit" },
  ];
}
