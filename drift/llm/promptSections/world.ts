import { relationSuffix, relationHistory } from "@/shared/scene";
import { generateQuirk } from "@/shared/npcFlavor";
import { shipIsOwned, shipThreadId } from "@/shared/recap";
import type { Dossier } from "@/shared/multiplayer";
import type { Section } from "./types";

/**
 * World-state sections: the NPCs in play, cross-campaign cameos, the relevant
 * open threads, and the clock/rep/ids footer. The "who and what is around you"
 * block, kept separate from the character sheet and economy clusters.
 */

/** How close an NPC is: in the scene with the player (immediate), on the same
 *  station/area (nearby), or neither (unmarked — recalled from elsewhere). */
function proximityTag(n: { id: string; locationId?: string }, present: Set<string>, currentLoc?: string): string {
  if (present.has(n.id)) return " [immediate]";
  if (n.locationId && currentLoc && n.locationId === currentLoc) return " [nearby]";
  return "";
}

/**
 * Cross-campaign cameo pool (MULTIPLAYER.md): from the OTHER players' dossiers
 * reachable in this universe, pick up to `cap` the narrator may bring in as an
 * NPC. Only living characters qualify. Same-location dossiers are PREFERRED, then
 * the rest fill remaining slots. Deterministic ordering — no Math.random.
 */
export function reachableDossiers(
  dossiers: Dossier[],
  currentLocationId: string | undefined,
  cap = 2,
): Dossier[] {
  const alive = dossiers.filter((d) => d.alive);
  const here = alive
    .filter((d) => currentLocationId && d.locationId === currentLocationId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const elsewhere = alive
    .filter((d) => !(currentLocationId && d.locationId === currentLocationId))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...here, ...elsewhere].slice(0, Math.max(0, cap));
}

/**
 * Render the OTHER PLAYERS' CHARACTERS context block. Lean by design (token cost):
 * name, faction, tier, a voice/role line, here-now vs. elsewhere, and 1-2 deeds.
 */
function otherCharactersBlock(
  dossiers: Dossier[],
  factionName: (id?: string) => string,
  currentLocationId: string | undefined,
): string {
  if (!dossiers.length) return "";
  const lines = dossiers.map((d) => {
    const here = currentLocationId && d.locationId === currentLocationId ? "HERE NOW" : "elsewhere";
    const faction = d.factionId ? factionName(d.factionId) : "unaligned";
    const voice = d.voiceNotes?.trim() || d.role?.trim() || d.reputation?.trim() || "";
    const deeds = d.deeds
      .slice(-2)
      .map((x) => x.headline)
      .filter(Boolean);
    const bits = [
      `  - ${d.name} (${faction}, ${d.capabilityTier}, ${here})`,
      voice ? `: ${voice}` : "",
      deeds.length ? ` — known for: ${deeds.join("; ")}` : "",
    ];
    return bits.join("");
  });
  return (
    `OTHER PLAYERS' CHARACTERS IN THE WORLD (real, canon — from other players' games; play TRUE to this, invent no mechanics; bring in at most ONE, only when natural):\n` +
    lines.join("\n")
  );
}

/** NPCs in play — proximity, canon personality, backstory hook, standing, and the
 *  full relationship history for anyone relevant this turn. */
export const npcs: Section = ({ npcs, memory, loc }) => {
  const rels = memory?.npcRelations ?? {};
  const presentSet = new Set(memory?.sceneCard?.presentNpcIds ?? []);
  return [
    npcs.length
      ? `NPCs in play (proximity = how close; standing = their history; "plays:" = their canon personality — play it CONSISTENTLY; "hook:" = a backstory thread you can pull into a quest; "history:" = what has ALREADY passed between you and them — treat it as fact and NEVER act as if it didn't happen):\n${npcs
          .map((n) => {
            const quirk = n.quirk ?? generateQuirk(n.id);
            const hook = presentSet.has(n.id) && n.backstory ? ` [hook: ${n.backstory}]` : "";
            // Feed the full relationship history for any NPC relevant this turn (present
            // OR surfaced by the player's text) so an extensive prior scene with them
            // can't be forgotten — the "Agnes forgot her whole scene with Sera" bug.
            const hist = relationHistory(rels[n.id]);
            const histLine = hist ? `\n      history: ${hist}` : "";
            return `  - ${n.name} (id: ${n.id})${proximityTag(n, presentSet, loc?.id)}: ${n.oneBreath} (plays: ${quirk})${relationSuffix(rels[n.id])}${hook}${histLine}`;
          })
          .join("\n")}`
      : `NPCs in play: none flagged`,
  ];
};

/** Cross-campaign cameo pool — other players' characters the narrator may bring in
 *  as an NPC this scene (same-location preferred). Includes its trailing spacer. */
export const cameos: Section = ({ state, otherDossiers, loc }) => {
  const cameoPool = reachableDossiers(otherDossiers ?? [], loc?.id);
  const otherChars = otherCharactersBlock(
    cameoPool,
    (id) => (id ? state.factions.find((f) => f.id === id)?.name ?? id : "unaligned"),
    loc?.id,
  );
  return otherChars ? [otherChars, ``] : [];
};

/** The relevant open threads (the player's live objectives). */
export const threads: Section = ({ threads }) => [
  threads.length
    ? `Relevant threads:\n${threads.map((t) => `  - ${t.title} (id: ${t.id}): ${t.body}`).join("\n")}`
    : `Relevant threads: none flagged`,
];

/** Clocks + faction rep + the entity-ids footer (mode-dependent). */
export const worldStatus: Section = ({ state, jsonMode }) => {
  const clocksLine = state.clocks
    .filter((c) => c.status === "active")
    .map((c) => {
      const near = c.milestones.some((m) => !m.done && m.at === c.current + 1);
      return `${c.name}: ${c.current}/${c.max}${near ? " ⚠ next tick hits a milestone" : ""}`;
    })
    .join("; ");
  const repLine = state.factionRep
    .map((r) => `${state.factions.find((f) => f.id === r.factionId)?.name ?? r.factionId} ${r.rep >= 0 ? "+" : ""}${r.rep}`)
    .join(", ");
  return [
    `Clocks: ${clocksLine}`,
    `Faction rep: ${repLine}`,
    ``,
    // JSON turns only reference clock + faction ids (clockAdvances/worldEvent);
    // the tool loop needed the full roster. Keep the slice lean per mode.
    jsonMode
      ? `Ids — clocks: ${state.clocks.map((c) => c.id).join(", ")}; factions: ${state.factions.map((f) => f.id).join(", ")}.`
      : `Entity ids for tools — characters: ${state.characters.map((c) => c.id).join(", ")}; ship: ${state.ship?.id ?? "none"}; clocks: ${state.clocks.map((c) => c.id).join(", ")}; factions: ${state.factions.map((f) => f.id).join(", ")}${state.ship && !shipIsOwned(state) ? `; ship-ownership thread (resolve to grant the title): ${shipThreadId(state.campaign.id)}` : ""}.`,
  ];
};
