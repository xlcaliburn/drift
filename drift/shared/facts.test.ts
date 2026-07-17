import { describe, it, expect } from "vitest";
import { applyFactUpdates, FACTS_CAP, PINNED_CAP, type Fact } from "./facts";

const f = (text: string, tenday = 0): Fact => ({ text, entityRefs: [], tenday });

describe("facts ledger — durable canon with dedupe + cap (CONTINUITY v2)", () => {
  it("appends new facts with the tenday stamp and entity refs", () => {
    const next = applyFactUpdates([], [{ text: "The split with Kaela is 50/50 — agreed.", entityRefs: ["npc-kaela"] }], 4);
    expect(next).toHaveLength(1);
    expect(next[0].tenday).toBe(4);
    expect(next[0].entityRefs).toEqual(["npc-kaela"]);
  });

  it("a restated fact REPLACES its older wording instead of duplicating (the 50/50 → 30% class)", () => {
    const start = [f("The split with Kaela is 50/50 — agreed"), f("Banned from the Meridian dock bar")];
    const next = applyFactUpdates(start, [{ text: "The split with Kaela is 50/50, agreed at the cantina" }], 5);
    expect(next).toHaveLength(2);
    // One Kaela-split fact, the NEWEST wording, moved to the fresh end.
    const kaela = next.filter((x) => x.text.includes("50/50"));
    expect(kaela).toHaveLength(1);
    expect(kaela[0].text).toContain("cantina");
    expect(next[next.length - 1]).toBe(kaela[0]);
  });

  it("keeps genuinely distinct facts distinct", () => {
    const start = [f("Meeting Dex at the Rust Bucket in two hours")];
    const next = applyFactUpdates(start, [{ text: "Doyle owes the player two hundred credits" }]);
    expect(next).toHaveLength(2);
  });

  it("caps at FACTS_CAP, evicting oldest-first", () => {
    let facts: Fact[] = [];
    for (let i = 0; i < FACTS_CAP + 5; i++) {
      // Distinct SUBJECTS (contact-i / berth-i / rate-i) so nothing dedupes away.
      facts = applyFactUpdates(facts, [{ text: `Contact-${i} holds berth-${i} rate-${i} standing` }], i);
    }
    expect(facts).toHaveLength(FACTS_CAP);
    expect(facts[0].text).toContain("Contact-5"); // 0-4 evicted
  });

  it("drops empty text and bounds length + refs", () => {
    const next = applyFactUpdates([], [
      { text: "   " },
      { text: "x".repeat(500), entityRefs: ["a", "b", "c", "d", "e", "f", "g", "h"] },
    ]);
    expect(next).toHaveLength(1);
    expect(next[0].text.length).toBeLessThanOrEqual(160);
    expect(next[0].entityRefs.length).toBeLessThanOrEqual(6);
  });
});

describe("facts ledger — pinning (CONTINUITY_HARDENING.md Task 5)", () => {
  it("a pinned fact survives 25 unpinned additions past the cap", () => {
    let facts: Fact[] = applyFactUpdates([], [{ text: "Split with Kaela: 50/50 — agreed", pinned: true }], 0);
    for (let i = 0; i < 25; i++) {
      facts = applyFactUpdates(facts, [{ text: `Contact-${i} holds berth-${i} rate-${i} standing` }], i);
    }
    expect(facts).toHaveLength(FACTS_CAP);
    expect(facts.some((f) => f.text.includes("Kaela") && f.pinned)).toBe(true);
  });

  it("unpinned facts still LRU-evict at the cap even with a pin present", () => {
    let facts: Fact[] = applyFactUpdates([], [{ text: "Pinned anchor fact", pinned: true }], 0);
    for (let i = 0; i < FACTS_CAP + 5; i++) {
      facts = applyFactUpdates(facts, [{ text: `Contact-${i} holds berth-${i} rate-${i} standing` }], i);
    }
    expect(facts).toHaveLength(FACTS_CAP);
    // Earliest unpinned entries evicted first; the pin survives untouched.
    expect(facts.find((f) => f.pinned)?.text).toBe("Pinned anchor fact");
    expect(facts.some((f) => f.text.includes("Contact-0"))).toBe(false);
  });

  it("a 9th pin unpins the oldest pinned fact", () => {
    let facts: Fact[] = [];
    for (let i = 0; i < PINNED_CAP; i++) {
      facts = applyFactUpdates(facts, [{ text: `Deal-${i} struck: exact terms`, pinned: true }], i);
    }
    expect(facts.filter((f) => f.pinned)).toHaveLength(PINNED_CAP);
    facts = applyFactUpdates(facts, [{ text: "Deal-8 struck: exact terms", pinned: true }], 8);
    expect(facts.filter((f) => f.pinned)).toHaveLength(PINNED_CAP);
    expect(facts.find((f) => f.text.includes("Deal-0"))?.pinned).toBeFalsy();
    expect(facts.find((f) => f.text.includes("Deal-8"))?.pinned).toBe(true);
  });

  it("a restated pinned fact keeps its pin even when the restatement doesn't repeat it", () => {
    let facts: Fact[] = applyFactUpdates([], [{ text: "Split with Kaela: 50/50 — agreed", pinned: true }], 0);
    facts = applyFactUpdates(facts, [{ text: "Split with Kaela: 50/50, agreed at the cantina" }], 1);
    expect(facts).toHaveLength(1);
    expect(facts[0].pinned).toBe(true);
    expect(facts[0].text).toContain("cantina");
  });

  it("everything pinned evicts oldest at the cap (pinned facts aren't immortal)", () => {
    // Directly construct an over-cap, all-pinned ledger (PINNED_CAP normally
    // prevents reaching this via applyFactUpdates itself) to exercise the
    // defensive fallback: with NO unpinned candidate, eviction takes the oldest.
    const over: Fact[] = Array.from({ length: FACTS_CAP + 1 }, (_, i) => ({
      text: `Fact-${i} distinct subject entry`,
      entityRefs: [],
      tenday: i,
      pinned: true,
    }));
    const next = applyFactUpdates(over, []);
    expect(next).toHaveLength(FACTS_CAP);
    expect(next.every((f) => f.pinned)).toBe(true);
    expect(next.some((f) => f.text.includes("Fact-0"))).toBe(false); // oldest evicted
  });
});
