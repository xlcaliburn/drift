import { pack } from "@/content/pack";
import { prologueDirective } from "@/shared/prologue";
import type { Section } from "./types";

/**
 * THE PROLOGUE (STORY.md §3, HANDOFF_STORY_4.md) — the current stage's
 * authored directive, engine-selected and placeholder-filled; the narrator
 * only dramatizes it, never decides when a stage advances. Returns []
 * whenever there's no active stage — true for every legacy campaign
 * (`prologueStage` unset) and once the prologue completes (trap 3: this is
 * what keeps the golden context slice byte-identical, since no golden
 * fixture sets a stage).
 */
export const prologue: Section = ({ state, pc }) => {
  const stage = state.campaign.prologueStage;
  if (!stage || stage === "complete") return [];
  const line = prologueDirective(pack, pc?.parentFactionId, stage);
  if (!line) return [];
  return [`PROLOGUE — ${line}`, ``];
};
