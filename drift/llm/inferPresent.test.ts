import { describe, it, expect } from "vitest";
import { inferPresentNpcs } from "./jsonTurn";

const npcs = [
  { id: "npc-soren", name: "Soren Valis" },
  { id: "npc-calvo", name: "Calvo" },
  { id: "npc-rax", name: "Rax Dellow" },
];

describe("inferPresentNpcs — presence beyond the strict speech-verb match", () => {
  it("marks an NPC present when the scene is set in THEIR space (place name token)", () => {
    // The reported bug: talking to Soren in his office, presentNpcIds empty.
    const p = inferPresentNpcs("You lay the shard on the desk.", "Meridian Ring — Valis's office", "", npcs);
    expect(p.has("npc-soren")).toBe(true);
    expect(p.has("npc-calvo")).toBe(false);
  });

  it("marks the named actor right before a quote (act-then-speak)", () => {
    const p = inferPresentNpcs("Valis taps the data shard, then slides it back. 'You've got a commendation.'", "the concourse", "", npcs);
    expect(p.has("npc-soren")).toBe(true);
  });

  it("does NOT mark an NPC merely MENTIONED as being elsewhere", () => {
    // Calvo is named, but off-screen and no quote attributed near him → not present.
    const p = inferPresentNpcs("Valis warns you that Calvo is holed up out at Undertow. 'Watch yourself.'", "Valis's office", "", npcs);
    expect(p.has("npc-calvo")).toBe(false);
    expect(p.has("npc-soren")).toBe(true); // in-place + speaker
  });

  it("does not treat a possessive/contraction apostrophe as an opening quote", () => {
    // "Rax's" and "you've" have inline apostrophes — no dialogue, no place match → nobody present.
    const p = inferPresentNpcs("You've heard Rax's name before, but the corridor is empty.", "an empty corridor", "", npcs);
    expect(p.size).toBe(0);
  });
});
