import { describe, it, expect } from "vitest";
import { applyFactUpdates, FACTS_CAP, type Fact } from "./facts";

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
