import { describe, it, expect } from "vitest";
import type { CampaignState } from "./schemas";
import type { EngineEvent } from "@/engine/events";
import { seededRng, scriptedRng } from "@/engine/rng";
import {
  generateJob,
  generatePersonalJob,
  refreshBoard,
  acceptJob,
  abandonJob,
  inferJobAccept,
  advanceJobs,
  turnSignals,
  rollJobCredits,
  canOffer,
  grantJobCargo,
  consumeJobCargo,
  materializeJobCast,
  castHomeLocation,
  type Job,
  type Objective,
} from "./quests";
import { slotsUsed } from "./items";
import { resolveJobsTurn } from "./jobsRuntime";

function state(over: { bias?: string; directive?: string; currentLocationId?: string; credits?: number } = {}): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: over.currentLocationId ?? "loc-a", tendaysElapsed: 0, directive: over.directive },
    universe: { id: "u", name: "U" },
    characters: [
      {
        id: "pc-1", kind: "pc", name: "Vess", hp: 18, maxHp: 18, ac: 12, stims: 0, fragile: false,
        credits: over.credits ?? 50,
        attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 },
        skills: [], actionModifiers: {}, gear: [], injuries: [],
        ...(over.bias ? { bias: over.bias } : {}),
      },
    ],
    factions: [
      { id: "f-crown", universeId: "u", name: "The Crown" },
      { id: "f-wreck", universeId: "u", name: "Wreckers" },
    ],
    factionRep: [],
    locations: [
      { id: "loc-a", universeId: "u", name: "Home Berth", tags: [] },
      { id: "loc-b", universeId: "u", name: "Rook Station", tags: [] },
      { id: "loc-c", universeId: "u", name: "The Shear", tags: [] },
    ],
    npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

const roll = (skill: string, outcome: string): EngineEvent => ({ type: "roll", breakdown: "x", skill, total: 10, outcome, tickEligible: false });
const active = (j: Job): Job => ({ ...j, status: "active" });

describe("generateJob", () => {
  it("builds a valid job with objectives away from the player's current location", () => {
    const j = generateJob(state(), seededRng(1), 0);
    expect(j).not.toBeNull();
    expect(j!.objectives.length).toBeGreaterThan(0);
    // any travel/deliver objective points somewhere the player ISN'T standing.
    for (const o of j!.objectives) if (o.locationId) expect(o.locationId).not.toBe("loc-a");
  });

  it("clamps the reward tier down to the player's net-worth ceiling (a rookie can't draw a big score)", () => {
    // Broke rookie → payoutCeiling T1; even a T2-band archetype must clamp to ≤ T1.
    for (let seed = 0; seed < 40; seed++) {
      const j = generateJob(state({ credits: 20 }), seededRng(seed), 0);
      expect(["T0", "T1"]).toContain(j!.tier);
    }
  });

  it("weights the board toward the player's playstyle bias", () => {
    // A combat-leaning player should draw bounty/protection far more than a random baseline.
    let combatLean = 0;
    for (let seed = 0; seed < 60; seed++) {
      const j = generateJob(state({ bias: "combat", credits: 400 }), seededRng(seed), 0);
      if (j && ["bounty", "protection"].includes(j.archetype)) combatLean++;
    }
    expect(combatLean).toBeGreaterThan(20); // strongly favored (baseline ~2/8 of 60 ≈ 15)
  });
});

describe("job coherence (giver/adversary alignment)", () => {
  // A state with all three faction characters present, using the CANON ids the
  // alignment map keys on. (The live incoherence: Hollow Crown offering a job
  // smuggling past its own watch, paying Crown rep.)
  function alignedState(over: { pcFactionId?: string } = {}): CampaignState {
    const s = state({ credits: 400 }) as unknown as { factions: unknown; characters: Record<string, unknown>[] };
    s.factions = [
      { id: "f-crown", universeId: "u", name: "Hollow Crown" },
      { id: "f-sable", universeId: "u", name: "Sable Chain" },
      { id: "f-free", universeId: "u", name: "Freeport Combine" },
    ];
    if (over.pcFactionId) s.characters[0].parentFactionId = over.pcFactionId;
    return s as unknown as CampaignState;
  }

  it("canOffer: officials never post underworld work, syndicates never run sanctioned desks, neutral goes both ways", () => {
    expect(canOffer("underworld", "official")).toBe(false);
    expect(canOffer("official", "underworld")).toBe(false);
    expect(canOffer("underworld", "underworld")).toBe(true);
    expect(canOffer("official", "official")).toBe(true);
    expect(canOffer("neutral", "official")).toBe(true);
    expect(canOffer("neutral", "underworld")).toBe(true);
    expect(canOffer("underworld", "neutral")).toBe(true);
    expect(canOffer("official", "neutral")).toBe(true);
  });

  it("an underworld job's GIVER is never an official faction, and the {faction} run AGAINST is never the giver", () => {
    for (let seed = 0; seed < 120; seed++) {
      const j = generateJob(alignedState(), seededRng(seed), 0);
      if (!j || !["smuggling", "heist"].includes(j.archetype)) continue;
      // Giver: Hollow Crown (official) can never post smuggling/heist work.
      expect(j.factionId).not.toBe("f-crown");
      expect(j.reward.repFactionId).not.toBe("f-crown");
      // Adversary: the watch/lockup being hit never belongs to the giver itself.
      const giverName = j.factionId === "f-sable" ? "Sable Chain" : "Freeport Combine";
      for (const o of j.objectives) expect(o.summary).not.toContain(giverName);
    }
  });

  it("a faction-aligned PC draws their own faction's postings and their faction's KIND of work more often", () => {
    let crownGiver = 0, official = 0, underworld = 0, total = 0;
    for (let seed = 0; seed < 120; seed++) {
      const j = generateJob(alignedState({ pcFactionId: "f-crown" }), seededRng(seed), 0);
      if (!j) continue;
      total++;
      if (j.factionId === "f-crown") crownGiver++;
      if (j.archetype === "bounty") official++;
      if (["smuggling", "heist"].includes(j.archetype)) underworld++;
    }
    // Giver bias: own faction weighted 4:1 among eligible givers.
    expect(crownGiver).toBeGreaterThan(total / 3);
    // Alignment lean: sanctioned work (+2) outdraws the underworld pool (2 archetypes, no lean).
    expect(official).toBeGreaterThan(underworld);
  });
});

describe("cargo as inventory (QUESTS 1b — one crate, one fate)", () => {
  const courier = (): Job => ({
    id: "j-cargo", title: "Courier run", blurb: "", giver: "board", playstyle: "commerce",
    archetype: "courier", tier: "T1", cargo: "a sealed medcrate",
    objectives: [{ id: "o1", kind: "deliver", summary: "Haul it to Rook", done: false, locationId: "loc-b" }],
    cast: [], reward: { tier: "T1" }, status: "active", createdTenday: 0,
  });

  it("generateJob stamps `cargo` on delivery archetypes", () => {
    for (let seed = 0; seed < 60; seed++) {
      const j = generateJob(state({ credits: 400 }), seededRng(seed), 0);
      if (!j) continue;
      const hasDeliver = j.objectives.some((o) => o.kind === "deliver");
      if (hasDeliver) expect(j.cargo).toBeTruthy();
      else expect(j.cargo).toBeUndefined();
    }
  });

  it("grant puts a jobId-tagged, SLOT-FREE item in hand (idempotent); consume takes it back", () => {
    const s0 = state();
    const before = slotsUsed(s0.characters[0]);
    let s = grantJobCargo(s0, courier());
    s = grantJobCargo(s, courier()); // re-grant must not duplicate
    const pc = s.characters[0];
    const carried = pc.gear.filter((g) => g.jobId === "j-cargo");
    expect(carried).toHaveLength(1);
    expect(carried[0].name).toBe("Sealed medcrate");
    expect(slotsUsed(pc)).toBe(before); // hauled, not packed
    const { state: s2, removedName } = consumeJobCargo(s, "j-cargo");
    expect(removedName).toBe("Sealed medcrate");
    expect(s2.characters[0].gear.some((g) => g.jobId === "j-cargo")).toBe(false);
  });

  it("the ENGINE hands the cargo over when delivery completes (resolveJobsTurn)", () => {
    // Player carries the crate, arrives at the drop — the completion that pays the
    // reward also removes the freight and says so (📦 line).
    let s = grantJobCargo(state({ currentLocationId: "loc-b" }), courier());
    const res = resolveJobsTurn({
      state: s, jobs: [courier()], events: [], combatResolvedAlive: false, rng: seededRng(1),
    });
    expect(res.jobs.find((j) => j.id === "j-cargo")!.status).toBe("complete");
    expect(res.state.characters[0].gear.some((g) => g.jobId === "j-cargo")).toBe(false);
    expect(res.lines.join(" ")).toContain("📦 Cargo handed over: Sealed medcrate");
  });
});

describe("inferJobAccept — the typed-accept backstop", () => {
  const offer = (id: string, title: string, archetype = "courier"): Job => ({
    id, title, blurb: "", giver: "board", playstyle: "commerce", archetype, tier: "T1",
    objectives: [{ id: "o1", kind: "deliver", summary: "x", done: false }],
    cast: [], reward: { tier: "T1" }, status: "offered", createdTenday: 0,
  });

  it("resolves an unmistakable typed take to the one matching offer", () => {
    const jobs = [offer("j1", "Courier run"), offer("j2", "Smuggling job", "smuggling")];
    expect(inferJobAccept("I'll take the courier run.", jobs)).toBe("j1");
    expect(inferJobAccept("Fine — I accept the smuggling work.", jobs)).toBe("j2");
  });

  it("stays quiet without an accept verb, on ambiguity, and on active jobs", () => {
    const jobs = [offer("j1", "Courier run"), offer("j2", "Smuggling job", "smuggling")];
    // Curiosity isn't consent.
    expect(inferJobAccept("Tell me more about the courier run.", jobs)).toBeUndefined();
    // Accept verb but nothing identifying a specific job.
    expect(inferJobAccept("I'll take the shot.", jobs)).toBeUndefined();
    // Two offers matching the same token → too ambiguous to act.
    const twins = [offer("j1", "Courier run"), offer("j2", "Courier run")];
    expect(inferJobAccept("I'll take the courier job.", twins)).toBeUndefined();
    // Already-active jobs never re-accept.
    expect(inferJobAccept("I'll take the courier run.", [{ ...offer("j1", "Courier run"), status: "active" }])).toBeUndefined();
  });
});

describe("board lifecycle", () => {
  it("refreshBoard tops offered jobs up to the count and drops expired offers", () => {
    let jobs: Job[] = [];
    jobs = refreshBoard(state(), jobs, seededRng(2), 0, 4);
    expect(jobs.filter((j) => j.status === "offered")).toHaveLength(4);
    // Advance time past expiry → the stale offers are dropped and replaced.
    const later = refreshBoard(state(), jobs, seededRng(3), 5, 4);
    expect(later.filter((j) => j.status === "offered")).toHaveLength(4);
    expect(later.some((j) => jobs.find((o) => o.id === j.id && o.expiresTenday! < 5))).toBe(false);
  });

  it("accept moves offered → active; abandon moves active → failed", () => {
    const jobs = refreshBoard(state(), [], seededRng(4), 0, 2);
    const id = jobs[0].id;
    const a = acceptJob(jobs, id);
    expect(a.find((j) => j.id === id)!.status).toBe("active");
    const b = abandonJob(a, id);
    expect(b.find((j) => j.id === id)!.status).toBe("failed");
  });

  it("stamps every offer with the current station and offers VARIETY (distinct archetypes)", () => {
    const jobs = refreshBoard(state({ currentLocationId: "loc-a", bias: "combat" }), [], seededRng(7), 0, 4);
    const offered = jobs.filter((j) => j.status === "offered");
    expect(offered).toHaveLength(4);
    expect(offered.every((j) => j.postedLocationId === "loc-a")).toBe(true);
    // Despite a strong combat lean, the board isn't four-of-a-kind.
    expect(new Set(offered.map((j) => j.archetype)).size).toBe(offered.length);
  });

  it("the board is LOCAL — moving station drops the old postings and regenerates", () => {
    const atA = refreshBoard(state({ currentLocationId: "loc-a" }), [], seededRng(8), 0, 4);
    expect(atA.filter((j) => j.status === "offered")).toHaveLength(4);
    // Accept one, then travel to loc-b: the accepted job follows, the rest of loc-a's
    // board is gone, and a fresh loc-b board fills in.
    const accepted = acceptJob(atA, atA.find((j) => j.status === "offered")!.id);
    const atB = refreshBoard(state({ currentLocationId: "loc-b" }), accepted, seededRng(9), 0, 4);
    const offeredB = atB.filter((j) => j.status === "offered");
    expect(offeredB).toHaveLength(4);
    expect(offeredB.every((j) => j.postedLocationId === "loc-b")).toBe(true);
    expect(atB.some((j) => j.status === "active" && j.postedLocationId === "loc-a")).toBe(true); // accepted one carried over
    expect(atB.some((j) => j.status === "offered" && j.postedLocationId === "loc-a")).toBe(false); // old offers dropped
  });
});

describe("advanceJobs — engine-owned completion detection", () => {
  const travelJob: Job = {
    id: "j1", title: "Courier run", blurb: "", giver: "board", playstyle: "commerce", archetype: "courier", tier: "T1",
    objectives: [{ id: "o1", kind: "deliver", summary: "Haul it to Rook", done: false, locationId: "loc-b" }],
    cast: [], reward: { tier: "T1" }, status: "active", createdTenday: 0,
  };
  const bountyJob: Job = {
    id: "j2", title: "Bounty", blurb: "", giver: "board", playstyle: "combat", archetype: "bounty", tier: "T2",
    objectives: [
      { id: "o1", kind: "travel", summary: "Track them to the Shear", done: false, locationId: "loc-c" },
      { id: "o2", kind: "eliminate", summary: "Take them down", done: false, enemyTier: "T2" },
    ],
    cast: [], reward: { tier: "T2", repFactionId: "f-crown", repDelta: 1 }, status: "active", createdTenday: 0,
  };

  it("completes a travel objective on arrival and pays out a single-step job", () => {
    const s = turnSignals("loc-b", [], false);
    const r = advanceJobs([travelJob], s);
    expect(r.jobs[0].status).toBe("complete");
    expect(r.completed).toHaveLength(1);
    expect(r.lines.join(" ")).toMatch(/Job complete/);
  });

  it("does NOT advance when the signal doesn't match the current step", () => {
    const r = advanceJobs([travelJob], turnSignals("loc-a", [roll("negotiation", "success")], false));
    expect(r.jobs[0].objectives[0].done).toBe(false);
    expect(r.completed).toHaveLength(0);
  });

  it("advances multi-step jobs ONE step at a time (travel, then the kill)", () => {
    const afterTravel = advanceJobs([bountyJob], turnSignals("loc-c", [], false));
    expect(afterTravel.jobs[0].objectives[0].done).toBe(true);
    expect(afterTravel.jobs[0].objectives[1].done).toBe(false);
    expect(afterTravel.jobs[0].status).toBe("active");
    const afterKill = advanceJobs(afterTravel.jobs, turnSignals("loc-c", [], true));
    expect(afterKill.jobs[0].status).toBe("complete");
  });

  it("completes a roll-gated objective on a matching skill success only", () => {
    const heist: Job = active({
      id: "j3", title: "Heist", blurb: "", giver: "board", playstyle: "intrigue", archetype: "heist", tier: "T1",
      objectives: [{ id: "o1", kind: "sabotage", summary: "Crack the vault", done: false, requiredSkills: ["electronics", "mechanics"] }],
      cast: [], reward: { tier: "T1" }, status: "offered", createdTenday: 0,
    });
    expect(advanceJobs([heist], turnSignals(undefined, [roll("perception", "success")], false)).completed).toHaveLength(0);
    expect(advanceJobs([heist], turnSignals(undefined, [roll("electronics", "success")], false)).completed).toHaveLength(1);
    expect(advanceJobs([heist], turnSignals(undefined, [roll("electronics", "failure")], false)).completed).toHaveLength(0);
  });

  it("leaves offered/inactive jobs untouched", () => {
    const offered: Job = { ...travelJob, status: "offered" };
    const r = advanceJobs([offered], turnSignals("loc-b", [], false));
    expect(r.jobs[0].status).toBe("offered");
  });
});

describe("generatePersonalJob", () => {
  it("builds an ACTIVE, NPC-given score wrapped around their want (never on the public board)", () => {
    const npc = { id: "npc-gen-kessa", name: "Kessa", factionId: "f-crown", backstory: "wants a ship of her own." };
    const j = generatePersonalJob(npc, state({ credits: 400 }), seededRng(3), 0)!;
    expect(j.giver).toBe("npc-gen-kessa"); // sourced from the NPC, not "board"
    expect(j.status).toBe("active"); // enters active — skips the offered board
    expect(j.expiresTenday).toBeUndefined(); // a personal favor doesn't lapse
    expect(j.blurb).toContain("ship of her own"); // the want rides as the fiction hook
    expect(j.reward.repFactionId).toBe("f-crown"); // pays standing with their faction
    expect(j.objectives.length).toBeGreaterThan(0);
  });
});

describe("rollJobCredits", () => {
  it("rolls inside the tier's payout band", () => {
    const lo = rollJobCredits("T1", scriptedRng([9999]) /* clamps to band hi */);
    expect(lo).toBeGreaterThan(0);
    const c = rollJobCredits("T2", seededRng(7));
    expect(c).toBeGreaterThanOrEqual(350);
    expect(c).toBeLessThanOrEqual(600);
  });
});

describe("quest CAST MANIFESTS (HANDOFF_NPC_CANON Task D — no more 4-5 randos per job)", () => {
  // Mirrors the CastSlot roles baked into each ARCHETYPE (quests.ts) — the whole
  // point under test is that this is FIXED, not something the model influences.
  const CAST_ROLES: Record<string, string[]> = {
    courier: ["giver"],
    smuggling: ["giver", "contact"],
    bounty: ["giver", "target"],
    protection: ["giver", "ward"],
    heist: ["giver", "contact"],
    recon: ["giver"],
    broker: ["giver", "target"],
    salvage: ["giver"],
  };

  it("every archetype generates EXACTLY its spec'd cast — same roles, every time", () => {
    let sampled = 0;
    for (let seed = 0; seed < 120; seed++) {
      const j = generateJob(state({ credits: 400 }), seededRng(seed), 0);
      if (!j) continue;
      sampled++;
      expect(j.cast.map((m) => m.role)).toEqual(CAST_ROLES[j.archetype]);
    }
    expect(sampled).toBeGreaterThan(20); // the assertion above actually ran
  });

  it("cast ids follow npc-job-<jobId>-<role>; names never collide with existing cast or the party", () => {
    const s = {
      ...state({ credits: 400 }),
      npcs: [{ id: "npc-x", universeId: "u", name: "Silas Karo", oneBreath: "x" }],
    } as unknown as CampaignState;
    for (let seed = 0; seed < 60; seed++) {
      const j = generateJob(s, seededRng(seed), 0);
      if (!j) continue;
      for (const m of j.cast) {
        expect(m.npcId).toBe(`npc-job-${j.id}-${m.role}`);
        expect(m.name.toLowerCase()).not.toBe("silas karo"); // pre-existing cast
        expect(m.name.toLowerCase()).not.toBe("vess"); // the PC
      }
    }
  });

  it("is deterministic — the same seed yields the same cast names/roles", () => {
    // npcId carries a monotonic idSeq (like enemy ids, engine.md-documented) for
    // cross-job uniqueness within a session — it's expected to differ run to run;
    // the seed-DERIVED parts (who, what they're called, what they do) must not.
    const strip = (cast: Job["cast"]) => cast.map(({ role, name, roleLabel }) => ({ role, name, roleLabel }));
    const j1 = generateJob(state({ credits: 400 }), seededRng(11), 0)!;
    const j2 = generateJob(state({ credits: 400 }), seededRng(11), 0)!;
    expect(strip(j1.cast)).toEqual(strip(j2.cast));
  });

  it("{target} in objective summaries equals the cast target/ward's NAME, not flavor text", () => {
    let sampled = 0;
    for (let seed = 0; seed < 300; seed++) {
      const j = generateJob(state({ credits: 400 }), seededRng(seed), 0);
      if (!j || !["bounty", "broker", "protection"].includes(j.archetype)) continue;
      const person = j.cast.find((m) => m.role === "target" || m.role === "ward")!;
      expect(person).toBeTruthy();
      expect(j.objectives.some((o) => o.summary.includes(person.name))).toBe(true);
      sampled++;
    }
    expect(sampled).toBeGreaterThan(10);
  });

  it("materializeJobCast creates real NPC records, home-located per role", () => {
    const s = state({ currentLocationId: "loc-a", credits: 400 });
    const j = generateJob(s, seededRng(5), 0)!;
    const after = materializeJobCast(s, j);
    expect(after.npcs).toHaveLength(j.cast.length);
    for (const m of j.cast) {
      const npc = after.npcs.find((n) => n.id === m.npcId)!;
      expect(npc.name).toBe(m.name);
      expect(npc.role).toBe(m.roleLabel);
      expect(npc.locationId).toBe(castHomeLocation(j, m.role));
      expect(npc.originCampaignId).toBe(s.campaign.id);
      expect(npc.quirk).toBeTruthy(); // full flavor, not a bare stub
    }
  });

  it("materializeJobCast is IDEMPOTENT — accepting/re-processing the same job never duplicates", () => {
    const s = state({ credits: 400 });
    const j = generateJob(s, seededRng(6), 0)!;
    const once = materializeJobCast(s, j);
    const twice = materializeJobCast(once, j);
    expect(twice.npcs.length).toBe(once.npcs.length);
  });

  it("no-ops on a cast-less job (defensive — every current archetype has ≥1 member)", () => {
    const s = state();
    const j: Job = {
      id: "j-x", title: "x", blurb: "", giver: "board", playstyle: "commerce", archetype: "courier", tier: "T1",
      objectives: [], cast: [], reward: { tier: "T1" }, status: "active", createdTenday: 0,
    };
    expect(materializeJobCast(s, j)).toBe(s);
  });

  it("the GIVER inherits the job's faction; other cast roles start unaligned", () => {
    const s = state({ credits: 400 });
    let j: Job | null = null;
    for (let seed = 0; seed < 50 && !j?.factionId; seed++) j = generateJob(s, seededRng(seed), 0);
    expect(j!.factionId).toBeTruthy();
    const after = materializeJobCast(s, j!);
    const giver = j!.cast.find((m) => m.role === "giver")!;
    expect(after.npcs.find((n) => n.id === giver.npcId)?.factionId).toBe(j!.factionId);
    for (const m of j!.cast.filter((c) => c.role !== "giver")) {
      expect(after.npcs.find((n) => n.id === m.npcId)?.factionId).toBeUndefined();
    }
  });

  it("generatePersonalJob replaces the generated giver with the REAL npc — no phantom duplicate", () => {
    const npc = { id: "npc-gen-kessa", name: "Kessa", factionId: "f-crown", backstory: "wants a ship of her own.", role: "fixer" };
    const j = generatePersonalJob(npc, state({ credits: 400 }), seededRng(3), 0)!;
    const giver = j.cast.find((m) => m.role === "giver")!;
    expect(giver.npcId).toBe("npc-gen-kessa");
    expect(giver.name).toBe("Kessa");
    expect(giver.roleLabel).toBe("fixer");
    // materializing is then a no-op for the giver — they already exist.
    const withGiver = { ...state({ credits: 400 }), npcs: [{ id: "npc-gen-kessa", universeId: "u", name: "Kessa", oneBreath: "x" }] } as unknown as CampaignState;
    const after = materializeJobCast(withGiver, j);
    expect(after.npcs.filter((n) => n.id === "npc-gen-kessa")).toHaveLength(1);
  });
});

describe("cast manifests — review-pass hardening (legacy jobs, dupes, PC names)", () => {
  it("LEGACY jobs (no cast field — raw-jsonb load) never throw: materialize no-ops", () => {
    // Pre-manifest jobs persist WITHOUT `cast`; loads are unparsed jsonb, so the
    // Zod default never runs. At review time 100% of live campaigns carried these.
    const legacy = {
      id: "j-old", title: "Courier run", blurb: "", giver: "board", playstyle: "commerce",
      archetype: "courier", tier: "T1",
      objectives: [{ id: "o1", kind: "deliver", summary: "x", done: false }],
      reward: { tier: "T1" }, status: "active", createdTenday: 0,
    } as unknown as Job; // deliberately NO cast
    const s = state();
    expect(materializeJobCast(s, legacy)).toBe(s); // no throw, no-op
  });

  it("ADOPT-BY-NAME: a giver already registered by the dialogue backstop is never duplicated", () => {
    // The live path: the pitch names the giver, she SPEAKS, extractDialogueNpcs
    // registers her as npc-gen- BEFORE the player accepts. Accepting must adopt
    // that record, not append a second same-named person (the Ren-class bug).
    const s = state({ credits: 400 });
    const j = generateJob(s, seededRng(5), 0)!;
    const giver = j.cast.find((m) => m.role === "giver")!;
    const preRegistered = {
      ...s,
      npcs: [{ id: "npc-gen-pitch-1", universeId: "u", name: giver.name, oneBreath: "Spoke with the player." }],
    } as unknown as CampaignState;
    const after = materializeJobCast(preRegistered, j);
    const sameName = after.npcs.filter((n) => n.name.toLowerCase() === giver.name.toLowerCase());
    expect(sameName).toHaveLength(1); // adopted, not duplicated
    expect(sameName[0].id).toBe("npc-gen-pitch-1"); // the record the story has been using
  });

  it("cast first names NEVER collide with the player's characters or crew", () => {
    // The name pools are the same ones players draw from — a cast "Wren Karo"
    // beside a PC "Wren Sung" is the original "another NPC called Wren" class.
    const s = state({ credits: 400 });
    (s.characters as { name: string }[]).push({ name: "Wren Sung" } as never);
    const pcFirsts = new Set(["vess", "wren"]);
    for (let seed = 0; seed < 200; seed++) {
      const j = generateJob(s, seededRng(seed), 0);
      if (!j) continue;
      for (const m of j.cast) {
        expect(pcFirsts.has(m.name.toLowerCase().split(/\s+/)[0])).toBe(false);
      }
    }
  });

  it("one board refresh never casts the same name twice across its offers", () => {
    for (let seed = 0; seed < 20; seed++) {
      const board = refreshBoard(state({ credits: 400 }), [], seededRng(seed), 0, 4);
      const names = board.flatMap((j) => (j.cast ?? []).map((m) => m.name.toLowerCase()));
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
