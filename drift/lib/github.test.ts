import { describe, it, expect, vi } from "vitest";

// server-only is a no-op shim in tests.
vi.mock("server-only", () => ({}));

import { buildAppealIssue } from "./github";

describe("buildAppealIssue", () => {
  const base = {
    reporter: "Ada Vex",
    campaignId: "camp-abc",
    character: "Cali Volkov",
    appealText: "The guard I stealth-killed shouldn't have shot back — the roll was a success.",
    ruling: "Upheld: the strike landed clean. Restoring the 4 HP the phantom return fire took.",
    model: "claude-sonnet-5",
  };

  it("titles a granted appeal with the character + a snippet", () => {
    const { title } = buildAppealIssue({ ...base, granted: true, adjustments: ["Cali hp → 18"] });
    expect(title).toMatch(/^\[appeal granted\] Cali Volkov:/);
    expect(title).toContain("stealth-killed");
  });

  it("marks a denied appeal and includes both the appeal and the ruling as quotes", () => {
    const { title, body } = buildAppealIssue({ ...base, granted: false });
    expect(title).toMatch(/^\[appeal denied\]/);
    expect(body).toContain("**Outcome:** denied");
    expect(body).toContain("**Player:** Ada Vex");
    expect(body).toContain("**Campaign:** `camp-abc`");
    expect(body).toContain("> The guard I stealth-killed"); // appeal quoted
    expect(body).toContain("> Upheld: the strike landed clean"); // ruling quoted
  });

  it("lists engine adjustments only when a granted ruling applied some", () => {
    const withAdj = buildAppealIssue({ ...base, granted: true, adjustments: ["Cali hp → 18", "+1 stim"] });
    expect(withAdj.body).toContain("### Engine adjustments applied");
    expect(withAdj.body).toContain("- Cali hp → 18");
    const noAdj = buildAppealIssue({ ...base, granted: false });
    expect(noAdj.body).not.toContain("Engine adjustments");
  });

  it("truncates a very long appeal in the title with an ellipsis", () => {
    const { title } = buildAppealIssue({ ...base, granted: true, appealText: "x".repeat(200) });
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThan(140);
  });

  it("embeds self-contained debug context (state, scene, transcript, dice) so no SQL dig is needed", () => {
    const { body } = buildAppealIssue({
      ...base,
      granted: false,
      context: {
        where: "Valis's office — Meridian Ring (loc-meridian)",
        situation: "Cali lays the shard on the desk",
        vitals: "3/18 HP (Downed) · ¢420 · 2 stims",
        presentNpcs: ["Soren Valis"],
        combat: "personal T2 fight, round 3: Thug 1 (4/8), Thug 2 (8/8)",
        transcriptTail: ["PLAYER: I gun the guard down", "SYSTEM: d20(4)+0 = 4 vs AC 13 → miss", "DM: Your shot goes wide"],
        engineLogTail: ["athletics: d20(14)+3 = 17 vs DC 18 → failure · 6 damage (DOWNED)"],
      },
    });
    expect(body).toContain("**Where:** Valis's office");
    expect(body).toContain("3/18 HP (Downed)"); // vitals fold into the Character line
    expect(body).toContain("**Present:** Soren Valis");
    expect(body).toContain("round 3: Thug 1 (4/8)");
    expect(body).toContain("<details><summary>Recent transcript"); // folded, so it doesn't bury the issue
    expect(body).toContain("PLAYER: I gun the guard down");
    expect(body).toContain("<details><summary>Recent engine log");
    expect(body).toContain("6 damage (DOWNED)");
  });

  it("omits the fold blocks when there's no transcript/log context", () => {
    const { body } = buildAppealIssue({ ...base, granted: false });
    expect(body).not.toContain("<details>");
  });
});
