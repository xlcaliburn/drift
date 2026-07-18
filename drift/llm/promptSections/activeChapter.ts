import { pack } from "@/content/pack";
import { nextBeat } from "@/shared/storyline";
import type { Section } from "./types";

/**
 * MAIN STORY block (STORY.md, HANDOFF_STORY_1.md Task C). Tells the narrator
 * the active chapter's title, its current objective, the fixed cast ("use
 * EXACTLY these people"), and THIS turn's beat directive — the ENGINE decides
 * all of it (trigger, objective completion, which beat); the narrator only
 * dramatizes what's handed to it. Returns [] whenever there's no active
 * chapter — true for every campaign while the live pack ships zero chapters
 * (trap 2: this is what keeps the golden context slice byte-identical).
 */
export const activeChapter: Section = ({ state, storyline }) => {
  if (!storyline) return [];
  const activeId = Object.keys(storyline.chapters).find((id) => storyline.chapters[id].status === "active");
  if (!activeId) return [];
  const chapter = pack.storyline.chapters.find((c) => c.id === activeId);
  if (!chapter) return []; // dropped from the pack — the next trigger evaluation cleans this up

  const progress = storyline.chapters[activeId];
  const done = new Set(progress.objectivesDone);
  const objective = chapter.objectives.find((o) => !done.has(o.id));
  const tenday = state.campaign.tendaysElapsed ?? 0;
  const beat = nextBeat(pack.storyline, storyline, state.npcs, tenday);
  const castNames = chapter.castNpcIds
    .map((id) => state.npcs.find((n) => n.id === id)?.name)
    .filter((n): n is string => !!n);

  const lines = [
    `MAIN STORY — Act ${chapter.act}, "${chapter.title}" is ACTIVE (engine-tracked; narrate it, never decide it's done or advance it yourself):`,
    objective ? `  - Current objective: ${objective.summary}` : `  - Every objective is done — awaiting the choice below.`,
  ];
  if (castNames.length) lines.push(`  - Use EXACTLY these people for this chapter, invent no one else: ${castNames.join(", ")}`);
  if (beat) lines.push(`  - THIS TURN, weave in: ${beat.directive}`);
  if (chapter.choicePoint && !progress.choiceOptionId && !objective) {
    const options = chapter.choicePoint.options.map((o) => o.label).join(" / ");
    lines.push(`  - Present the choice "${chapter.choicePoint.prompt}" (${options}) as a real chip — the engine records the pick.`);
  }
  return [lines.join("\n"), ``];
};
