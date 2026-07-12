import { z } from "zod";

/**
 * In-game feature requests: players submit free-text through the play UI; a
 * cheap LLM call formats it (title/summary/category); the owner approves or
 * declines from /requests.
 */

export const FeedbackCategory = z.enum(["bug", "feature", "balance", "content", "other"]);
export type FeedbackCategory = z.infer<typeof FeedbackCategory>;

export const FeedbackStatus = z.enum(["pending", "approved", "declined", "done"]);
export type FeedbackStatus = z.infer<typeof FeedbackStatus>;

export const FeatureRequest = z.object({
  id: z.string(),
  campaignId: z.string().optional(),
  /** Who asked — the character/player name shown to the owner. */
  authorName: z.string().default("anonymous"),
  /** Authenticated user id (profiles.id); absent in keyless dev. */
  authorId: z.string().optional(),
  /** The player's original words, kept verbatim. */
  raw: z.string(),
  /** LLM-formatted (or naive-fallback) presentation. */
  title: z.string(),
  summary: z.string().default(""),
  category: FeedbackCategory.default("other"),
  status: FeedbackStatus.default("pending"),
  decisionNote: z.string().optional(),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
});
export type FeatureRequest = z.infer<typeof FeatureRequest>;
