import { describe, it, expect } from "vitest";
import { suggestName, sample, exampleSkills, exampleMoralCodes, exampleLosses, exampleTies, exampleTells } from "./examples";

/**
 * PIN TEST (Modularity M1 Task B) — captured from the code BEFORE the name
 * pools + example prose moved into the pack, to prove the move is byte-
 * identical data motion. Deterministic pools are order-sensitive
 * (HANDOFF_MODULARITY_M1.md's trap): any reordering here means a pool changed,
 * not just relocated.
 */
describe("content/examples — pin (name pools + creation gallery)", () => {
  it("suggestName is unchanged for known seeds", () => {
    expect(suggestName(0)).toBe("Rook");
    expect(suggestName(0.1)).toBe("Fen");
    expect(suggestName(0.37)).toBe("Corwin Draeve");
    expect(suggestName(0.5)).toBe("Rook");
    expect(suggestName(0.83)).toBe("Perla Sung");
    expect(suggestName(0.99)).toBe("Nadia Quist");
  });

  it("sample() picks are unchanged for known seeds (pool order pinned)", () => {
    expect(sample(exampleMoralCodes, 3, 0)).toEqual([
      "I don't shoot someone in the back.",
      "No poison, no gas — I look them in the eye.",
      "Debts get paid: mine, and the ones owed to me.",
    ]);
    expect(sample(exampleLosses, 2, 7)).toEqual([
      "A fortune, once — gone in a single bad jump.",
      "Years, to a debtor's contract I finally bought out.",
    ]);
    expect(sample(exampleTies, 2, 3)).toEqual([
      "A Crown handler vouched for me once — I still owe that.",
      "I raised someone else's kid; they don't know I'm not blood.",
    ]);
    expect(sample(exampleTells, 2, 11)).toEqual([
      "I whistle the same three notes when I'm working.",
      "I tap two fingers when I'm lying.",
    ]);
  });

  it("exampleSkills is unchanged in length and endpoints", () => {
    expect(exampleSkills.length).toBe(23);
    expect(exampleSkills[0].skill.name).toBe("Shear-Sense");
    expect(exampleSkills[exampleSkills.length - 1].skill.name).toBe("Pickpocket's Grace");
  });
});
