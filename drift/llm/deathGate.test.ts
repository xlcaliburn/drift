import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

// d20 = 1 → any check vs a high DC fails (and 1 is not a crit), so failDamage lands.
const minRng: RNG = { int: (min) => min };
const maxRng: RNG = { int: (_min, max) => max };
// Fails the d20 (rolls 1) but MAXES the hazard-damage roll (0..2 → 2), so damage
// = 2 × hazardLevel deterministically.
const failHard: RNG = { int: (min, max) => (max === 20 ? 1 : max) };

/** A low-HP PC with `resolved` completed quests (>=3 ends the tutorial). */
function pcState(resolved: number): CampaignState {
  const threads = Array.from({ length: resolved }, (_, i) => ({
    id: `t-${i}`, campaignId: "c", title: "done", body: "", status: "resolved", entityRefs: [],
  }));
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 5, maxHp: 5, ac: 12, stims: 0, fragile: false, credits: 0,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
      },
    ],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads, contracts: [],
  } as unknown as CampaignState;
}

// A deadly (⚠5) hazard hit with failHard deals 2 × 5 = 10 — one-shots a 5-HP PC.
const hazardHit = (rt: TurnRuntime) =>
  rt.execute("roll_check", { characterId: "pc-1", skill: "zeroG", dc: 99, stakes: false, hazardLevel: 5 });

describe("death gate", () => {
  it("in the tutorial (<3 quests), even a deadly hit DOWNS but never kills", () => {
    const rt = new TurnRuntime(pcState(0), failHard);
    hazardHit(rt); // 10 damage vs 5 HP → 0: downed
    expect(rt.state.characters[0].hp).toBe(0);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(true);
    hazardHit(rt); // struck while down — would kill, but tutorial forbids it
    const names = rt.state.characters[0].injuries.map((i) => i.name);
    expect(names).toContain("Downed");
    expect(names).not.toContain("Dead");
    expect(TurnRuntime.isDead(rt.state.characters[0])).toBe(false);
  });

  it("after the tutorial (>=3 quests), a hit while down KILLS", () => {
    const rt = new TurnRuntime(pcState(3), failHard);
    hazardHit(rt); // downed
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(true);
    hazardHit(rt); // struck while down → dead
    expect(TurnRuntime.isDead(rt.state.characters[0])).toBe(true);
  });
});

describe("failure damage is gated + leveled (0-2 × hazardLevel)", () => {
  it("a failed ability check (perception) deals NO damage", () => {
    const rt = new TurnRuntime(pcState(3), failHard); // hp 5, fails vs dc 99
    rt.execute("roll_check", { characterId: "pc-1", skill: "perception", dc: 99, failDamage: "100" });
    expect(rt.state.characters[0].hp).toBe(5); // untouched — perception can't hurt you
  });

  it("a ⚠1 hazard scrape deals at most 2; a ⚠5 deadly hit can one-shot", () => {
    const scrape = new TurnRuntime(pcState(3), failHard);
    scrape.execute("roll_check", { characterId: "pc-1", skill: "zeroG", dc: 99, hazardLevel: 1 });
    expect(scrape.state.characters[0].hp).toBe(3); // 5 - (2×1)

    const deadly = new TurnRuntime(pcState(3), failHard);
    deadly.execute("roll_check", { characterId: "pc-1", skill: "zeroG", dc: 99, hazardLevel: 5 });
    expect(deadly.state.characters[0].hp).toBe(0); // 2×5 = 10 ≥ 5 → downed outright
  });

  it("damage can also roll ZERO — a lucky escape at any level", () => {
    const rt = new TurnRuntime(pcState(3), minRng); // damage roll (0..2) → 0
    rt.execute("roll_check", { characterId: "pc-1", skill: "zeroG", dc: 99, hazardLevel: 5 });
    expect(rt.state.characters[0].hp).toBe(5); // failed the check, dodged the harm
  });

  it("legacy dice failDamage converts to a level (2d6 → ⚠5 territory stays bounded)", () => {
    const rt = new TurnRuntime(pcState(3), failHard);
    rt.execute("roll_check", { characterId: "pc-1", skill: "zeroG", dc: 99, failDamage: "1d4" });
    expect(rt.state.characters[0].hp).toBe(1); // ceil(4/2)=2 → 2×2=4 → 5-4
  });

  it("a danger save (hazard flag) deals leveled damage on any skill", () => {
    const rt = new TurnRuntime(pcState(3), failHard);
    rt.execute("roll_check", { characterId: "pc-1", skill: "perception", dc: 99, hazardLevel: 1, hazard: true });
    expect(rt.state.characters[0].hp).toBe(3); // a trap can hurt even on a perception save
  });

  it("scavenging is a real skill and never deals failure damage (looting can't hurt you)", () => {
    const rt = new TurnRuntime(pcState(3), failHard);
    const r = rt.execute("roll_check", { characterId: "pc-1", skill: "scavenging", dc: 99, failDamage: "100" }) as {
      breakdown: string;
    };
    expect(r.breakdown).toContain("scavenging");
    expect(rt.state.characters[0].hp).toBe(5); // a bad haul, not a wound
  });

  it("target:ship routes leveled damage to the HULL, not the pilot", () => {
    const s = pcState(3);
    s.ship = { id: "ship-1", campaignId: "c", name: "Magpie", shipClass: "scout", hp: 18, maxHp: 18, ac: 12, evasiveAcBonus: 2, damageReduction: 0, weapons: [], hasShield: false, shieldReady: false, hasPointDefense: false, burstDriveReady: false, dcModifier: 0, buyoutRemaining: 0 } as unknown as CampaignState["ship"];
    const rt = new TurnRuntime(s, failHard);
    const r = rt.execute("roll_check", {
      characterId: "pc-1", skill: "piloting", dc: 99, hazardLevel: 3, target: "ship",
    }) as { shipDamage?: number };
    expect(rt.state.characters[0].hp).toBe(5); // pilot untouched
    expect(rt.state.ship!.hp).toBe(12); // 18 - (2×3)
    expect(r.shipDamage).toBe(6);
  });
});

describe("downed recovery", () => {
  function downedState(): CampaignState {
    const s = pcState(3);
    s.characters[0].hp = 0;
    s.characters[0].injuries = [{ name: "Downed", effect: "bleeding out" }];
    s.characters[0].stims = 1;
    return s;
  }

  it("a heal that brings HP above 0 clears Downed (back on your feet)", () => {
    const rt = new TurnRuntime(downedState(), maxRng);
    rt.useItem("stim");
    expect(rt.state.characters[0].hp).toBeGreaterThan(0);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(false);
  });

  it("scene end stabilises a downed survivor to at least 1 HP and clears Downed", () => {
    const rt = new TurnRuntime(downedState(), maxRng);
    rt.execute("end_scene", {});
    expect(rt.state.characters[0].hp).toBe(1);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(false);
  });
});
