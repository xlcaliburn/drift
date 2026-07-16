import type { CampaignState } from "@/shared/schemas";
import type { RNG, EngineEvent } from "@/engine";
import type { SceneCard, NpcRelations } from "@/shared/scene";
import {
  berthsFree,
  berthCap,
  buildCrewMember,
  crewTierFor,
  inferCrewRole,
  crewTierSpec,
  upkeepPerTenday,
} from "@/shared/crew";

/**
 * Crew recruitment (CREW.md §3) — the engine-owned side of the Hire chip. The chip
 * is generated from `recruitOffer` (trusted PRESENT NPC + a free berth); clicking it
 * lands here, where the SAME gates are re-validated before the engine instantiates
 * the member from the tier/role tables. Free functions over a narrow surface, same
 * pattern as the other runtime* domains.
 */
export interface CrewRT {
  state: CampaignState;
  rng: RNG;
  events: EngineEvent[];
  sceneCard: SceneCard;
  npcRelations: NpcRelations;
}

export function recruitCrew(rt: CrewRT, npcId: string): { line?: string; error?: string } {
  const npc = rt.state.npcs.find((n) => n.id === npcId);
  if (!npc) return { error: "no such person here" };
  if (!rt.sceneCard.presentNpcIds.includes(npcId)) return { error: `${npc.name} isn't here right now` };
  const rel = rt.npcRelations[npcId];
  const tier = rel ? crewTierFor(rel.disposition) : null;
  if (!tier) return { error: `${npc.name} doesn't trust you enough to sign on` };
  if (rt.state.characters.some((c) => c.name.toLowerCase() === npc.name.toLowerCase())) {
    return { error: `${npc.name} is already with you` };
  }
  if (berthsFree(rt.state) <= 0) {
    return { error: `no berth for them — the ${rt.state.ship?.name ?? "outfit"} is full (${berthCap(rt.state)} berths)` };
  }
  const role = inferCrewRole(npc.role);
  const member = buildCrewMember(npc, tier, role, rt.state.campaign.id, rt.rng);
  rt.state = { ...rt.state, characters: [...rt.state.characters, member] };
  const upkeep = upkeepPerTenday(rt.state);
  rt.events.push({
    type: "note",
    breakdown: `${npc.name} joined the crew — ${tier} ${role}, ¢${member.wage}/tenday (upkeep now ¢${upkeep}/tenday).`,
  });
  return {
    line: `🤝 ${npc.name} signs on — ${crewTierSpec(tier).label} ${role}, ¢${member.wage}/tenday. Crew upkeep is now ¢${upkeep}/tenday.`,
  };
}
