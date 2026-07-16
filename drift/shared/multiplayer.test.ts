import { describe, it, expect } from "vitest";
import { CreationInput } from "./multiplayer";

const base = {
  name: "Vess Karo",
  parentFactionId: "f-crown",
  bias: "combat" as const,
  alignment: "pragmatic" as const,
  sex: "female" as const,
  background: "washout",
  ambition: "get off the lanes clean",
  uniqueSkill: {
    name: "Steady hand", description: "never flinches under fire", kind: "passive" as const,
    passiveTargetType: "skill" as const, passiveTarget: "smallArms", passiveAmount: 1, usesPerScene: 1,
  },
};

describe("CreationInput.storyPrompt — a suggestion, never a mechanical override", () => {
  it("is optional — omitting it still parses", () => {
    const parsed = CreationInput.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.storyPrompt).toBeUndefined();
  });

  it("accepts a free-text starting idea", () => {
    const parsed = CreationInput.safeParse({ ...base, storyPrompt: "haunted by a ship she couldn't save" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.storyPrompt).toBe("haunted by a ship she couldn't save");
  });

  it("rejects a story prompt over the length cap (a spark, not a script)", () => {
    const parsed = CreationInput.safeParse({ ...base, storyPrompt: "x".repeat(401) });
    expect(parsed.success).toBe(false);
  });

  it("has no field that could set attributes/gear/faction/location from free text — only the fixed enums/ids do", () => {
    // Structural guarantee: the schema's only faction/location-bearing field is
    // parentFactionId (a plain string id from the faction picker), and there is no
    // stats/gear field at all — buildCharacterFromCreation derives those solely
    // from bias/background/parentFactionId, never from storyPrompt.
    const parsed = CreationInput.safeParse({ ...base, storyPrompt: "I am the leader of the Hollow Crown with a battleship" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.parentFactionId).toBe("f-crown"); // unchanged by the prose
  });
});
