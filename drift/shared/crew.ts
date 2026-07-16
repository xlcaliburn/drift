import { crew as crewContent } from "@/content";
import type { CampaignState, Character } from "./schemas";
import type { EngineEvent } from "@/engine/events";
import type { RNG } from "@/engine/rng";
import { TRUST_THRESHOLD, type NpcRelations } from "./scene";

/**
 * CREW v1 (CREW.md) — recruitment + per-tenday upkeep, pure logic. The ENGINE builds
 * every crew member from the content tier/role tables (model stats are ignored), the
 * player confirms via a Hire chip, and wages charge as the tenday clock advances
 * (engine/time.ts). Locked decisions: recruitment flows through the RELATIONSHIPS
 * trust tier (a trusted PRESENT NPC is hireable — deterministic, no model field to
 * under-fire); per-tenday wages REPLACE the old flat per-job wage; the nonpayment
 * cascade v1 is trimmed to loyalty decay + desertion (mutiny later).
 */

export type CrewTier = "T1" | "T2" | "T3";
export type CrewRole = "muscle" | "gunner" | "medic" | "engineer" | "pilot" | "face";

interface TierSpec {
  label: string;
  hpRange: [number, number];
  skillLevel: number;
  wage: number;
}
interface RoleSpec {
  label: string;
  skill: string;
  gear: { name: string; itemId?: string; damage?: string }[];
}

const TIERS = crewContent.tiers as Record<CrewTier, TierSpec>;
const ROLES = crewContent.roles as Record<CrewRole, RoleSpec>;
const BERTHS = crewContent.berths as Record<string, number>;

export const crewTierSpec = (t: CrewTier): TierSpec => TIERS[t];

/** Berths (PC + crew) the current hull supports; grounded = 2 (one companion). */
export function berthCap(state: CampaignState): number {
  const cls = state.ship?.shipClass ?? "none";
  return BERTHS[cls] ?? BERTHS.none ?? 2;
}

const isDead = (c: Character) => (c.injuries ?? []).some((i) => i.name === "Dead");

/** Living crew members (kind "party"). */
export function crewMembers(state: CampaignState): Character[] {
  return state.characters.filter((c) => c.kind === "party" && !isDead(c));
}

/** Living heads aboard (PC + crew) vs the hull's berths. */
export function berthsFree(state: CampaignState): number {
  const heads = state.characters.filter((c) => !isDead(c)).length;
  return Math.max(0, berthCap(state) - heads);
}

/** Map an NPC's freeform role handle to the crew role it reads as (muscle default). */
export function inferCrewRole(role?: string): CrewRole {
  const r = (role ?? "").toLowerCase();
  if (/\b(medic|doc|doctor|surgeon|nurse)\b/.test(r)) return "medic";
  if (/\b(engineer|mechanic|tech|wrench|grease)\b/.test(r)) return "engineer";
  if (/\b(pilot|helm|navigator|flyer)\b/.test(r)) return "pilot";
  if (/\b(fixer|broker|talker|negotiator|charmer|face|diplomat)\b/.test(r)) return "face";
  if (/\b(gunner|shooter|sniper|marksman|rifle)\b/.test(r)) return "gunner";
  return "muscle";
}

/** Tier a trusted NPC hires at: trusted (+2) → T1, ally (+3) → T2. T3 is never a
 *  routine hire (story beats only — later). */
export function crewTierFor(disposition: number): CrewTier | null {
  if (disposition >= 3) return "T2";
  if (disposition >= TRUST_THRESHOLD) return "T1";
  return null;
}

export interface RecruitOffer {
  npcId: string;
  name: string;
  role: CrewRole;
  tier: CrewTier;
  wage: number;
  label: string;
}

/**
 * The Hire chip, if one applies right now: the first PRESENT NPC the player has
 * earned trust with (disposition ≥ +2), who isn't already crew, while a berth is
 * free. Deterministic — the engine offers, the player's click confirms (CREW.md §3).
 */
export function recruitOffer(
  state: CampaignState,
  npcRelations: NpcRelations,
  presentNpcIds: string[],
): RecruitOffer | null {
  if (berthsFree(state) <= 0) return null;
  const crewNames = new Set(state.characters.map((c) => c.name.toLowerCase()));
  for (const id of presentNpcIds) {
    const rel = npcRelations[id];
    const tier = rel ? crewTierFor(rel.disposition) : null;
    if (!tier) continue;
    const npc = state.npcs.find((n) => n.id === id);
    if (!npc || crewNames.has(npc.name.toLowerCase())) continue;
    const role = inferCrewRole(npc.role);
    const wage = TIERS[tier].wage;
    return {
      npcId: id,
      name: npc.name,
      role,
      tier,
      wage,
      label: `Hire ${npc.name} (${TIERS[tier].label} ${ROLES[role].label} — ¢${wage}/tenday)`,
    };
  }
  return null;
}

/** Build the crew member the ENGINE hires — stats from the tier table, kit from the
 *  role table; any model-suggested numbers are ignored (the one invariant). */
export function buildCrewMember(
  npc: { id: string; name: string; role?: string; backstory?: string },
  tier: CrewTier,
  role: CrewRole,
  campaignId: string,
  rng: RNG,
): Character {
  const t = TIERS[tier];
  const r = ROLES[role];
  const hp = rng.int(t.hpRange[0], t.hpRange[1]);
  const slug = npc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "crew";
  return {
    id: `crew-${slug}-${rng.int(100, 999)}`,
    campaignId,
    kind: "party",
    name: npc.name,
    attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
    hp,
    maxHp: hp,
    ac: 12,
    stims: 0,
    fragile: false,
    loyalty: (crewContent.startingLoyalty as number) ?? 3,
    crewRole: role,
    crewTier: tier,
    wage: t.wage,
    skills: [{ name: r.skill, level: t.skillLevel, ticks: 0 }],
    actionModifiers: {},
    ...(npc.backstory ? { backstory: npc.backstory } : {}),
    gear: r.gear.map((g) => ({ ...g })),
    injuries: [],
  } as Character;
}

/** Upkeep per tenday: wages + superlinear overhead (supplies/berth costs) —
 *  `wages + ceil(wages × factor × (crewCount − 1))`. Five hands cost more than 5×one. */
export function upkeepPerTenday(state: CampaignState): number {
  const crew = crewMembers(state);
  if (!crew.length) return 0;
  const wages = crew.reduce((s, c) => s + (c.wage ?? TIERS[(c.crewTier as CrewTier) ?? "T1"].wage), 0);
  const factor = (crewContent.overheadFactor as number) ?? 0.15;
  return wages + Math.ceil(wages * factor * (crew.length - 1));
}

/**
 * Charge crew upkeep for elapsed tendays — deducted from the PC (credits may go
 * negative; the dock-debt loop picks that up). The v1 cascade (loyalty decay on
 * nonpayment → desertion) lands with the upkeep slice; this charges honestly.
 */
export function chargeCrewUpkeep(
  state: CampaignState,
  tendays: number,
): { state: CampaignState; lines: string[]; events: EngineEvent[] } {
  const perTenday = upkeepPerTenday(state);
  if (!tendays || tendays <= 0 || perTenday <= 0) return { state, lines: [], events: [] };
  const pc = state.characters.find((c) => c.kind === "pc");
  if (!pc) return { state, lines: [], events: [] };
  const cost = perTenday * tendays;
  const after = (pc.credits ?? 0) - cost;
  const next: CampaignState = {
    ...state,
    characters: state.characters.map((c) => (c.id === pc.id ? { ...c, credits: after } : c)),
  };
  const n = crewMembers(state).length;
  return {
    state: next,
    lines: [`💸 Crew upkeep: -¢${cost} (${n} crew${tendays > 1 ? ` × ${tendays} tendays` : ""}) — ¢${after} left.`],
    events: [{ type: "cost", breakdown: `Crew upkeep: -¢${cost} (${n} crew, ${tendays} tenday${tendays > 1 ? "s" : ""})`, amount: -cost }],
  };
}
