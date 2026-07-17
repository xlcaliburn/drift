import { describe, it, expect } from "vitest";
import { mergeFactsOnConflict, mergeNpcsOnConflict, mergeRecentScenesOnConflict } from "./runtimeMerge";
import type { Fact } from "./facts";
import type { SceneMemory } from "./scene";
import type { Npc } from "./schemas";

describe("runtimeMerge — campaign_runtime CAS conflict resolution (CHECKS.md §0)", () => {
  describe("mergeFactsOnConflict", () => {
    it("overlapping facts dedupe instead of duplicating", () => {
      const theirs: Fact[] = [{ text: "Split with Kaela on the crate: 50/50 — agreed", entityRefs: [] }];
      const mine: Fact[] = [{ text: "Meeting Dex at the Rust Bucket, two hours", entityRefs: [] }];
      const merged = mergeFactsOnConflict(theirs, mine);
      expect(merged).toHaveLength(2);
      expect(merged.some((f) => f.text.includes("Kaela"))).toBe(true);
      expect(merged.some((f) => f.text.includes("Dex"))).toBe(true);
    });

    it("OUR restated fact wins over theirs (ours applied last, on top)", () => {
      const theirs: Fact[] = [{ text: "Split with Kaela on the crate: 50/50 — agreed", entityRefs: [] }];
      const mine: Fact[] = [{ text: "Split with Kaela on the crate now 60/40 — renegotiated", entityRefs: [] }];
      const merged = mergeFactsOnConflict(theirs, mine);
      const kaelaFacts = merged.filter((f) => f.text.toLowerCase().includes("kaela"));
      expect(kaelaFacts).toHaveLength(1);
      expect(kaelaFacts[0].text).toContain("60/40");
    });

    it("a fact only THEY have (from a background write we never saw) survives the merge", () => {
      const theirs: Fact[] = [{ text: "Banned from the Meridian dock bar", entityRefs: [] }];
      const merged = mergeFactsOnConflict(theirs, []);
      expect(merged).toHaveLength(1);
      expect(merged[0].text).toContain("Banned");
    });
  });

  describe("mergeRecentScenesOnConflict", () => {
    const scene = (seq: number, over: Partial<SceneMemory> = {}): SceneMemory => ({
      seq,
      title: `Scene ${seq}`,
      summary: `summary ${seq}`,
      entityRefs: [],
      ...over,
    });

    it("unions distinct seqs from both sides", () => {
      const merged = mergeRecentScenesOnConflict([scene(1), scene(2)], [scene(3)]);
      expect(merged.map((s) => s.seq)).toEqual([1, 2, 3]);
    });

    it("prefers OUR non-degraded entry over their degraded stub for the same seq", () => {
      const theirs = [scene(5, { degraded: true, summary: "PLAYER: hi … DM: bye" })];
      const mine = [scene(5, { summary: "A real, healed summary of what happened." })];
      const merged = mergeRecentScenesOnConflict(theirs, mine);
      expect(merged).toHaveLength(1);
      expect(merged[0].degraded).toBeFalsy();
      expect(merged[0].summary).toContain("healed");
    });

    it("prefers THEIR non-degraded entry over our degraded stub (the repair-pass-elsewhere case)", () => {
      const theirs = [scene(5, { summary: "A real, healed summary from elsewhere." })];
      const mine = [scene(5, { degraded: true, summary: "PLAYER: hi … DM: bye" })];
      const merged = mergeRecentScenesOnConflict(theirs, mine);
      expect(merged[0].degraded).toBeFalsy();
      expect(merged[0].summary).toContain("healed");
    });

    it("same health on both sides: prefers the longer (more complete) summary", () => {
      const theirs = [scene(5, { summary: "short" })];
      const mine = [scene(5, { summary: "a much longer and more detailed summary of the scene" })];
      const merged = mergeRecentScenesOnConflict(theirs, mine);
      expect(merged[0].summary).toContain("longer");
    });

    it("returns sorted by seq", () => {
      const merged = mergeRecentScenesOnConflict([scene(9), scene(2)], [scene(5)]);
      expect(merged.map((s) => s.seq)).toEqual([2, 5, 9]);
    });
  });

  describe("mergeNpcsOnConflict", () => {
    const npc = (id: string, over: Partial<Npc> = {}): Npc => ({
      id,
      universeId: "u",
      name: id,
      oneBreath: "Someone the player met.",
      ...over,
    });

    it("unions distinct ids from both sides", () => {
      const merged = mergeNpcsOnConflict([npc("npc-a")], [npc("npc-b")]);
      expect(merged.map((n) => n.id).sort()).toEqual(["npc-a", "npc-b"]);
    });

    it("prefers the RICHER record when the same id diverges (an analyst refresh elsewhere)", () => {
      const theirs = [npc("npc-ren", { oneBreath: "Someone the player met." })];
      const mine = [
        npc("npc-ren", {
          oneBreath: "Renwick Duross, the dockmaster's fixer.",
          role: "fixer",
          aliases: ["Renwick"],
        }),
      ];
      const merged = mergeNpcsOnConflict(theirs, mine);
      expect(merged).toHaveLength(1);
      expect(merged[0].aliases).toEqual(["Renwick"]);
    });

    it("keeps THEIR richer record when ours is the thin one", () => {
      const theirs = [npc("npc-ren", { oneBreath: "Renwick Duross, the dockmaster's fixer.", role: "fixer" })];
      const mine = [npc("npc-ren", { oneBreath: "Someone the player met." })];
      const merged = mergeNpcsOnConflict(theirs, mine);
      expect(merged[0].role).toBe("fixer");
    });
  });
});
