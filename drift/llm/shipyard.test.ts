import { describe, it, expect } from "vitest";
import type { CampaignState, Ship } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

const maxRng: RNG = { int: (_min, max) => max };

function ship(over: Partial<Ship> = {}): Ship {
  return {
    id: "ship-1", campaignId: "c", name: "The Wren", shipClass: "hauler", hp: 20, maxHp: 20, ac: 12,
    evasiveAcBonus: 0, damageReduction: 0, weapons: [], hasShield: false, shieldReady: true,
    hasPointDefense: false, burstDriveReady: false, dcModifier: 0, buyoutRemaining: 0,
    ...over,
  } as Ship;
}

/** A PC standing at a location with (or without) a market + dock, ship optional. */
function atDock(tags: string[], over: { credits?: number; shipOver?: Partial<Ship>; noShip?: boolean; rep?: number } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-1", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        credits: over.credits ?? 2000,
        attributes: { might: 0, reflex: 2, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    ship: over.noShip ? undefined : ship(over.shipOver),
    factions: [{ id: "f-dock", name: "Dockers", defaultRep: 0, alignment: "neutral", homeLocationId: "loc-1", color: "#fff" }],
    factionRep: [{ factionId: "f-dock", rep: over.rep ?? 0 }],
    locations: [{ id: "loc-1", universeId: "u", name: "Rook Station", tags: [...tags, "dock"] }],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("buyShipItem — install in one step (HANDOFF_COMBAT_V2_3.md Task C)", () => {
  it("happy path: writes the ship, debits credits, materializes stock first", () => {
    const rt = new TurnRuntime(atDock(["blackmarket"]), maxRng); // hauler, empty weapons[]
    const res = rt.buyShipItem("ionBattery");
    expect(res.error).toBeUndefined();
    expect(res.line).toContain("Ion battery fitted");
    // Materialized the hauler's stock railgun FIRST, then appended the ion battery.
    expect(rt.state.ship!.weapons).toHaveLength(2);
    expect(rt.state.ship!.weapons[0].type).toBe("kinetic"); // the materialized stock railgun
    expect(rt.state.ship!.weapons[1].type).toBe("ion");
    expect(rt.state.characters[0].credits).toBe(2000 - 400);
  });

  it("a system item SETS the field, no weapons[] change", () => {
    const rt = new TurnRuntime(atDock(["blackmarket"]), maxRng);
    const res = rt.buyShipItem("shieldEmitter");
    expect(res.error).toBeUndefined();
    expect(rt.state.ship!.hasShield).toBe(true);
    expect(rt.state.ship!.shieldReady).toBe(true);
    expect(rt.state.ship!.weapons).toHaveLength(0); // materialization only happens for MOUNT buys
  });

  it("above-tier items are refused with a clear reason", () => {
    const rt = new TurnRuntime(atDock([]), maxRng); // no commerce/blackmarket tag → T1
    const res = rt.buyShipItem("missileRack"); // T3
    expect(res.error).toMatch(/above/);
    expect(rt.state.ship!.weapons).toHaveLength(0); // nothing changed
  });

  it("a scout's single mount slot is already spent by its OWN stock gun — no room to buy", () => {
    // shipMountSlots counts a virtual class-default mount as "used" even
    // before materialization (Task B's own rule) — a scout (mountSlots 1,
    // 1 default mount) is already full; selling the stock gun is the way in.
    const rt = new TurnRuntime(atDock(["blackmarket"], { shipOver: { shipClass: "scout" } }), maxRng);
    expect(rt.buyShipItem("kineticCannon").error).toMatch(/no free mount slot/);
  });

  it("a full mount slot refuses the buy once every slot is actually spent", () => {
    const rt = new TurnRuntime(atDock(["blackmarket"], { shipOver: { shipClass: "gunship" } }), maxRng); // 2 default mounts, mountSlots 3
    const first = rt.buyShipItem("ionBattery"); // fills the 3rd (last) slot
    expect(first.error).toBeUndefined();
    const second = rt.buyShipItem("kineticCannon");
    expect(second.error).toMatch(/no free mount slot/);
  });

  it("an already-fitted system can't be bought twice", () => {
    const rt = new TurnRuntime(atDock(["blackmarket"]), maxRng);
    expect(rt.buyShipItem("hullPlating").error).toBeUndefined();
    expect(rt.buyShipItem("hullPlating").error).toMatch(/already fitted/);
  });

  it("no ship, no market, no such item — all refused visibly", () => {
    expect(new TurnRuntime(atDock(["blackmarket"], { noShip: true }), maxRng).buyShipItem("hullPlating").error).toMatch(/no ship/);
    expect(new TurnRuntime(atDock(["hazard"]), maxRng).buyShipItem("hullPlating").error).toBeTruthy();
    expect(new TurnRuntime(atDock(["blackmarket"]), maxRng).buyShipItem("plasmaCannon").error).toMatch(/no such/);
  });

  it("can't afford it — refused, nothing changes", () => {
    const rt = new TurnRuntime(atDock(["blackmarket"], { credits: 10 }), maxRng);
    const res = rt.buyShipItem("hullPlating");
    expect(res.error).toMatch(/afford/);
    expect(rt.state.characters[0].credits).toBe(10);
    expect(rt.state.ship!.damageReduction).toBe(0);
  });

  it("haggle takes 10% off, positive rep lowers price further", () => {
    const flat = new TurnRuntime(atDock(["blackmarket"]), maxRng);
    const flatRes = flat.buyShipItem("hullPlating");
    expect(flatRes.line).toContain("¢350");

    const haggler = new TurnRuntime(atDock(["blackmarket"]), maxRng);
    haggler.events.push({ type: "roll", breakdown: "x", skill: "negotiation", total: 20, dc: 13, outcome: "success", tickEligible: false });
    const haggleRes = haggler.buyShipItem("hullPlating");
    expect(haggleRes.line).toContain("haggled");
    expect(haggler.state.characters[0].credits).toBe(2000 - Math.round(350 * 0.9));

    const repped = new TurnRuntime(atDock(["blackmarket"], { rep: 5 }), maxRng);
    const reppedRes = repped.buyShipItem("hullPlating");
    expect(repped.state.characters[0].credits!).toBeGreaterThan(flat.state.characters[0].credits!); // paid less
    void reppedRes;
  });
});

describe("sellShipItem — strip at the flat 40% (HANDOFF_COMBAT_V2_3.md Task C)", () => {
  it("strips a bought mount and refunds 40% of its type's shipyard price", () => {
    const rt = new TurnRuntime(atDock(["blackmarket"]), maxRng);
    rt.buyShipItem("ionBattery"); // hauler stock railgun + ion battery, credits 2000-400=1600
    const res = rt.sellShipItem("Ion battery");
    expect(res.error).toBeUndefined();
    expect(res.line).toContain("+¢160"); // 400 × 0.4
    expect(rt.state.ship!.weapons).toHaveLength(1); // only the stock railgun remains
    expect(rt.state.characters[0].credits).toBe(1600 + 160);
  });

  it("strips a fitted system and unsets the field", () => {
    const rt = new TurnRuntime(atDock(["blackmarket"]), maxRng);
    rt.buyShipItem("shieldEmitter");
    const res = rt.sellShipItem("Shield emitter");
    expect(res.error).toBeUndefined();
    expect(rt.state.ship!.hasShield).toBe(false);
    expect(res.line).toContain("+¢160"); // 400 × 0.4
  });

  it("selling a NEVER-BOUGHT stock gun materializes it first, then sells it", () => {
    const rt = new TurnRuntime(atDock(["blackmarket"]), maxRng); // hauler — empty weapons[], virtual railgun
    const res = rt.sellShipItem("railgun");
    expect(res.error).toBeUndefined();
    expect(rt.state.ship!.weapons).toHaveLength(0); // materialized then immediately stripped
    expect(rt.state.characters[0].credits).toBe(2000 + 100); // kineticCannon 250 × 0.4 = 100
  });

  it("can't sell an unfitted system or a mount you don't have", () => {
    const rt = new TurnRuntime(atDock(["blackmarket"]), maxRng);
    expect(rt.sellShipItem("Burst drive").error).toMatch(/isn't fitted/);
    expect(rt.sellShipItem("Plasma carbine").error).toMatch(/not carrying/);
  });

  it("no ship — refused", () => {
    expect(new TurnRuntime(atDock(["blackmarket"], { noShip: true }), maxRng).sellShipItem("railgun").error).toMatch(/no ship/);
  });
});
