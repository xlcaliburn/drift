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

  it("ALIASES: presence + speaker attribution match every name the person is known by", () => {
    const cast = [{ id: "npc-ren-fixer", name: "Ren (fixer)", aliases: ["Renwick"] }];
    // Prose uses the alias only — still the same record, present.
    const p = inferPresentNpcs("Renwick sets down his glass. 'You found me.'", "the Rust Anchor", "", cast);
    expect(p.has("npc-ren-fixer")).toBe(true);
    // Place text using the alias also marks them.
    const p2 = inferPresentNpcs("You wait.", "Renwick's back room", "", cast);
    expect(p2.has("npc-ren-fixer")).toBe(true);
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

  it("COMPANION EXEMPTION: an NPC who was just with the player passes the home gate", () => {
    // The live gap: a courier (based loc-meridian) rides the shuttle WITH the player
    // to Halcyon. She acts-then-speaks in the arrival scene — but her home base
    // would gate her out. Being in companionIds (present last scene) exempts her; a
    // genuinely remote NPC with the same home stays gated. (A 3-char name like
    // "Ren" is below this inference's ≥4-char token floor — short names ride the
    // speech-verb presence loop instead, which carries the same exemption.)
    const based = [
      { id: "npc-sera", name: "Sera", locationId: "loc-meridian" },
      { id: "npc-ilyana", name: "Ilyana", locationId: "loc-meridian" },
    ];
    const narration = "Sera scans the bar from the corner. 'Watch the barman.' Somewhere back home, Ilyana waits by the comm. 'Report in.'";
    const gated = inferPresentNpcs(narration, "Halcyon — the Rust Anchor", "", based, "loc-freeport");
    expect(gated.has("npc-sera")).toBe(false); // no exemption → gated like anyone remote
    const withCompanions = inferPresentNpcs(narration, "Halcyon — the Rust Anchor", "", based, "loc-freeport", new Set(["npc-sera"]));
    expect(withCompanions.has("npc-sera")).toBe(true); // she came along — inferable again
    expect(withCompanions.has("npc-ilyana")).toBe(false); // still gated — she did NOT come along
  });
});
