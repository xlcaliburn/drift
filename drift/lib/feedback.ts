import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { FeatureRequest, FeedbackStatus } from "@/shared/feedback";
import { deepseekChat, deepseekAvailable, resolveModel, isDeepSeekModel } from "@/llm/deepseek";

/**
 * Feature-request store + LLM formatter. In-memory for now (same pattern as
 * lib/state.ts); the feature_requests table in db/schema.sql is ready for the
 * Supabase wiring. Formatting always uses the cheapest configured model.
 */

const store = new Map<string, FeatureRequest>();

export function listRequests(): FeatureRequest[] {
  return [...store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveRequest(req: FeatureRequest): void {
  store.set(req.id, req);
}

export function decideRequest(
  id: string,
  status: FeedbackStatus,
  note?: string,
): FeatureRequest | null {
  const req = store.get(id);
  if (!req) return null;
  const updated: FeatureRequest = {
    ...req,
    status,
    decisionNote: note ?? req.decisionNote,
    decidedAt: new Date().toISOString(),
  };
  store.set(id, updated);
  return updated;
}

const FORMAT_SYSTEM =
  'You format raw player feedback about a TTRPG webapp into JSON. Reply ONLY with JSON: {"title": string (imperative, <=60 chars), "summary": string (2-3 sentences: what they want and why), "category": one of "bug"|"feature"|"balance"|"content"|"other"}. Preserve the player\'s intent; do not invent requirements.';

export interface FormattedFeedback {
  title: string;
  summary: string;
  category: "bug" | "feature" | "balance" | "content" | "other";
}

/** Format raw feedback with the cheapest available model; naive fallback if none. */
export async function formatFeedback(raw: string): Promise<FormattedFeedback> {
  const naive: FormattedFeedback = {
    title: raw.split(/\s+/).slice(0, 8).join(" ").slice(0, 60) || "Untitled request",
    summary: raw.slice(0, 300),
    category: "other",
  };

  try {
    let text = "";
    if (deepseekAvailable()) {
      const resp = await deepseekChat({
        model: "deepseek-chat",
        maxTokens: 300,
        system: [{ type: "text", text: FORMAT_SYSTEM }],
        messages: [{ role: "user", content: raw }],
      });
      const block = resp.content.find((b) => b.type === "text");
      text = block && block.type === "text" ? block.text : "";
    } else if (process.env.ANTHROPIC_API_KEY) {
      const model = resolveModel("claude-haiku-4-5-20251001");
      if (isDeepSeekModel(model)) return naive; // no anthropic key either
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const resp = await client.messages.create({
        model,
        max_tokens: 300,
        system: FORMAT_SYSTEM,
        messages: [{ role: "user", content: raw }],
      });
      const block = resp.content.find((b) => b.type === "text");
      text = block && block.type === "text" ? block.text : "";
    } else {
      return naive;
    }

    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    return {
      title: String(parsed.title ?? naive.title).slice(0, 60),
      summary: String(parsed.summary ?? naive.summary),
      category: ["bug", "feature", "balance", "content", "other"].includes(parsed.category)
        ? parsed.category
        : "other",
    };
  } catch {
    return naive;
  }
}
