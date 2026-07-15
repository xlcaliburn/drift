import type { CampaignState } from "@/shared/schemas";
import type { SceneCard, NpcRelations, SceneMemory } from "@/shared/scene";
import type { Dossier } from "@/shared/multiplayer";

/**
 * Shared input for every context section. The broadly-used derivations (pc, loc,
 * retrieved npcs/threads) are computed ONCE in buildSectionCtx; each section pulls
 * what it needs and returns the LINES it contributes (an empty array = omitted).
 * Returning lines rather than one string lets the registry reproduce the exact
 * blank-line layout of the original single-function buildContextSlice.
 */
export interface SectionCtx {
  state: CampaignState;
  playerText: string;
  focusIds: string[];
  /** JSON-turn variant: tutorial directive phrased for fields, not tools. */
  jsonMode: boolean;
  /** Retrieved this turn (retrieveEntities) — surfaced NPCs and active threads. */
  npcs: CampaignState["npcs"];
  threads: CampaignState["threads"];
  /** Scene memory (CONTINUITY.md): card + relations + recent summaries. */
  memory?: { sceneCard?: SceneCard; npcRelations?: NpcRelations; recentScenes?: SceneMemory[] };
  /** Reachable dossiers of OTHER players' characters (cross-campaign cameos). */
  otherDossiers?: Dossier[];
  // ── derived once in buildSectionCtx ──
  pc?: CampaignState["characters"][number];
  loc?: CampaignState["locations"][number];
}

export type Section = (ctx: SectionCtx) => string[];
