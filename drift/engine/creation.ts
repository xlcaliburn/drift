import { Character, type Attributes, type Skill, type Npc, type CampaignState } from "@/shared/schemas";
import type { CreationInput } from "@/shared/multiplayer";
import type { NpcRelation } from "@/shared/scene";
import { seededRng, type RNG } from "@/engine/rng";
import { backgrounds, biasSkills, biasAttribute, attributeBaseline, factionStarterGear, patronFor, FACTION_HOME } from "@/content/creation";
import { DEFAULT_HOME_LOCATION } from "@/content/pack";
import { mapLegacyGear } from "@/shared/items";
import { weaponSkill } from "@/shared/combat";

/**
 * Turn character-creation answers into a starting sheet — pure and
 * deterministic. Tuned for parity: every background nets +3 attribute points
 * and comparable gear, so answers change shape, not power.
 */
export function buildCharacterFromCreation(
  input: CreationInput,
  ids: { id: string; campaignId: string },
): Character {
  const bg = backgrounds.find((b) => b.id === input.background);
  if (!bg) throw new Error(`unknown background: ${input.background}`);

  // Attributes: your FOCUS drives the primary (+3) — it's the main build choice —
  // and the background adds a secondary (+1) and a weakness (-1) for texture.
  // Net is always +3 regardless of overlap, so every character stays equal-footing.
  const attributes: Attributes = { ...attributeBaseline };
  attributes[biasAttribute[input.bias]] += 3;
  attributes[bg.secondary] += 1;
  attributes[bg.weakness] -= 1;

  // Skills: bias grants + the background's signature skill (+1, merged).
  const skills: Skill[] = biasSkills[input.bias].map((s) => ({
    name: s.name,
    level: s.level,
    ticks: 0,
  }));
  addSkillLevel(skills, bg.signatureSkill, 1);

  // Vitals derived from attributes + gear. Base 18: a fresh character survives
  // several hits, so a lone T2 is a roughly even ~3-4 round duel rather than a
  // one-shot. (Deliberate rebalance — hazard-damage numbers are unchanged; HP is
  // the lever, so a fight lasts a handful of rounds instead of ending in one volley.)
  const maxHp = Math.max(1, 18 + attributes.vitality);
  // Starting gear is FACTION-issued and standardized (a sidearm, +1 armor, a tool) —
  // the SAME statline for everyone so no build starts gunless, only the flavor differs
  // by faction. The background sets attributes/skills/hook, not the loadout.
  const startGear = factionStarterGear(input.parentFactionId);
  // Armor = the BEST single piece, not a sum — the rule the engine applies when
  // armor is bought/sold later (no vest-stacking).
  const armorBonus = Math.max(0, ...startGear.map((g) => g.acBonus ?? 0));
  const ac = 10 + attributes.reflex + armorBonus;
  // Attach catalog ids to the loadout (price/slot data ride the id; names stay).
  const gear = mapLegacyGear({ gear: startGear.map((g) => ({ ...g })) }).gear;

  return Character.parse({
    id: ids.id,
    campaignId: ids.campaignId,
    kind: "pc",
    name: input.name,
    attributes,
    hp: maxHp,
    maxHp,
    ac,
    slots: 8,
    maxSlots: 8,
    stims: 2,
    credits: 120, // flat starting credits — equal footing, thin (a low-level minion's pocket)
    fragile: false,
    skills,
    actionModifiers: {},
    backstory: bg.hook,
    drives: input.flavor.moralCode,
    gear,
    injuries: [],
    parentFactionId: input.parentFactionId,
    loyaltyToParent: 4,
    bias: input.bias,
    alignment: input.alignment,
    sex: input.sex,
    background: input.background,
    ambition: input.ambition,
    moralCode: input.flavor.moralCode,
    uniqueSkill: input.uniqueSkill,
  });
}

function addSkillLevel(skills: Skill[], name: string, delta: number) {
  const existing = skills.find((s) => s.name === name);
  if (existing) existing.level += delta;
  else skills.push({ name, level: delta, ticks: 0 });
}

/**
 * Guarantee a PC carries at least one GUN. New characters get one in their faction
 * kit, but LEGACY characters (whose old background gave no firearm — a broker, a
 * corporate insider) could start gunless. Run on load: if the PC has no ranged
 * weapon, add their faction-flavored sidearm. Non-PCs and anyone already armed pass
 * through untouched.
 */
export function ensureStartingGun(c: Character): Character {
  if (c.kind !== "pc") return c;
  const hasGun = (c.gear ?? []).some((g) => g.damage && weaponSkill(g.name) === "smallArms");
  if (hasGun) return c;
  const gun = factionStarterGear(c.parentFactionId).find((g) => g.itemId === "sidearm");
  if (!gun) return c;
  return {
    ...c,
    gear: [...(c.gear ?? []), { name: gun.name, itemId: gun.itemId, damage: gun.damage, detail: "faction-issue sidearm" }],
  };
}

// ── Faction patron (safe-harbor helper, seeded at creation) ──────────────────

/** Stable id of a campaign's patron NPC (STARTER.md). */
export function patronNpcId(campaignId: string): string {
  return `npc-patron-${campaignId}`;
}

/** Is this the campaign's PATRON? Patron ids are always `npc-patron-<campaignId>`.
 *  The patron is a permanently home-station-seeded safe-harbor NPC, so it must be
 *  excluded from PASSIVE surfacing (co-location / faction) — otherwise it leaks into
 *  every scene at its home station as a phantom "nearby" figure. It should surface
 *  only when actually present or named. */
export function isPatronNpcId(id: string): boolean {
  return id.startsWith("npc-patron-");
}

/**
 * Build the campaign's PATRON — a faction-flavored safe-harbor mentor placed at the
 * recruit's home location, with a pre-filled warm standing. The engine (restWithPatron)
 * owns the free safety net; this just puts the person in the world. Deterministic.
 */
export function buildPatronNpc(opts: {
  campaignId: string;
  universeId: string;
  factionId?: string;
}): BackstoryNpcSeed {
  const def = patronFor(opts.factionId);
  const id = patronNpcId(opts.campaignId);
  const locationId = FACTION_HOME[opts.factionId ?? ""] ?? DEFAULT_HOME_LOCATION;
  const npc: Npc = {
    id,
    universeId: opts.universeId,
    name: def.name,
    oneBreath: def.oneBreath,
    role: def.role,
    originCampaignId: opts.campaignId,
    locationId,
  };
  const relation: NpcRelation = {
    relationship: "your patron",
    disposition: 1,
    nameKnown: true,
    lastNote: `Took you in — a berth, a mend, and safe work while you find your feet.`,
    log: [{ note: `${def.name} took you under their wing: a safe berth, patch-ups, and steady starter work.`, scene: 1 }],
  };
  return { npc, id, relation };
}

/**
 * Load-time BACKSTOP (STARTER.md): a campaign created before patrons existed has no
 * `npc-patron-<id>`. Given the campaign state, synthesize its patron seed so the free
 * safety net is available to legacy players too — mirrors ensureStartingGun. Returns
 * null when a patron already exists (idempotent) or there's no PC to anchor it to.
 * The caller folds the npc into state.npcs and the relation into npcRelations.
 */
export function ensurePatronSeed(state: CampaignState): BackstoryNpcSeed | null {
  const id = patronNpcId(state.campaign.id);
  if (state.npcs.some((n) => n.id === id)) return null;
  const pc = state.characters.find((c) => c.kind === "pc");
  if (!pc) return null;
  return buildPatronNpc({
    campaignId: state.campaign.id,
    universeId: state.universe.id,
    factionId: pc.parentFactionId,
  });
}

// ── Backstory NPCs (universe-shared, seeded at creation) ─────────────────────

/** A person named in the PC's backstory, as returned by the creation story pass. */
export interface BackstoryRelationInput {
  name: string;
  /** Their tie to the PC, e.g. "estranged brother", "the fixer who bankrolled them". */
  relation: string;
  /** One sentence on who they are now. */
  oneBreath?: string;
}

/** A ready-to-persist backstory NPC: the universe-shared entity plus the PC's
 *  private, pre-filled standing (keyed by the same id in npc_relations). */
export interface BackstoryNpcSeed {
  npc: Npc;
  /** The npc id — also the key under which `relation` goes into npcRelations. */
  id: string;
  relation: NpcRelation;
}

/** FNV-1a-ish string hash → a stable 32-bit seed, so backstory NPCs are
 *  deterministic from the campaign id (same campaign → same picks). */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Infer the PC's starting disposition toward a backstory relation from its label.
 * Engine-owned so the tie's tone is consistent and testable: a nemesis starts
 * cold (-2), a mentor/ally/family warm (+1), estrangement pulls a warm tie down.
 */
export function inferDisposition(relation: string): number {
  const s = relation.toLowerCase();
  const hostile =
    /\b(nemesis|enem|rival|betray|traitor|hunt|kill|murder|wronged|double-?cross|for dead|vengeance|vendetta|hostile)\b/.test(
      s,
    );
  if (hostile) return -2;
  const estranged = /\b(estranged|abandoned|disowned|left)\b/.test(s);
  const warm =
    /\b(mentor|teacher|master|bankroll|saved|rescued|protector|ally|allies|friend|brother|sister|sibling|mother|father|parent|family|lover|partner|loved|comrade|crewmate|handler)\b/.test(
      s,
    );
  if (warm) return estranged ? -1 : 1;
  if (estranged) return -1;
  return 0;
}

/** Reduce a relation label to a short occupational handle for the NPC's `role`
 *  ("the fixer who bankrolled them" → "fixer"; "estranged brother" → "estranged
 *  brother"). Drops leading articles and any trailing "who/that…" clause. */
export function deriveRole(relation: string): string {
  let r = relation.trim().toLowerCase().replace(/^(the|a|an)\s+/, "");
  r = r.split(/\b(?:who|whom|that|which)\b/)[0];
  r = r.replace(/[.,;:]+\s*$/, "").replace(/\s+/g, " ").trim();
  return r.slice(0, 40) || "contact";
}

/** Deterministic fallback relation when the story pass named no one — every PC
 *  should still start with a face in the world. Keyed to their ambition (revenge
 *  → a nemesis; otherwise a mentor who vouched for them). Names come from a small
 *  pool picked by the campaign seed, skipping any already in the cast. */
const FALLBACK_NAMES = [
  "Kessa Vane",
  "Doran Ait",
  "Sillow Marr",
  "Nadre Coil",
  "Bexley Torn",
  "Ivo Sarn",
  "Renn Halloway",
  "Marta Quell",
];

function fallbackRelation(
  ambition: string | undefined,
  rng: RNG,
  taken: Set<string>,
): BackstoryRelationInput | null {
  const name =
    FALLBACK_NAMES.filter((n) => !taken.has(n.toLowerCase()))[
      rng.int(0, Math.max(0, FALLBACK_NAMES.length - 1))
    ] ?? FALLBACK_NAMES.find((n) => !taken.has(n.toLowerCase()));
  if (!name) return null;
  if (ambition === "revenge") {
    return {
      name,
      relation: "old nemesis",
      oneBreath: "The one who wronged you, still out there in the lanes.",
    };
  }
  return {
    name,
    relation: "the mentor who vouched for you",
    oneBreath: "Took a chance on you once; you owe them more than you'll admit.",
  };
}

/**
 * Turn the backstory's named people into 1–2 real, universe-shared NPC entities
 * plus the PC's pre-filled private standing — pure and deterministic from the
 * campaign seed. Each NPC gets a role (occupational handle) and a location picked
 * from the universe's locations; each relation gets a relationship label, an
 * inferred disposition, a lastNote from the backstory, and nameKnown=true (the PC
 * knows these people). They are NOT marked present in the opening scene — they
 * exist in the world, not the opening room.
 */
export function buildBackstoryNpcs(opts: {
  relations: BackstoryRelationInput[];
  universeId: string;
  campaignId: string;
  characterName: string;
  ambition?: string;
  /** Universe locations to plant NPCs in (only the id is used). */
  locationIds: string[];
  /** Names already in the cast — skip collisions. */
  existingNames?: string[];
  /** Explicit seed; defaults to a hash of the campaign id (deterministic). */
  seed?: number;
  max?: number;
}): BackstoryNpcSeed[] {
  const rng = seededRng(opts.seed ?? seedFromString(opts.campaignId));
  const taken = new Set((opts.existingNames ?? []).map((n) => n.toLowerCase()));
  const max = opts.max ?? 2;

  // Prefer the story-pass relations; fall back to one ambition-keyed tie if none.
  let pool = opts.relations.filter((r) => r.name?.trim() && !taken.has(r.name.trim().toLowerCase()));
  if (pool.length === 0) {
    const fb = fallbackRelation(opts.ambition, rng, taken);
    if (fb) pool = [fb];
  }

  const out: BackstoryNpcSeed[] = [];
  for (const r of pool.slice(0, max)) {
    const name = r.name.trim();
    const key = name.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    const i = out.length;
    const id = `npc-rel-${opts.campaignId}-${i}`;
    const role = deriveRole(r.relation);
    const locationId = opts.locationIds.length
      ? opts.locationIds[rng.int(0, opts.locationIds.length - 1)]
      : undefined;
    const oneBreath = (r.oneBreath ?? "").trim() || `${r.relation} of ${opts.characterName}.`;
    const npc: Npc = {
      id,
      universeId: opts.universeId,
      name,
      oneBreath,
      role,
      originCampaignId: opts.campaignId,
      notes: `${opts.characterName}'s ${r.relation}.`,
      ...(locationId ? { locationId } : {}),
    };
    const relation: NpcRelation = {
      relationship: r.relation.trim() || undefined,
      disposition: inferDisposition(r.relation),
      lastNote: oneBreath.slice(0, 160),
      nameKnown: true,
    };
    out.push({ npc, id, relation });
  }
  return out;
}
