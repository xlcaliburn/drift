import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

const fixed = (d20: number): RNG => ({ int: (min, max) => (min === 1 && max === 20 ? d20 : max) });
const maxRng: RNG = { int: (_min, max) => max };
// Fails the d20 (rolls 1) but maxes any damage roll — a guaranteed failed check
// that lands full hazard damage (mirrors the death-gate suite).
const failHard: RNG = { int: (min, max) => (max === 20 ? 1 : max) };

/** A Downed PC (post-tutorial), optionally holding a stim, with a given track. */
function downedState(over: {
  saves?: { successes: number; failures: number };
  stim?: number;
  resolved?: number;
} = {}): CampaignState {
  const threads = Array.from({ length: over.resolved ?? 3 }, (_, i) => ({
    id: `t-${i}`, campaignId: "c", title: "done", body: "", status: "resolved", entityRefs: [],
  }));
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 0, maxHp: 18, ac: 12, stims: 0, fragile: false, credits: 0,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {},
        gear: over.stim ? [{ name: "Stim", itemId: "stim", qty: over.stim }] : [],
        injuries: [{ name: "Downed", effect: "critical" }],
        deathSaves: over.saves ?? { successes: 0, failures: 0 },
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads, contracts: [],
  } as unknown as CampaignState;
}

const pc = (rt: TurnRuntime) => rt.state.characters[0];

describe("resolveDeathSave — the engine owns the Bleeding Out roll", () => {
  it("a passing save adds a success and keeps you down", () => {
    const rt = new TurnRuntime(downedState(), fixed(15));
    const { outcome } = rt.resolveDeathSave({ kind: "hold" });
    expect(outcome).toBe("continue");
    expect(pc(rt).deathSaves).toEqual({ successes: 1, failures: 0 });
    expect(pc(rt).hp).toBe(0);
  });

  it("the third success STABILISES — up to 1 HP, Downed cleared, track dropped", () => {
    const rt = new TurnRuntime(downedState({ saves: { successes: 2, failures: 0 } }), fixed(15));
    const { outcome } = rt.resolveDeathSave({ kind: "hold" });
    expect(outcome).toBe("stabilized");
    expect(pc(rt).hp).toBe(1);
    expect(pc(rt).injuries.some((i) => i.name === "Downed")).toBe(false);
    expect(pc(rt).deathSaves).toBeUndefined();
  });

  it("the third failure is DEATH (post-tutorial)", () => {
    const rt = new TurnRuntime(downedState({ saves: { successes: 0, failures: 2 } }), fixed(5));
    const { outcome } = rt.resolveDeathSave({ kind: "hold" });
    expect(outcome).toBe("dead");
    expect(TurnRuntime.isDead(pc(rt))).toBe(true);
  });

  it("a nat 20 RALLIES you back to your feet at 1 HP", () => {
    const rt = new TurnRuntime(downedState({ saves: { successes: 0, failures: 2 } }), fixed(20));
    const { outcome } = rt.resolveDeathSave({ kind: "hold" });
    expect(outcome).toBe("recovered");
    expect(pc(rt).hp).toBe(1);
    expect(pc(rt).injuries.some((i) => i.name === "Downed")).toBe(false);
  });

  it("a nat 1 is two failures — one away from dead becomes dead", () => {
    const rt = new TurnRuntime(downedState({ saves: { successes: 0, failures: 1 } }), fixed(1));
    const { outcome } = rt.resolveDeathSave({ kind: "hold" });
    expect(outcome).toBe("dead");
  });

  it("reaching for a held stim is the self-rescue: heal, up, item spent", () => {
    const rt = new TurnRuntime(downedState({ stim: 1 }), maxRng);
    const { outcome } = rt.resolveDeathSave({ kind: "item", itemId: "stim" });
    expect(outcome).toBe("recovered");
    expect(pc(rt).hp).toBeGreaterThan(0);
    expect(pc(rt).injuries.some((i) => i.name === "Downed")).toBe(false);
    expect(pc(rt).gear.some((g) => g.itemId === "stim")).toBe(false); // consumed
  });

  it("reaching for a stim you DON'T have falls back to a raw save", () => {
    const rt = new TurnRuntime(downedState({ saves: { successes: 2, failures: 0 } }), fixed(15));
    const { outcome } = rt.resolveDeathSave({ kind: "item", itemId: "stim" });
    expect(outcome).toBe("stabilized"); // fell through to a hold-on save → 3rd success
  });

  it("cover lowers the bar — an 8 saves with the +2 edge", () => {
    const rt = new TurnRuntime(downedState(), fixed(8));
    expect(rt.resolveDeathSave({ kind: "cover" }).outcome).toBe("continue");
    expect(pc(rt).deathSaves).toEqual({ successes: 1, failures: 0 });
  });

  it("a hostile standing over you adds a failure on top of the save", () => {
    // Save passes (+1 success) but pressure adds +1 failure the same turn.
    const rt = new TurnRuntime(downedState(), fixed(15));
    rt.resolveDeathSave({ kind: "hold" }, { hostilePresent: true });
    expect(pc(rt).deathSaves).toEqual({ successes: 1, failures: 1 });
  });

  it("the tutorial never lets the third failure kill", () => {
    const rt = new TurnRuntime(downedState({ saves: { successes: 0, failures: 2 }, resolved: 0 }), fixed(5));
    const { outcome } = rt.resolveDeathSave({ kind: "hold" });
    expect(outcome).toBe("continue");
    expect(TurnRuntime.isDead(pc(rt))).toBe(false);
  });
});

describe("going down seeds the track", () => {
  it("a killing blow to a healthy PC downs them and starts death saves at 0/0", () => {
    const s = downedState();
    s.characters[0].hp = 6;
    s.characters[0].injuries = [];
    s.characters[0].deathSaves = undefined;
    const rt = new TurnRuntime(s, failHard);
    // A deadly hazard one-shots the 6-HP PC → Downed, track seeded.
    rt.execute("roll_check", { characterId: "pc-1", skill: "zeroG", dc: 99, stakes: false, hazardLevel: 5 });
    expect(pc(rt).hp).toBe(0);
    expect(pc(rt).injuries.some((i) => i.name === "Downed")).toBe(true);
    expect(pc(rt).deathSaves).toEqual({ successes: 0, failures: 0 });
  });
});
