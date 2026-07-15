import { z } from "zod";
import type { CampaignState, Character } from "./schemas";
import type { EngineEvent } from "@/engine/events";
import type { RNG } from "@/engine/rng";
import { economy } from "@/content";
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
  locationId: z.string().optional(), // where it mainly plays out
  objectives: z.array(Objective),
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
interface Archetype {
  id: string;
  label: string;
  playstyles: Bias[];
  tier: [PayoutTier, PayoutTier]; // reward band before the net-worth clamp
  steps: Step[];
}

const ARCHETYPES: Archetype[] = [
  { id: "courier", label: "Courier run", playstyles: ["commerce", "piloting"], tier: ["T0", "T1"],
    steps: [{ kind: "deliver", loc: "dropoff", summary: "Haul {cargo} to {dropoff}" }] },
  { id: "smuggling", label: "Smuggling job", playstyles: ["commerce", "intrigue"], tier: ["T1", "T2"],
    steps: [{ kind: "deliver", loc: "dropoff", summary: "Run {cargo} past the {faction} watch to {dropoff}" }] },
  { id: "bounty", label: "Bounty", playstyles: ["combat", "brawn"], tier: ["T1", "T2"],
    steps: [
      { kind: "travel", loc: "site", summary: "Track {target} to {site}" },
      { kind: "eliminate", enemyTier: "T2", summary: "Take {target} down" },
    ] },
  { id: "protection", label: "Protection", playstyles: ["combat", "brawn", "diplomacy"], tier: ["T1", "T1"],
    steps: [{ kind: "survive", summary: "Guard {target} through the meet — walk away alive" }] },
  { id: "heist", label: "Heist", playstyles: ["intrigue", "engineering"], tier: ["T1", "T2"],
    steps: [
      { kind: "travel", loc: "site", summary: "Get inside {faction}'s lockup at {site}" },
      { kind: "sabotage", requiredSkills: ["electronics", "mechanics"], summary: "Crack the vault" },
    ] },
  { id: "recon", label: "Recon", playstyles: ["intrigue", "survival", "piloting"], tier: ["T0", "T1"],
    steps: [
      { kind: "travel", loc: "site", summary: "Scout {site}" },
      { kind: "investigate", requiredSkills: ["perception", "streetwise"], summary: "Find out what's really going on" },
    ] },
  { id: "broker", label: "Broker deal", playstyles: ["diplomacy", "commerce"], tier: ["T0", "T1"],
    steps: [
      { kind: "travel", loc: "site", summary: "Meet the contact at {site}" },
      { kind: "persuade", requiredSkills: ["negotiation", "diplomacy"], summary: "Close the deal with {target}" },
    ] },
  { id: "salvage", label: "Salvage", playstyles: ["engineering", "survival"], tier: ["T0", "T1"],
    steps: [
      { kind: "travel", loc: "site", summary: "Reach the wreck at {site}" },
      { kind: "investigate", requiredSkills: ["electronics", "mechanics"], summary: "Strip {cargo} worth hauling out" },
    ] },
];

const CARGO = ["a sealed medcrate", "contraband stims", "a data core", "reactor parts", "salvaged plating", "a locked strongbox", "a refrigerated pod"];
const TARGETS = ["a Wrecker enforcer", "a jumped bail-runner", "a Chain informant", "a nervous fixer", "a rogue quartermaster", "a debt-skipping broker"];
const COMPLICATIONS = ["a rival crew wants it too", "it's hotter than advertised", "the buyer's spooked", "someone already tipped off the wrong people", "the meet's on contested ground"];

const TIER_ORDER: PayoutTier[] = ["T0", "T1", "T2", "T3"];

// ── Generation ────────────────────────────────────────────────────────────────

/** Bias → how strongly each archetype is favored on the board. Default weight 1;
 *  a listed match gets 4. Anyone can still take anything (a couple off-lean jobs
 *  always appear), matching the "one board, playstyle-weighted" design. */
function archetypeWeight(arch: Archetype, bias: Bias | undefined, directive: string): number {
  let w = 1;
  if (bias && arch.playstyles.includes(bias)) w += 4;
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

/** Generate one offered job for this campaign, weighted to the PC's playstyle. */
export function generateJob(state: CampaignState, rng: RNG, tenday = 0): Job | null {
  const pc = state.characters.find((c) => c.kind === "pc");
  const bias = pc?.bias as Bias | undefined;
  const directive = state.campaign.directive ?? "";
  const arch = weightedPick(ARCHETYPES, (a) => archetypeWeight(a, bias, directive), rng);

  // Parts. Prefer a destination that ISN'T where the player already stands.
  const elsewhere = state.locations.filter((l) => l.id !== state.campaign.currentLocationId);
  const destPool = elsewhere.length ? elsewhere : state.locations;
  const dest = destPool.length ? pick(destPool, rng) : undefined;
  const faction = state.factions.length ? pick(state.factions, rng) : undefined;
  const cargo = pick(CARGO, rng);
  const target = pick(TARGETS, rng);
  const complication = rng.int(1, 3) === 1 ? pick(COMPLICATIONS, rng) : undefined;

  const fill = (s: string) =>
    s.replace("{cargo}", cargo).replace("{target}", target).replace("{dropoff}", dest?.name ?? "the drop")
      .replace("{site}", dest?.name ?? "the site").replace("{faction}", faction?.name ?? "the locals");

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
    id: jobId(rng),
    title: fill(arch.label),
    blurb: fill(arch.steps[0].summary),
    giver: "board",
    factionId: faction?.id,
    playstyle: arch.playstyles[0],
    archetype: arch.id,
    tier,
    complication,
    locationId: dest?.id,
    objectives,
    reward: { tier, ...(faction ? { repFactionId: faction.id, repDelta: 1 } : {}) },
    status: "offered",
    createdTenday: tenday,
    expiresTenday: tenday + 3,
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
  npc: { id: string; name: string; factionId?: string; backstory?: string },
  state: CampaignState,
  rng: RNG,
  tenday = 0,
): Job | null {
  const base = generateJob(state, rng, tenday);
  if (!base) return null;
  const want = npc.backstory?.trim() || `${npc.name} needs a hand with something personal.`;
  return {
    ...base,
    id: jobId(rng),
    giver: npc.id,
    title: `${npc.name} — a personal favor`,
    blurb: want,
    factionId: npc.factionId,
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

/** Top the OFFERED board up to `count`, dropping expired offers. Active/complete
 *  jobs are untouched. */
export function refreshBoard(state: CampaignState, jobs: Job[], rng: RNG, tenday = 0, count = 4): Job[] {
  const kept = jobs.filter((j) => j.status !== "offered" || (j.expiresTenday ?? Infinity) >= tenday);
  const offered = kept.filter((j) => j.status === "offered").length;
  const out = [...kept];
  for (let i = offered; i < count; i++) {
    const j = generateJob(state, rng, tenday);
    if (j) out.push(j);
  }
  return out;
}

export function acceptJob(jobs: Job[], id: string): Job[] {
  return jobs.map((j) => (j.id === id && j.status === "offered" ? { ...j, status: "active" as const } : j));
}
export function abandonJob(jobs: Job[], id: string): Job[] {
  return jobs.map((j) => (j.id === id && j.status === "active" ? { ...j, status: "failed" as const } : j));
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
