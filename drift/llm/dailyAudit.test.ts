import { describe, it, expect } from "vitest";
import { parseAuditReport, buildAuditUser } from "./dailyAudit";

describe("parseAuditReport — the nightly audit's pure parse/bound layer", () => {
  it("parses a full report and preserves every section", () => {
    const raw = JSON.stringify({
      storyContext: "Vess runs Crown contracts out of Meridian; the Sable war is closing in.",
      inconsistencies: [
        { severity: "high", what: "Ilyana greeted the player as a stranger despite trusted standing", evidence: "turn 41 vs 12", suggestedFix: "have her acknowledge the debt history" },
      ],
      droppedThreads: [{ title: "Quist's missing manifest", lastSeen: "promised two scenes ago", suggestedBeat: "Quist comms the player at dock" }],
      frustrations: [{ signal: "APPEAL over a lost stim", quote: "APPEAL: I should have a stim", cause: "useItem under-fired", suggestedFix: "typed-consumable backstop" }],
      adjustments: ["Tighten rule 8 on offer surfacing"],
      npcs: [{ name: "Moss", role: "dock rat", oneBreath: "A wiry lookout who trades in berth gossip.", note: "tipped you off about the watch rotation", presence: "present" }],
      threads: [{ op: "open", title: "Find who tipped the watch", body: "Someone sold the route." }, { op: "resolve", id: "th-manifest" }],
    });
    const r = parseAuditReport(raw);
    expect(r.storyContext).toContain("Crown contracts");
    expect(r.inconsistencies).toHaveLength(1);
    expect(r.inconsistencies[0].severity).toBe("high");
    expect(r.droppedThreads[0].title).toBe("Quist's missing manifest");
    expect(r.frustrations[0].quote).toContain("APPEAL");
    expect(r.adjustments).toHaveLength(1);
    expect(r.threads).toEqual([
      { op: "open", title: "Find who tipped the watch", body: "Someone sold the route." },
      { op: "resolve", id: "th-manifest" },
    ]);
    // An OFFLINE audit may never mark someone into the live scene.
    expect(r.npcs[0].presence).toBe("mentioned");
  });

  it("bounds junk: bad severity → low, junk rows dropped, arrays capped", () => {
    const raw = JSON.stringify({
      storyContext: "x",
      inconsistencies: [
        { severity: "catastrophic", what: "w" },
        { severity: "high" }, // no "what" → dropped
        ...Array.from({ length: 20 }, (_, i) => ({ severity: "low", what: `w${i}` })),
      ],
      threads: [{ op: "open" }, { op: "resolve" }, { op: "nonsense", title: "x" }],
      npcs: [{ role: "no name → dropped" }],
      adjustments: [null, "", "keep me"],
    });
    const r = parseAuditReport(raw);
    expect(r.inconsistencies[0].severity).toBe("low"); // clamped
    expect(r.inconsistencies.length).toBeLessThanOrEqual(10); // capped
    expect(r.inconsistencies.every((x) => x.what)).toBe(true);
    expect(r.threads).toEqual([]); // all three were invalid
    expect(r.npcs).toEqual([]);
    expect(r.adjustments).toEqual(["keep me"]);
  });

  it("extracts the JSON object out of reasoning-model preamble", () => {
    const r = parseAuditReport('Thinking it through...\n{"storyContext":"ok","inconsistencies":[]}');
    expect(r.storyContext).toBe("ok");
  });

  it("never throws on garbage — degrades to an empty report carrying the raw text", () => {
    const r = parseAuditReport("not json at all");
    expect(r.inconsistencies).toEqual([]);
    expect(r.storyContext).toContain("not json");
  });
});

describe("buildAuditUser", () => {
  it("labels every input block and falls back to (none)", () => {
    const u = buildAuditUser({
      header: "Vess — Hollow Crown character at Meridian Ring, tenday 4",
      transcript: "PLAYER: hi\nDM: hello",
      npcRoster: "",
      threadRoster: "th-1 = Find the manifest",
      jobs: "",
      recentScenes: "[s1] Arrival: docked at Meridian.",
      appeals: "[03:12] APPEAL — player: I should have a stim",
    });
    expect(u).toContain("CAMPAIGN: Vess");
    expect(u).toContain("KNOWN NPCs (id = name: description):\n(none)");
    expect(u).toContain("OPEN THREADS (id = title):\nth-1 = Find the manifest");
    expect(u).toContain("TODAY'S APPEALS + ERRORS");
    expect(u.trim().endsWith("DM: hello")).toBe(true); // transcript last (the bulk)
  });
});
