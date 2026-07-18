import type { PackSidequest } from "../types";

/**
 * Authored, placed side quests (STORY.md §2, HANDOFF_STORY_2.md Task C) —
 * EMPTY on purpose, same as storyline.ts: this slice ships the machinery
 * only (schema, materialization, injection into the board), proven against
 * a test-only stub (shared/sidequests.test.ts); arming the live pack with
 * real sidequests is 3b's job (Fable drafts, owner edits — see
 * STORY_AUTHORING.md once that lands).
 */
export const driftSidequests: PackSidequest[] = [];
