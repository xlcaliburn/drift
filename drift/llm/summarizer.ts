import Anthropic from "@anthropic-ai/sdk";
import { deepseekChat, deepseekAvailable, isDeepSeekModel, resolveModel } from "./deepseek";

export interface SceneSummary {
  summary: string;
  entityRefs: string[];
}

/** Per-NPC continuity update the analyst extracts from a closed scene. */
export interface NpcAnalysis {
  /** Must match a known NPC id from the provided list. */
  id: string;
  /** A refreshed one-line "who they REALLY are" — upgrades a thin/placeholder
   *  oneBreath once the scene has revealed the character. */
  oneBreath?: string;
  /** One concrete beat of what passed between this NPC and the PLAYER this scene
   *  (→ the relationship log), from the player's side. */
  note?: string;
  /** A short label for who they are to the player if the scene makes it clear
   *  ("partner", "fixer contact", "romantic interest"). */
  relationship?: string;
}

export interface SceneAnalysis extends SceneSummary {
  npcs: NpcAnalysis[];
}

const SYSTEM =
  "You compress TTRPG scenes. Reply ONLY with JSON: {\"summary\": string (2-3 sentences, past tense, concrete outcomes), \"entityRefs\": string[] (ids from the provided list that appeared)}.";

/**
 * The richer SCENE ANALYST system prompt (CONTINUITY). Beyond a summary, it reads
 * the scene for lasting continuity: which NPCs meaningfully appeared, a refreshed
 * one-line identity for each (so a placeholder like "Spoke with the player." can
 * be replaced with who they REALLY are), one concrete relationship beat with the
 * player, and — when clear — what they are TO the player now.
 */
const ANALYST_SYSTEM =
  'You are a TTRPG continuity analyst. Read the scene and reply ONLY with JSON:\n' +
  '{"summary": string (2-3 sentences, past tense, concrete outcomes),\n' +
  ' "entityRefs": string[] (ids from the KNOWN list that appeared),\n' +
  ' "npcs": [{"id": string (a KNOWN id), "oneBreath": string (one vivid line — who this person REALLY is, as the scene revealed them; refresh a vague/placeholder description), "note": string (ONE concrete beat of what passed between THEM and the PLAYER this scene, from the player\'s side, past tense), "relationship": string (a SHORT label for who they are to the player now — "partner", "fixer contact", "romantic interest" — only if the scene makes it clear)}]}\n' +
  'Only include an NPC in "npcs" if they genuinely took part. Ground every field in what actually happened — never invent. Omit a field you cannot fill.';

function defaultSummarizerModel() {
  return (
    process.env.SUMMARIZER_MODEL ??
    (deepseekAvailable() ? "deepseek-v4-flash" : "claude-haiku-4-5-20251001")
  );
}

/** Analyst model — a slower REASONING model by default (this runs in the
 *  background on scene close, so latency doesn't matter and depth is worth it).
 *  Configurable; falls back to the summarizer default, then Haiku. */
function defaultAnalystModel() {
  return (
    process.env.SCENE_ANALYST_MODEL ??
    (deepseekAvailable() ? "deepseek-reasoner" : "claude-haiku-4-5-20251001")
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
  const primary = resolveModel(opts.model ?? defaultSummarizerModel());
  const user = `Known entity ids: ${knownEntityIds.join(", ")}\n\nScene transcript:\n${transcript}`;

  // Cheapest model first; if it errors at runtime (e.g. DeepSeek 402), fall back
  // to Haiku before giving up. A summarizer failure would otherwise lose the
  // scene summary + entity refs entirely.
  const candidates = [primary];
  if (isDeepSeekModel(primary) && process.env.ANTHROPIC_API_KEY) {
    candidates.push("claude-haiku-4-5-20251001");
  }

  async function callModel(model: string): Promise<string> {
    if (isDeepSeekModel(model)) {
      const resp = await deepseekChat({
        model,
        maxTokens: 800, // headroom for hybrid-model thinking before the JSON
        system: [{ type: "text", text: SYSTEM }],
        messages: [{ role: "user", content: user }],
      });
      const text = resp.content.find((b) => b.type === "text");
      return text && text.type === "text" ? text.text : "{}";
    }
    const client = new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content.find((b) => b.type === "text");
    return text && text.type === "text" ? text.text : "{}";
  }

  let raw = "{}";
  for (const model of candidates) {
    try {
      raw = await callModel(model);
      break;
    } catch (e) {
      console.error(`[summarizer] model ${model} failed:`, e instanceof Error ? e.message : e);
    }
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

/**
 * SCENE ANALYST — a richer, slower pass than summarizeScene (CONTINUITY). Runs in
 * the background on scene close, so it uses a reasoning model by default and reads
 * the scene for lasting memory: the summary + which entities appeared PLUS per-NPC
 * continuity updates (a refreshed identity, one relationship beat, an evolved
 * label). The caller applies the NPC updates to the shared cast + the relationship
 * log. Best-effort: on any failure it degrades to a plain summary (npcs: []).
 */
export async function analyzeScene(
  transcript: string,
  npcs: { id: string; name: string; oneBreath: string }[],
  entityIds: string[],
  opts: { apiKey?: string; model?: string } = {},
): Promise<SceneAnalysis> {
  const primary = resolveModel(opts.model ?? defaultAnalystModel());
  const candidates = [primary];
  // Robust fallback chain: reasoner → flash → Haiku, so a scene is never lost to a
  // model that isn't provisioned on this key.
  if (isDeepSeekModel(primary)) candidates.push("deepseek-v4-flash");
  if (process.env.ANTHROPIC_API_KEY) candidates.push("claude-haiku-4-5-20251001");

  const roster = npcs.length
    ? npcs.map((n) => `${n.id} = ${n.name}: ${n.oneBreath}`).join("\n")
    : "(none)";
  const user =
    `KNOWN NPCs (id = name: current description):\n${roster}\n\n` +
    `Other known entity ids (factions/locations): ${entityIds.join(", ")}\n\n` +
    `Scene transcript:\n${transcript}`;

  async function callModel(model: string): Promise<string> {
    if (isDeepSeekModel(model)) {
      const resp = await deepseekChat({
        model,
        maxTokens: 1400, // reasoning headroom + a richer JSON payload
        system: [{ type: "text", text: ANALYST_SYSTEM }],
        messages: [{ role: "user", content: user }],
      });
      const text = resp.content.find((b) => b.type === "text");
      return text && text.type === "text" ? text.text : "{}";
    }
    const client = new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model,
      max_tokens: 700,
      system: ANALYST_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content.find((b) => b.type === "text");
    return text && text.type === "text" ? text.text : "{}";
  }

  let raw = "{}";
  for (const model of candidates) {
    try {
      raw = await callModel(model);
      break;
    } catch (e) {
      console.error(`[analyst] model ${model} failed:`, e instanceof Error ? e.message : e);
    }
  }

  const knownIds = new Set(npcs.map((n) => n.id));
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const npcUpdates: NpcAnalysis[] = Array.isArray(parsed.npcs)
      ? parsed.npcs
          .filter((u: unknown): u is Record<string, unknown> => !!u && typeof u === "object")
          .map((u: Record<string, unknown>) => ({
            id: String(u.id ?? ""),
            oneBreath: u.oneBreath ? String(u.oneBreath).trim().slice(0, 200) : undefined,
            note: u.note ? String(u.note).trim().slice(0, 160) : undefined,
            relationship: u.relationship ? String(u.relationship).trim().slice(0, 60) : undefined,
          }))
          .filter((u: NpcAnalysis) => knownIds.has(u.id) && (u.oneBreath || u.note || u.relationship))
      : [];
    return {
      summary: String(parsed.summary ?? ""),
      entityRefs: Array.isArray(parsed.entityRefs) ? parsed.entityRefs.map(String) : [],
      npcs: npcUpdates,
    };
  } catch {
    return { summary: raw.slice(0, 500), entityRefs: [], npcs: [] };
  }
}
