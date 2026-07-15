import { describe, it, expect } from "vitest";
import type { Dossier } from "./multiplayer";
import { deriveKnowledge, visibleDeeds, projectDossier, recordEncounter, advanceLedger, type PlayerLedger } from "./ledger";

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

  it("secondhand from a PUBLIC deed even with an empty ledger", () => {
    expect(deriveKnowledge({}, dossier())).toBe("secondhand");
  });

  it("secondhand from a shared faction even with only a rumored deed", () => {
    const quiet = dossier({ deeds: [{ id: "d3", headline: "a whisper", factionIds: [], notoriety: "rumored" }] });
    expect(deriveKnowledge({}, quiet, "f-sable")).toBe("secondhand");
  });

  it("unknown when only a rumored deed and no shared faction, no entry", () => {
    const quiet = dossier({ factionId: "f-sable", deeds: [{ id: "d3", headline: "a whisper", factionIds: [], notoriety: "rumored" }] });
    expect(deriveKnowledge({}, quiet, "f-crown")).toBe("unknown");
  });
});

describe("visibleDeeds", () => {
  it("secondhand sees public deeds (known + notorious), not rumors", () => {
    expect(visibleDeeds(dossier(), "secondhand").map((d) => d.id)).toEqual(["d1", "d2"]);
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
  it("secondhand hides tier + voice, shows public deeds (not rumors)", () => {
    const v = projectDossier(dossier(), "secondhand")!;
    expect(v.capabilityTier).toBeUndefined();
    expect(v.voiceNotes).toBeUndefined();
    expect(v.standing).toBe("rising Sable enforcer"); // reputation still reaches you
    expect(v.deeds.map((d) => d.id)).toEqual(["d1", "d2"]);
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

describe("advanceLedger — promote on a real in-scene encounter", () => {
  const here = dossier({ locationId: "loc-rook" });

  it("promotes a here-now dossier named in the narration to firsthand", () => {
    const next = advanceLedger({}, { characterId: "me" }, [here], "Rax Dellow leans on the bar, watching you.", "loc-rook");
    expect(next.rax?.knowledge).toBe("firsthand");
  });

  it("does NOT promote when the dossier is at another location (a rumor)", () => {
    const elsewhere = dossier({ locationId: "loc-meridian" });
    const led: PlayerLedger = {};
    const next = advanceLedger(led, { characterId: "me" }, [elsewhere], "You hear Rax Dellow torched a depot on Meridian.", "loc-rook");
    expect(next).toBe(led); // unchanged, same ref
  });

  it("does NOT promote when the name isn't in the narration", () => {
    const led: PlayerLedger = {};
    const next = advanceLedger(led, { characterId: "me" }, [here], "The bar is quiet tonight.", "loc-rook");
    expect(next).toBe(led);
  });

  it("leaves an already-firsthand contact untouched", () => {
    const led: PlayerLedger = { rax: { ownerCharacterId: "me", subjectId: "rax", subjectName: "Rax Dellow", knowledge: "firsthand", stance: "ally", warmth: 2, knownDeedIds: [] } };
    const next = advanceLedger(led, { characterId: "me" }, [here], "Rax Dellow nods at you.", "loc-rook");
    expect(next).toBe(led); // no change → same ref
  });
});
