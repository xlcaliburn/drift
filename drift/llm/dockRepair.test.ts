import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { repairQuote } from "@/engine/market";
import type { RNG } from "@/engine";

const rng: RNG = { int: (_min, max) => max };

/** A PC + ship at a location, with control over dock tags, hull, and wallet. */
function state(over: { tags?: string[]; hp?: number; maxHp?: number; credits?: number; withShip?: boolean } = {}): CampaignState {
  const withShip = over.withShip ?? true;
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-1", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        credits: over.credits ?? 500,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    ship: withShip
      ? {
          id: "ship-1", campaignId: "c", name: "The Wren", shipClass: "scout",
          hp: over.hp ?? 8, maxHp: over.maxHp ?? 18, ac: 12, evasiveAcBonus: 2, damageReduction: 0,
          weapons: [], hasShield: false, shieldReady: false, hasPointDefense: false, burstDriveReady: true,
          dcModifier: 0, buyoutRemaining: 0, notes: "",
        }
      : undefined,
    factions: [], factionRep: [], locations: [{ id: "loc-1", universeId: "u", name: "Rook Station", tags: over.tags ?? ["blackmarket"] }],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const pc = (rt: TurnRuntime) => rt.state.characters[0];
const debtThread = (rt: TurnRuntime) => rt.state.threads.find((t) => t.id === "th-dock-debt");

describe("repairQuote — offered only at a serviced dock with a damaged hull", () => {
  it("quotes ¢12/HP of the deficit", () => {
    expect(repairQuote(state({ hp: 8, maxHp: 18 }))).toEqual({ hp: 10, cost: 120 });
  });
  it("null at a hazard site, at full hull, or with no ship", () => {
    expect(repairQuote(state({ tags: ["hazard"] }))).toBeNull();
    expect(repairQuote(state({ hp: 18, maxHp: 18 }))).toBeNull();
    expect(repairQuote(state({ withShip: false }))).toBeNull();
  });
});

describe("repairShip — engine-owned dock repair (E-3)", () => {
  it("patches to full and charges ¢12/HP", () => {
    const rt = new TurnRuntime(state({ hp: 8, maxHp: 18, credits: 500 }), rng);
    const res = rt.repairShip();
    expect(res.line).toContain("¢120");
    expect(rt.state.ship!.hp).toBe(18);
    expect(pc(rt).credits).toBe(380);
  });

  it("a partial patch respects hp and never over-repairs", () => {
    const rt = new TurnRuntime(state({ hp: 8, maxHp: 18, credits: 500 }), rng);
    rt.repairShip(4);
    expect(rt.state.ship!.hp).toBe(12);
    expect(pc(rt).credits).toBe(452); // 4 × 12
  });

  it("is NEVER refused for lack of funds — the balance goes negative (debt) and opens the thread", () => {
    const rt = new TurnRuntime(state({ hp: 0, maxHp: 18, credits: 50 }), rng);
    const res = rt.repairShip();
    expect(rt.state.ship!.hp).toBe(18);
    expect(pc(rt).credits).toBe(50 - 216); // -166
    expect(res.line).toContain("in the hole");
    const t = debtThread(rt);
    expect(t?.status).toBe("active");
    expect(t?.title).toBe("Dock debt");
  });

  it("refuses only where there's no dock, or nothing to fix", () => {
    expect(new TurnRuntime(state({ tags: ["hazard"] }), rng).repairShip().error).toMatch(/no dock/);
    expect(new TurnRuntime(state({ hp: 18, maxHp: 18 }), rng).repairShip().error).toMatch(/already/);
  });
});

describe("syncDockDebt — the payoff loop", () => {
  it("a payout that clears the balance resolves the debt thread (payout comes off debt first)", () => {
    const rt = new TurnRuntime(state({ hp: 0, maxHp: 18, credits: 50 }), rng);
    rt.repairShip(); // → -166, debt thread active
    expect(debtThread(rt)?.status).toBe("active");
    // A T2 payout (engine rolls within band) more than covers ¢166.
    rt.execute("award_payout", { tier: "T2", reason: "salvage sold" });
    rt.syncDockDebt();
    expect(pc(rt).credits).toBeGreaterThanOrEqual(0);
    expect(debtThread(rt)?.status).toBe("resolved");
  });

  it("is idempotent — no duplicate thread across repeated shortfalls", () => {
    const rt = new TurnRuntime(state({ hp: 0, maxHp: 40, credits: 0 }), rng);
    rt.repairShip(); // deep in debt
    rt.syncDockDebt();
    rt.syncDockDebt();
    expect(rt.state.threads.filter((t) => t.id === "th-dock-debt")).toHaveLength(1);
  });
});
