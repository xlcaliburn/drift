import { describe, it, expect } from "vitest";
import type { CampaignState, Character } from "./schemas";
import type { RNG } from "@/engine/rng";
import {
  berthCap,
  berthsFree,
  crewMembers,
  inferCrewRole,
  crewTierFor,
  recruitOffer,
  buildCrewMember,
  upkeepPerTenday,
  chargeCrewUpkeep,
} from "./crew";

const maxRng: RNG = { int: (_min, max) => max };

function pc(credits = 500): Character {
  return {
    id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false, credits,
    attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
    skills: [], actionModifiers: {}, gear: [], injuries: [],
  } as unknown as Character;
}

function state(over: {
  characters?: Character[];
  shipClass?: string;
  npcs?: { id: string; name: string; role?: string }[];
} = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u", name: "U" },
    characters: over.characters ?? [pc()],
    ship: over.shipClass
      ? { id: "s", campaignId: "c", name: "Wren", shipClass: over.shipClass, hp: 10, maxHp: 10, ac: 12,
          evasiveAcBonus: 0, damageReduction: 0, weapons: [], hasShield: false, shieldReady: false,
          hasPointDefense: false, burstDriveReady: false, dcModifier: 0, buyoutRemaining: 0, notes: "" }
      : undefined,
    factions: [], factionRep: [], locations: [],
    npcs: (over.npcs ?? []).map((n) => ({ ...n, universeId: "u", oneBreath: "..." })),
    clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const crewMember = (name: string, tier: "T1" | "T2" = "T1"): Character =>
  buildCrewMember({ id: `npc-${name}`, name }, tier, "muscle", "c", maxRng);

describe("berths + roles + tiers", () => {
  it("berth caps follow the hull; grounded = 2", () => {
    expect(berthCap(state())).toBe(2);
    expect(berthCap(state({ shipClass: "hauler" }))).toBe(5);
    expect(berthCap(state({ shipClass: "corvette" }))).toBe(6);
  });

  it("role inference from a freeform handle (muscle default)", () => {
    expect(inferCrewRole("ship medic")).toBe("medic");
    expect(inferCrewRole("dock mechanic")).toBe("engineer");
    expect(inferCrewRole("shuttle pilot")).toBe("pilot");
    expect(inferCrewRole("trade-house fixer")).toBe("face");
    expect(inferCrewRole("ex-military sniper")).toBe("gunner");
    expect(inferCrewRole("enforcer")).toBe("muscle");
    expect(inferCrewRole(undefined)).toBe("muscle");
  });

  it("trust gates the tier: +2 → T1, +3 → T2, below → no hire", () => {
    expect(crewTierFor(1)).toBeNull();
    expect(crewTierFor(2)).toBe("T1");
    expect(crewTierFor(3)).toBe("T2");
  });
});

describe("recruitOffer — the deterministic Hire chip", () => {
  const npcs = [{ id: "npc-kessa", name: "Kessa", role: "medic" }];

  it("offers a trusted, present NPC while a berth is free", () => {
    const offer = recruitOffer(state({ npcs }), { "npc-kessa": { disposition: 2, log: [] } }, ["npc-kessa"]);
    expect(offer?.npcId).toBe("npc-kessa");
    expect(offer?.role).toBe("medic");
    expect(offer?.tier).toBe("T1");
    expect(offer?.label).toMatch(/Hire Kessa/);
    expect(offer?.label).toMatch(/¢25\/tenday/);
  });

  it("no offer when: not trusted / not present / no berth / already crew", () => {
    const s = state({ npcs });
    expect(recruitOffer(s, { "npc-kessa": { disposition: 1, log: [] } }, ["npc-kessa"])).toBeNull(); // wary
    expect(recruitOffer(s, { "npc-kessa": { disposition: 2, log: [] } }, [])).toBeNull(); // absent
    const full = state({ npcs, characters: [pc(), crewMember("Bruno")] }); // grounded cap = 2
    expect(recruitOffer(full, { "npc-kessa": { disposition: 2, log: [] } }, ["npc-kessa"])).toBeNull();
    const already = state({ npcs, characters: [pc(), crewMember("Kessa")], shipClass: "hauler" });
    expect(recruitOffer(already, { "npc-kessa": { disposition: 2, log: [] } }, ["npc-kessa"])).toBeNull();
  });
});

describe("buildCrewMember — engine-built, model stats ignored", () => {
  it("stats come from the tier table, kit from the role table", () => {
    const m = buildCrewMember({ id: "n1", name: "Kessa", role: "medic" }, "T1", "medic", "c", maxRng);
    expect(m.kind).toBe("party");
    expect(m.hp).toBe(12); // T1 hpRange max with maxRng
    expect(m.loyalty).toBe(3);
    expect(m.crewRole).toBe("medic");
    expect(m.crewTier).toBe("T1");
    expect(m.wage).toBe(25);
    expect(m.skills[0]).toEqual({ name: "survival", level: 1, ticks: 0 });
    expect(m.gear.some((g) => g.itemId === "medkit")).toBe(true);
  });
});

describe("upkeep — wages + superlinear overhead, charged as tendays pass", () => {
  it("one hand = flat wage; three hands cost more than 3× one", () => {
    const one = state({ characters: [pc(), crewMember("A")], shipClass: "hauler" });
    expect(upkeepPerTenday(one)).toBe(25);
    const three = state({ characters: [pc(), crewMember("A"), crewMember("B"), crewMember("C")], shipClass: "hauler" });
    // 75 wages + ceil(75 × 0.15 × 2) = 75 + 23 = 98 > 75
    expect(upkeepPerTenday(three)).toBe(98);
  });

  it("chargeCrewUpkeep debits the PC per tenday (may go negative)", () => {
    const s = state({ characters: [pc(30), crewMember("A")], shipClass: "hauler" });
    const r = chargeCrewUpkeep(s, 2);
    expect(r.state.characters.find((c) => c.kind === "pc")!.credits).toBe(30 - 50); // 25 × 2
    expect(r.lines[0]).toMatch(/Crew upkeep: -¢50/);
  });

  it("no crew (or no time) = no charge", () => {
    expect(chargeCrewUpkeep(state(), 2).lines).toHaveLength(0);
    const s = state({ characters: [pc(), crewMember("A")], shipClass: "hauler" });
    expect(chargeCrewUpkeep(s, 0).lines).toHaveLength(0);
  });

  it("crewMembers excludes the dead; berthsFree counts living heads", () => {
    const dead = { ...crewMember("Gone"), injuries: [{ name: "Dead", effect: "" }] } as Character;
    const s = state({ characters: [pc(), dead], shipClass: "scout" }); // cap 2
    expect(crewMembers(s)).toHaveLength(0);
    expect(berthsFree(s)).toBe(1); // the dead don't hold a berth
  });
});
