import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { freshSceneCard } from "@/shared/scene";
import type { RNG } from "@/engine";

const maxRng: RNG = { int: (_min, max) => max };

function state(): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false, credits: 500,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    ship: {
      id: "s", campaignId: "c", name: "Wren", shipClass: "hauler", hp: 10, maxHp: 10, ac: 12,
      evasiveAcBonus: 0, damageReduction: 0, weapons: [], hasShield: false, shieldReady: false,
      hasPointDefense: false, burstDriveReady: false, dcModifier: 0, buyoutRemaining: 0, notes: "",
    },
    factions: [], factionRep: [], locations: [],
    npcs: [{ id: "npc-kessa", universeId: "u", name: "Kessa", oneBreath: "A steady dock medic.", role: "medic" }],
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

function runtimeWith(disposition: number, present = true): TurnRuntime {
  const card = freshSceneCard();
  if (present) card.presentNpcIds.push("npc-kessa");
  return new TurnRuntime(state(), maxRng, {
    sceneCard: card,
    npcRelations: { "npc-kessa": { disposition, log: [] } },
  });
}

describe("recruitCrew — the Hire chip's engine side (CREW.md §3)", () => {
  it("signs a trusted, present NPC on as a real party Character", () => {
    const rt = runtimeWith(2);
    const res = rt.recruitCrew("npc-kessa");
    expect(res.error).toBeUndefined();
    expect(res.line).toMatch(/Kessa signs on/);
    const member = rt.state.characters.find((c) => c.kind === "party");
    expect(member?.name).toBe("Kessa");
    expect(member?.crewRole).toBe("medic");
    expect(member?.crewTier).toBe("T1");
    expect(member?.wage).toBe(25);
  });

  it("refuses when trust is short, they're absent, or the berths are full", () => {
    expect(runtimeWith(1).recruitCrew("npc-kessa").error).toMatch(/trust/);
    expect(runtimeWith(2, false).recruitCrew("npc-kessa").error).toMatch(/isn't here/);
    const rt = runtimeWith(2);
    rt.recruitCrew("npc-kessa");
    expect(rt.recruitCrew("npc-kessa").error).toMatch(/already with you/);
  });
});
