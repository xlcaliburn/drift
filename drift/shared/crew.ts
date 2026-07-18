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

/** Role PASSIVES (CREW.md §4) — a standing crew specialist assists the PC's skill
 *  checks: engineer → mechanics, pilot → piloting, face → negotiation + streetwise.
 *  +1 each (same auditable `situational` slot as tool bonuses); one per role — two
 *  engineers don't stack. Muscle/gunner/medic earn their keep in the fight. */
const ROLE_ASSIST: Partial<Record<CrewRole, string[]>> = {
  engineer: ["mechanics"],
  pilot: ["piloting"],
  face: ["negotiation", "streetwise"],
};

export function crewAssistBonus(state: CampaignState, skill: string): number {
  let bonus = 0;
  const seen = new Set<CrewRole>();
  for (const m of crewMembers(state)) {
    const role = m.crewRole as CrewRole | undefined;
    if (!role || seen.has(role)) continue;
    if (m.hp <= 0) continue; // a downed specialist isn't assisting anyone
    if ((ROLE_ASSIST[role] ?? []).includes(skill)) {
      bonus += 1;
      seen.add(role);
    }
  }
  return bonus;
}

/** An engineer aboard makes hull repairs cheaper: 25% off the dock rate (¢12 → ¢9). */
export function repairRatePerHp(state: CampaignState, baseRate: number): number {
  const hasEngineer = crewMembers(state).some((m) => m.crewRole === "engineer" && m.hp > 0);
  return hasEngineer ? Math.ceil(baseRate * 0.75) : baseRate;
}

/** Upkeep per tenday: wages + superlinear overhead (supplies/berth costs) —
 *  `wages + ceil(wages × factor × (crewCount − 1))`. Five hands cost more than 5×one.
 *  Temporary members are excluded to MATCH chargeCrewUpkeep — this is the number
 *  quoted to the player (Status tab, the hire line), and quoting a wage the
 *  charger never takes would be a lie. Without the filter, the `?? TIERS[…].wage`
 *  fallback below would even price a wage-less story ally. */
export function upkeepPerTenday(state: CampaignState): number {
  const crew = crewMembers(state).filter((m) => !m.temporary);
  if (!crew.length) return 0;
  const wages = crew.reduce((s, c) => s + (c.wage ?? TIERS[(c.crewTier as CrewTier) ?? "T1"].wage), 0);
  const factor = (crewContent.overheadFactor as number) ?? 0.15;
  return wages + Math.ceil(wages * factor * (crew.length - 1));
}

/**
 * Charge crew upkeep for elapsed tendays, with the NONPAYMENT CASCADE (CREW.md §6,
 * trimmed v1): pay who you can afford in wage order (the expensive specialists get
 * paid first; the cheapest hands go unpaid), every unpaid member loses a point of
 * loyalty, and an unpaid member already AT loyalty 0 rolls to DESERT (d20 ≤ 10 →
 * walks, taking their gear — the Character row is removed; the shared NPC remains
 * in the world). Overhead is only charged when every wage was covered. Mutiny is
 * deliberately deferred.
 */
export function chargeCrewUpkeep(
  state: CampaignState,
  tendays: number,
  rng: RNG,
): { state: CampaignState; lines: string[]; events: EngineEvent[] } {
  // Temporary members (STORY.md prologue ally, etc.) are otherwise normal
  // crew — controllable, downable, fate-tracked — but draw no wage: they're
  // story-granted, not hired. Filtered HERE (wages only), not in crewMembers
  // itself, so berth-counting / crew UI still see them as present.
  const crew = crewMembers(state).filter((m) => !m.temporary);
  const pc = state.characters.find((c) => c.kind === "pc");
  if (!tendays || tendays <= 0 || !crew.length || !pc) return { state, lines: [], events: [] };

  const lines: string[] = [];
  const events: EngineEvent[] = [];
  let pool = Math.max(0, pc.credits ?? 0);
  let paidTotal = 0;
  const unpaidIds = new Set<string>();

  // Wages, most expensive first — you keep the specialist before the deckhand.
  const byWage = [...crew].sort((a, b) => (b.wage ?? 0) - (a.wage ?? 0));
  for (const m of byWage) {
    const due = (m.wage ?? TIERS[(m.crewTier as CrewTier) ?? "T1"].wage) * tendays;
    if (pool >= due) {
      pool -= due;
      paidTotal += due;
    } else {
      unpaidIds.add(m.id);
    }
  }
  // Overhead (supplies/berth costs) only lands when the full payroll cleared.
  const factor = (crewContent.overheadFactor as number) ?? 0.15;
  const wagesPerTenday = crew.reduce((s, c) => s + (c.wage ?? TIERS[(c.crewTier as CrewTier) ?? "T1"].wage), 0);
  const overhead = unpaidIds.size === 0 ? Math.ceil(wagesPerTenday * factor * (crew.length - 1)) * tendays : 0;
  const charged = paidTotal + Math.min(pool, overhead);

  let characters = state.characters.map((c) => (c.id === pc.id ? { ...c, credits: (c.credits ?? 0) - charged } : c));
  if (charged > 0) {
    lines.push(`💸 Crew upkeep: -¢${charged} (${crew.length} crew${tendays > 1 ? ` × ${tendays} tendays` : ""}).`);
    events.push({ type: "cost", breakdown: `Crew upkeep: -¢${charged} (${crew.length} crew, ${tendays} tenday${tendays > 1 ? "s" : ""})`, amount: -charged });
  }

  // The cascade: unpaid → loyalty −1; unpaid at 0 → departure roll.
  const deserters = new Set<string>();
  for (const id of unpaidIds) {
    const m = characters.find((c) => c.id === id);
    if (!m) continue;
    const before = m.loyalty ?? 3;
    if (before > 0) {
      characters = characters.map((c) => (c.id === id ? { ...c, loyalty: before - 1 } : c));
      lines.push(`⚠ ${m.name} goes unpaid — loyalty ${before}→${before - 1}.`);
      events.push({ type: "note", breakdown: `${m.name} unpaid: loyalty ${before}→${before - 1}.` });
    } else {
      const roll = rng.int(1, 20);
      if (roll <= 10) {
        deserters.add(id);
        lines.push(`🚪 ${m.name} deserts (d20 ${roll}) — walks off with their gear.`);
        events.push({ type: "note", breakdown: `${m.name} DESERTED over unpaid wages (d20 ${roll}).` });
      } else {
        lines.push(`⚠ ${m.name} stays one more tenday (d20 ${roll}) — but they're done working for free.`);
        events.push({ type: "note", breakdown: `${m.name} on the brink of deserting (unpaid at loyalty 0, d20 ${roll}).` });
      }
    }
  }
  if (deserters.size) characters = characters.filter((c) => !deserters.has(c.id));

  return { state: { ...state, characters }, lines, events };
}
