import { describe, it, expect } from "vitest";
import type {
  Attributes,
  CampaignState,
  Character,
  WorldEvent,
} from "@/shared/schemas";
import { buildDossier, deriveCapabilityTier } from "@/shared/dossier";

// ── Minimal, self-contained fixtures (no DB, no API key) ─────────────────────

const FLAT_ATTRS: Attributes = {
  might: 0,
  reflex: 0,
  vitality: 0,
  intellect: 0,
  perception: 0,
  presence: 0,
};

function makePc(overrides: Partial<Character> = {}): Character {
  return {
    id: "pc-1",
    campaignId: "camp-1",
    kind: "pc",
    name: "Test PC",
    attributes: { ...FLAT_ATTRS },
    hp: 10,
    maxHp: 10,
    ac: 12,
    stims: 0,
    fragile: false,
    skills: [],
    actionModifiers: {},
    gear: [],
    injuries: [],
    ...overrides,
  };
}

function makeState(pc: Character, overrides: Partial<CampaignState> = {}): CampaignState {
  return {
    universe: { id: "uni-1", name: "U", primer: "p" },
    campaign: {
      id: "camp-1",
      universeId: "uni-1",
      name: "Camp",
      status: "active",
      currentLocationId: "loc-1",
      tendaysElapsed: 0,
    },
    characters: [pc],
    factions: [],
    factionRep: [],
    locations: [],
    npcs: [],
    clocks: [],
    threads: [],
    contracts: [],
    ...overrides,
  };
}

function makeEvent(id: string, overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id,
    universeId: "uni-1",
    sourceCampaignId: "camp-1",
    factionIds: [],
    headline: `Headline ${id}`,
    visibility: "canon",
    ...overrides,
  };
}

// ── Capability tier ──────────────────────────────────────────────────────────

describe("deriveCapabilityTier", () => {
  it("a green rookie (no combat skills, flat attributes) scores lowest tier", () => {
    const rookie = makePc({ skills: [], attributes: { ...FLAT_ATTRS } });
    expect(deriveCapabilityTier(rookie)).toBe("green");
  });

  it("an elite veteran (maxed combat skill + strong attribute) scores top tier", () => {
    const veteran = makePc({
      skills: [
        { name: "smallArms", level: 10, ticks: 0 },
        { name: "melee", level: 8, ticks: 0 },
      ],
      attributes: { ...FLAT_ATTRS, reflex: 4 },
    });
    expect(deriveCapabilityTier(veteran)).toBe("elite");
  });

  it("a mid-skill fighter lands in a middle tier", () => {
    // 2*6 + 3 = 15, + reflex 3 = 18 → dangerous
    const fighter = makePc({
      skills: [
        { name: "smallArms", level: 6, ticks: 0 },
        { name: "gunnery", level: 3, ticks: 0 },
      ],
      attributes: { ...FLAT_ATTRS, reflex: 3 },
    });
    expect(deriveCapabilityTier(fighter)).toBe("dangerous");
  });

  it("rookie and veteran produce DIFFERENT tiers", () => {
    const rookie = makePc({ id: "r", skills: [] });
    const veteran = makePc({
      id: "v",
      skills: [{ name: "smallArms", level: 10, ticks: 0 }],
      attributes: { ...FLAT_ATTRS, might: 4 },
    });
    expect(deriveCapabilityTier(rookie)).not.toBe(deriveCapabilityTier(veteran));
  });
});

// ── Identity passthrough ─────────────────────────────────────────────────────

describe("buildDossier identity fields", () => {
  it("copies characterId / campaignId / universeId / name from the PC + state", () => {
    const pc = makePc({ id: "pc-xyz", name: "Kesh Vane" });
    const state = makeState(pc);
    const d = buildDossier(state, []);
    expect(d.characterId).toBe("pc-xyz");
    expect(d.campaignId).toBe("camp-1");
    expect(d.universeId).toBe("uni-1");
    expect(d.name).toBe("Kesh Vane");
    expect(d.locationId).toBe("loc-1");
    expect(d.updatedAt).toBeUndefined();
  });

  it("factionId prefers ownFactionId over parentFactionId", () => {
    const pc = makePc({ parentFactionId: "fac-parent", ownFactionId: "fac-own" });
    expect(buildDossier(makeState(pc), []).factionId).toBe("fac-own");

    const pc2 = makePc({ parentFactionId: "fac-parent" });
    expect(buildDossier(makeState(pc2), []).factionId).toBe("fac-parent");
  });

  it("standing comes from the PC's own faction rep when present", () => {
    const pc = makePc({ ownFactionId: "fac-own" });
    const state = makeState(pc, {
      factionRep: [{ campaignId: "camp-1", factionId: "fac-own", rep: 3, standing: "Respected" }],
    });
    expect(buildDossier(state, []).standing).toBe("Respected");
  });

  it("throws when the campaign has no PC", () => {
    const party = makePc({ kind: "party" });
    const state = makeState(party);
    expect(() => buildDossier(state, [])).toThrow(/no PC/);
  });
});

// ── alive / death ────────────────────────────────────────────────────────────

describe("buildDossier alive flag", () => {
  it("is true for a healthy PC", () => {
    expect(buildDossier(makeState(makePc()), []).alive).toBe(true);
  });

  it("is false when the PC has a Dead injury", () => {
    const pc = makePc({ injuries: [{ name: "Dead", effect: "bled out" }] });
    expect(buildDossier(makeState(pc), []).alive).toBe(false);
  });

  it("stays alive with a non-fatal injury", () => {
    const pc = makePc({ injuries: [{ name: "Downed" }, { name: "Broken arm" }] });
    expect(buildDossier(makeState(pc), []).alive).toBe(true);
  });
});

// ── voiceNotes ───────────────────────────────────────────────────────────────

describe("buildDossier voiceNotes", () => {
  it("prefers authored voiceNotes (first line only)", () => {
    const pc = makePc({ voiceNotes: "Cold, clipped. Never repeats herself." });
    expect(buildDossier(makeState(pc), []).voiceNotes).toBe("Cold, clipped");
  });

  it("assembles from background + alignment + ambition when no voiceNotes", () => {
    const pc = makePc({
      background: "Ex-smuggler pilot. Ran the Shear for years.",
      alignment: "loud",
      ambition: "Chase the big score",
    });
    const v = buildDossier(makeState(pc), []).voiceNotes;
    expect(v).toBe("Ex-smuggler pilot; loud; Chase the big score");
  });

  it("is undefined with nothing to assemble from", () => {
    expect(buildDossier(makeState(makePc()), []).voiceNotes).toBeUndefined();
  });
});

// ── deeds mapping ────────────────────────────────────────────────────────────

describe("buildDossier deeds", () => {
  it("maps world events to deeds, preserving headline + factionIds, default notoriety", () => {
    const ev = makeEvent("ev-1", {
      headline: "Blew the Sable Chain vault",
      factionIds: ["fac-a", "fac-b"],
      createdAt: "2026-01-01T00:00:00Z",
    });
    const deeds = buildDossier(makeState(makePc()), [ev]).deeds;
    expect(deeds).toHaveLength(1);
    expect(deeds[0]).toMatchObject({
      id: "ev-1",
      headline: "Blew the Sable Chain vault",
      factionIds: ["fac-a", "fac-b"],
      notoriety: "known",
      at: "2026-01-01T00:00:00Z",
    });
  });

  it("orders most-recent-first by createdAt", () => {
    const events = [
      makeEvent("old", { createdAt: "2026-01-01T00:00:00Z" }),
      makeEvent("new", { createdAt: "2026-03-01T00:00:00Z" }),
      makeEvent("mid", { createdAt: "2026-02-01T00:00:00Z" }),
    ];
    const ids = buildDossier(makeState(makePc()), events).deeds.map((d) => d.id);
    expect(ids).toEqual(["new", "mid", "old"]);
  });

  it("caps at 5 deeds", () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      makeEvent(`ev-${i}`, { createdAt: `2026-01-0${i + 1}T00:00:00Z` }),
    );
    expect(buildDossier(makeState(makePc()), events).deeds).toHaveLength(5);
  });

  it("is empty when no events are passed", () => {
    expect(buildDossier(makeState(makePc()), []).deeds).toEqual([]);
  });
});
