import type { CampaignState } from "@/shared/schemas";
import type { SceneCard, NpcRelations, SceneMemory } from "@/shared/scene";
import type { Dossier } from "@/shared/multiplayer";
import { retrieveEntities } from "../retrieval";
import type { Section, SectionCtx } from "./types";
import { tutorial, previously, directive, sceneHeader, season, sceneNow } from "./framing";
import { pcSheet, vitals, ship } from "./pcSheet";
import { threat, market, dock, patron, bodyMod } from "./economy";
import { npcs, cameos, threads, worldStatus } from "./world";

/**
 * The per-turn context slice, composed from ordered SECTIONS. The order IS the
 * prompt layout; a literal "" is a blank-line spacer (matching the original
 * single-function layout exactly). A new context line is a new section export +
 * one entry here — no edit inside a 280-line function, so parallel feature work
 * stops colliding on this file (REFACTOR.md Plan 1). Byte-stability is pinned by
 * llm/contextSlice.golden.test.ts.
 */
const SECTIONS: (Section | "")[] = [
  tutorial, previously, directive, sceneHeader, season, sceneNow,
  "",
  pcSheet, vitals, ship, threat, market, dock, patron, bodyMod,
  "",
  npcs,
  "",
  cameos, threads,
  "",
  worldStatus,
];

/**
 * Assemble the per-turn context slice: current location, present NPCs, relevant
 * active threads, party vitals, ship state, economy prompts, and world status.
 * This is the block that keeps token cost flat regardless of campaign length.
 */
export function buildContextSlice(
  state: CampaignState,
  playerText: string,
  focusIds: string[] = [],
  retrieved?: { npcs: CampaignState["npcs"]; threads: CampaignState["threads"] },
  /** JSON-turn variant: tutorial directive phrased for fields, not tools. */
  jsonMode = false,
  /** Scene memory (CONTINUITY.md): card + relations + recent summaries. */
  memory?: { sceneCard?: SceneCard; npcRelations?: NpcRelations; recentScenes?: SceneMemory[] },
  /** Reachable dossiers of OTHER players' characters in this universe (cameos). */
  otherDossiers?: Dossier[],
): string {
  const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const { npcs, threads } = retrieved ?? retrieveEntities(state, playerText, focusIds);
  const pc = state.characters.find((c) => c.kind === "pc");
  const ctx: SectionCtx = { state, playerText, focusIds, jsonMode, npcs, threads, memory, otherDossiers, pc, loc };
  return SECTIONS.flatMap((s) => (s === "" ? [""] : s(ctx))).join("\n");
}
