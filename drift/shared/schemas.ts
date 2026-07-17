import { z } from "zod";

/**
 * Single source of truth for DRIFT game state.
 *
 * Design notes:
 * - Attributes are stored as MODIFIERS (Reflex 18 -> +4). Party members in the
 *   save file are already given as modifiers; PCs get their scores reduced to
 *   modifiers at import time so the engine treats everyone uniformly.
 * - `actionModifiers` backs NON-skill action keys only (deathSave, shipSensors,
 *   initiative) — numbers with no derivation path. Real skill modifiers are
 *   ALWAYS live-derived (attribute mod + compressed proficiency + passives) so
 *   level-ups count; a stale precomputed skill entry is ignored (see rolls.ts).
 */

export const AttributeKey = z.enum([
  "might",
  "reflex",
  "vitality",
  "intellect",
  "perception",
  "presence",
]);
export type AttributeKey = z.infer<typeof AttributeKey>;

export const Attributes = z.object({
  might: z.number().int(),
  reflex: z.number().int(),
  vitality: z.number().int(),
  intellect: z.number().int(),
  perception: z.number().int(),
  presence: z.number().int(),
});
export type Attributes = z.infer<typeof Attributes>;

export const Skill = z.object({
  name: z.string(),
  level: z.number().int().min(0),
  ticks: z.number().int().min(0),
});
export type Skill = z.infer<typeof Skill>;

export const Injury = z.object({
  name: z.string(),
  effect: z.string().optional(),
});

export const GearItem = z.object({
  name: z.string(),
  detail: z.string().optional(),
  damage: z.string().optional(),
  rounds: z.number().int().optional(),
  acBonus: z.number().int().optional(),
  /** Catalog id (content/items.json) when this gear is a known mechanical item;
   *  absent on legacy freeform gear (ITEMS.md IT-1). */
  itemId: z.string().optional(),
  /** Stack size for consumables (e.g. "Stim ×3"); 1/absent for single items. */
  qty: z.number().int().positive().optional(),
  /** Set when this gear IS a delivery job's cargo (QUESTS.md 1b) — granted on
   *  accept, consumed by the engine on delivery, unsellable, slot-free (hauled,
   *  not packed). Kills the "sold AND delivered AND still carried" class. */
  jobId: z.string().optional(),
});

/**
 * A player-authored signature ability. Two shapes, both with balance caps:
 * - passive: a small always-on buff (skill +1/+2, or one attribute +1)
 * - trigger: in a narrow, GM-adjudicated scenario, a check resolves as a
 *   natural 20 (auto-crit). Limited by usesPerScene.
 */
export const UniqueSkill = z.object({
  name: z.string(),
  description: z.string(),
  kind: z.enum(["passive", "trigger"]),
  // passive
  passiveTargetType: z.enum(["skill", "attribute"]).optional(),
  passiveTarget: z.string().optional(),
  passiveAmount: z.number().int().min(1).max(2).optional(),
  // trigger
  triggerScenario: z.string().optional(),
  triggerEffect: z.literal("auto_crit").optional(),
  usesPerScene: z.number().int().min(1).max(3).default(1),
});
export type UniqueSkill = z.infer<typeof UniqueSkill>;

export const CharacterKind = z.enum(["pc", "party"]);

export const Character = z.object({
  id: z.string(),
  campaignId: z.string(),
  kind: CharacterKind,
  name: z.string(),
  attributes: Attributes,
  hp: z.number().int(),
  maxHp: z.number().int().positive(),
  ac: z.number().int(),
  slots: z.number().int().optional(),
  maxSlots: z.number().int().optional(),
  stims: z.number().int().min(0).default(0),
  credits: z.number().int().optional(),
  loyalty: z.number().int().min(0).max(5).optional(),
  // ── Crew metadata (CREW.md — kind "party" recruits; absent on PCs/legacy) ──
  /** The role they were hired for (muscle/gunner/medic/engineer/pilot/face). */
  crewRole: z.string().optional(),
  /** Crew tier they were built from (wage + stats table). */
  crewTier: z.enum(["T1", "T2", "T3"]).optional(),
  /** Wage per TENDAY (engine-charged as the clock advances). */
  wage: z.number().int().optional(),
  /** Vitality-based death save penalty is derived from attributes.vitality; this
   *  flag documents fragile crew (e.g. Josen at -4) for the UI. */
  fragile: z.boolean().default(false),
  skills: z.array(Skill),
  /** Precomputed QRC roll modifiers keyed by action label, e.g. "gunneryShip". */
  actionModifiers: z.record(z.string(), z.number().int()).default({}),
  backstory: z.string().optional(),
  drives: z.string().optional(),
  gear: z.array(GearItem).default([]),
  injuries: z.array(Injury).default([]),
  /** Death-save track while Downed (COMBAT.md — the Bleeding Out sequence). Absent
   *  when up; the engine seeds it the moment HP hits 0 and clears it on recovery,
   *  stabilise, or death. 3 successes → stabilise, 3 failures → dead. */
  deathSaves: z.object({ successes: z.number().int().min(0), failures: z.number().int().min(0) }).optional(),

  // ── Multiplayer / character-creation metadata (optional; absent on legacy PCs) ──
  /** Which faction the character starts embedded in. */
  parentFactionId: z.string().optional(),
  /** Loyalty to the parent faction; drops toward the break-away beat. */
  loyaltyToParent: z.number().int().min(0).max(5).optional(),
  /** Set once the character splits off and founds their own faction. */
  ownFactionId: z.string().optional(),
  /** Creation steering answers, kept for story hooks + dossier voice. */
  bias: z
    .enum(["commerce", "combat", "intrigue", "piloting", "diplomacy", "engineering", "survival", "brawn"])
    .optional(),
  alignment: z
    .enum([
      "ruthless",
      "pragmatic",
      "principled",
      "loyal",
      "slick",
      "ghost",
      "loud",
      "merciful",
      "reckless",
      "calculating",
      "greedy",
      "vengeful",
      "cynical",
      "zealous",
    ])
    .optional(),
  /** Player-selected sex (male/female). Optional — absent on legacy PCs. */
  sex: z.enum(["male", "female"]).optional(),
  /** Narrative appearance — what the character looks like. Set/rewritten by the
   *  Rook body-modification service (engine-owned bodyMod). */
  appearance: z.string().optional(),
  background: z.string().optional(),
  ambition: z.string().optional(),
  /** The line this character won't cross (e.g. "people aren't cargo"). */
  moralCode: z.string().optional(),
  /** Voice/personality notes so the GM can play them consistently as an NPC. */
  voiceNotes: z.string().optional(),
  uniqueSkill: UniqueSkill.optional(),
});
export type Character = z.infer<typeof Character>;

export const ShipWeapon = z.object({
  name: z.string(),
  type: z.enum(["kinetic", "energy", "missile", "ion"]),
  damage: z.string(),
  count: z.number().int().optional(),
  ammo: z.number().int().optional(),
});

export const Ship = z.object({
  id: z.string(),
  campaignId: z.string(),
  name: z.string(),
  shipClass: z.enum(["scout", "fighter", "hauler", "gunship", "corvette"]),
  hp: z.number().int(),
  maxHp: z.number().int().positive(),
  ac: z.number().int(),
  /** AC bonus applied when flown evasive. */
  evasiveAcBonus: z.number().int().default(0),
  /** Damage reduction per hit from plating. */
  damageReduction: z.number().int().default(0),
  weapons: z.array(ShipWeapon).default([]),
  hasShield: z.boolean().default(false),
  shieldReady: z.boolean().default(true),
  hasPointDefense: z.boolean().default(false),
  burstDriveReady: z.boolean().default(false),
  /** Ship-piloting DC modifier (racing thrusters = -2, i.e. easier). */
  dcModifier: z.number().int().default(0),
  buyoutRemaining: z.number().int().default(0),
  notes: z.string().optional(),
});
export type Ship = z.infer<typeof Ship>;

export const Faction = z.object({
  id: z.string(),
  universeId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  defaultRep: z.number().int().min(-5).max(5).default(0),
});
export type Faction = z.infer<typeof Faction>;

export const FactionRep = z.object({
  campaignId: z.string(),
  factionId: z.string(),
  rep: z.number().int().min(-5).max(5),
  standing: z.string().optional(),
});
export type FactionRep = z.infer<typeof FactionRep>;

export const Location = z.object({
  id: z.string(),
  universeId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Danger band (LOCATIONS.md). Optional — when unset it's derived from `tags`
   *  (shared/locations.ts `locationTier`), so existing seed rows need no migration. */
  tier: z.enum(["T1", "T2", "T3"]).optional(),
});
export type Location = z.infer<typeof Location>;

export const Npc = z.object({
  id: z.string(),
  universeId: z.string(),
  name: z.string(),
  oneBreath: z.string(),
  status: z.string().optional(),
  factionId: z.string().optional(),
  locationId: z.string().optional(),
  /** Occupational handle, e.g. "data broker" — the UI shows this when a player
   *  doesn't (yet) know the NPC's name. Universe-shared, set once at creation. */
  role: z.string().optional(),
  /** Alternate names this person is known by ("Ren (fixer)" aka "Renwick") —
   *  dedupe, retrieval, and presence matching honor these, so every name the
   *  prose uses resolves to the SAME record (CHECKS.md §2, the Ren/Renwick bug). */
  aliases: z.array(z.string()).optional(),
  /** Campaign that first spawned this NPC (provenance for generated NPCs that
   *  are promoted into the shared universe cast). Absent on the hand-seeded cast. */
  originCampaignId: z.string().optional(),
  /** Canonical personality — a demeanor + a tell the narrator plays consistently.
   *  Engine-generated (deterministic, seeded off id), set once, universe-shared. */
  quirk: z.string().optional(),
  /** Light backstory — an origin + a want + a complication; a latent quest hook.
   *  Same as quirk: engine-generated, set once, shared so the NPC is the same
   *  person for everyone. */
  backstory: z.string().optional(),
  /** FIXED physical description — build + face + one distinguishing mark. Engine-
   *  generated (deterministic off id), set once, universe-shared: the narrator
   *  describes FROM this and never re-invents the same person's body (the live
   *  failure: an NPC scarred in one scene, unmarked the next). */
  appearance: z.string().optional(),
  /** Pinned sex — CAPTURED from the fiction (the pronouns the narration itself
   *  first used, `inferNpcSex`), set once, then fed back every turn so the model
   *  can never regender the same person scene to scene. Absent until the
   *  narration establishes it — never guessed from the name. */
  sex: z.enum(["male", "female"]).optional(),
  /** Pinned COMBAT capability — set once from the tier they actually spawned/
   *  fought at (a canon match wins over the model's pick and the net-worth
   *  clamp; an un-tiered match gets stamped with whatever tier ended up
   *  spawning). Stops a named cast member from being a T3 boss one fight and a
   *  re-spawned T1 mook the next (CHECKS.md §2). */
  tier: z.enum(["T1", "T2", "T3"]).optional(),
  /** Pinned SPEECH PATTERN — engine-generated (deterministic off id), set once,
   *  universe-shared: HOW they talk (rhythm, formality, slang), distinct from
   *  `quirk`'s demeanor+tell. Stops a dockworker sounding like a poet one scene
   *  and a soldier the next. */
  voice: z.string().optional(),
  notes: z.string().optional(),
});
export type Npc = z.infer<typeof Npc>;

export const ClockMilestone = z.object({
  at: z.number().int(),
  effect: z.string(),
  done: z.boolean().default(false),
});

export const Clock = z.object({
  id: z.string(),
  campaignId: z.string(),
  name: z.string(),
  current: z.number().int().min(0),
  max: z.number().int().positive(),
  triggerText: z.string(),
  milestones: z.array(ClockMilestone).default([]),
  status: z.enum(["active", "paused", "complete"]).default("active"),
});
export type Clock = z.infer<typeof Clock>;

export const Thread = z.object({
  id: z.string(),
  campaignId: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(["active", "resolved"]).default("active"),
  entityRefs: z.array(z.string()).default([]),
});
export type Thread = z.infer<typeof Thread>;

export const Contract = z.object({
  id: z.string(),
  campaignId: z.string(),
  name: z.string(),
  payoutRange: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["standing", "active", "complete"]).default("standing"),
});
export type Contract = z.infer<typeof Contract>;

export const Roll = z.object({
  id: z.string(),
  sceneId: z.string().optional(),
  characterId: z.string().optional(),
  skill: z.string(),
  d20: z.number().int().min(1).max(20),
  modifier: z.number().int(),
  total: z.number().int(),
  dc: z.number().int().optional(),
  outcome: z.enum(["success", "failure", "n/a"]).default("n/a"),
  stakes: z.boolean().default(false),
  ticked: z.boolean().default(false),
  breakdown: z.string(),
  createdAt: z.string().optional(),
});
export type Roll = z.infer<typeof Roll>;

export const Scene = z.object({
  id: z.string(),
  campaignId: z.string(),
  seq: z.number().int(),
  title: z.string(),
  locationId: z.string().optional(),
  summary: z.string().optional(),
  entityRefs: z.array(z.string()).default([]),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  /** JSON snapshot of full campaign state at scene end (rewind point). */
  snapshot: z.unknown().optional(),
});
export type Scene = z.infer<typeof Scene>;

export const WorldEvent = z.object({
  id: z.string(),
  universeId: z.string(),
  sourceCampaignId: z.string(),
  factionIds: z.array(z.string()).default([]),
  locationId: z.string().optional(),
  headline: z.string(),
  detail: z.string().optional(),
  visibility: z.enum(["private", "canon"]).default("private"),
  createdAt: z.string().optional(),
});
export type WorldEvent = z.infer<typeof WorldEvent>;

export const Campaign = z.object({
  id: z.string(),
  universeId: z.string(),
  name: z.string(),
  playerId: z.string().optional(),
  status: z.enum(["active", "archived", "deceased"]).default("active"),
  currentLocationId: z.string().optional(),
  tendaysElapsed: z.number().int().min(0).default(0),
  narratorModel: z.string().optional(),
  /** One-line "current situation" headline, shown in the free opening recap. */
  situation: z.string().optional(),
  /** The PLAYER's own stated aim for their character — what THEY want out of play
   *  ("dig into people and build relationships", "get rich", "hunt the person who
   *  burned me"). Player-set, free text. Fed to the narrator every turn so the
   *  world bends toward it instead of forcing an unrelated questline. */
  directive: z.string().max(400).optional(),
  /** BACKSTORY.md — the tenday value at which a backstory beat (an NPC tie,
   *  ambition, or moral code) last surfaced in play. Undefined = never yet, so
   *  pressure is measured from campaign start. Engine-owned; reset by the turn
   *  route whenever `backstoryPressureDue` fires, regardless of the model's
   *  actual follow-through (a soft directive, like ambition/moralCode elsewhere). */
  lastBackstoryBeatTenday: z.number().int().min(0).optional(),
});
export type Campaign = z.infer<typeof Campaign>;

export const Universe = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string().optional(),
  primer: z.string(),
  styleRules: z.string().optional(),
});
export type Universe = z.infer<typeof Universe>;

/** Full campaign state assembled for the engine and for snapshots. */
export const CampaignState = z.object({
  universe: Universe,
  campaign: Campaign,
  characters: z.array(Character),
  ship: Ship.optional(),
  factions: z.array(Faction).default([]),
  factionRep: z.array(FactionRep).default([]),
  locations: z.array(Location).default([]),
  npcs: z.array(Npc).default([]),
  clocks: z.array(Clock).default([]),
  threads: z.array(Thread).default([]),
  contracts: z.array(Contract).default([]),
});
export type CampaignState = z.infer<typeof CampaignState>;
