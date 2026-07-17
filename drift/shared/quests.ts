import { z } from "zod";
import type { CampaignState, Character } from "./schemas";
import type { EngineEvent } from "@/engine/events";
import type { RNG } from "@/engine/rng";
import { economy } from "@/content";
import { pack, FACTION_ALIGNMENT } from "@/content/pack";
import { suggestName } from "@/content/examples";
import { generateNpcFlavor } from "./npcFlavor";
import { payoutCeiling, clampPayoutTier, type PayoutTier } from "./payoutRamp";

/**
 * DRIFT quests — a procedural, playstyle-weighted JOB BOARD of structured "scores"
 * (Blades in the Dark) the ENGINE owns end-to-end: it assembles each job from parts,
 * tracks the ordered objectives, DETECTS completion from the turn's real signals
 * (where you are, a won fight, a successful roll), and pays a guaranteed reward. The
 * narrator only writes the prose over engine-decided beats — offloading the quest
 * STRUCTURE that DeepSeek used to carry entirely in free-text threads.
 *
 * PURE: no DB, no engine class. Takes state + the turn's EngineEvents + an RNG and
 * returns new state/jobs + display lines. Kept self-contained so it never collides
 * with the engineBridge split, and stays fully unit-testable.
 *
 * PHASE 1a — objectives are limited to kinds the engine can verify from state alone
 * (location, combat outcome, a matching skill roll). Inventory-tracked cargo and the
 * model-signalled "report" step land in 1b once the engine refactor settles.
 */

type Bias = "commerce" | "combat" | "intrigue" | "piloting" | "diplomacy" | "engineering" | "survival" | "brawn";

// ── Schema ────────────────────────────────────────────────────────────────────
export const ObjectiveKind = z.enum([
  "travel", // reach a location
  "deliver", // reach the drop-off (cargo is flavor in 1a)
  "eliminate", // win the fight
  "survive", // come out of it alive
  "investigate", // a successful perception/streetwise/electronics roll
  "persuade", // a successful negotiation/diplomacy roll
  "sabotage", // a successful mechanics/electronics roll
]);
export type ObjectiveKind = z.infer<typeof ObjectiveKind>;

export const Objective = z.object({
  id: z.string(),
  kind: ObjectiveKind,
  summary: z.string(), // player-facing "Deliver the crate to Rook Station"
  done: z.boolean().default(false),
  /** travel/deliver — the destination location id. */
  locationId: z.string().optional(),
  /** eliminate — enemy toughness. */
  enemyTier: z.enum(["T1", "T2", "T3"]).optional(),
  /** investigate/persuade/sabotage — any success on one of these skills completes it. */
  requiredSkills: z.array(z.string()).optional(),
});
export type Objective = z.infer<typeof Objective>;

export const JobStatus = z.enum(["offered", "active", "complete", "failed", "expired"]);

// ── Cast manifests (HANDOFF_NPC_CANON Task D / QUESTS.md "quest cast manifests")
// A quest's PEOPLE are constants like its objectives and payout — the engine
// decides who's in a score at GENERATION time, the model narrates them but never
// invents the cast. Kills the live failure where a running job accretes 4-5
// model-invented randos (a live audit found 8-of-22 thin cast NPCs on one
// campaign, most "Spoke with the player" shells from unnecessary jobs).
export const JobCastRole = z.enum(["giver", "target", "contact", "ward"]);
export type JobCastRole = z.infer<typeof JobCastRole>;

export const JobCastMember = z.object({
  role: JobCastRole,
  /** Stable id this person will register under — see materializeJobCast. */
  npcId: z.string(),
  name: z.string(),
  /** Occupational handle for their registered `role` + oneBreath (e.g. "fixer",
   *  "Wrecker enforcer", "inside contact"). */
  roleLabel: z.string(),
});
export type JobCastMember = z.infer<typeof JobCastMember>;

export const Job = z.object({
  id: z.string(),
  title: z.string(),
  blurb: z.string(), // one-line pitch shown on the board
  giver: z.string(), // npc id, or "board"
  factionId: z.string().optional(),
  playstyle: z.string(), // the lean it fits (a Bias), for weighting + UI
  archetype: z.string(),
  tier: z.enum(["T0", "T1", "T2", "T3"]),
  complication: z.string().optional(),
  /** Delivery jobs: the actual freight ("a sealed medcrate"). On accept it becomes
   *  REAL inventory (a jobId-tagged gear item); the engine consumes it when the
   *  deliver objective completes. QUESTS.md 1b — kills sold-AND-still-carried. */
  cargo: z.string().optional(),
  locationId: z.string().optional(), // where it mainly plays out (the destination)
  /** The station this job was POSTED at — the board is local, so an offer only shows
   *  while the player is here. Undefined on legacy jobs (shown anywhere). */
  postedLocationId: z.string().optional(),
  objectives: z.array(Objective),
  /** The people this job's fiction involves — decided at GENERATION time, never
   *  by the model. Real NPC records are only created on ACCEPT (materializeJobCast)
   *  so an untaken board posting never bloats the cast. */
  cast: z.array(JobCastMember).default([]),
  reward: z.object({
    tier: z.enum(["T0", "T1", "T2", "T3"]),
    repFactionId: z.string().optional(),
    repDelta: z.number().int().optional(),
  }),
  status: JobStatus.default("offered"),
  createdTenday: z.number().int().default(0),
  expiresTenday: z.number().int().optional(),
});
export type Job = z.infer<typeof Job>;

// ── Archetypes (the score skeletons) + parts pools ─────────────────────────────
interface Step {
  kind: ObjectiveKind;
  /** {cargo}/{target}/{dropoff}/{site}/{faction} filled at generation. */
  summary: string;
  /** which generated location this objective points at (travel/deliver). */
  loc?: "dropoff" | "site";
  enemyTier?: "T1" | "T2" | "T3";
  requiredSkills?: string[];
}
/** How a job READS: official (sanctioned, on-the-books) vs underworld (criminal,
 *  off-book). Neutral work is taken from anyone. Drives WHO can offer a job — the
 *  live incoherence this fixes: a smuggling run offered BY the faction whose own
 *  watch it smuggles past. Each faction's character is AUTHORED on the content
 *  pack (`alignment`); this module only reads the derived record. */
type JobAlignment = "official" | "underworld" | "neutral";

/** A cast SLOT an archetype fills at generation. `roleLabel` is a static
 *  occupational handle for `giver`/`contact`/`ward`; `target` draws its label
 *  from the (already-authored) TARGETS flavor pool instead, since it already
 *  reads as a short occupation/description ("a Wrecker enforcer"). */
interface CastSlot {
  role: JobCastRole;
  roleLabel?: string;
}

interface Archetype {
  id: string;
  label: string;
  playstyles: Bias[];
  tier: [PayoutTier, PayoutTier]; // reward band before the net-worth clamp
  /** Who can OFFER this work (see FACTION_ALIGNMENT; neutral = anyone). */
  alignment: JobAlignment;
  /** This archetype's {faction} placeholder is an OPPONENT (smuggled past, broken
   *  into) — it must never resolve to the GIVER's own faction. */
  adversarial?: boolean;
  /** The people this archetype's fiction involves (HANDOFF Task D) — a fixed
   *  manifest of ROLES, not a fixed number of NPCs system-wide (each archetype
   *  picks its own). Generated once per job; never grown by the model. */
  cast: CastSlot[];
  steps: Step[];
}

const ARCHETYPES: Archetype[] = [
  { id: "courier", label: "Courier run", playstyles: ["commerce", "piloting"], tier: ["T0", "T1"], alignment: "neutral",
    cast: [{ role: "giver", roleLabel: "dispatcher" }],
    steps: [{ kind: "deliver", loc: "dropoff", summary: "Haul {cargo} to {dropoff}" }] },
  { id: "smuggling", label: "Smuggling job", playstyles: ["commerce", "intrigue"], tier: ["T1", "T2"], alignment: "underworld", adversarial: true,
    cast: [{ role: "giver", roleLabel: "fixer" }, { role: "contact", roleLabel: "receiver" }],
    steps: [{ kind: "deliver", loc: "dropoff", summary: "Run {cargo} past the {faction} watch to {dropoff}" }] },
  { id: "bounty", label: "Bounty", playstyles: ["combat", "brawn"], tier: ["T1", "T2"], alignment: "official",
    cast: [{ role: "giver", roleLabel: "dispatcher" }, { role: "target" }],
    steps: [
      { kind: "travel", loc: "site", summary: "Track {target} to {site}" },
      { kind: "eliminate", enemyTier: "T2", summary: "Take {target} down" },
    ] },
  { id: "protection", label: "Protection", playstyles: ["combat", "brawn", "diplomacy"], tier: ["T1", "T1"], alignment: "neutral",
    cast: [{ role: "giver", roleLabel: "agent" }, { role: "ward", roleLabel: "client" }],
    steps: [{ kind: "survive", summary: "Guard {target} through the meet — walk away alive" }] },
  { id: "heist", label: "Heist", playstyles: ["intrigue", "engineering"], tier: ["T1", "T2"], alignment: "underworld", adversarial: true,
    cast: [{ role: "giver", roleLabel: "fixer" }, { role: "contact", roleLabel: "inside contact" }],
    steps: [
      { kind: "travel", loc: "site", summary: "Get inside {faction}'s lockup at {site}" },
      { kind: "sabotage", requiredSkills: ["electronics", "mechanics"], summary: "Crack the vault" },
    ] },
  { id: "recon", label: "Recon", playstyles: ["intrigue", "survival", "piloting"], tier: ["T0", "T1"], alignment: "neutral",
    cast: [{ role: "giver", roleLabel: "dispatcher" }],
    steps: [
      { kind: "travel", loc: "site", summary: "Scout {site}" },
      { kind: "investigate", requiredSkills: ["perception", "streetwise"], summary: "Find out what's really going on" },
    ] },
  { id: "broker", label: "Broker deal", playstyles: ["diplomacy", "commerce"], tier: ["T0", "T1"], alignment: "neutral",
    cast: [{ role: "giver", roleLabel: "broker" }, { role: "target" }],
    steps: [
      { kind: "travel", loc: "site", summary: "Meet the contact at {site}" },
      { kind: "persuade", requiredSkills: ["negotiation", "diplomacy"], summary: "Close the deal with {target}" },
    ] },
  { id: "salvage", label: "Salvage", playstyles: ["engineering", "survival"], tier: ["T0", "T1"], alignment: "neutral",
    cast: [{ role: "giver", roleLabel: "dispatcher" }],
    steps: [
      { kind: "travel", loc: "site", summary: "Reach the wreck at {site}" },
      { kind: "investigate", requiredSkills: ["electronics", "mechanics"], summary: "Strip {cargo} worth hauling out" },
    ] },
];

/** Can this faction plausibly OFFER work of this alignment? Officials don't post
 *  smuggling runs; syndicates don't run sanctioned bounty desks; neutral work and
 *  neutral factions go both ways. */
export function canOffer(jobAlignment: JobAlignment, factionAlignment: JobAlignment): boolean {
  if (jobAlignment === "neutral" || factionAlignment === "neutral") return true;
  return jobAlignment === factionAlignment;
}

// Flavor pools ({cargo}/{target}/complications) are AUTHORED on the content pack.
const CARGO = pack.jobFlavor.cargo;
const TARGETS = pack.jobFlavor.targets;
const COMPLICATIONS = pack.jobFlavor.complications;

const TIER_ORDER: PayoutTier[] = ["T0", "T1", "T2", "T3"];

// ── Generation ────────────────────────────────────────────────────────────────

/** Bias → how strongly each archetype is favored on the board. Default weight 1;
 *  a listed playstyle match gets +4; work matching the PLAYER'S FACTION character
 *  gets +2 (a Hollow Crown hand sees more sanctioned bounty/courier work, a Sable
 *  runner more smuggling — the off-lean stuff still appears, just less). */
function archetypeWeight(arch: Archetype, bias: Bias | undefined, directive: string, pcAlignment: JobAlignment = "neutral"): number {
  let w = 1;
  if (bias && arch.playstyles.includes(bias)) w += 4;
  if (pcAlignment !== "neutral" && arch.alignment === pcAlignment) w += 2;
  // Light directive-keyword nudge (the player's own stated aim).
  const d = directive.toLowerCase();
  const KEY: Record<string, Bias> = {
    trade: "commerce", cargo: "commerce", money: "commerce", smuggl: "intrigue", fight: "combat",
    bounty: "combat", hunt: "combat", sneak: "intrigue", steal: "intrigue", heist: "intrigue",
    explore: "survival", salvage: "engineering", people: "diplomacy", talk: "diplomacy", fly: "piloting",
  };
  for (const [kw, b] of Object.entries(KEY)) if (d.includes(kw) && arch.playstyles.includes(b)) w += 2;
  return w;
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: RNG): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let r = rng.int(1, Math.max(1, total));
  for (const t of items) {
    r -= weight(t);
    if (r <= 0) return t;
  }
  return items[items.length - 1];
}

const pick = <T>(arr: T[], rng: RNG): T => arr[rng.int(0, arr.length - 1)];

let idSeq = 0;
/** Deterministic-enough id (RNG-seeded, no Date/Math.random). */
function jobId(rng: RNG): string {
  return `job-${rng.int(100000, 999999)}-${idSeq++}`;
}

/** "a Wrecker enforcer" → "Wrecker enforcer" — TARGETS pool entries read as
 *  full descriptive phrases; strip the leading article for a short role handle. */
function stripArticle(s: string): string {
  return s.replace(/^(a|an|the)\s+/i, "");
}

/** Lowercased base name — a name-collision "(role)" suffix stripped, matching
 *  registerNpc's normalization, so "Ren (fixer)" and "Ren" compare equal. */
function baseNameLc(n: string): string {
  return n.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** A name for a generated cast member, avoiding a collision with anyone already
 *  in the world (cast + party) or generated earlier in THIS refresh (`taken` is
 *  mutated by the caller between calls) — and never sharing a FIRST name with a
 *  player character or crew (`forbiddenFirst`): the name pools are the SAME ones
 *  players draw from, and a cast "Wren Karo" beside a PC "Wren Sung" is exactly
 *  the first-name-collision class the registerNpc PC-name guard exists to stop
 *  (materialization bypasses that guard, so the protection lives here). Bounded
 *  retries; on exhaustion a suffix forces uniqueness rather than colliding. */
function generateCastName(rng: RNG, taken: Set<string>, forbiddenFirst: Set<string>): string {
  let last = "";
  for (let i = 0; i < 8; i++) {
    const seed = rng.int(0, 999999) / 1000000;
    const candidate = suggestName(seed);
    const lc = candidate.toLowerCase();
    if (taken.has(lc)) { last = candidate; continue; }
    if (forbiddenFirst.has(lc.split(/\s+/)[0])) { last = candidate; continue; }
    return candidate;
  }
  return `${last} II`;
}

/** Generate one offered job for this campaign, weighted to the PC's playstyle AND
 *  faction character (a Hollow Crown operative sees mostly sanctioned work, and
 *  their own faction's postings first). `avoidArchetypes` (ids already on the board
 *  this refresh) is excluded so a board reads as a VARIETY of work. Coherence rules:
 *  the GIVER faction must be able to offer the archetype (canOffer), and an
 *  adversarial archetype's {faction} placeholder resolves to an OPPONENT — never the
 *  giver itself (the live "Crown smuggling past the Crown watch, paying Crown rep"). */
export function generateJob(
  state: CampaignState,
  rng: RNG,
  tenday = 0,
  avoidArchetypes?: Set<string>,
  /** Names already claimed by SIBLING offers this refresh (lowercased) — each
   *  generateJob call only sees state.npcs, so without this two offers on one
   *  board could both cast a "Mox". refreshBoard threads one set through; new
   *  cast names are ADDED to it as they're taken. */
  reservedNames?: Set<string>,
): Job | null {
  const pc = state.characters.find((c) => c.kind === "pc");
  const bias = pc?.bias as Bias | undefined;
  const pcFactionId = pc?.ownFactionId ?? pc?.parentFactionId;
  const pcAlignment: JobAlignment = FACTION_ALIGNMENT[pcFactionId ?? ""] ?? "neutral";
  const directive = state.campaign.directive ?? "";
  // Prefer archetypes not already offered this refresh; fall back to the full pool
  // once every kind is used (a board bigger than the archetype count).
  const fresh = avoidArchetypes?.size ? ARCHETYPES.filter((a) => !avoidArchetypes.has(a.id)) : ARCHETYPES;
  const pool = fresh.length ? fresh : ARCHETYPES;
  const arch = weightedPick(pool, (a) => archetypeWeight(a, bias, directive, pcAlignment), rng);

  // Parts. Prefer a destination that ISN'T where the player already stands.
  const elsewhere = state.locations.filter((l) => l.id !== state.campaign.currentLocationId);
  const destPool = elsewhere.length ? elsewhere : state.locations;
  const dest = destPool.length ? pick(destPool, rng) : undefined;
  // GIVER: a faction that can plausibly offer this kind of work, with the player's
  // own faction strongly preferred when eligible ("official jobs for a Crown hand").
  const eligible = state.factions.filter((f) => canOffer(arch.alignment, FACTION_ALIGNMENT[f.id] ?? "neutral"));
  const giverPool = eligible.length ? eligible : state.factions;
  const faction = giverPool.length
    ? weightedPick(giverPool, (f) => (f.id === pcFactionId ? 4 : 1), rng)
    : undefined;
  // ADVERSARY: who the job is run AGAINST ({faction} in smuggling/heist summaries) —
  // never the giver; prefer a faction of the OPPOSITE character when one exists.
  const adversary = arch.adversarial
    ? (() => {
        const others = state.factions.filter((f) => f.id !== faction?.id);
        const opposed = others.filter((f) => {
          const fa = FACTION_ALIGNMENT[f.id] ?? "neutral";
          const ga = faction ? FACTION_ALIGNMENT[faction.id] ?? "neutral" : "neutral";
          return fa !== "neutral" && fa !== ga;
        });
        const advPool = opposed.length ? opposed : others;
        return advPool.length ? pick(advPool, rng) : undefined;
      })()
    : undefined;
  const cargo = pick(CARGO, rng);
  const complication = rng.int(1, 3) === 1 ? pick(COMPLICATIONS, rng) : undefined;
  const jid = jobId(rng);

  // CAST (HANDOFF Task D / QUESTS.md): decide the job's PEOPLE now, once — the
  // model narrates them, it never invents who else is in the score. Names avoid
  // colliding with anyone already in the world OR generated earlier in this
  // SAME job (taken is mutated as we go). Real NPC records are only created on
  // accept (materializeJobCast) so an untaken offer never bloats the cast.
  const taken = new Set([
    ...state.npcs.map((n) => baseNameLc(n.name)),
    ...state.characters.map((c) => c.name.toLowerCase()),
    ...(reservedNames ?? []),
  ]);
  // A cast member may never SHARE A FIRST NAME with the player's characters/crew
  // (the pools overlap with player naming — see generateCastName).
  const forbiddenFirst = new Set(state.characters.map((c) => c.name.toLowerCase().split(/\s+/)[0]));
  const cast: JobCastMember[] = arch.cast.map((slot) => {
    const name = generateCastName(rng, taken, forbiddenFirst);
    taken.add(name.toLowerCase());
    reservedNames?.add(name.toLowerCase());
    const roleLabel = slot.role === "target" ? stripArticle(pick(TARGETS, rng)) : slot.roleLabel ?? "contact";
    return { role: slot.role, npcId: `npc-job-${jid}-${slot.role}`, name, roleLabel };
  });
  // {target} in a step's summary means "the person this beat centers on" — the
  // bounty/broker mark OR the protection ward, whichever this archetype cast.
  // Archetypes with neither (the common case — most jobs have no {target} token
  // at all) fall back to the old flavor-text pool so the placeholder never breaks.
  const targetPerson = cast.find((m) => m.role === "target" || m.role === "ward");
  const target = targetPerson?.name ?? pick(TARGETS, rng);

  const fill = (s: string) =>
    s.replace("{cargo}", cargo).replace("{target}", target).replace("{dropoff}", dest?.name ?? "the drop")
      .replace("{site}", dest?.name ?? "the site").replace("{faction}", adversary?.name ?? "local");

  const objectives: Objective[] = arch.steps.map((step, i) => ({
    id: `${arch.id}-${i}`,
    kind: step.kind,
    summary: fill(step.summary),
    done: false,
    ...(step.loc && dest ? { locationId: dest.id } : {}),
    ...(step.enemyTier ? { enemyTier: step.enemyTier } : {}),
    ...(step.requiredSkills ? { requiredSkills: step.requiredSkills } : {}),
  }));
  if (!objectives.length) return null;

  // Reward tier: the archetype's band, clamped DOWN to what the player's net worth
  // has earned (payoutRamp) so a rookie can't draw a major-score job.
  const ceiling = payoutCeiling(state);
  const bandLo = TIER_ORDER.indexOf(arch.tier[0]);
  const bandHi = TIER_ORDER.indexOf(arch.tier[1]);
  const rolledTier = TIER_ORDER[rng.int(bandLo, bandHi)];
  const tier = clampPayoutTier(rolledTier, ceiling);

  return {
    id: jid,
    title: fill(arch.label),
    blurb: fill(arch.steps[0].summary),
    giver: "board",
    factionId: faction?.id,
    playstyle: arch.playstyles[0],
    archetype: arch.id,
    tier,
    complication,
    // A job with a deliver step carries REAL freight — becomes inventory on accept.
    ...(arch.steps.some((s) => s.kind === "deliver") ? { cargo } : {}),
    locationId: dest?.id,
    postedLocationId: state.campaign.currentLocationId,
    objectives,
    cast,
    reward: { tier, ...(faction ? { repFactionId: faction.id, repDelta: 1 } : {}) },
    status: "offered",
    createdTenday: tenday,
    expiresTenday: tenday + 3,
  };
}

// ── Cast materialization (HANDOFF_NPC_CANON Task D) ────────────────────────────
// Cast MEMBERSHIP is decided at generation (above); the actual NPC RECORD is only
// created when the job is ACCEPTED, so a board full of untaken offers never
// bloats the cast with people the player never meets.

/** Where a cast member is BASED: the giver fronts the posting where the job was
 *  offered; everyone else (target/contact/ward) is out at the job's destination. */
export function castHomeLocation(job: Job, role: JobCastRole): string | undefined {
  return role === "giver" ? job.postedLocationId : job.locationId;
}

function castOneBreath(job: Job, member: JobCastMember): string {
  switch (member.role) {
    case "giver":
      return `The ${member.roleLabel} who posted the "${job.title}" job.`;
    case "target":
      return `${member.roleLabel} — the mark on "${job.title}".`;
    case "contact":
      return `The ${member.roleLabel} for "${job.title}".`;
    case "ward":
      return `The ${member.roleLabel} "${job.title}" has you protecting.`;
  }
}

/**
 * Turn an accepted job's cast (fixed at generation) into REAL cast NPCs.
 * Idempotent — a cast member already registered (by id) is skipped, so calling
 * this again on a later turn (or from more than one accept path) is safe. The
 * giver inherits the job's faction (they fronted an official/underworld posting
 * for it); other roles start unaligned — later play can reveal more.
 */
export function materializeJobCast(state: CampaignState, job: Job): CampaignState {
  if (!(job.cast ?? []).length) return state;
  const existingIds = new Set(state.npcs.map((n) => n.id));
  // ADOPT-BY-NAME: if someone with this name already exists in the cast, they ARE
  // this person — the normal path being the GIVER, who was name-dropped in the
  // diegetic pitch, SPOKE, and got registered by the dialogue backstop as an
  // npc-gen- record before the player ever accepted. Appending a second record
  // would recreate the exact duplicate-person class registerNpc's dedupe exists
  // to stop (materialization bypasses registerNpc, so the guard lives here).
  const existingNames = new Set(state.npcs.map((n) => baseNameLc(n.name)));
  const fresh = job.cast.filter((m) => !existingIds.has(m.npcId) && !existingNames.has(baseNameLc(m.name)));
  if (!fresh.length) return state;
  const newNpcs = fresh.map((m) => ({
    id: m.npcId,
    universeId: state.universe.id,
    name: m.name,
    oneBreath: castOneBreath(job, m),
    role: m.roleLabel,
    ...(castHomeLocation(job, m.role) ? { locationId: castHomeLocation(job, m.role) } : {}),
    ...(m.role === "giver" && job.factionId ? { factionId: job.factionId } : {}),
    originCampaignId: state.campaign.id,
    ...generateNpcFlavor(m.npcId),
  }));
  return { ...state, npcs: [...state.npcs, ...newNpcs] };
}

// ── Cargo as inventory (QUESTS.md 1b) ──────────────────────────────────────────
// Born from the live Wren audit: the SAME data core was sold (+212), delivered
// (+155), and later narrated "still under your arm" — three fates for one crate,
// including a double payout. The fix is ownership: a delivery job's freight is a
// REAL, jobId-tagged gear item — granted on accept, unsellable, slot-free, and
// consumed by the ENGINE the moment the deliver objective completes.

/** Display name for a cargo string: "a sealed medcrate" → "Sealed medcrate". */
function cargoDisplayName(cargo: string): string {
  const stripped = cargo.replace(/^(a|an|the)\s+/i, "").trim();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** Put an accepted delivery job's freight in the PC's hands. Idempotent. */
export function grantJobCargo(state: CampaignState, job: Job): CampaignState {
  const pc = state.characters.find((c) => c.kind === "pc");
  if (!pc || !job.cargo) return state;
  if (pc.gear.some((g) => g.jobId === job.id)) return state; // already carrying it
  const item = {
    name: cargoDisplayName(job.cargo),
    jobId: job.id,
    detail: `cargo for "${job.title}" — hand it over at the drop to close the job`,
  };
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === pc.id ? { ...c, gear: [...c.gear, item] } : c)),
  };
}

/** Take the job's freight back out of the PC's hands (delivered, or the job was
 *  dropped/failed — either way it's no longer theirs). Returns the removed name. */
export function consumeJobCargo(
  state: CampaignState,
  jobId: string,
): { state: CampaignState; removedName?: string } {
  const pc = state.characters.find((c) => c.kind === "pc");
  const carried = pc?.gear.find((g) => g.jobId === jobId);
  if (!pc || !carried) return { state };
  return {
    state: {
      ...state,
      characters: state.characters.map((c) =>
        c.id === pc.id ? { ...c, gear: c.gear.filter((g) => g !== carried) } : c,
      ),
    },
    removedName: carried.name,
  };
}

/**
 * A PERSONAL job an NPC gives once the player has earned their trust
 * (RELATIONSHIPS.md). Mechanically a standard tracked score, but `giver` is the NPC
 * (not "board"), it enters ACTIVE immediately (accepted diegetically, never listed on
 * the public board), and completing it resolves their arc (jobsRuntime bumps the
 * relation). The NPC's `backstory` want rides as the blurb — the fiction hook the
 * narrator dresses the beats in. Returns null only if no base score could be built.
 */
export function generatePersonalJob(
  npc: { id: string; name: string; factionId?: string; backstory?: string; role?: string },
  state: CampaignState,
  rng: RNG,
  tenday = 0,
): Job | null {
  const base = generateJob(state, rng, tenday);
  if (!base) return null;
  const want = npc.backstory?.trim() || `${npc.name} needs a hand with something personal.`;
  // The giver here is a REAL, already-known NPC (this IS their favor) — replace
  // generateJob's freshly-generated giver cast entry with them, rather than
  // materializing a phantom duplicate on accept. Any target/contact/ward stays
  // as a generated person for this favor.
  const cast = base.cast.map((m) =>
    m.role === "giver" ? { ...m, npcId: npc.id, name: npc.name, roleLabel: npc.role ?? "your contact" } : m,
  );
  return {
    ...base,
    id: jobId(rng),
    giver: npc.id,
    title: `${npc.name} — a personal favor`,
    blurb: want,
    factionId: npc.factionId,
    cast,
    // Personal jobs pay standing with the NPC's own faction (their want furthers it).
    reward: {
      tier: base.reward.tier,
      ...(npc.factionId ? { repFactionId: npc.factionId, repDelta: 1 } : {}),
    },
    status: "active",
    createdTenday: tenday,
    expiresTenday: undefined, // a personal favor doesn't lapse off a board timer
  };
}

/** Top the OFFERED board up to `count` for the CURRENT station, with archetype
 *  VARIETY (no four-of-a-kind boards). Offers posted at another station — a board
 *  you've walked away from — are dropped, as are expired ones. Active/complete jobs
 *  (and legacy offers with no posting location) are untouched. */
export function refreshBoard(state: CampaignState, jobs: Job[], rng: RNG, tenday = 0, count = 4): Job[] {
  const here = state.campaign.currentLocationId;
  const postedHere = (j: Job) => j.postedLocationId === undefined || j.postedLocationId === here;
  const kept = jobs.filter(
    (j) => j.status !== "offered" || ((j.expiresTenday ?? Infinity) >= tenday && postedHere(j)),
  );
  const out = [...kept];
  // Don't repeat an archetype already on the board this refresh (variety).
  const used = new Set(out.filter((j) => j.status === "offered").map((j) => j.archetype));
  // …or a cast NAME already claimed by any kept job (offered OR active) — each
  // generateJob only sees state.npcs, so this set is what keeps two postings on
  // one board from both casting a "Mox".
  const reserved = new Set(out.flatMap((j) => (j.cast ?? []).map((m) => m.name.toLowerCase())));
  const offeredHere = out.filter((j) => j.status === "offered" && postedHere(j)).length;
  for (let i = offeredHere; i < count; i++) {
    const j = generateJob(state, rng, tenday, used, reserved);
    if (!j) continue;
    out.push(j);
    used.add(j.archetype);
  }
  return out;
}

export function acceptJob(jobs: Job[], id: string): Job[] {
  return jobs.map((j) => (j.id === id && j.status === "offered" ? { ...j, status: "active" as const } : j));
}
export function abandonJob(jobs: Job[], id: string): Job[] {
  return jobs.map((j) => (j.id === id && j.status === "active" ? { ...j, status: "failed" as const } : j));
}

/** Verbs that read as taking a job in a typed action. Tight, like the other typed
 *  backstops (inferConsumableUse): ordinary prose must not accept work by accident. */
const ACCEPT_VERB_RE = /\b(take|accept|sign (?:on|up) for|i'?ll (?:do|take|run|handle)|take on|agree to)\b/i;

/**
 * Typed-accept backstop: with the posting-board UI gone, offers surface through the
 * narrator and are accepted diegetically. The model SHOULD return a choice carrying
 * `acceptJob`, but every model-emitted field under-fires eventually (CHECKS.md §6) —
 * so a typed "I'll take the courier run" resolves deterministically here. Requires
 * BOTH an accept verb and a distinctive match against ONE offered job (title words
 * or archetype), and stays out of ambiguity: two plausible matches → no accept.
 */
export function inferJobAccept(text: string, jobs: Job[]): string | undefined {
  const t = (text ?? "").toLowerCase();
  if (!t || !ACCEPT_VERB_RE.test(t)) return undefined;
  const offered = jobs.filter((j) => j.status === "offered");
  const matches = offered.filter((j) => {
    const words = `${j.title} ${j.archetype}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !["run"].includes(w)); // "run" is too common to identify a job
    return words.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  });
  return matches.length === 1 ? matches[0].id : undefined;
}

// ── Completion tracking (the engine-owned crux) ────────────────────────────────

export interface TurnSignals {
  currentLocationId?: string;
  /** A fight resolved this turn with the player alive (won or escaped). */
  combatResolvedAlive?: boolean;
  /** Skills that rolled a SUCCESS this turn (from EngineEvents). */
  successfulSkills: Set<string>;
}

/** Build the signals a job tracker needs from the turn's raw outputs. */
export function turnSignals(
  currentLocationId: string | undefined,
  events: EngineEvent[],
  combatResolvedAlive: boolean,
): TurnSignals {
  const successfulSkills = new Set<string>();
  for (const e of events) if (e.type === "roll" && e.outcome === "success") successfulSkills.add(e.skill);
  return { currentLocationId, combatResolvedAlive, successfulSkills };
}

function objectiveMet(obj: Objective, s: TurnSignals): boolean {
  switch (obj.kind) {
    case "travel":
    case "deliver":
      return !!obj.locationId && s.currentLocationId === obj.locationId;
    case "eliminate":
    case "survive":
      return !!s.combatResolvedAlive;
    case "investigate":
    case "persuade":
    case "sabotage":
      return (obj.requiredSkills ?? []).some((sk) => s.successfulSkills.has(sk));
  }
}

export interface JobProgress {
  jobs: Job[];
  /** Prefixed display lines (🎯) for the transcript. */
  lines: string[];
  /** Rewards to pay for jobs completed THIS turn — the caller rolls/applies them. */
  completed: { job: Job }[];
}

/**
 * Advance every ACTIVE job by one step where the turn's signals satisfy its next
 * objective. Completing the last objective marks the job complete and flags it for
 * reward. Pure: returns new jobs + lines + the completed set (rewards applied by the
 * caller so the credit roll can go through the engine's payout ramp).
 */
export function advanceJobs(jobs: Job[], signals: TurnSignals): JobProgress {
  const lines: string[] = [];
  const completed: { job: Job }[] = [];
  const next = jobs.map((job) => {
    if (job.status !== "active") return job;
    const objectives = job.objectives.map((o) => ({ ...o }));
    const idx = objectives.findIndex((o) => !o.done);
    if (idx < 0) return job;
    if (!objectiveMet(objectives[idx], signals)) return job;
    objectives[idx].done = true;
    const allDone = objectives.every((o) => o.done);
    if (allDone) {
      lines.push(`🎯 Job complete — ${job.title}`);
      const finished = { ...job, objectives, status: "complete" as const };
      completed.push({ job: finished });
      return finished;
    }
    const nextObj = objectives.find((o) => !o.done);
    lines.push(`🎯 ${job.title}: ${objectives[idx].summary} ✓${nextObj ? ` — next: ${nextObj.summary}` : ""}`);
    return { ...job, objectives };
  });
  return { jobs: next, lines, completed };
}

/** Roll a completed job's credit reward from its tier band (engine-owned figure,
 *  same bands as award_payout). Rep is applied separately by the caller. */
export function rollJobCredits(tier: PayoutTier, rng: RNG): number {
  const band = economy.jobPayouts[tier];
  if (!Array.isArray(band)) return 0;
  return rng.int(band[0], band[1]);
}
