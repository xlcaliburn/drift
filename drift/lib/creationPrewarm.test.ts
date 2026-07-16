import { describe, it, expect, vi } from "vitest";

// server-only is a no-op shim in tests (matches lib/github.test.ts).
vi.mock("server-only", () => ({}));

import { prewarmKey } from "./creationPrewarm";
import type { CreationInput } from "@/shared/multiplayer";

const base: CreationInput = {
  name: "Vess Karo",
  parentFactionId: "f-crown",
  bias: "combat",
  alignment: "pragmatic",
  sex: "female",
  background: "washout",
  ambition: "get off the lanes clean",
  flavor: {},
  uniqueSkill: {
    name: "Steady hand", description: "never flinches under fire", kind: "passive",
    passiveTargetType: "skill", passiveTarget: "smallArms", passiveAmount: 1, usesPerScene: 1,
  },
};

describe("prewarmKey — storyPrompt participates in the cache key", () => {
  it("changes the key when storyPrompt changes (a differing idea busts the warm cache)", () => {
    const a = prewarmKey({ ...base, storyPrompt: "haunted by a ship she couldn't save" });
    const b = prewarmKey({ ...base, storyPrompt: "grew up running cargo for the Ledger" });
    const none = prewarmKey(base);
    expect(a).not.toBe(b);
    expect(a).not.toBe(none);
  });

  it("stays stable when only the signature changes (excluded on purpose)", () => {
    const withSig1 = prewarmKey(base);
    const withSig2 = prewarmKey({
      ...base,
      uniqueSkill: { ...base.uniqueSkill, name: "Different sig", passiveAmount: 2 },
    });
    expect(withSig1).toBe(withSig2);
  });
});
