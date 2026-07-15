import { describe, it, expect } from "vitest";
import { netWorth, maxThreatTier, playerThreatTier, clampTier, patronHelp, PATRON_HELP_MAX } from "./netWorth";
import type { CampaignState } from "./schemas";

function stateWith(over: {
  credits?: number;
  gear?: { name: string; damage?: string; acBonus?: number; itemId?: string; qty?: number }[];
  currentLocationId?: string;
  npcs?: CampaignState["npcs"];
}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: over.currentLocationId ?? "loc-1", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1",
        kind: "pc",
        name: "Test",
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        hp: 18,
        maxHp: 18,
        ac: 12,
        stims: 0,
        fragile: false,
        skills: [],
        actionModifiers: {},
        gear: over.gear ?? [],
        injuries: [],
        credits: over.credits ?? 0,
      },
    ],
    factions: [],
    factionRep: [],
    locations: [],
    npcs: over.npcs ?? [],
    clocks: [],
    threads: [],
    contracts: [],
  } as unknown as CampaignState;
}

const patronNpc = {
  id: "npc-patron-c",
  universeId: "u",
  name: "Old Marn",
  oneBreath: "Your patron.",
  role: "steward",
  locationId: "loc-home",
} as unknown as CampaignState["npcs"][number];

describe("netWorth — gear + credits (owned ship excluded when a loaner)", () => {
  it("a fresh ex-military loadout sits in the T1 band (< 600)", () => {
    const s = stateWith({
      credits: 120,
      gear: [
        { name: "Sidearm", damage: "1d8" }, // 96
        { name: "Combat rifle", damage: "2d6" }, // 144
        { name: "Ballistic vest", acBonus: 2 }, // 160
      ],
    });
    const w = netWorth(s); // 120 + 96 + 144 + 160 = 520
    expect(w).toBe(520);
    expect(playerThreatTier(s)).toBe("T1");
  });

  it("a well-paid, well-armed character reaches T2, then T3", () => {
    expect(maxThreatTier(520)).toBe("T1");
    expect(maxThreatTier(600)).toBe("T2");
    expect(maxThreatTier(1500)).toBe("T2");
    expect(maxThreatTier(2500)).toBe("T3");
    expect(maxThreatTier(9000)).toBe("T3");
  });

  it("counts stacked/qty gear", () => {
    const s = stateWith({ credits: 0, gear: [{ name: "Grenade", damage: "2d8", qty: 2 }] }); // 192 * 2
    expect(netWorth(s)).toBe(384);
  });
});

describe("patronHelp — the free early-game safety net (STARTER.md)", () => {
  it("is available to a struggling rookie WHEN they're at the patron's station", () => {
    const s = stateWith({ credits: 50, currentLocationId: "loc-home", npcs: [patronNpc] });
    const { patron, eligible } = patronHelp(s);
    expect(patron?.name).toBe("Old Marn");
    expect(eligible).toBe(true);
  });

  it("is available when the patron is PRESENT even if the player has moved on", () => {
    const s = stateWith({ credits: 50, currentLocationId: "loc-elsewhere", npcs: [patronNpc] });
    expect(patronHelp(s).eligible).toBe(false); // not here, not present
    expect(patronHelp(s, ["npc-patron-c"]).eligible).toBe(true); // present overrides
  });

  it("cuts off once the player is established (net worth ≥ the cutoff)", () => {
    const s = stateWith({ credits: PATRON_HELP_MAX + 100, currentLocationId: "loc-home", npcs: [patronNpc] });
    const { patron, eligible } = patronHelp(s);
    expect(patron).toBeDefined(); // the person still exists…
    expect(eligible).toBe(false); // …but the freebies are done
  });

  it("returns no patron for a campaign that never seeded one", () => {
    const s = stateWith({ credits: 50, currentLocationId: "loc-home", npcs: [] });
    expect(patronHelp(s)).toEqual({ eligible: false });
  });
});

describe("clampTier — a request never exceeds the ceiling", () => {
  it("clamps down but never up", () => {
    expect(clampTier("T3", "T1")).toBe("T1");
    expect(clampTier("T2", "T1")).toBe("T1");
    expect(clampTier("T1", "T3")).toBe("T1"); // a weak foe is fine at any band
    expect(clampTier("T2", "T2")).toBe("T2");
  });
});
