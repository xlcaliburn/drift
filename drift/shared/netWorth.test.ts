import { describe, it, expect } from "vitest";
import { netWorth, maxThreatTier, playerThreatTier, clampTier, patronHelp, PATRON_HELP_MAX } from "./netWorth";
import type { CampaignState } from "./schemas";

function stateWith(over: {
  credits?: number;
  gear?: { name: string; damage?: string; acBonus?: number; itemId?: string; qty?: number }[];
  currentLocationId?: string;
  npcs?: CampaignState["npcs"];
  /** Default full/topped so patronHelp tests that don't care about needsHelp
   *  aren't accidentally gated by it. */
  hp?: number;
  stims?: number;
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
        hp: over.hp ?? 18,
        maxHp: 18,
        ac: 12,
        stims: over.stims ?? 2,
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
  it("is eligible when the patron is PRESENT, under the cap, and the player needs help", () => {
    const s = stateWith({ credits: 50, currentLocationId: "loc-home", npcs: [patronNpc], hp: 4 });
    const { patron, present, underCap, needsHelp, eligible } = patronHelp(s, ["npc-patron-c"]);
    expect(patron?.name).toBe("Old Marn");
    expect(present).toBe(true);
    expect(underCap).toBe(true);
    expect(needsHelp).toBe(true);
    expect(eligible).toBe(true);
  });

  it("is NOT eligible from merely sharing a STATION — presence is required (the reported bug)", () => {
    // Same currentLocationId as the patron's home, but not actually in the scene.
    // A station is coarse (covers the ship, the market, every bar on it), so
    // matching on it alone offered the free-rest chip everywhere, for a patron the
    // story might never have introduced yet.
    const s = stateWith({ credits: 50, currentLocationId: "loc-home", npcs: [patronNpc], hp: 4 });
    const info = patronHelp(s); // no presentNpcIds passed
    expect(info.present).toBe(false);
    expect(info.eligible).toBe(false);
  });

  it("is eligible when present even far from the patron's home station", () => {
    const s = stateWith({ credits: 50, currentLocationId: "loc-elsewhere", npcs: [patronNpc], hp: 4 });
    expect(patronHelp(s, ["npc-patron-c"]).eligible).toBe(true);
  });

  it("does NOT offer the chip when the player doesn't need it (full HP + stims)", () => {
    const s = stateWith({ credits: 50, currentLocationId: "loc-home", npcs: [patronNpc], hp: 18, stims: 2 });
    const { present, underCap, needsHelp, eligible } = patronHelp(s, ["npc-patron-c"]);
    expect(present).toBe(true);
    expect(underCap).toBe(true);
    expect(needsHelp).toBe(false);
    expect(eligible).toBe(false);
  });

  it("HANDOFF_PLAYTEST_POLISH_1.md: low stims alone (full HP) no longer triggers the chip", () => {
    const s = stateWith({ credits: 50, currentLocationId: "loc-home", npcs: [patronNpc], hp: 18, stims: 0 });
    expect(patronHelp(s, ["npc-patron-c"]).needsHelp).toBe(false);
    expect(patronHelp(s, ["npc-patron-c"]).eligible).toBe(false);
  });

  it("cuts off once the player is established (net worth ≥ the cutoff), even present and hurt", () => {
    const s = stateWith({ credits: PATRON_HELP_MAX + 100, currentLocationId: "loc-home", npcs: [patronNpc], hp: 4 });
    const { patron, underCap, eligible } = patronHelp(s, ["npc-patron-c"]);
    expect(patron).toBeDefined(); // the person still exists…
    expect(underCap).toBe(false);
    expect(eligible).toBe(false); // …but the freebies are done
  });

  it("returns no patron for a campaign that never seeded one", () => {
    const s = stateWith({ credits: 50, currentLocationId: "loc-home", npcs: [] });
    const info = patronHelp(s);
    expect(info.patron).toBeUndefined();
    expect(info.eligible).toBe(false);
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
