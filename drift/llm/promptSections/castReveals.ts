import { pack, authoredCastDepth } from "@/content/pack";
import type { Section } from "./types";

/**
 * CAST REVEALS (STORY.md, HANDOFF_STORY_2.md Task B). A storyline NPC's
 * authored `secret`/`arc` are GATED, unlike `backstory` (always-on, spoiler-
 * safe — see promptSections/world.ts): a reveal only surfaces while its
 * chapter is ACTIVE and the cast member is PRESENT, both engine facts. This
 * is the "backstory pays off on cue" mechanism — the model still chooses
 * WHEN and HOW to play it (never forced into one turn), but it can never
 * fire before the story arms it. Returns [] whenever there's no active
 * chapter — true for every campaign while the live pack ships zero chapters
 * (trap 4: keeps the golden context slice byte-identical).
 */
export const castReveals: Section = ({ state, storyline, memory }) => {
  if (!storyline) return [];
  const activeId = Object.keys(storyline.chapters).find((id) => storyline.chapters[id].status === "active");
  if (!activeId) return [];
  const chapter = pack.storyline.chapters.find((c) => c.id === activeId);
  if (!chapter) return []; // dropped from the pack — the next trigger evaluation cleans this up

  const present = new Set(memory?.sceneCard?.presentNpcIds ?? []);
  const lines: string[] = [];
  for (const npcId of chapter.castNpcIds) {
    if (!present.has(npcId)) continue;
    const depth = authoredCastDepth(npcId);
    if (!depth) continue;
    const name = state.npcs.find((n) => n.id === npcId)?.name ?? npcId;
    if (depth.secret) {
      lines.push(`  - ${name}: their secret may now surface, on YOUR timing (not forced this turn): ${depth.secret}`);
    }
    const actLine = depth.arc?.[chapter.act - 1];
    if (actLine) {
      lines.push(`  - ${name}, how they are this act: ${actLine}`);
    }
  }

  if (!lines.length) return [];
  return [
    `CAST REVEALS (authored depth for this chapter's present cast — weave in naturally, never dump it all in one beat):\n${lines.join("\n")}`,
    ``,
  ];
};
