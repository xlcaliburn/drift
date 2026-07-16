import { describe, it, expect } from "vitest";
import type { Location } from "./schemas";
import { routeBetween, rollTransitIncident, riskColor, riskLabel } from "./routes";

const LOCS: Location[] = [
  { id: "loc-meridian", universeId: "u", name: "Meridian Ring", tags: ["crown", "commerce"], tier: "T1" },
  { id: "loc-rook", universeId: "u", name: "Rook Station", tags: ["blackmarket", "lawless"], tier: "T1" },
  { id: "loc-freeport", universeId: "u", name: "Halcyon", tags: ["free", "neutral"], tier: "T1" },
  { id: "loc-sable", universeId: "u", name: "Coldharbor", tags: ["sable", "contested"], tier: "T2" },
  { id: "loc-talos", universeId: "u", name: "Talos Station", tags: ["frontier", "hostile"], tier: "T3" },
  { id: "loc-nest", universeId: "u", name: "The Nest", tags: ["lawless", "hidden", "raiders"], tier: "T3" },
] as unknown as Location[];

describe("routeBetween — named lanes + formula fallback", () => {
  it("a named lane returns its authored value, either direction", () => {
    expect(routeBetween("loc-meridian", "loc-rook", LOCS)).toEqual({ tendays: 3, risk: "low" });
    expect(routeBetween("loc-rook", "loc-meridian", LOCS)).toEqual({ tendays: 3, risk: "low" });
  });

  it("same location is a trivial local hop", () => {
    expect(routeBetween("loc-meridian", "loc-meridian", LOCS)).toEqual({ tendays: 0, risk: "low" });
  });

  it("an un-named pair falls back to the tier/tag formula", () => {
    // T1 <-> T1, no hazard tags -> low risk, short hop.
    const r = routeBetween("loc-meridian", "loc-freeport", LOCS);
    expect(r.risk).toBe("low");
    expect(r.tendays).toBe(1);

    // T1 <-> T2 -> medium.
    const r2 = routeBetween("loc-freeport", "loc-sable", LOCS);
    expect(r2.risk).toBe("medium");
    expect(r2.tendays).toBe(2);

    // T1 <-> T3 -> high (tier alone).
    const r3 = routeBetween("loc-freeport", "loc-talos", LOCS);
    expect(r3.risk).toBe("high");

    // A hazard-tagged endpoint (raiders) bumps risk to high even at lower tiers.
    const r4 = routeBetween("loc-freeport", "loc-nest", LOCS);
    expect(r4.risk).toBe("high");
  });

  it("unknown location ids don't throw — default to T1-shaped distance", () => {
    expect(() => routeBetween("loc-ghost-a", "loc-ghost-b", LOCS)).not.toThrow();
    expect(routeBetween("loc-ghost-a", "loc-ghost-b", LOCS).risk).toBe("low");
  });
});

describe("rollTransitIncident — the risk-drives-encounters mechanic", () => {
  it("uses the risk tier's chance band and is honest about the roll", () => {
    const low = rollTransitIncident("low", { int: () => 5 });
    expect(low.hit).toBe(true); // 5 <= 10
    expect(low.chance).toBe(10);

    const lowMiss = rollTransitIncident("low", { int: () => 50 });
    expect(lowMiss.hit).toBe(false);

    const high = rollTransitIncident("high", { int: () => 40 });
    expect(high.hit).toBe(true); // 40 <= 45
    expect(high.chance).toBe(45);
  });

  it("higher risk tiers never have a LOWER hit chance", () => {
    const rollAt = (r: "low" | "medium" | "high", n: number) => rollTransitIncident(r, { int: () => n }).hit;
    for (let n = 1; n <= 100; n++) {
      if (rollAt("low", n)) expect(rollAt("medium", n)).toBe(true);
      if (rollAt("medium", n)) expect(rollAt("high", n)).toBe(true);
    }
  });
});

describe("risk display helpers", () => {
  it("color and label are distinct per tier", () => {
    const colors = new Set((["low", "medium", "high"] as const).map(riskColor));
    expect(colors.size).toBe(3);
    expect(riskLabel("high")).toMatch(/high/i);
  });
});
