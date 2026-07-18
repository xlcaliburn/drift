import { z } from "zod";
import { UniqueSkill, AttributeKey } from "@/shared/schemas";
import { catalogItem } from "@/shared/items";

/**
 * THE CONTENT PACK SCHEMA — the single authored source of world truth. Everything
 * the engine/UI needs to know about a universe that ISN'T mechanics lives here:
 * the setting primer, factions (with the fields play taught us to require),
 * locations (with map placement + hand-tuned travel lanes), the canonical cast,
 * and the job-generation flavor pools.
 *
 * The point of the seam: rebooting the WORLD is authoring a new pack, not a
 * refactor. Canon ids must never be hardcoded outside content/ — the canon-lint
 * test enforces it, and pack.test.ts validates referential integrity so a typo'd
 * home/lane/faction id fails CI instead of silently breaking retrieval.
 */

export const RouteRiskZ = z.enum(["low", "medium", "high"]);

export const PackLane = z.object({
  /** Destination location id (lanes are undirected — author on either endpoint). */
  to: z.string(),
  tendays: z.number().int().min(1).max(9),
  risk: RouteRiskZ,
  /** Why this lane is what it is — authoring note, never shown. */
  note: z.string().optional(),
});

export const PackLocation = z.object({
  id: z.string().regex(/^loc-[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()),
  /** LOCATIONS.md danger band: T1 secure / T2 rough / T3 deadly. */
  tier: z.enum(["T1", "T2", "T3"]),
  /** Hand-placed map position + node color (the MapTab layout). */
  mapPos: z.object({ x: z.number(), y: z.number(), color: z.string() }),
  /** Hand-tuned named lanes FROM this location (formula covers the rest). */
  lanes: z.array(PackLane).default([]),
});
export type PackLocation = z.infer<typeof PackLocation>;

export const PackFaction = z.object({
  id: z.string().regex(/^f-[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  defaultRep: z.number().int().default(0),
  /** Job-coherence character (QUESTS.md): who can plausibly OFFER what work. */
  alignment: z.enum(["official", "underworld", "neutral"]),
  /** Where this faction's recruits start / its patron is based. */
  homeLocationId: z.string(),
  /** UI accent for this faction (creation wizard, badges). */
  color: z.string(),
});
export type PackFaction = z.infer<typeof PackFaction>;

/** A canonical cast member — every field a season of live drift taught us to pin:
 *  a home (set-once), a faction, a role handle, and a GM-truth oneBreath. */
export const PackNpc = z.object({
  id: z.string().regex(/^npc-[a-z0-9-]+$/),
  name: z.string().min(1),
  oneBreath: z.string().min(1),
  factionId: z.string().optional(),
  locationId: z.string().optional(),
  role: z.string().optional(),
  /** Authored depth for STORYLINE cast (STORY.md, HANDOFF_STORY_1.md) — the
   *  generated-pool fallbacks (shared/npcFlavor.ts) stay for everyone else;
   *  these are GM-truth, never model-improvised. CONTRACT (HANDOFF_STORY_2.md
   *  Task A): `backstory` is SPOILER-SAFE and player-adjacent — it surfaces
   *  in the narrator's "[hook: ...]" line for anyone present, same as the
   *  generated fallback it replaces. Never put the reveal here; that's what
   *  `secret` is for. Read LIVE from the pack (content/pack's
   *  `authoredCastDepth`), never persisted onto the state-level Npc record. */
  backstory: z.string().optional(),
  /** The GATED reveal a storyline beat can spend — what the backstory is
   *  hiding. Rendered ONLY by promptSections/castReveals.ts, and only while
   *  this NPC's storyline chapter is active AND they're present — never fed
   *  alongside the always-on `backstory` hook. Same pack-only read path. */
  secret: z.string().optional(),
  /** How they change across the season, one line per act (index 0 = act 1). */
  arc: z.array(z.string()).optional(),
});
export type PackNpc = z.infer<typeof PackNpc>;

/** A creation-screen background's starting gear item. */
export const PackGearItem = z.object({
  name: z.string().min(1),
  detail: z.string().optional(),
  damage: z.string().optional(),
  acBonus: z.number().int().optional(),
});

/** One of the ~16 creation backgrounds (Modularity M1 Task D). The EQUAL-
 *  FOOTING math (every background nets the same +3 attribute budget) lives in
 *  content/creation.ts as a RULESET invariant, not here — this schema only
 *  carries the world-flavored CHOICES (which attributes, which gear, the hook
 *  prose); content/creation.test.ts / engine/creation.test.ts already pin
 *  built-character output byte-for-byte, so a bad move fails loudly. */
export const PackBackground = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  primary: AttributeKey,
  secondary: AttributeKey,
  weakness: AttributeKey,
  signatureSkill: z.string().min(1),
  gear: z.array(PackGearItem).min(1),
  hook: z.string().min(1),
});
export type PackBackground = z.infer<typeof PackBackground>;

/** A labeled, described creation OPTION — ambitions and alignments share this
 *  shape (id/label/description, no mechanical payload). */
export const PackOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
});
export type PackOption = z.infer<typeof PackOption>;

/** A faction's PATRON — the safe-harbor mentor STARTER.md's free early-game
 *  safety net plays as (mechanics are engine-owned; this is who they ARE). */
export const PackPatron = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  oneBreath: z.string().min(1),
});
export type PackPatron = z.infer<typeof PackPatron>;

/** Faction-flavored NAMES for the identical starting sidearm/armor/tool every
 *  recruit ships with — stats live in content/creation.ts's factionStarterGear
 *  (engine-owned, identical for everyone); only the outfit's flavor differs. */
export const PackStarterFlavor = z.object({
  gun: z.string().min(1),
  armor: z.string().min(1),
  tool: z.string().min(1),
});
export type PackStarterFlavor = z.infer<typeof PackStarterFlavor>;

/** World-flavored creation content (Modularity M1 Task D). Keyed maps
 *  (patrons/starterGearFlavor) are validated referentially by validatePack
 *  against `factions[].id` below — a Zod record can't enforce that itself. */
export const PackCreation = z.object({
  backgrounds: z.array(PackBackground).min(3),
  alignments: z.array(PackOption).min(3),
  ambitions: z.array(PackOption).min(3),
  patrons: z.record(z.string(), PackPatron),
  defaultPatron: PackPatron,
  starterGearFlavor: z.record(z.string(), PackStarterFlavor),
  defaultStarterGear: PackStarterFlavor,
});
export type PackCreation = z.infer<typeof PackCreation>;

/** A faction's player-facing onboarding blurb (creation screen). */
export const PackFactionBrief = z.object({
  factionId: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().min(1),
  brief: z.string().min(1),
  playstyle: z.string().min(1),
});
export type PackFactionBrief = z.infer<typeof PackFactionBrief>;

/** Player-facing onboarding prose (Modularity M1 Task E) — the world primer,
 *  the current season spine, and per-faction briefs shown during creation. */
export const PackBriefs = z.object({
  worldIntro: z.string().min(1),
  seasonOneSpine: z.string().min(1),
  factions: z.array(PackFactionBrief).min(1),
});
export type PackBriefs = z.infer<typeof PackBriefs>;

/** A faction's starting loaner hull — flown, not owned, until earned in play. */
export const PackLoaner = z.object({
  name: z.string().min(1),
  shipClass: z.enum(["scout", "fighter", "hauler", "gunship", "corvette"]),
  weaponName: z.string().min(1),
  notes: z.string().min(1),
});
export type PackLoaner = z.infer<typeof PackLoaner>;

/** Raw material for the creation-time opening-generation LLM pass — grounds it
 *  in real canon instead of freestyling. */
export const PackOpeningSeed = z.object({
  startLocation: z.string().min(1),
  recruitGoal: z.string().min(1),
  anchors: z.string().min(1),
  tension: z.string().min(1),
  leads: z.array(z.string().min(1)).min(1),
});
export type PackOpeningSeed = z.infer<typeof PackOpeningSeed>;

/** A faction's opening scenario + starting point — the static fallback (no API
 *  key / generation failure) AND the generation seed, in one record. */
export const PackFactionOpening = z.object({
  factionId: z.string().min(1),
  hook: z.string().min(1),
  threadTitle: z.string().min(1),
  threadBody: z.string().min(1),
  firstMoves: z.array(z.string().min(1)).min(1),
  loaner: PackLoaner.optional(),
  seed: PackOpeningSeed,
});
export type PackFactionOpening = z.infer<typeof PackFactionOpening>;

export const PackOpenings = z.object({
  factions: z.array(PackFactionOpening).min(1),
});
export type PackOpenings = z.infer<typeof PackOpenings>;

/** Free-text name pools a NEW character or NPC can draw from (Modularity M1
 *  Task B) — `suggestName()` combines given+surname, or picks a mononym; the
 *  SAME pool backs quest cast-manifest generation (`shared/quests.ts`), so a
 *  world reboot renames both the player's creation-screen suggestions and every
 *  generated NPC in one place. */
export const PackNames = z.object({
  given: z.array(z.string().min(1)).min(6),
  surnames: z.array(z.string().min(1)).min(6),
  /** Spacers who go by one handle instead of given+surname. */
  mononyms: z.array(z.string().min(1)).min(3),
});
export type PackNames = z.infer<typeof PackNames>;

/** Creation-screen inspiration gallery — hand-authored so the wizard never
 *  spends tokens generating throwaway suggestions. Lane-flavored PROSE, not
 *  mechanics (the balance caps `exampleSkills` respects are engine-enforced
 *  elsewhere, not by this data). */
export const PackExamples = z.object({
  skills: z.array(z.object({ blurb: z.string().min(1), skill: UniqueSkill })).min(3),
  moralCodes: z.array(z.string().min(1)).min(3),
  /** A defining loss/scar, a debt/tie, and a recognizable tell — the optional
   *  creation flavor prompts (blank → the finalize pass invents one). */
  losses: z.array(z.string().min(1)).min(3),
  ties: z.array(z.string().min(1)).min(3),
  tells: z.array(z.string().min(1)).min(3),
});
export type PackExamples = z.infer<typeof PackExamples>;

/** ⚠ ORDER-SENSITIVE (Modularity M1 Task C — see HANDOFF_MODULARITY_M1.md's
 *  named trap): `shared/npcFlavor.ts` hashes an NPC's id into each pool by
 *  INDEX for a stable, engine-owned personality/voice/body/backstory — many
 *  call sites are RENDER-TIME FALLBACKS (world.ts recomputes for any seed NPC
 *  without a persisted value, every turn), so reordering or resizing a pool
 *  here silently changes what every live campaign displays for that NPC.
 *  A world reboot may swap these pools' CONTENT freely; never their arity. */
export const PackNpcFlavor = z.object({
  demeanors: z.array(z.string().min(1)).min(6),
  tells: z.array(z.string().min(1)).min(6),
  drives: z.array(z.string().min(1)).min(6),
  hooks: z.array(z.string().min(1)).min(6),
  builds: z.array(z.string().min(1)).min(6),
  faces: z.array(z.string().min(1)).min(6),
  marks: z.array(z.string().min(1)).min(6),
  ages: z.array(z.string().min(1)).min(6),
  voices: z.array(z.string().min(1)).min(6),
  origins: z.array(z.string().min(1)).min(6),
});
export type PackNpcFlavor = z.infer<typeof PackNpcFlavor>;

/** Mechanical tuning catalogs (Modularity M1) — weapon/item/enemy-tier/ship-
 *  class/crew/economy tables. The pack owns the DATA (values), engine/ owns the
 *  MATH over it (a world reboot can retune numbers/flavor, never the shape the
 *  engine reads). Deliberately LOOSE here — each catalog's real internal shape
 *  is pinned by its own consumers' extensive test coverage (items/shop/combat/
 *  crew tests), not by this schema; this only guarantees every catalog exists
 *  and is a real object, so one can never silently go missing from a pack.
 *  `content/index.ts` re-exports the SAME underlying JSON with its natural
 *  precise type for consumers — this field is validation/completeness-only. */
/** A ship2 weapon mount's dice profile (COMBAT_V2.md Part B, HANDOFF_COMBAT_V2_2.md
 *  — the Eclipse-style "1 reliable die vs 6 swingy dice" tradeoff). `overchargeHitOn`
 *  is the lowered hit-on when +1 power is diverted to that mount (beam lance only
 *  this slice); `ammoLimited` mounts are subject to the defender's point-defense
 *  roll-down (`pdHitOn`) before armor/shields ever see the hit. */
export const PackShip2Mount = z.object({
  name: z.string().min(1),
  dice: z.number().int().min(1),
  hitOn: z.number().int().min(1).max(6),
  dmgPerHit: z.number().int().min(1),
  power: z.number().int().min(1),
  overchargeHitOn: z.number().int().min(1).max(6).optional(),
  ammoLimited: z.boolean().optional(),
  pdHitOn: z.number().int().min(1).max(6).optional(),
});
export type PackShip2Mount = z.infer<typeof PackShip2Mount>;

/** A shipClass's ship2 statline — reused for BOTH the player's derived profile
 *  (shared/ship2.ts's `deriveShip2Profile`) and enemy spawns. `mounts` is
 *  priority-ordered (the enemy's "guns" policy token funds the first unfunded
 *  one); `policy` is the enemy's deterministic allocation weights, resolved
 *  token-by-token until the reactor is spent or the list is exhausted.
 *  `mountSlots`/`systemSlots` (HANDOFF_COMBAT_V2_3.md) are the customization
 *  caps — deliberately allowed to exceed what the reactor can fire in one
 *  round (slots are the collection you choose from; power is the per-round
 *  constraint). */
export const PackShip2Class = z.object({
  reactor: z.number().int().min(1),
  engineCap: z.number().int().min(0),
  shieldCap: z.number().int().min(0),
  armor: z.number().int().min(0),
  mounts: z.array(z.string().min(1)).min(1),
  policy: z.array(z.enum(["guns", "shields", "engines"])).min(1),
  mountSlots: z.number().int().min(1),
  systemSlots: z.number().int().min(1),
});
export type PackShip2Class = z.infer<typeof PackShip2Class>;

/** A shipyard mount item (HANDOFF_COMBAT_V2_3.md Task B) — buying it appends
 *  a `weapons[]` entry with this type/damage; `shared/ship2.ts`'s
 *  WEAPON_TYPE_TO_MOUNT then derives the ship2 mount from `type` alone, same
 *  as any hand-authored weapon. */
export const PackShip2MountItem = z.object({
  name: z.string().min(1),
  type: z.enum(["kinetic", "energy", "ion", "missile"]),
  damage: z.string().min(1),
  /** Starting ammo for an ammo-limited type (missile). */
  ammo: z.number().int().min(1).optional(),
  price: z.number().int().min(1),
  tier: z.enum(["T1", "T2", "T3"]),
});
export type PackShip2MountItem = z.infer<typeof PackShip2MountItem>;

/** A shipyard system item — buying it SETS the named existing `Ship` field
 *  (no schema change: these are all columns the row already has).
 *  `numericValue` only matters for the two numeric fields; the three
 *  boolean fields always set to `true` on purchase. */
export const PackShip2SystemItem = z.object({
  name: z.string().min(1),
  field: z.enum(["damageReduction", "evasiveAcBonus", "hasShield", "hasPointDefense", "burstDriveReady"]),
  numericValue: z.number().int().min(1).optional(),
  price: z.number().int().min(1),
  tier: z.enum(["T1", "T2", "T3"]),
});
export type PackShip2SystemItem = z.infer<typeof PackShip2SystemItem>;

export const PackShip2Outfitting = z.object({
  mountItems: z.record(z.string(), PackShip2MountItem),
  systemItems: z.record(z.string(), PackShip2SystemItem),
});
export type PackShip2Outfitting = z.infer<typeof PackShip2Outfitting>;

export const PackShip2 = z.object({
  mounts: z.record(z.string(), PackShip2Mount),
  classes: z.record(z.string(), PackShip2Class),
  outfitting: PackShip2Outfitting,
});
export type PackShip2 = z.infer<typeof PackShip2>;

export const PackCatalogs = z.object({
  economy: z.record(z.string(), z.unknown()),
  weapons: z.record(z.string(), z.unknown()),
  enemyTiers: z.record(z.string(), z.unknown()),
  shipClasses: z.record(z.string(), z.unknown()),
  crew: z.record(z.string(), z.unknown()),
  items: z.record(z.string(), z.unknown()),
});
export type PackCatalogs = z.infer<typeof PackCatalogs>;

/**
 * The authored main questline (STORY.md, HANDOFF_STORY_1.md) — a season is
 * `pack.storyline.chapters`, an ORDERED array the engine reads live every
 * turn. Campaigns persist only PROGRESS POINTERS (chapter/beat/choice ids —
 * shared/storyline.ts); content itself is never copied into campaign_runtime,
 * which is what makes a chapter hot-editable mid-campaign. Ids are forever;
 * everything else (prose, triggers, rewards) is safe to rewrite.
 */

/** ALL specified conditions must hold (AND) — every field is a state
 *  predicate re-evaluated fresh each turn, so a campaign already past a
 *  threshold when this chapter ships opens on the very next turn (the
 *  "retrofit live campaigns" decision — no backfill, no event-edges). */
export const PackStoryTrigger = z.object({
  /** The prior chapter must be complete. Omit for an opening chapter. */
  requiresChapterId: z.string().optional(),
  tendaysAtLeast: z.number().int().min(0).optional(),
  atLocationId: z.string().optional(),
  factionRepAtLeast: z.object({ factionId: z.string(), rep: z.number().int() }).optional(),
  npcTrustAtLeast: z.object({ npcId: z.string(), disposition: z.number().int() }).optional(),
  /** Substring match against the facts ledger (shared/facts.ts). */
  hasFact: z.string().optional(),
});
export type PackStoryTrigger = z.infer<typeof PackStoryTrigger>;

/** A narrative directive fed to the narrator VERBATIM while its chapter is
 *  active, one at a time, marked delivered by the engine (the
 *  backstoryPressure pattern) — never model-improvised. `aboutNpcId` gates
 *  the mortal-NPC rule: if that cast member has died/departed by the time
 *  this beat comes up, `fallbackDirective` runs instead (both still count as
 *  delivered) — a storyline chapter must survive its own cast dying. */
export const PackStoryBeat = z.object({
  id: z.string().min(1),
  directive: z.string().min(1),
  fallbackDirective: z.string().optional(),
  aboutNpcId: z.string().optional(),
});
export type PackStoryBeat = z.infer<typeof PackStoryBeat>;

/** One branch of a chapter's choice point — picking it records `fact` on the
 *  ledger, which later chapters' triggers/beats can condition on. */
export const PackChoiceOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  fact: z.string().min(1),
});
export type PackChoiceOption = z.infer<typeof PackChoiceOption>;

/** An authored objective — the SAME shape `shared/quests.ts`'s `Objective`
 *  tracks progress in, minus `done` (the engine adds that at runtime). The
 *  `kind` enum is duplicated here rather than imported (same reason
 *  `PackLoaner.shipClass` duplicates `Ship.shipClass`): `shared/quests.ts`
 *  imports `pack` from this module's sibling `content/pack/index.ts`, so an
 *  import the other way would be circular. `pack.test.ts` pins the literal
 *  set matches `shared/quests.ts`'s `ObjectiveKind`. */
export const PackStoryObjective = z.object({
  id: z.string().min(1),
  kind: z.enum(["travel", "deliver", "eliminate", "survive", "investigate", "persuade", "sabotage", "report"]),
  summary: z.string().min(1),
  locationId: z.string().optional(),
  npcId: z.string().optional(),
  enemyTier: z.enum(["T1", "T2", "T3"]).optional(),
  requiredSkills: z.array(z.string()).optional(),
});
export type PackStoryObjective = z.infer<typeof PackStoryObjective>;

export const PackStoryChapter = z.object({
  id: z.string().min(1),
  act: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().min(1),
  trigger: PackStoryTrigger,
  /** Authored cast for this chapter — pack NPC ids, "use EXACTLY these
   *  people" (the cast-manifest rule; no generation). */
  castNpcIds: z.array(z.string()).default([]),
  objectives: z.array(PackStoryObjective).min(1),
  beats: z.array(PackStoryBeat).default([]),
  /** At most one branch point per chapter (STORY.md: "branch light"). */
  choicePoint: z.object({ id: z.string().min(1), prompt: z.string().min(1), options: z.array(PackChoiceOption).min(2) }).optional(),
  reward: z.object({
    credits: z.number().int().min(0),
    factionRep: z.object({ factionId: z.string(), delta: z.number().int() }).optional(),
    /** A SIGNATURE item reward (an act finale) — a shared/items CATALOG id;
     *  validatePack checks it resolves. Granted through the same full-pack
     *  pickup path loot uses (shared/storylineRuntime.ts): fits → straight
     *  into gear; pack full → parked as sceneCard.pendingPickup, same swap
     *  chips as any other pickup. */
    itemId: z.string().optional(),
    /** Raises this pack cast NPC to recruit-eligibility (disposition to at
     *  least TRUST_THRESHOLD) — `recruitOffer` still gates on berth/presence
     *  as normal; this only clears the trust bar. */
    crewUnlock: z.string().optional(),
  }),
});
export type PackStoryChapter = z.infer<typeof PackStoryChapter>;

export const PackStoryline = z.object({
  /** ORDERED — a chapter's position here has no mechanical meaning (triggers
   *  do the gating), but authoring reads top-to-bottom act by act. */
  chapters: z.array(PackStoryChapter).default([]),
});
export type PackStoryline = z.infer<typeof PackStoryline>;

/** ALL specified conditions must hold (AND) — same state-predicate style as
 *  PackStoryTrigger, minus `requiresChapterId` (a sidequest has no
 *  prerequisite quest chain) plus `actAtLeast` (gate to how far the season
 *  has progressed; the schema itself caps it to 1-3). */
export const PackSidequestTrigger = z.object({
  actAtLeast: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  factionRepAtLeast: z.object({ factionId: z.string(), rep: z.number().int() }).optional(),
  npcTrustAtLeast: z.object({ npcId: z.string(), disposition: z.number().int() }).optional(),
  hasFact: z.string().optional(),
});
export type PackSidequestTrigger = z.infer<typeof PackSidequestTrigger>;

/** An authored, PLACED side quest (STORY.md §2, HANDOFF_STORY_2.md Task C) —
 *  a thin wrapper on the existing Job machinery: same objective shape/kinds
 *  as a storyline chapter (`PackStoryObjective`, incl. `report`), materialized
 *  into a real OFFERED Job the moment its trigger holds and it hasn't already
 *  been taken (shared/sidequests.ts). Surfaces exactly like a generated board
 *  offer through the existing offeredJobs section (no seam) — but with a
 *  FIXED giver (a real pack cast id, never generated) and authored stakes. */
export const PackSidequest = z.object({
  /** Unique, prefix-free — the runtime materializes it as Job id `sq-<id>`. */
  id: z.string().min(1),
  title: z.string().min(1),
  blurb: z.string().min(1),
  /** The giver — a real pack cast id. Never a generated cast member. */
  giverNpcId: z.string().min(1),
  factionId: z.string().optional(),
  /** Authored stakes — the author's call, NOT clamped by payoutCeiling
   *  (that clamp only applies to the procedural generator). */
  tier: z.enum(["T0", "T1", "T2", "T3"]),
  /** Where this quest is OFFERED — station-local, like a generated board
   *  offer (shared/quests.ts refreshBoard's `postedLocationId`). */
  postedLocationId: z.string().min(1),
  trigger: PackSidequestTrigger.optional(),
  objectives: z.array(PackStoryObjective).min(1),
  cargo: z.string().optional(),
  complication: z.string().optional(),
  reward: z.object({
    repFactionId: z.string().optional(),
    repDelta: z.number().int().optional(),
  }),
});
export type PackSidequest = z.infer<typeof PackSidequest>;

export const ContentPack = z.object({
  universe: z.object({
    id: z.string().regex(/^uni-[a-z0-9-]+$/),
    name: z.string().min(1),
    /** The narrator's canon primer (rides the system prompt). */
    primer: z.string().min(1),
    styleRules: z.string().min(1),
    /** One-line setting frame for auxiliary model calls (creation finalize etc.). */
    settingLine: z.string().min(1),
  }),
  factions: z.array(PackFaction).min(1),
  locations: z.array(PackLocation).min(1),
  cast: z.array(PackNpc),
  names: PackNames,
  examples: PackExamples,
  npcFlavor: PackNpcFlavor,
  creation: PackCreation,
  briefs: PackBriefs,
  openings: PackOpenings,
  /** Job-generation flavor pools (QUESTS.md `fill()` placeholders). */
  jobFlavor: z.object({
    cargo: z.array(z.string()).min(3),
    targets: z.array(z.string()).min(3),
    complications: z.array(z.string()).min(3),
  }),
  /** Where world services live (engine-gated features pinned to a place). */
  services: z.object({
    /** The body-modification / respec parlor's location id. */
    bodyMod: z.string(),
  }),
  catalogs: PackCatalogs,
  /** The ship2 CombatSystem's statlines (HANDOFF_COMBAT_V2_2.md) — separate
   *  from `catalogs` (which is deliberately loose) because it needs REAL
   *  referential validation: every class's `mounts`/`policy` must resolve. */
  ship2: PackShip2,
  /** The authored main questline (STORY.md, HANDOFF_STORY_1.md) — empty on
   *  the live pack until the content slice ships (a dormant storyline). */
  storyline: PackStoryline,
  /** Authored, placed side quests (STORY.md §2, HANDOFF_STORY_2.md Task C) —
   *  empty on the live pack until the content slice ships. */
  sidequests: z.array(PackSidequest).default([]),
});
export type ContentPack = z.infer<typeof ContentPack>;

/** Validate a pack BEYOND the schema: referential integrity across ids. Returns
 *  human-readable problems (empty = valid). Run by pack.test.ts on the live pack. */
export function validatePack(pack: ContentPack): string[] {
  const problems: string[] = [];
  const locIds = new Set(pack.locations.map((l) => l.id));
  const facIds = new Set(pack.factions.map((f) => f.id));

  const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of dupes(pack.locations.map((l) => l.id))) problems.push(`duplicate location id: ${d}`);
  for (const d of dupes(pack.factions.map((f) => f.id))) problems.push(`duplicate faction id: ${d}`);
  for (const d of dupes(pack.cast.map((n) => n.id))) problems.push(`duplicate npc id: ${d}`);

  for (const f of pack.factions) {
    if (!locIds.has(f.homeLocationId)) problems.push(`faction ${f.id}: home ${f.homeLocationId} is not a location`);
  }
  for (const l of pack.locations) {
    for (const lane of l.lanes) {
      if (!locIds.has(lane.to)) problems.push(`location ${l.id}: lane to unknown ${lane.to}`);
      if (lane.to === l.id) problems.push(`location ${l.id}: lane to itself`);
    }
  }
  for (const n of pack.cast) {
    if (n.factionId && !facIds.has(n.factionId)) problems.push(`npc ${n.id}: unknown faction ${n.factionId}`);
    if (n.locationId && !locIds.has(n.locationId)) problems.push(`npc ${n.id}: unknown location ${n.locationId}`);
    // Factions must never be seeded as people (the live "Sable Chain the NPC" bug).
    if (pack.factions.some((f) => f.name.toLowerCase() === n.name.toLowerCase()))
      problems.push(`npc ${n.id}: name collides with a faction name (${n.name})`);
  }
  if (!locIds.has(pack.services.bodyMod)) problems.push(`services.bodyMod: unknown location ${pack.services.bodyMod}`);
  // ship2 (HANDOFF_COMBAT_V2_2.md): every class's owned mounts must resolve,
  // and every shipClass the OLD catalog knows about needs a ship2 statline too
  // (a new class added to catalogs.shipClasses without one would silently
  // fall back to nothing at fight start).
  for (const [classId, cls] of Object.entries(pack.ship2.classes)) {
    for (const mountId of cls.mounts) {
      if (!pack.ship2.mounts[mountId]) problems.push(`ship2.classes.${classId}: unknown mount ${mountId}`);
    }
    // HANDOFF_COMBAT_V2_3.md: a class's own default mounts must fit its slots
    // — the shipyard would otherwise "materialize" more mounts than the ship
    // has room for the moment it writes them into weapons[].
    if (cls.mountSlots < cls.mounts.length) {
      problems.push(`ship2.classes.${classId}: mountSlots (${cls.mountSlots}) below its default mounts (${cls.mounts.length})`);
    }
  }
  const knownShipClasses = (pack.catalogs.shipClasses as { classes?: Record<string, unknown> }).classes ?? {};
  for (const classId of Object.keys(knownShipClasses)) {
    if (!pack.ship2.classes[classId]) problems.push(`ship2.classes: missing a ship2 statline for shipClass ${classId}`);
  }
  // HANDOFF_COMBAT_V2_3.md: every shipyard mount item's weapon TYPE must
  // resolve to a real mount profile (mirrors shared/ship2.ts's
  // WEAPON_TYPE_TO_MOUNT — kept as a small local map here since the pack
  // schema itself doesn't encode that correspondence).
  const TYPE_TO_MOUNT: Record<string, string> = { kinetic: "railgun", energy: "beamLance", ion: "autocannon", missile: "missileRack" };
  for (const [itemId, item] of Object.entries(pack.ship2.outfitting.mountItems)) {
    const mountId = TYPE_TO_MOUNT[item.type];
    if (!mountId || !pack.ship2.mounts[mountId]) {
      problems.push(`ship2.outfitting.mountItems.${itemId}: type ${item.type} has no matching mount profile`);
    }
  }
  for (const fid of Object.keys(pack.creation.patrons)) {
    if (!facIds.has(fid)) problems.push(`creation.patrons: unknown faction ${fid}`);
  }
  for (const fid of Object.keys(pack.creation.starterGearFlavor)) {
    if (!facIds.has(fid)) problems.push(`creation.starterGearFlavor: unknown faction ${fid}`);
  }
  for (const b of pack.briefs.factions) {
    if (!facIds.has(b.factionId)) problems.push(`briefs: unknown faction ${b.factionId}`);
  }
  for (const o of pack.openings.factions) {
    if (!facIds.has(o.factionId)) problems.push(`openings: unknown faction ${o.factionId}`);
  }

  // Storyline (HANDOFF_STORY_1.md): the live pack ships empty, but the
  // referential rules matter the moment content lands, so they're checked
  // now against a schema-shaped fixture (pack.test.ts) rather than deferred.
  const npcIds = new Set(pack.cast.map((n) => n.id));
  const chapterIds = pack.storyline.chapters.map((c) => c.id);
  for (const d of dupes(chapterIds)) problems.push(`storyline: duplicate chapter id ${d}`);
  pack.storyline.chapters.forEach((chapter, i) => {
    const tag = `storyline.${chapter.id}`;
    for (const npcId of chapter.castNpcIds) {
      if (!npcIds.has(npcId)) problems.push(`${tag}: unknown cast npc ${npcId}`);
    }
    const { trigger } = chapter;
    if (trigger.requiresChapterId) {
      const priorIdx = chapterIds.indexOf(trigger.requiresChapterId);
      if (priorIdx === -1) problems.push(`${tag}: trigger requires unknown chapter ${trigger.requiresChapterId}`);
      else if (priorIdx >= i) problems.push(`${tag}: trigger requires a chapter that isn't EARLIER (${trigger.requiresChapterId})`);
    }
    if (trigger.atLocationId && !locIds.has(trigger.atLocationId)) {
      problems.push(`${tag}: trigger location ${trigger.atLocationId} is not a location`);
    }
    if (trigger.factionRepAtLeast && !facIds.has(trigger.factionRepAtLeast.factionId)) {
      problems.push(`${tag}: trigger faction ${trigger.factionRepAtLeast.factionId} is not a faction`);
    }
    if (trigger.npcTrustAtLeast && !npcIds.has(trigger.npcTrustAtLeast.npcId)) {
      problems.push(`${tag}: trigger npc ${trigger.npcTrustAtLeast.npcId} is not an npc`);
    }
    for (const obj of chapter.objectives) {
      if (obj.locationId && !locIds.has(obj.locationId)) problems.push(`${tag} objective ${obj.id}: unknown location ${obj.locationId}`);
      if (obj.npcId && !npcIds.has(obj.npcId)) problems.push(`${tag} objective ${obj.id}: unknown npc ${obj.npcId}`);
    }
    for (const beat of chapter.beats) {
      // The mortal-NPC rule: a beat ABOUT a cast member must survive their
      // death — no fallback means a dead NPC silently breaks the chapter.
      if (beat.aboutNpcId && !beat.fallbackDirective) {
        problems.push(`${tag} beat ${beat.id}: aboutNpcId set with no fallbackDirective (the mortal-NPC rule)`);
      }
      if (beat.aboutNpcId && !npcIds.has(beat.aboutNpcId)) problems.push(`${tag} beat ${beat.id}: unknown npc ${beat.aboutNpcId}`);
    }
    if (chapter.reward.factionRep && !facIds.has(chapter.reward.factionRep.factionId)) {
      problems.push(`${tag}: reward faction ${chapter.reward.factionRep.factionId} is not a faction`);
    }
    // Signature rewards (HANDOFF_STORY_2.md Task D).
    if (chapter.reward.itemId && !catalogItem(chapter.reward.itemId)) {
      problems.push(`${tag}: reward itemId ${chapter.reward.itemId} is not a catalog item`);
    }
    if (chapter.reward.crewUnlock && !npcIds.has(chapter.reward.crewUnlock)) {
      problems.push(`${tag}: reward crewUnlock ${chapter.reward.crewUnlock} is not an npc`);
    }
  });

  // Sidequests (HANDOFF_STORY_2.md Task C): thin wrapper on Job, placed +
  // triggered + one-shot via the jobs slice itself (no runtime slice here —
  // no referential rule needed for that).
  for (const d of dupes(pack.sidequests.map((sq) => sq.id))) problems.push(`sidequests: duplicate id ${d}`);
  for (const sq of pack.sidequests) {
    const tag = `sidequest.${sq.id}`;
    if (!npcIds.has(sq.giverNpcId)) problems.push(`${tag}: unknown giver npc ${sq.giverNpcId}`);
    if (!locIds.has(sq.postedLocationId)) problems.push(`${tag}: unknown postedLocationId ${sq.postedLocationId}`);
    if (sq.factionId && !facIds.has(sq.factionId)) problems.push(`${tag}: unknown faction ${sq.factionId}`);
    if (sq.trigger?.factionRepAtLeast && !facIds.has(sq.trigger.factionRepAtLeast.factionId)) {
      problems.push(`${tag}: trigger faction ${sq.trigger.factionRepAtLeast.factionId} is not a faction`);
    }
    if (sq.trigger?.npcTrustAtLeast && !npcIds.has(sq.trigger.npcTrustAtLeast.npcId)) {
      problems.push(`${tag}: trigger npc ${sq.trigger.npcTrustAtLeast.npcId} is not an npc`);
    }
    for (const obj of sq.objectives) {
      if (obj.locationId && !locIds.has(obj.locationId)) problems.push(`${tag} objective ${obj.id}: unknown location ${obj.locationId}`);
      if (obj.npcId && !npcIds.has(obj.npcId)) problems.push(`${tag} objective ${obj.id}: unknown npc ${obj.npcId}`);
    }
    if (sq.reward.repFactionId && !facIds.has(sq.reward.repFactionId)) {
      problems.push(`${tag}: reward faction ${sq.reward.repFactionId} is not a faction`);
    }
  }
  return problems;
}
