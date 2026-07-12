import Anthropic from "@anthropic-ai/sdk";
import { deepseekChat, deepseekAvailable, isDeepSeekModel, resolveModel } from "./deepseek";

export interface SceneSummary {
  summary: string;
  entityRefs: string[];
}

const SYSTEM =
  "You compress TTRPG scenes. Reply ONLY with JSON: {\"summary\": string (2-3 sentences, past tense, concrete outcomes), \"entityRefs\": string[] (ids from the provided list that appeared)}.";

function defaultSummarizerModel() {
  return (
    process.env.SUMMARIZER_MODEL ??
    (deepseekAvailable() ? "deepseek-chat" : "claude-haiku-4-5-20251001")
  );
}

/**
 * Cheap scene summarizer (DeepSeek when configured, else Haiku): compress a
 * scene's exchanges into 2-3 sentences and extract which entity ids appeared
 * (for retrieval next time).
 */
export async function summarizeScene(
  transcript: string,
  knownEntityIds: string[],
  opts: { apiKey?: string; model?: string } = {},
): Promise<SceneSummary> {
  const model = resolveModel(opts.model ?? defaultSummarizerModel());
  const user = `Known entity ids: ${knownEntityIds.join(", ")}\n\nScene transcript:\n${transcript}`;

  let raw = "{}";
  if (isDeepSeekModel(model)) {
    const resp = await deepseekChat({
      model,
      maxTokens: 400,
      system: [{ type: "text", text: SYSTEM }],
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content.find((b) => b.type === "text");
    raw = text && text.type === "text" ? text.text : "{}";
  } else {
    const client = new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content.find((b) => b.type === "text");
    raw = text && text.type === "text" ? text.text : "{}";
  }

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return {
      summary: String(parsed.summary ?? ""),
      entityRefs: Array.isArray(parsed.entityRefs) ? parsed.entityRefs.map(String) : [],
    };
  } catch {
    return { summary: raw.slice(0, 500), entityRefs: [] };
  }
}
