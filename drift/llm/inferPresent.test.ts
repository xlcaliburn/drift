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

  it("HOME-LOCATION GATE: an NPC based at another station never infers as present", () => {
    // The live bug: Ilyana (based on Meridian) quoted over comms while the player is
    // at Halcyon — the dialogue reads exactly like a real appearance to these
    // heuristics, but she is NOT in the scene.
    const based = [
      { id: "npc-ilyana", name: "Ilyana", locationId: "loc-meridian" },
      { id: "npc-quist", name: "Harbormaster Quist", locationId: "loc-freeport" },
      { id: "npc-drifter", name: "Moss" }, // no home known — ungated (current behavior)
    ];
    const p = inferPresentNpcs(
      "Ilyana's voice crackles over the comm. 'The Crown remembers.' Quist waves you through while Moss watches. 'Berth nine.'",
      "Halcyon — the harbormaster's gate",
      "",
      based,
      "loc-freeport",
    );
    expect(p.has("npc-ilyana")).toBe(false); // based elsewhere — gated out
    expect(p.has("npc-quist")).toBe(true); // based here — inferable
    // Without a currentLocationId the gate is off (back-compat callers).
    const ungated = inferPresentNpcs("Ilyana taps the desk. 'Sit.'", "Ilyana's office", "", based);
    expect(ungated.has("npc-ilyana")).toBe(true);
  });
});
