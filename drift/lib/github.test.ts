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
});
