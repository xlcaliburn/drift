import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { RNG } from "@/engine";
import { TurnRuntime } from "./engineBridge";
import { freshSceneCard } from "@/shared/scene";
import { openFightFromSkill, dcToTier, COMBAT_SKILLS } from "./openFight";

const maxRng: RNG = { int: (_min: number, max: number) => max };

/** A low-net-worth rookie (T1 ceiling), optionally with a present named foe. */
function state(over: { ship?: boolean; npcs?: CampaignState["npcs"] } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-x", tendaysElapsed: 0 },
    universe: { id: "u", name: "T" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 12, maxHp: 12, ac: 12, stims: 0, fragile: false, credits: 50,
        attributes: { might: 0, reflex: 2, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "smallArms", level: 2, ticks: 0 }],
        actionModifiers: { smallArms: 4 },
        gear: [{ name: "Sidearm", damage: "1d8", rounds: 12 }],
        injuries: [],
      },
    ],
    ship: over.ship
      ? ({ id: "s1", campaignId: "c", name: "Wren", shipClass: "scout", hp: 18, maxHp: 18, ac: 12, evasiveAcBonus: 2, damageReduction: 0, weapons: [{ name: "gun", type: "kinetic", damage: "2d6", count: 1 }], hasShield: false, shieldReady: false, hasPointDefense: false, burstDriveReady: true, dcModifier: 0, buyoutRemaining: 0, notes: "" } as unknown as CampaignState["ship"])
      : undefined,
    factions: [], factionRep: [],
    locations: [{ id: "loc-x", universeId: "u", name: "Dock", tags: [] }],
    npcs: over.npcs ?? [],
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("dcToTier + COMBAT_SKILLS", () => {
  it("maps DC bands to enemy tiers", () => {
    expect(dcToTier(10)).toBe("T1");
    expect(dcToTier(13)).toBe("T2");
    expect(dcToTier(17)).toBe("T3");
  });
  it("flags the two gun skills", () => {
    expect(COMBAT_SKILLS.has("smallArms")).toBe(true);
    expect(COMBAT_SKILLS.has("gunnery")).toBe(true);
    expect(COMBAT_SKILLS.has("negotiation")).toBe(false);
  });
});

describe("openFightFromSkill — gun-skill reroute", () => {
  it("spawns a fight and resolves the opening shot", () => {
    const s = state();
    const rt = new TurnRuntime(s, maxRng, { sceneCard: freshSceneCard() });
    const { combat, engineLine, lines } = openFightFromSkill(rt, s, "look, I shoot", "smallArms" as string, 12);
    expect(engineLine.startsWith("ENGINE RESULT:")).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    // A fight began (either still active, or the surprise shot dropped a lone T1).
    expect(rt.state.characters[0].id).toBe("pc-1");
    expect(combat === null || combat.enemies.length >= 1).toBe(true);
  });

  it("names the foe after a present NPC the player targeted", () => {
    const s = state({ npcs: [{ id: "npc-yuri", universeId: "u", name: "Yuri", oneBreath: "A fence." }] });
    const rt = new TurnRuntime(s, maxRng, { sceneCard: { ...freshSceneCard(), presentNpcIds: ["npc-yuri"] } });
    const { combat, lines } = openFightFromSkill(rt, s, "I shoot Yuri", "smallArms" as string, 12);
    const named = (combat?.enemies ?? []).some((e) => e.name.includes("Yuri")) || lines.join(" ").includes("Yuri");
    expect(named).toBe(true);
  });
});
