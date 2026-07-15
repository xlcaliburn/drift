import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import { freshSceneCard } from "@/shared/scene";
import type { RNG } from "@/engine";

const rng: RNG = { int: (_min, max) => max };

/** A PC + patron NPC + ship, with control over hull, wallet, stims, and where
 *  everyone is (STARTER.md — the free early-game safety net). */
function state(
  over: {
    hp?: number;
    shipHp?: number;
    credits?: number;
    stims?: number;
    downed?: boolean;
    pcLocation?: string;
    patronLocation?: string;
    withPatron?: boolean;
    gear?: { name: string; damage?: string; acBonus?: number }[];
  } = {},
): CampaignState {
  const withPatron = over.withPatron ?? true;
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: over.pcLocation ?? "loc-home", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess",
        hp: over.hp ?? 4, maxHp: 18, ac: 12, stims: over.stims ?? 0, fragile: false,
        credits: over.credits ?? 10,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: over.gear ?? [],
        injuries: over.downed ? [{ name: "Downed", effect: "critical" }] : [],
        ...(over.downed ? { deathSaves: { successes: 1, failures: 2 } } : {}),
      },
    ],
    ship: {
      id: "ship-1", campaignId: "c", name: "The Wren", shipClass: "scout",
      hp: over.shipHp ?? 6, maxHp: 18, ac: 12, evasiveAcBonus: 2, damageReduction: 0,
      weapons: [], hasShield: false, shieldReady: false, hasPointDefense: false, burstDriveReady: true,
      dcModifier: 0, buyoutRemaining: 0, notes: "",
    },
    factions: [], factionRep: [],
    locations: [
      { id: "loc-home", universeId: "u", name: "Home Berth", tags: [] },
      { id: "loc-away", universeId: "u", name: "The Deep", tags: [] },
    ],
    npcs: withPatron
      ? [{ id: "npc-patron-c", universeId: "u", name: "Old Marn", oneBreath: "Your patron.", role: "steward", locationId: over.patronLocation ?? "loc-home" }]
      : [],
    clocks: [],
    // A fresh player flies a LOANER (active ship-ownership thread) — so the hull's
    // resale value does NOT count toward net worth. Without this the scout (¢1200)
    // alone pushes them past the ¢600 cutoff before they've earned anything.
    threads: [{ id: "th-ship-c", title: "The loaner", status: "active", detail: "" }],
    contracts: [],
  } as unknown as CampaignState;
}

const pc = (rt: TurnRuntime) => rt.state.characters[0];

describe("restWithPatron — the faction patron's free safety net (STARTER.md)", () => {
  it("rests a struggling rookie to full HP + hull, tops stims to the floor, and stakes them when broke", () => {
    const rt = new TurnRuntime(state({ hp: 4, shipHp: 6, credits: 10, stims: 0 }), rng);
    const res = rt.restWithPatron();
    expect(res.error).toBeUndefined();
    expect(pc(rt).hp).toBe(18); // full HP
    expect(rt.state.ship!.hp).toBe(18); // hull mended
    expect(pc(rt).stims).toBe(2); // topped to the floor
    expect(pc(rt).credits).toBe(120); // broke → stipend
    expect(res.line).toContain("Old Marn");
  });

  it("clears the Downed state and death-save track", () => {
    const rt = new TurnRuntime(state({ downed: true, hp: 0 }), rng);
    rt.restWithPatron();
    expect((pc(rt).injuries ?? []).some((i) => i.name === "Downed")).toBe(false);
    expect(pc(rt).deathSaves).toBeUndefined();
    expect(pc(rt).hp).toBe(18);
  });

  it("does NOT hand out a stipend to a rookie who isn't actually broke", () => {
    const rt = new TurnRuntime(state({ hp: 4, credits: 200 }), rng); // still < ¢600 so eligible
    rt.restWithPatron();
    expect(pc(rt).credits).toBe(200); // untouched — not broke
  });

  it("won't top stims the player already has", () => {
    const rt = new TurnRuntime(state({ hp: 4, stims: 3 }), rng);
    rt.restWithPatron();
    expect(pc(rt).stims).toBe(3); // already above the floor
  });

  it("refuses once the player is established (net worth ≥ ¢600)", () => {
    const rt = new TurnRuntime(state({ hp: 4, credits: 700 }), rng);
    const res = rt.restWithPatron();
    expect(res.error).toMatch(/on your feet/);
    expect(pc(rt).hp).toBe(4); // nothing applied
  });

  it("refuses when the patron isn't here and isn't present in the scene", () => {
    const rt = new TurnRuntime(state({ pcLocation: "loc-away", patronLocation: "loc-home" }), rng);
    const res = rt.restWithPatron();
    expect(res.error).toMatch(/isn't here/);
  });

  it("works when the patron is PRESENT in the scene even away from their berth", () => {
    const rt = new TurnRuntime(
      state({ pcLocation: "loc-away", patronLocation: "loc-home", hp: 4 }),
      rng,
      { sceneCard: { ...freshSceneCard(), presentNpcIds: ["npc-patron-c"] } },
    );
    const res = rt.restWithPatron();
    expect(res.error).toBeUndefined();
    expect(pc(rt).hp).toBe(18);
  });

  it("errors cleanly when the campaign has no patron", () => {
    const rt = new TurnRuntime(state({ withPatron: false }), rng);
    expect(rt.restWithPatron().error).toMatch(/no patron/);
  });
});
