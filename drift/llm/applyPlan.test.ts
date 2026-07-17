import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import type { TurnPlan } from "@/shared/turnPlan";
import type { CombatState } from "@/shared/combat";
import type { RNG } from "@/engine";
import { TurnRuntime } from "./engineBridge";
import { freshSceneCard } from "@/shared/scene";
import { applyPlan, type ApplyCtx } from "./applyPlan";

/**
 * Seam test for applyPlan (jsonTurn regions I + J). The whole point of the
 * extraction: the plan-application logic is now exercised WITHOUT a model call —
 * hand-built TurnPlans run against fixture state + a seeded RNG, asserting the
 * engine state deltas directly.
 */

const minRng: RNG = { int: (min: number) => min };
const maxRng: RNG = { int: (_min: number, max: number) => max };

/** A low-net-worth rookie (T1 ceiling for both payout and combat) at a dock. */
function state(
  over: {
    credits?: number;
    gear?: { name: string; damage?: string; acBonus?: number; qty?: number; itemId?: string }[];
    threads?: CampaignState["threads"];
    clocks?: CampaignState["clocks"];
    hp?: number;
    maxHp?: number;
  } = {},
): CampaignState {
  return {
    campaign: { id: "camp-a", universeId: "u", currentLocationId: "loc-x", tendaysElapsed: 0 },
    universe: { id: "u", name: "Test" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: over.hp ?? 8, maxHp: over.maxHp ?? 8, ac: 12, stims: 0, fragile: false,
        credits: over.credits ?? 120,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: over.gear ?? [], injuries: [],
      },
    ],
    factions: [], factionRep: [],
    locations: [{ id: "loc-x", universeId: "u", name: "Dock X", tags: [] }],
    npcs: [],
    clocks: over.clocks ?? [],
    threads: over.threads ?? [],
    contracts: [],
  } as unknown as CampaignState;
}

/** Build a TurnPlan with the required-array defaults filled. */
function mkPlan(over: Partial<TurnPlan>): TurnPlan {
  return { narration: "", choices: [], clockAdvances: [], ...over } as TurnPlan;
}

/** Run applyPlan and capture the observable outputs. */
function run(
  s: CampaignState,
  plan: TurnPlan,
  opts: { rng?: RNG; combat?: CombatState | null; lastRoll?: ApplyCtx["lastRoll"]; sceneTurnCount?: number } = {},
) {
  const runtime = new TurnRuntime(s, opts.rng ?? minRng, {
    sceneCard: { ...freshSceneCard(), turnCount: opts.sceneTurnCount ?? 1 },
  });
  const emitted: string[] = [];
  const ctx: ApplyCtx = {
    runtime,
    preState: s,
    pc: runtime.state.characters[0],
    emit: (lines) => emitted.push(...lines),
    toolCalls: [],
    lastRoll: opts.lastRoll ?? null,
    combat: opts.combat ?? null,
    reconcile: [],
  };
  applyPlan(plan, ctx);
  return { runtime, emitted, toolCalls: ctx.toolCalls, combat: ctx.combat, reconcile: ctx.reconcile };
}

const pc = (rt: TurnRuntime) => rt.state.characters[0];

describe("applyPlan — money", () => {
  it("credits a payout and CLAMPS the tier to the rookie ceiling (T3 → T1)", () => {
    const { runtime, emitted } = run(state({ credits: 120 }), mkPlan({ payout: { tier: "T3", reason: "big score" } }));
    expect(pc(runtime).credits).toBe(270); // 120 + T1 min (150)
    expect(emitted.some((l) => /Payment: \+¢150 \(T1\)/.test(l))).toBe(true);
  });

  it("a negotiation success this turn shades a payout to the upper half", () => {
    const { runtime } = run(
      state({ credits: 0 }),
      mkPlan({ payout: { tier: "T1" } }),
      { rng: minRng, lastRoll: { skill: "negotiation", outcome: "success" } },
    );
    expect(pc(runtime).credits).toBe(200); // T1 midpoint with mood high + min-RNG
  });

  it("quotes offers without moving credits", () => {
    const { runtime, emitted } = run(state({ credits: 50 }), mkPlan({ offers: [{ tier: "T1", from: "the buyer" }] }), { rng: maxRng });
    expect(pc(runtime).credits).toBe(50); // an offer is a quote, not income
    expect(emitted.some((l) => /the buyer: ~¢/.test(l))).toBe(true);
  });
});

describe("applyPlan — inventory", () => {
  it("sells carried gear: gone from the pack, credits up", () => {
    const { runtime } = run(state({ credits: 100, gear: [{ name: "Combat rifle", damage: "2d6" }] }), mkPlan({ sell: { name: "Combat rifle" } }));
    expect(pc(runtime).gear.some((g) => g.name === "Combat rifle")).toBe(false);
    expect(pc(runtime).credits).toBeGreaterThan(100);
  });

  it("records a legitimate item gain as real gear", () => {
    const { runtime } = run(state({}), mkPlan({ items: [{ name: "vac-rated facemask", action: "gain", note: "looted" }] }));
    expect(pc(runtime).gear.some((g) => g.name === "vac-rated facemask")).toBe(true);
  });

  it("flags a DENIED heal for re-narration (used an item the player doesn't hold)", () => {
    // The model narrated an NPC patching the player up with a 'medkit' the PC never
    // owned. The engine can't consume it → emits a ⚠ line AND a reconcile note so the
    // prose gets corrected, not just contradicted by a buried system line.
    const { emitted, reconcile } = run(state({ gear: [] }), mkPlan({ useItem: { itemId: "medkit" } }));
    expect(emitted.some((l) => /Can't use item/.test(l))).toBe(true);
    expect(reconcile).toHaveLength(1);
    expect(reconcile[0]).toMatch(/NO healing|UNCHANGED/);
  });

  it("does NOT flag a successful item use", () => {
    const { reconcile } = run(
      state({ gear: [{ name: "Medkit", itemId: "medkit" }], hp: 5, maxHp: 20 }),
      mkPlan({ useItem: { itemId: "medkit" } }),
    );
    expect(reconcile).toHaveLength(0);
  });
});

describe("applyPlan — quests & world", () => {
  it("opens a new thread, dedupes an overlapping one, resolves by id", () => {
    const s = state({
      threads: [{ id: "th-fence", campaignId: "camp-a", title: "Fence the salvage", body: "", status: "active", entityRefs: [] }],
    });
    const { runtime } = run(
      s,
      mkPlan({
        threads: [
          { op: "open", title: "Fence the salvage through Yoren", body: "dup" }, // overlaps → skipped
          { op: "open", title: "Escort the courier", body: "new" }, // added
          { op: "resolve", id: "th-fence" }, // resolved
        ],
      }),
    );
    const titles = runtime.state.threads.map((t) => t.title);
    expect(titles.filter((t) => t.toLowerCase().includes("fence")).length).toBe(1); // no dup
    expect(titles).toContain("Escort the courier");
    expect(runtime.state.threads.find((t) => t.id === "th-fence")?.status).toBe("resolved");
  });

  it("dispatches a clock advance to the engine (applied authoritatively at scene end)", () => {
    const s = state({
      clocks: [{ id: "clk-a", campaignId: "camp-a", name: "Heat", current: 1, max: 6, triggerText: "", milestones: [], status: "active" }],
    });
    const { toolCalls, runtime } = run(s, mkPlan({ clockAdvances: [{ clockId: "clk-a", amount: 2, reason: "spotted" }] }));
    expect(toolCalls).toContain("advance_clock");
    // The engine PREVIEWS the advance now and commits `current` at end_scene, so the
    // event breakdown fired but the clock value stays put until the scene closes.
    expect(runtime.events.some((e) => e.breakdown?.includes("Heat"))).toBe(true);
  });

  it("updates the scene card (situation overwrite, beats append)", () => {
    const { runtime } = run(state({}), mkPlan({ scene: { situation: "Doyle counts the seals", beats: ["promised pay on delivery"] } }));
    expect(runtime.sceneCard.situation).toBe("Doyle counts the seals");
    expect(runtime.sceneCard.beats).toContain("promised pay on delivery");
  });
});

describe("applyPlan — facts ledger (CONTINUITY v2)", () => {
  it("records plan facts onto the runtime's SESSION-OWNED array (mutated in place)", () => {
    const { runtime, toolCalls } = run(
      state({}),
      mkPlan({ facts: [{ text: "Split with Kaela on the crate: 50/50 — agreed", entityRefs: ["npc-kaela"] }] }),
    );
    expect(toolCalls).toContain("record_facts");
    expect(runtime.facts).toHaveLength(1);
    expect(runtime.facts[0].text).toContain("50/50");
  });

  it("a restated fact replaces its older wording — the ledger can't accumulate contradictions", () => {
    const runtime0 = new TurnRuntime(state({}), minRng, {
      facts: [{ text: "Split with Kaela on the crate: 50/50 — agreed", entityRefs: [] }],
    });
    const ctx: ApplyCtx = {
      runtime: runtime0, preState: runtime0.state, pc: runtime0.state.characters[0],
      emit: () => {}, toolCalls: [], lastRoll: null, combat: null, reconcile: [],
    };
    applyPlan(mkPlan({ facts: [{ text: "Split with Kaela on the crate now 60/40 — renegotiated at the dock" }] }), ctx);
    expect(runtime0.facts).toHaveLength(1);
    expect(runtime0.facts[0].text).toContain("60/40");
  });
});

describe("applyPlan — NPC registration gate", () => {
  it("registers a named NPC that appears in the narration; skips one that doesn't", () => {
    const { runtime } = run(
      state({}),
      mkPlan({
        narration: "Quartermaster Doyle waves you over to the manifest desk.",
        npcs: [
          { name: "Quartermaster Doyle", oneBreath: "Gruff supply officer." }, // in prose → registered
          { name: "Phantom Vane", oneBreath: "Not mentioned anywhere." }, // absent → skipped
        ],
      }),
    );
    const names = runtime.state.npcs.map((n) => n.name);
    expect(names).toContain("Quartermaster Doyle");
    expect(names).not.toContain("Phantom Vane");
  });
});

describe("applyPlan — scene close", () => {
  it("fires end_scene on the model's sceneEnd", () => {
    const { runtime } = run(state({}), mkPlan({ sceneEnd: { title: "The deal is struck" } }));
    expect(runtime.sceneEndReport).not.toBeNull();
  });

  it("auto-closes at the scene turn cap even without a sceneEnd", () => {
    const { runtime } = run(state({}), mkPlan({}), { sceneTurnCount: 99 });
    expect(runtime.sceneEndReport).not.toBeNull();
  });
});

describe("applyPlan — combatStart", () => {
  it("spawns a fight and caps the total at 5", () => {
    const { combat } = run(
      state({}),
      mkPlan({ combatStart: { tier: "T1", enemies: [{ tier: "T1", count: 3 }, { tier: "T1", count: 4 }], surprise: "none" } }),
      { rng: maxRng },
    );
    expect(combat?.active).toBe(true);
    expect(combat!.enemies.length).toBe(5); // 3 + trimmed 2
  });

  it("tops the spawn up to the narrated foe count", () => {
    const { combat } = run(
      state({}),
      mkPlan({ narration: "Two thugs rush you from the shadows.", combatStart: { tier: "T1", count: 1, surprise: "none" } }),
      { rng: maxRng },
    );
    expect(combat!.enemies.length).toBe(2);
  });

  it("is SKIPPED when a reroute already started a fight this turn", () => {
    const preset = { active: true, round: 1, scale: "personal", enemies: [{ id: "e0" }] } as unknown as CombatState;
    const { combat, toolCalls } = run(
      state({}),
      mkPlan({ combatStart: { tier: "T1", count: 2, surprise: "none" } }),
      { combat: preset },
    );
    expect(combat).toBe(preset); // untouched
    expect(toolCalls).not.toContain("combat_start");
  });
});

describe("applyPlan — combatStart pins a cast NPC's combat tier (CHECKS.md §2)", () => {
  /** A rookie state (T1 net-worth ceiling) with one named cast NPC. */
  function stateWithNpc(npc: Partial<CampaignState["npcs"][number]> & { name: string }): CampaignState {
    const s = state({});
    return {
      ...s,
      npcs: [{ id: "npc-gen-calvo-1", universeId: "u", oneBreath: "Dock boss.", ...npc } as CampaignState["npcs"][number]],
    };
  }

  it("a stored tier OVERRIDES both the model's pick and the net-worth clamp", () => {
    const { combat } = run(
      stateWithNpc({ name: "Calvo", tier: "T3" }),
      mkPlan({ combatStart: { tier: "T1", enemies: [{ tier: "T1", name: "Calvo", count: 1 }], surprise: "none" } }),
      { rng: minRng },
    );
    // A T1 model pick + T1 ceiling would normally clamp to T1 — canon wins instead.
    expect(combat!.enemies[0].tier).toBe("T3");
  });

  it("an UN-tiered cast NPC gets stamped from the tier that actually spawned (post-clamp)", () => {
    const { runtime } = run(
      stateWithNpc({ name: "Calvo" }), // no tier yet
      mkPlan({ combatStart: { tier: "T3", enemies: [{ tier: "T3", name: "Calvo", count: 1 }], surprise: "none" } }),
      { rng: minRng },
    );
    // Rookie ceiling clamps T3 → T1; the NPC is stamped with what actually spawned.
    const npc = runtime.state.npcs.find((n) => n.name === "Calvo");
    expect(npc?.tier).toBe("T1");
  });

  it("a generic mook name matches nobody — no stamp, no override", () => {
    const { runtime, combat } = run(
      stateWithNpc({ name: "Calvo", tier: "T3" }),
      mkPlan({ combatStart: { tier: "T1", enemies: [{ tier: "T1", name: "Thug", count: 1 }], surprise: "none" } }),
      { rng: minRng },
    );
    expect(combat!.enemies[0].tier).toBe("T1"); // untouched by Calvo's canon
    expect(runtime.state.npcs.find((n) => n.name === "Calvo")?.tier).toBe("T3"); // untouched
  });

  it("SET-ONCE: a later fight with a different model tier still uses the pinned tier", () => {
    const first = run(
      stateWithNpc({ name: "Calvo" }), // un-tiered
      mkPlan({ combatStart: { tier: "T1", enemies: [{ tier: "T1", name: "Calvo", count: 1 }], surprise: "none" } }),
      { rng: minRng },
    );
    expect(first.runtime.state.npcs.find((n) => n.name === "Calvo")?.tier).toBe("T1"); // pinned
    // The fight must be OVER before a second combatStart can fire (guarded by ctx.combat).
    const midState = { ...first.runtime.state } as CampaignState;
    const second = run(
      midState,
      mkPlan({ combatStart: { tier: "T3", enemies: [{ tier: "T3", name: "Calvo", count: 1 }], surprise: "none" } }),
      { rng: minRng },
    );
    expect(second.combat!.enemies[0].tier).toBe("T1"); // pinned tier wins over the new T3 pick
    expect(second.runtime.state.npcs.find((n) => n.name === "Calvo")?.tier).toBe("T1"); // still T1, not overwritten
  });
});
