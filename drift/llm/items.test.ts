import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { CombatState, CombatEnemy } from "@/shared/combat";
import { TurnRuntime } from "./engineBridge";
import { toolBonus } from "./runtimeCombat";
import { usableConsumables, itemCount } from "@/shared/items";
import type { RNG } from "@/engine";

const maxRng: RNG = { int: (_min, max) => max };
const minRng: RNG = { int: (min) => min };

/** A PC with a gear stack of items + a legacy stims counter, optionally a ship. */
function withInventory(
  gear: { name: string; itemId?: string; qty?: number; damage?: string }[] = [],
  stims = 0,
  hp = 6,
  withShip = false,
): CampaignState {
  return {
    campaign: { id: "c", currentLocationId: "l", tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp, maxHp: 20, ac: 12, stims, fragile: false, credits: 100,
        attributes: { might: 0, reflex: 2, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [{ name: "smallArms", level: 2, ticks: 0 }, { name: "gunnery", level: 2, ticks: 0 }],
        actionModifiers: {}, gear, injuries: [],
      },
    ],
    ship: withShip
      ? {
          id: "ship-1", campaignId: "c", name: "The Wren", shipClass: "scout",
          hp: 10, maxHp: 18, ac: 12, evasiveAcBonus: 2, damageReduction: 0,
          weapons: [{ name: "Rack", type: "missile", damage: "3d6", count: 1, ammo: 1 }],
          hasShield: true, shieldReady: false, hasPointDefense: false, burstDriveReady: false,
          dcModifier: 0, buyoutRemaining: 0, notes: "",
        }
      : undefined,
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const personalCombat = (enemies: CombatEnemy[]): CombatState => ({
  active: true, round: 1, scale: "personal", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0,
});
const shipCombat = (enemies: CombatEnemy[]): CombatState => ({
  active: true, round: 1, scale: "ship", enemies, playerCoverAc: 0, playerAimBonus: 0, fleeAttempts: 0,
});

const enemy = (over: Partial<CombatEnemy> = {}): CombatEnemy => ({
  id: "e-1", name: "Mook", tier: "T1", hp: 8, maxHp: 8, ac: 5, atk: 0, damage: "1d4",
  shieldReady: false, multiAttack: false, ...over,
});

describe("inventory selectors", () => {
  it("counts gear stacks and the legacy stims counter together", () => {
    const s = withInventory([{ name: "Medkit", itemId: "medkit", qty: 2 }], 3);
    const pc = s.characters[0];
    expect(itemCount(pc, "medkit")).toBe(2);
    expect(itemCount(pc, "stim")).toBe(3); // from the legacy field
  });

  it("usableConsumables filters by scale and combat-usability", () => {
    const s = withInventory(
      [{ name: "Frag grenade", itemId: "frag", qty: 1 }, { name: "Shield cell", itemId: "shieldCell", qty: 1 }, { name: "Hull patch kit", itemId: "hullPatch", qty: 1 }],
      1,
    );
    const pc = s.characters[0];
    const personal = usableConsumables(pc, "personal").map((u) => u.itemId).sort();
    expect(personal).toEqual(["frag", "stim"]); // grenade + legacy stim; medkit absent
    const ship = usableConsumables(pc, "ship").map((u) => u.itemId);
    expect(ship).toEqual(["shieldCell"]); // hullPatch is not combat-usable
  });
});

describe("combat item actions", () => {
  it("a stim (legacy field) heals in combat and decrements", () => {
    const rt = new TurnRuntime(withInventory([], 1, 6), maxRng);
    const r = rt.resolveCombatRound(personalCombat([enemy()]), { type: "stim" });
    expect(rt.state.characters[0].hp).toBeGreaterThan(6);
    expect(rt.state.characters[0].stims).toBe(0);
    expect(r.outcome).toBe("continue");
  });

  it("a frag grenade damages every enemy; clearing the field is victory", () => {
    const rt = new TurnRuntime(withInventory([{ name: "Frag grenade", itemId: "frag", qty: 1 }], 0, 20), maxRng);
    const r = rt.resolveCombatRound(personalCombat([enemy({ id: "a", hp: 6 }), enemy({ id: "b", hp: 6 })]), {
      type: "item", itemId: "frag",
    });
    expect(r.outcome).toBe("victory"); // 2d6 max = 12 ≥ 6 each
    expect(itemCount(rt.state.characters[0], "frag")).toBe(0);
  });

  it("a smoke charge is an auto-escape", () => {
    const rt = new TurnRuntime(withInventory([{ name: "Smoke charge", itemId: "smoke", qty: 1 }], 0, 6), maxRng);
    const r = rt.resolveCombatRound(personalCombat([enemy({ hp: 40, atk: 20 })]), { type: "item", itemId: "smoke" });
    expect(r.outcome).toBe("escaped");
    expect(itemCount(rt.state.characters[0], "smoke")).toBe(0);
  });

  it("a shield cell restores ship shields mid-fight", () => {
    // minRng → the enemy's return volley misses, so the restored shield persists.
    const rt = new TurnRuntime(withInventory([{ name: "Shield cell", itemId: "shieldCell", qty: 1 }], 0, 6, true), minRng);
    expect(rt.state.ship!.shieldReady).toBe(false);
    const r = rt.resolveCombatRound(shipCombat([enemy({ tier: "T2", hp: 30, ac: 20, atk: 0 })]), { type: "item", itemId: "shieldCell" });
    expect(r.lines.some((l) => l.includes("shields back online"))).toBe(true);
    expect(rt.state.ship!.shieldReady).toBe(true);
    expect(itemCount(rt.state.characters[0], "shieldCell")).toBe(0);
  });
});

describe("out-of-combat useItem", () => {
  it("a medkit heals and clears Downed", () => {
    const s = withInventory([{ name: "Medkit", itemId: "medkit", qty: 1 }], 0, 0);
    s.characters[0].injuries = [{ name: "Downed", effect: "bleeding out" }] as CampaignState["characters"][number]["injuries"];
    const rt = new TurnRuntime(s, maxRng);
    const res = rt.useItem("medkit") as { line?: string };
    expect(res.line).toContain("Medkit");
    expect(rt.state.characters[0].hp).toBeGreaterThan(0);
    expect(rt.state.characters[0].injuries.some((i) => i.name === "Downed")).toBe(false);
    expect(itemCount(rt.state.characters[0], "medkit")).toBe(0);
  });

  it("a hull patch repairs the ship; a missile reload adds ammo", () => {
    const rt = new TurnRuntime(
      withInventory([{ name: "Hull patch kit", itemId: "hullPatch", qty: 1 }, { name: "Missile reload", itemId: "missileReload", qty: 1 }], 0, 6, true),
      maxRng,
    );
    rt.useItem("hullPatch");
    expect(rt.state.ship!.hp).toBeGreaterThan(10);
    rt.useItem("missileReload");
    expect(rt.state.ship!.weapons.find((w) => w.type === "missile")!.ammo).toBe(3); // 1 + 2
  });

  it("refuses to use an item the character does not hold", () => {
    const rt = new TurnRuntime(withInventory([], 0, 6), maxRng);
    const res = rt.useItem("medkit") as { error?: string };
    expect(res.error).toBeTruthy();
  });

  it("heals AND consumes an UNMAPPED legacy medkit (name-only gear) — the bug", () => {
    // A warm/legacy session: "Medkit" carried with NO itemId. Before the fix this
    // healed (narrated) but the possession check saw 0, so nothing was spent — or
    // the reverse. Now count/use/consume all resolve by name.
    const rt = new TurnRuntime(withInventory([{ name: "Medkit" }], 0, 5), maxRng);
    const res = rt.useItem("medkit") as { line?: string; error?: string };
    expect(res.error).toBeUndefined();
    expect(res.line).toContain("Medkit");
    expect(rt.state.characters[0].hp).toBeGreaterThan(5); // actually healed
    expect(itemCount(rt.state.characters[0], "medkit")).toBe(0); // actually spent
  });
});

describe("functional tools (ITEMS.md slice 4)", () => {
  it("a held tool grants its skill bonus; nothing for the wrong skill or no tool", () => {
    const scannerPc = withInventory([{ name: "Scanner", itemId: "scanner" }]).characters[0];
    expect(toolBonus(scannerPc, "perception")).toBe(2);
    expect(toolBonus(scannerPc, "streetwise")).toBe(1);
    expect(toolBonus(scannerPc, "athletics")).toBe(0);
    const pickPc = withInventory([{ name: "Lockpick set", itemId: "lockpicks" }]).characters[0];
    expect(toolBonus(pickPc, "mechanics")).toBe(2);
    expect(toolBonus(pickPc, "electronics")).toBe(2);
    const grapPc = withInventory([{ name: "Grapnel line", itemId: "grapnel" }]).characters[0];
    expect(toolBonus(grapPc, "athletics")).toBe(2);
    expect(toolBonus(withInventory([]).characters[0], "perception")).toBe(0);
  });

  it("the tool bonus lands in the roll breakdown (auditable)", () => {
    const rt = new TurnRuntime(withInventory([{ name: "Scanner", itemId: "scanner" }]), maxRng);
    const res = rt.execute("roll_check", { characterId: "pc-1", skill: "perception", dc: 10, stakes: false }) as { breakdown?: string };
    expect(res.breakdown).toMatch(/situational \+2/);
  });
});
