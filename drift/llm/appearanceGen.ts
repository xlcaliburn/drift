import Anthropic from "@anthropic-ai/sdk";
import type { Character } from "@/shared/schemas";
import { deepseekChat, deepseekAvailable, isDeepSeekModel, resolveModel } from "./deepseek";

/**
 * Generate a short physical DESCRIPTION of a character after a remake at Chrome's
 * (shown in the Story tab). Cheap + best-effort: the caller falls back to the raw
 * hint on any failure. Second-person-free, 1-2 sentences, appearance ONLY — no
 * backstory, no stats. Built from the player's hint plus the character's traits so
 * the look reads as coherent with who they are.
 */
export async function generateAppearance(
  character: Pick<Character, "name" | "sex" | "background" | "alignment" | "bias">,
  hint: string,
  opts: { apiKey?: string; model?: string } = {},
): Promise<string> {
  const model = resolveModel(
    opts.model ?? process.env.SUMMARIZER_MODEL ?? (deepseekAvailable() ? "deepseek-v4-flash" : "claude-haiku-4-5-20251001"),
  );

  const traits = [
    character.sex ? `sex: ${character.sex}` : "",
    character.background ? `background: ${character.background}` : "",
    character.alignment ? `bearing: ${character.alignment}` : "",
    character.bias ? `leans: ${character.bias}` : "",
  ]
    .filter(Boolean)
    .join("; ");

  const system =
    "You write a SHORT third-person physical description of a space-opera character just after they've had body-modification work done. 1-2 sentences, present tense, appearance ONLY (face, build, hair, skin, notable marks or augments) — no backstory, no stats, no name repetition beyond once. Ground it in the player's request; keep it grounded and specific, not purple. Reply with the description text and nothing else.";
  const user = `Character: ${character.name}${traits ? ` (${traits})` : ""}.\nThe look they asked for: ${hint || "a subtle, clean reinvention"}.\nWrite the description.`;

  const clean = (s: string) => s.trim().replace(/^["']|["']$/g, "").slice(0, 400);

  if (isDeepSeekModel(model)) {
    const resp = await deepseekChat({
      model,
      maxTokens: 400, // headroom for hybrid-model thinking before the prose
      system: [{ type: "text", text: system }],
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content.find((b) => b.type === "text");
    return clean(text && text.type === "text" ? text.text : "");
  }
  const client = new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({ model, max_tokens: 200, system, messages: [{ role: "user", content: user }] });
  const text = resp.content.find((b) => b.type === "text");
  return clean(text && text.type === "text" ? text.text : "");
}
