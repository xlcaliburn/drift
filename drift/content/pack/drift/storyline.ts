import type { PackStoryline } from "../types";

/**
 * The authored main questline (STORY.md, HANDOFF_STORY_1.md Task B) — EMPTY
 * on purpose. This slice ships the machinery only (schema, engine, runtime
 * slice, prompt section, Story tab), proven against a test-only stub
 * (shared/storyline.test.ts); arming the live pack with real chapters is the
 * next slice's job (Fable drafts the season script, the owner edits this
 * file directly — see STORY_AUTHORING.md once that lands).
 */
export const driftStoryline: PackStoryline = {
  chapters: [],
};
