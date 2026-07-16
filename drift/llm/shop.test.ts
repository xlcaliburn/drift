import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { marketStock } from "@/engine/market";
import type { RNG } from "@/engine";

const maxRng: RNG = { int: (_min, max) => max };

/** A PC standing at a location with (or without) a market. */
function atLocation(
  tags: string[],
  over: { credits?: number; gear?: { name: string; itemId?: string; qty?: number; damage?: string; acBonus?: number }[]; might?: number } = {},
): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: "loc-1", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        credits: over.credits ?? 500,
        attributes: { might: over.might ?? 0, reflex: 2, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: over.gear ?? [], injuries: [],
      },
    ],
    factions: [{ id: "fac-crown", name: "Hollow Crown", agenda: "", disposition: 0 }],
    factionRep: [{ campaignId: "c", factionId: "fac-crown", rep: 0 }],
    locations: [{ id: "loc-1", universeId: "u", name: "Rook Station", tags }],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("buyItem — the engine owns the whole transaction", () => {
  it("buys a shelved consumable: debits credits, adds the stack, prints the figure", () => {
    const rt = new TurnRuntime(atLocation(["blackmarket"]), maxRng);
    const res = rt.buyItem("medkit", 1);
    expect(res.line).toContain("Bought Medkit");
    expect(res.line).toContain("¢75");
    const pc = rt.state.characters[0];
    expect(pc.credits).toBe(425);
    expect(pc.gear.find((g) => g.itemId === "medkit")?.qty).toBe(1);
  });

  it("HAGGLE: a passed negotiation roll this turn takes 10% off the till (audit-born)", () => {
    // The live appeal: player won the haggle, narration said ¢28, engine charged
    // list ¢30. The price the till charges must follow the dice.
    const rt = new TurnRuntime(atLocation(["blackmarket"]), maxRng);
    rt.events.push({ type: "roll", breakdown: "x", skill: "negotiation", total: 20, dc: 13, outcome: "success", tickEligible: false });
    const res = rt.buyItem("medkit", 1);
    expect(res.line).toContain("¢68"); // round(75 * 0.9)
    expect(res.line).toContain("haggled");
    expect(rt.state.characters[0].credits).toBe(500 - 68);

    // A FAILED haggle changes nothing — list price, no discount marker.
    const rt2 = new TurnRuntime(atLocation(["blackmarket"]), maxRng);
    rt2.events.push({ type: "roll", breakdown: "x", skill: "negotiation", total: 4, dc: 13, outcome: "failure", tickEligible: false });
    const res2 = rt2.buyItem("medkit", 1);
    expect(res2.line).toContain("¢75");
    expect(res2.line).not.toContain("haggled");
  });

  it("refuses off-shelf items, empty wallets, and full packs — all visibly", () => {
    // Not on ANY shelf: a made-up id.
    const rt = new TurnRuntime(atLocation(["blackmarket"]), maxRng);
    expect(rt.buyItem("rocketLauncher").error).toBeTruthy();

    // Can't afford.
    const broke = new TurnRuntime(atLocation(["blackmarket"], { credits: 5 }), maxRng);
    expect(broke.buyItem("medkit").error).toMatch(/afford/);

    // Pack full: 8 slots of flavor junk (might 0 → cap 8).
    const full = new TurnRuntime(
      atLocation(["blackmarket"], {
        gear: Array.from({ length: 8 }, (_, i) => ({ name: `Bolt crate ${i}` })),
      }),
      maxRng,
    );
    expect(full.buyItem("medkit").error).toMatch(/pack full/i);
  });

  it("no market at a hazard site — nothing is for sale", () => {
    const rt = new TurnRuntime(atLocation(["hazard"]), maxRng);
    expect(rt.buyItem("stim").error).toBeTruthy();
  });

  it("buying armor recomputes AC to the best single piece", () => {
    const rt = new TurnRuntime(atLocation(["blackmarket"], { credits: 2000 }), maxRng);
    const res = rt.buyItem("ballisticVest"); // +2 AC, T1 — buyable at any market now
    expect(res.line).toBeTruthy();
    const pc = rt.state.characters[0];
    expect(pc.ac).toBe(10 + 2 + 2); // 10 + reflex 2 + vest +2
  });

  it("buys a tier-appropriate item even when it's NOT in the rotated 'featured' stock (the offer-then-rejected bug)", () => {
    const rt = new TurnRuntime(atLocation(["blackmarket"], { credits: 2000 }), maxRng); // T3 market
    const res = rt.buyItem("railRifle"); // T3 hardware — must be buyable regardless of the chunk's featured window
    expect(res.error).toBeUndefined();
    expect(res.line).toContain("Rail rifle");
    expect(rt.state.characters[0].gear.some((g) => g.itemId === "railRifle")).toBe(true);
  });

  it("resolves a purchase by NAME, not just catalog id", () => {
    const rt = new TurnRuntime(atLocation(["blackmarket"], { credits: 2000 }), maxRng);
    expect(rt.buyItem("Combat rifle").error).toBeUndefined();
    expect(rt.state.characters[0].gear.some((g) => g.itemId === "combatRifle")).toBe(true);
  });

  it("a bought item records HOW + WHEN it was acquired", () => {
    const rt = new TurnRuntime(atLocation(["blackmarket"], { credits: 2000 }), maxRng);
    rt.buyItem("combatRifle");
    const rifle = rt.state.characters[0].gear.find((g) => g.itemId === "combatRifle");
    expect(rifle?.detail).toMatch(/bought at Rook/);
    expect(rifle?.detail).toMatch(/tenday/);
  });

  it("still refuses gear ABOVE the market's tier", () => {
    const rt = new TurnRuntime(atLocation(["hostile"], { credits: 2000 }), maxRng); // backwater → T1 market
    expect(rt.buyItem("plasmaCarbine").error).toMatch(/above/); // T3 gun, not at a T1 dock
  });
});

describe("sellItem — flat 40% of value", () => {
  it("sells catalog gear at 40% of price and decrements the stack", () => {
    const rt = new TurnRuntime(
      atLocation(["blackmarket"], { credits: 0, gear: [{ name: "Medkit", itemId: "medkit", qty: 2 }] }),
      maxRng,
    );
    const res = rt.sellItem("Medkit");
    expect(res.line).toContain("+¢30"); // 75 × 0.4
    const pc = rt.state.characters[0];
    expect(pc.credits).toBe(30);
    expect(pc.gear.find((g) => g.itemId === "medkit")?.qty).toBe(1);
  });

  it("sells flavor gear by the netWorth heuristic and removes it whole", () => {
    const rt = new TurnRuntime(
      atLocation(["blackmarket"], { credits: 0, gear: [{ name: "Odd carbine", damage: "2d6" }] }),
      maxRng,
    );
    const res = rt.sellItem("Odd carbine");
    expect(res.line).toContain("+¢58"); // maxDamage 12 × 12 = 144 × 0.4 = 57.6 → 58
    expect(rt.state.characters[0].gear).toHaveLength(0);
  });

  it("selling worn armor drops AC back to reflexes", () => {
    const state = atLocation(["blackmarket"], {
      credits: 0,
      gear: [{ name: "Ballistic vest", itemId: "ballisticVest", acBonus: 2 }],
    });
    state.characters[0].ac = 14; // 10 + reflex 2 + vest 2
    const rt = new TurnRuntime(state, maxRng);
    rt.sellItem("Ballistic vest");
    expect(rt.state.characters[0].ac).toBe(12);
  });

  it("can't sell what you don't carry", () => {
    const rt = new TurnRuntime(atLocation(["blackmarket"]), maxRng);
    expect(rt.sellItem("Plasma carbine").error).toMatch(/not carrying/);
  });
});
