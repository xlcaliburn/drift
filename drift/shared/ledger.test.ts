import { describe, it, expect } from "vitest";
import type { Dossier } from "./multiplayer";
import { deriveKnowledge, visibleDeeds, projectDossier, recordEncounter, type PlayerLedger } from "./ledger";

function dossier(over: Partial<Dossier> = {}): Dossier {
  return {
    characterId: "rax",
    campaignId: "camp-b",
    universeId: "u",
    name: "Rax Dellow",
    factionId: "f-sable",
    capabilityTier: "dangerous",
    standing: "rising Sable enforcer",
    alive: true,
    deeds: [
      { id: "d1", headline: "torched a Crown depot", factionIds: ["f-crown"], notoriety: "notorious" },
      { id: "d2", headline: "ran a quiet courier job", factionIds: [], notoriety: "known" },
      { id: "d3", headline: "whispered a betrayal", factionIds: [], notoriety: "rumored" },
    ],
    voiceNotes: "clipped, menacing",
    ...over,
  } as Dossier;
}

describe("deriveKnowledge", () => {
  it("firsthand when a firsthand entry is stored", () => {
    const led: PlayerLedger = { rax: { ownerCharacterId: "me", subjectId: "rax", subjectName: "Rax Dellow", knowledge: "firsthand", stance: "rival", warmth: -1, knownDeedIds: [] } };
    expect(deriveKnowledge(led, dossier())).toBe("firsthand");
  });

  it("secondhand from a NOTORIOUS deed even with an empty ledger", () => {
    expect(deriveKnowledge({}, dossier())).toBe("secondhand");
  });

  it("secondhand from a shared faction even with no notorious deed", () => {
    const quiet = dossier({ deeds: [{ id: "d2", headline: "a quiet job", factionIds: [], notoriety: "known" }] });
    expect(deriveKnowledge({}, quiet, "f-sable")).toBe("secondhand");
  });

  it("unknown when no notoriety, no shared faction, no entry", () => {
    const quiet = dossier({ factionId: "f-sable", deeds: [{ id: "d2", headline: "a quiet job", factionIds: [], notoriety: "known" }] });
    expect(deriveKnowledge({}, quiet, "f-crown")).toBe("unknown");
  });
});

describe("visibleDeeds", () => {
  it("secondhand sees only notorious deeds", () => {
    expect(visibleDeeds(dossier(), "secondhand").map((d) => d.id)).toEqual(["d1"]);
  });
  it("firsthand sees notorious + known, but not unspread rumors", () => {
    expect(visibleDeeds(dossier(), "firsthand").map((d) => d.id)).toEqual(["d1", "d2"]);
  });
  it("firsthand sees a rumor it personally learned", () => {
    const entry = { ownerCharacterId: "me", subjectId: "rax", subjectName: "Rax", knowledge: "firsthand" as const, stance: "neutral" as const, warmth: 0, knownDeedIds: ["d3"] };
    expect(visibleDeeds(dossier(), "firsthand", entry).map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
  });
});

describe("projectDossier", () => {
  it("returns null for unknown", () => {
    expect(projectDossier(dossier(), "unknown")).toBeNull();
  });
  it("firsthand carries tier + voice + full known deeds + stance", () => {
    const entry = { ownerCharacterId: "me", subjectId: "rax", subjectName: "Rax", knowledge: "firsthand" as const, stance: "rival" as const, warmth: -2, knownDeedIds: [] };
    const v = projectDossier(dossier(), "firsthand", entry)!;
    expect(v.capabilityTier).toBe("dangerous");
    expect(v.voiceNotes).toBe("clipped, menacing");
    expect(v.stance).toBe("rival");
    expect(v.deeds.map((d) => d.id)).toEqual(["d1", "d2"]);
  });
  it("secondhand hides tier + voice, shows only notorious deeds", () => {
    const v = projectDossier(dossier(), "secondhand")!;
    expect(v.capabilityTier).toBeUndefined();
    expect(v.voiceNotes).toBeUndefined();
    expect(v.standing).toBe("rising Sable enforcer"); // reputation still reaches you
    expect(v.deeds.map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("recordEncounter", () => {
  it("promotes to firsthand, folds in known deeds, preserves prior stance/notes", () => {
    const led: PlayerLedger = { rax: { ownerCharacterId: "me", subjectId: "rax", subjectName: "Rax Dellow", knowledge: "secondhand", stance: "rival", warmth: -1, knownDeedIds: ["d1"], notes: "heard he's Sable" } };
    const next = recordEncounter(led, { characterId: "me" }, dossier());
    const e = next.rax;
    expect(e.knowledge).toBe("firsthand");
    expect(e.stance).toBe("rival"); // preserved
    expect(e.notes).toBe("heard he's Sable"); // preserved
    expect(new Set(e.knownDeedIds)).toEqual(new Set(["d1", "d2"])); // folded notorious+known, not the rumor
  });
  it("creates a neutral firsthand entry for a brand-new contact", () => {
    const next = recordEncounter({}, { characterId: "me" }, dossier());
    expect(next.rax.knowledge).toBe("firsthand");
    expect(next.rax.stance).toBe("neutral");
    expect(next.rax.warmth).toBe(0);
  });
});
