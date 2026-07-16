import { describe, it, expect } from "vitest";
import { parseAuditReport, buildAuditUser } from "./dailyAudit";
import { repairTruncatedJson } from "./jsonRepair";

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

  it("strips markdown code fences before parsing", () => {
    const r = parseAuditReport('```json\n{"storyContext":"fenced","inconsistencies":[]}\n```');
    expect(r.storyContext).toBe("fenced");
  });

  it("parses PATTERNS (the headline) and clamps a junk mechanism to engine-gap", () => {
    const r = parseAuditReport(
      JSON.stringify({
        storyContext: "x",
        patterns: [
          {
            pattern: "Narrated deal terms have no durable home, so later scenes contradict them",
            mechanism: "engine-gap",
            evidence: "the 50/50 → 30% renegotiation",
            proposedCheck: "facts ledger slice on campaign_runtime",
          },
          { pattern: "clamped", mechanism: "cosmic-rays" },
          { mechanism: "drift" }, // no pattern → dropped
        ],
      }),
    );
    expect(r.patterns).toHaveLength(2);
    expect(r.patterns[0].mechanism).toBe("engine-gap");
    expect(r.patterns[0].proposedCheck).toContain("facts ledger");
    expect(r.patterns[1].mechanism).toBe("engine-gap"); // junk mechanism clamped
  });

  it("SALVAGES a truncated report (the live Wren case: token cap hit mid-object)", () => {
    // Fenced AND cut mid-string inside the second field — the shape that reduced
    // a $0.28 Opus report to a 500-char raw stub.
    const raw =
      '```json\n{\n  "storyContext": "Wren Sung is a shipless independent on Rook Station.",\n' +
      '  "inconsistencies": [{"severity": "high", "what": "Sera denies the arrangement", "evidence": "she said';
    const r = parseAuditReport(raw);
    expect(r.storyContext).toBe("Wren Sung is a shipless independent on Rook Station.");
    // The complete first fields survive; the half-written finding may be dropped.
    expect(r.frustrations).toEqual([]);
  });
});

describe("repairTruncatedJson", () => {
  it("closes an object cut mid-string value", () => {
    const fixed = repairTruncatedJson('{"a": "done", "b": "half wri')!;
    expect(JSON.parse(fixed)).toEqual({ a: "done" });
  });

  it("closes an array cut mid-element and drops the dangling key", () => {
    const fixed = repairTruncatedJson('{"list": [1, 2, 3], "next": [4, 5')!;
    expect(JSON.parse(fixed)).toEqual({ list: [1, 2, 3], next: [4, 5] });
  });

  it("drops a dangling key cut before its colon", () => {
    const fixed = repairTruncatedJson('{"a": 1, "hangingKey"')!;
    expect(JSON.parse(fixed)).toEqual({ a: 1 });
  });

  it("handles escaped quotes inside strings", () => {
    const fixed = repairTruncatedJson('{"quote": "she said \\"done\\"", "cut": "mid')!;
    expect(JSON.parse(fixed)).toEqual({ quote: 'she said "done"' });
  });

  it("returns null when nothing is salvageable", () => {
    expect(repairTruncatedJson("no braces here")).toBeNull();
    expect(repairTruncatedJson('{"')).toBeNull();
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
