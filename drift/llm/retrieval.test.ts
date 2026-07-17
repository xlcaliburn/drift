import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { retrieveEntities } from "./promptBuilder";

/** Minimal state carrying only the fields retrieveEntities reads. */
function state(opts: {
  npcs?: unknown[];
  threads?: unknown[];
  factions?: unknown[];
  locations?: unknown[];
  currentLoc?: string;
  pcFaction?: string;
  campaignId?: string;
}): CampaignState {
  return {
    campaign: { id: opts.campaignId ?? "camp-1", currentLocationId: opts.currentLoc ?? "loc-1" },
    characters: [{ kind: "pc", parentFactionId: opts.pcFaction ?? "f-crown" }],
    factions: opts.factions ?? [],
    locations: opts.locations ?? [],
    npcs: opts.npcs ?? [],
    threads: opts.threads ?? [],
  } as unknown as CampaignState;
}

const ilyana = { id: "npc-ilyana", name: "Ilyana Vance", factionId: "f-crown", locationId: "loc-meridian" };
const kesh = { id: "npc-kesh", name: "Kesh", factionId: "f-reclaimers", locationId: "loc-rook" };
const dead = { id: "npc-ghost", name: "Old Ghost", status: "dead", locationId: "loc-meridian" };

const thread = (over: Record<string, unknown>) => ({
  campaignId: "camp-1",
  body: "",
  status: "active",
  entityRefs: [],
  ...over,
});

describe("retrieveEntities — NPCs", () => {
  it("surfaces an NPC named by full name", () => {
    const { npcs } = retrieveEntities(state({ npcs: [ilyana, kesh], currentLoc: "loc-rook" }), "I go find Ilyana Vance");
    expect(npcs.map((n) => n.id)).toContain("npc-ilyana");
  });

  it("matches an NPC by a single name token", () => {
    const { npcs } = retrieveEntities(state({ npcs: [ilyana], currentLoc: "loc-rook" }), "ask Ilyana for work");
    expect(npcs.map((n) => n.id)).toContain("npc-ilyana");
  });

  it("surfaces NPCs physically at the current location even if unnamed", () => {
    const { npcs } = retrieveEntities(state({ npcs: [ilyana, kesh], currentLoc: "loc-meridian" }), "look around the docks");
    expect(npcs.map((n) => n.id)).toContain("npc-ilyana"); // at loc-meridian
    expect(npcs.map((n) => n.id)).not.toContain("npc-kesh"); // at loc-rook, unnamed
  });

  it("prioritizes carried focus ids", () => {
    const { npcs } = retrieveEntities(state({ npcs: [ilyana, kesh], currentLoc: "loc-talos" }), "keep moving", ["npc-kesh"]);
    expect(npcs[0].id).toBe("npc-kesh");
  });

  it("excludes NPCs marked gone/dead even when named", () => {
    const { npcs } = retrieveEntities(state({ npcs: [dead], currentLoc: "loc-meridian" }), "I look for Old Ghost");
    expect(npcs).toHaveLength(0);
  });

  it("does NOT surface the patron by bare co-location (the 'Steward Harrow in the berth' bug)", () => {
    // Patron ids are npc-patron-<campaignId>. Seeded permanently at the home station,
    // it must not leak into every home-station scene as a phantom nearby figure.
    const patron = { id: "npc-patron-camp-1", name: "Steward Harrow", locationId: "loc-meridian" };
    const { npcs } = retrieveEntities(state({ npcs: [patron], currentLoc: "loc-meridian" }), "I look around the berth");
    expect(npcs.map((n) => n.id)).not.toContain("npc-patron-camp-1");
  });

  it("STILL surfaces the patron when named or present", () => {
    const patron = { id: "npc-patron-camp-1", name: "Steward Harrow", locationId: "loc-meridian" };
    const named = retrieveEntities(state({ npcs: [patron], currentLoc: "loc-rook" }), "I go find Steward Harrow");
    expect(named.npcs.map((n) => n.id)).toContain("npc-patron-camp-1"); // named
    const present = retrieveEntities(state({ npcs: [patron], currentLoc: "loc-rook" }), "look", ["npc-patron-camp-1"]);
    expect(present.npcs.map((n) => n.id)).toContain("npc-patron-camp-1"); // focus/present
  });

  it("caps NPCs to a small set", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `npc-${i}`, name: `Body ${i}`, locationId: "loc-meridian" }));
    const { npcs } = retrieveEntities(state({ npcs: many, currentLoc: "loc-meridian" }), "look around");
    expect(npcs.length).toBeLessThanOrEqual(5);
  });
});

describe("retrieveEntities — threads", () => {
  it("pulls a thread whose entityRefs point at a surfaced NPC", () => {
    const t = thread({ id: "th-1", title: "A quiet debt", entityRefs: ["npc-ilyana"] });
    const { threads } = retrieveEntities(state({ npcs: [ilyana], threads: [t], currentLoc: "loc-rook" }), "talk to Ilyana");
    expect(threads.map((x) => x.id)).toContain("th-1");
  });

  it("pulls a thread by title keyword overlap with the action", () => {
    const t = thread({ id: "th-2", title: "Salvage the derelict freighter" });
    const { threads } = retrieveEntities(state({ threads: [t], currentLoc: "loc-rook" }), "I want to salvage the freighter");
    expect(threads.map((x) => x.id)).toContain("th-2");
  });

  it("ignores resolved threads", () => {
    const t = thread({ id: "th-3", title: "Salvage the freighter", status: "resolved" });
    const { threads } = retrieveEntities(state({ threads: [t], currentLoc: "loc-rook" }), "salvage the freighter");
    expect(threads.map((x) => x.id)).not.toContain("th-3");
  });

  it("falls back to active threads when nothing scores", () => {
    const t = thread({ id: "th-a", title: "Zzz" });
    const { threads } = retrieveEntities(state({ threads: [t], currentLoc: "loc-x" }), "hmm");
    expect(threads.map((x) => x.id)).toContain("th-a");
  });
});

describe("retrieveEntities — role-token scoring (CONTINUITY_HARDENING.md Task 4)", () => {
  // Players address people by their HANDLE as often as their name ("ask the
  // harbormaster") — retrieval used to score name/alias tokens only, so a
  // role-only reference dropped the NPC from context entirely.
  const quist = { id: "npc-quist", name: "Harbormaster Quist", role: "harbormaster", locationId: "loc-far" };
  const fixer = { id: "npc-fixer", name: "Doc", role: "fixer", locationId: "loc-far" };

  it("'ask the harbormaster about berths' retrieves the NPC by role alone", () => {
    const { npcs } = retrieveEntities(state({ npcs: [quist], currentLoc: "loc-rook" }), "ask the harbormaster about berths");
    expect(npcs.map((n) => n.id)).toContain("npc-quist");
  });

  it("a role word inside an unrelated sentence still retrieves that NPC ('the fixer's price')", () => {
    const { npcs } = retrieveEntities(state({ npcs: [fixer], currentLoc: "loc-rook" }), "what's the fixer's price for the job?");
    expect(npcs.map((n) => n.id)).toContain("npc-fixer");
  });

  it("patron role words do NOT retrieve the patron (same exclusion as co-location — the phantom-nearby bug)", () => {
    const patron = { id: "npc-patron-camp-1", name: "Steward Harrow", role: "patron", locationId: "loc-far" };
    const { npcs } = retrieveEntities(state({ npcs: [patron], currentLoc: "loc-rook" }), "I look for the patron to ask for help");
    expect(npcs.map((n) => n.id)).not.toContain("npc-patron-camp-1");
  });

  it("an explicit NAME still outranks a role mention when both are present", () => {
    const { npcs } = retrieveEntities(
      state({ npcs: [quist, fixer], currentLoc: "loc-rook" }),
      "I go find Harbormaster Quist to ask about the fixer's reputation",
    );
    expect(npcs[0]?.id).toBe("npc-quist"); // named (60) beats role-only (30)
  });

  it("role tokens under 4 chars don't false-match", () => {
    const shortRole = { id: "npc-short", name: "Nix", role: "fan", locationId: "loc-far" };
    const { npcs } = retrieveEntities(state({ npcs: [shortRole], currentLoc: "loc-rook" }), "I am a fan of the show");
    expect(npcs.map((n) => n.id)).not.toContain("npc-short");
  });

  it("a role hit sets named=true so focus carries into next turn", () => {
    const { namedNpcIds } = retrieveEntities(state({ npcs: [quist], currentLoc: "loc-rook" }), "talk to the harbormaster");
    expect(namedNpcIds).toContain("npc-quist");
  });
});

describe("retrieveEntities — carried focus", () => {
  it("carries forward only entities the player named this turn", () => {
    const r = retrieveEntities(state({ npcs: [ilyana, kesh], currentLoc: "loc-meridian" }), "I ask Ilyana about the run");
    expect(r.namedNpcIds).toContain("npc-ilyana");
    expect(r.namedNpcIds).not.toContain("npc-kesh");
  });

  it("does not carry a location-present but unnamed NPC (no self-reinforcing pin)", () => {
    const r = retrieveEntities(state({ npcs: [ilyana], currentLoc: "loc-meridian" }), "look around");
    expect(r.npcs.map((n) => n.id)).toContain("npc-ilyana"); // still surfaced via location
    expect(r.namedNpcIds).not.toContain("npc-ilyana"); // but focus doesn't renew
  });
});
