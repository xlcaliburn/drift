import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { FeatureRequest, type FeedbackStatus } from "@/shared/feedback";
import { deepseekChat, deepseekAvailable, resolveModel, isDeepSeekModel } from "@/llm/deepseek";
import { hasSupabase } from "@/lib/state";

/**
 * Feature-request store + LLM formatter. DB-backed (feature_requests table)
 * when Supabase is configured; in-memory Map fallback for keyless local dev
 * (same pattern as lib/state.ts). Formatting always uses the cheapest
 * configured model.
 */

const store = new Map<string, FeatureRequest>();

async function db() {
  const { getServiceClient } = await import("@/db/queries");
  return getServiceClient();
}

export async function listRequests(): Promise<FeatureRequest[]> {
  if (!hasSupabase()) {
    return [...store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { fromRow } = await import("@/db/queries");
  const { data, error } = await (await db())
    .from("feature_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.flatMap((r) => {
    const parsed = FeatureRequest.safeParse(fromRow(r));
    return parsed.success ? [parsed.data] : [];
  });
}

/** A single user's submissions, newest first — the player-facing status list. */
export async function listRequestsByAuthor(authorId: string): Promise<FeatureRequest[]> {
  if (!hasSupabase()) {
    return [...store.values()]
      .filter((r) => r.authorId === authorId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { fromRow } = await import("@/db/queries");
  const { data, error } = await (await db())
    .from("feature_requests")
    .select("*")
    .eq("author_id", authorId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.flatMap((r) => {
    const parsed = FeatureRequest.safeParse(fromRow(r));
    return parsed.success ? [parsed.data] : [];
  });
}

export async function saveRequest(req: FeatureRequest): Promise<void> {
  if (!hasSupabase()) {
    store.set(req.id, req);
    return;
  }
  const { toRow } = await import("@/db/queries");
  const { error } = await (await db()).from("feature_requests").upsert(toRow(req));
  if (error) console.error("saveRequest failed", error);
}

export async function decideRequest(
  id: string,
  status: FeedbackStatus,
  note?: string,
): Promise<FeatureRequest | null> {
  if (!hasSupabase()) {
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
  const { fromRow } = await import("@/db/queries");
  const { data, error } = await (await db())
    .from("feature_requests")
    .update({
      status,
      ...(note !== undefined ? { decision_note: note } : {}),
      decided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error || !data) return null;
  const parsed = FeatureRequest.safeParse(fromRow(data));
  return parsed.success ? parsed.data : null;
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
        model: "deepseek-v4-flash",
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
