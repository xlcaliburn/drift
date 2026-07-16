import { describe, it, expect } from "vitest";
import type { CampaignState } from "@/shared/schemas";
import { TurnRuntime } from "./engineBridge";
import type { RNG } from "@/engine";

const rng: RNG = { int: (min) => min };

function stateAt(locId = "loc-meridian"): CampaignState {
  return {
    campaign: { id: "c", universeId: "u", currentLocationId: locId, tendaysElapsed: 0 },
    universe: { id: "u" },
    characters: [{ id: "pc-1", kind: "pc", name: "Vess", hp: 8, maxHp: 8, ac: 12, stims: 0, fragile: false, attributes: { might: 0, reflex: 0, vitality: 0, intellect: 0, perception: 0, presence: 0 }, skills: [], actionModifiers: {}, gear: [], injuries: [] }],
    factions: [], factionRep: [], locations: [], npcs: [], clocks: [], threads: [], contracts: [],
  } as unknown as CampaignState;
}

describe("registerNpc — continuity", () => {
  it("persists a narrator-introduced NPC to the cast, at the current location", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const res = rt.registerNpc("Quartermaster Doyle", "Gruff supply officer; keeps the manifests.");
    expect(res.added).toBe(true);
    const npc = rt.state.npcs.find((n) => n.id === res.id)!;
    expect(npc.name).toBe("Quartermaster Doyle");
    expect(npc.locationId).toBe("loc-meridian"); // remembered where you met them
    expect(npc.id.startsWith("npc-gen-")).toBe(true); // campaign-scoped id
  });

  it("REFUSES to register the player's own character as an NPC (the 'Wren' bug)", () => {
    // PC is "Vess". The model attributes a line to "Vess" (or a full-name PC's first
    // name) — that must never spawn a duplicate person.
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const res = rt.registerNpc("Vess", "Spoke with the player.");
    expect(res.added).toBe(false);
    expect(res.id).toBe("");
    expect(rt.state.npcs.some((n) => n.name.toLowerCase() === "vess")).toBe(false);
    // markPresent no-ops on the refused "" id (doesn't corrupt presentNpcIds).
    rt.markPresent(res.id);
    expect(rt.sceneCard.presentNpcIds).not.toContain("");
  });

  it("refuses a first-name match against a full PC name", () => {
    const s = stateAt("loc-rook");
    (s.characters[0] as { name: string }).name = "Wren Sung";
    const rt = new TurnRuntime(s, rng);
    expect(rt.registerNpc("Wren").added).toBe(false); // "Wren" == first name of "Wren Sung"
  });

  it("dedupes by name (case-insensitive); does NOT re-add the entry", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const first = rt.registerNpc("Doyle", "supply officer");
    rt.state = { ...rt.state, campaign: { ...rt.state.campaign, currentLocationId: "loc-rook" } };
    const again = rt.registerNpc("doyle");
    expect(again.added).toBe(false);
    expect(again.id).toBe(first.id);
    expect(rt.state.npcs.filter((n) => n.name.toLowerCase() === "doyle").length).toBe(1);
  });

  it("home location is SET-ONCE — a later mention elsewhere never relocates it (the live 'Steward still nearby at Halcyon' bug)", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const first = rt.registerNpc("Doyle", "supply officer");
    expect(rt.state.npcs.find((n) => n.id === first.id)!.locationId).toBe("loc-meridian");
    // The player has since traveled; the narrator quotes Doyle again this turn (a
    // comms call, a remembered line) — this must NOT silently move his canonical home.
    rt.state = { ...rt.state, campaign: { ...rt.state.campaign, currentLocationId: "loc-rook" } };
    rt.registerNpc("doyle");
    expect(rt.state.npcs.find((n) => n.id === first.id)!.locationId).toBe("loc-meridian");
  });

  it("a NEW npc still gets pinned to wherever they're introduced", () => {
    const rt = new TurnRuntime(stateAt("loc-rook"), rng);
    const res = rt.registerNpc("Korso", "cargo-locker fence");
    expect(rt.state.npcs.find((n) => n.id === res.id)!.locationId).toBe("loc-rook");
  });
});

describe("registerNpc — name-collision guard (CHECKS.md §2, the live 'a second Ren' bug)", () => {
  it("two DIFFERENT roles under the same name never merge — the second person gets a disambiguated entry", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const courier = rt.registerNpc("Ren", "A sharp, scarred courier.", "courier");
    // Later: the pilot introduces an unrelated bar-fixer, ALSO named "Ren".
    const fixer = rt.registerNpc("Ren", "Runs a dock-side bar, the Rust Anchor.", "fixer");
    expect(fixer.added).toBe(true);
    expect(fixer.id).not.toBe(courier.id); // a genuinely new, distinct record
    const courierNpc = rt.state.npcs.find((n) => n.id === courier.id)!;
    const fixerNpc = rt.state.npcs.find((n) => n.id === fixer.id)!;
    expect(courierNpc.oneBreath).toContain("courier"); // untouched by the fixer's identity
    expect(fixerNpc.oneBreath).toContain("Rust Anchor");
    expect(fixerNpc.name).toBe("Ren (fixer)"); // disambiguated so future mentions tell them apart
    expect(rt.state.npcs.filter((n) => n.name.toLowerCase().startsWith("ren"))).toHaveLength(2);
  });

  it("a LATER mention of either Ren re-matches by role — no third duplicate spawns", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const courier = rt.registerNpc("Ren", "A sharp, scarred courier.", "courier");
    const fixer = rt.registerNpc("Ren", "Runs a dock-side bar.", "fixer");
    // The dialogue backstop fires again for each of them later in the same scene.
    const courierAgain = rt.registerNpc("Ren", undefined, "courier");
    const fixerAgain = rt.registerNpc("Ren", undefined, "fixer");
    expect(courierAgain.id).toBe(courier.id);
    expect(fixerAgain.id).toBe(fixer.id);
    expect(rt.state.npcs.filter((n) => n.name.toLowerCase().startsWith("ren"))).toHaveLength(2); // still just the two
  });

  it("same name + same role merges as one person (not a collision)", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const first = rt.registerNpc("Ren", "A courier.", "courier");
    const again = rt.registerNpc("Ren", undefined, "courier");
    expect(again.added).toBe(false);
    expect(again.id).toBe(first.id);
  });

  it("an existing NPC with NO role yet still merges when a role shows up later (adopts it, not a collision)", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const first = rt.registerNpc("Ren"); // no role known yet
    const withRole = rt.registerNpc("Ren", undefined, "courier");
    expect(withRole.added).toBe(false);
    expect(withRole.id).toBe(first.id);
    expect(rt.state.npcs.find((n) => n.id === first.id)!.role).toBe("courier");
  });

  it("with NO role signal at all on a genuinely ambiguous mention, falls back to the first candidate (documented best-effort)", () => {
    const rt = new TurnRuntime(stateAt("loc-meridian"), rng);
    const courier = rt.registerNpc("Ren", "A courier.", "courier");
    rt.registerNpc("Ren", "Runs a dock-side bar.", "fixer"); // creates the disambiguated second Ren
    const noRoleMention = rt.registerNpc("Ren"); // no role this time — can't disambiguate
    expect(noRoleMention.id).toBe(courier.id); // best effort: the original, unchanged from before this feature
  });
});
