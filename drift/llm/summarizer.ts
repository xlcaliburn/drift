import Anthropic from "@anthropic-ai/sdk";
import { deepseekChat, deepseekAvailable, isDeepSeekModel, resolveModel } from "./deepseek";
import { repairTruncatedJson, stripCodeFences } from "./jsonRepair";

export interface SceneSummary {
  summary: string;
  entityRefs: string[];
}

/** A character the analyst found in a closed scene — KNOWN (matches a roster id) or
 *  NEW (name only, to be registered). This is how the analyst PICKS UP figures the
 *  live turn missed (e.g. Yuri, attributed by an action beat the model never listed
 *  in npcs[]) instead of a brittle regex. */
export interface NpcAnalysis {
  /** A KNOWN NPC id if this matches one from the roster; omitted for a NEW figure. */
  id?: string;
  /** The character's name — always present (a new figure is registered under it). */
  name?: string;
  /** Where they stand in the scene: "present" = physically in the immediate area
   *  (Yuri the dockmaster you're talking to); "mentioned" = referenced/off-screen
   *  (Calvo, talked ABOUT but elsewhere). Only "present" figures are marked in the
   *  scene's Here-&-now; both are tracked in the cast. */
  presence?: "present" | "mentioned";
  /** Occupational handle ("dockmaster", "fixer") when the scene shows one. */
  role?: string;
  /** A one-line "who they REALLY are" (refreshes a placeholder / seeds a new one). */
  oneBreath?: string;
  /** One concrete beat of what passed between them and the PLAYER this scene. */
  note?: string;
  /** A short label for who they are to the player, when the scene makes it clear. */
  relationship?: string;
}

/** A prop the player legitimately came away with this scene (a gift, a keepsake) —
 *  flavor only; the engine still owns weapons/armor/valuables. */
export interface ItemAnalysis {
  name: string;
  note?: string;
}

/** A quest the analyst found the player took on (or finished) this scene — the
 *  retrospective backstop for the cheap model under-firing threads:[] live (the
 *  emergent Fingers→Yarl→loot chain that never got tracked). "open" adds an
 *  objective not already tracked; "resolve" closes a tracked one by id. */
export type ThreadAnalysis =
  | { op: "open"; title: string; body?: string }
  | { op: "resolve"; id: string };

export interface SceneAnalysis extends SceneSummary {
  npcs: NpcAnalysis[];
  items: ItemAnalysis[];
  threads: ThreadAnalysis[];
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
  ' "npcs": [ EVERY distinct CHARACTER who figured in the scene — whether or not they are in the KNOWN list, and whether they were PRESENT or only TALKED ABOUT. For each: {"name": string (their name or a short handle if unnamed — REQUIRED), "id": string (the KNOWN id ONLY if this is clearly that same person; OMIT for anyone new), "presence": "present" (physically in the immediate area — someone the player spoke to or faced) or "mentioned" (referenced/off-screen — talked ABOUT but not here, e.g. a target named by a contact), "role": string (their job/handle — "dockmaster", "fixer" — if shown), "oneBreath": string (one vivid line: who this person REALLY is, as the scene revealed them), "note": string (ONE concrete beat of what passed between THEM and the PLAYER this scene — omit for a merely-mentioned figure), "relationship": string (a SHORT label for who they are to the player — only if clear)} ],\n' +
  ' "items": [ props the PLAYER clearly came away with this scene — a gift, a token, a keepsake, a document: {"name": string, "note": string}. Do NOT list weapons, armor, ammo, or valuable gear (the game grants those separately); do NOT list things the player merely saw or wanted. Usually empty. ],\n' +
  ' "threads": [ QUEST tracking. Compare what happened against the OPEN THREADS list. If the player COMMITTED to a real objective this scene that is NOT already an open thread — a job accepted, a hunt begun, a delivery promised, a debt taken on, a target set — add {"op": "open", "title": string (short, concrete: "Loot the derelict for Yarl"), "body": string (one line: who set it and what it needs)}. If an OPEN THREAD was clearly COMPLETED or ABANDONED this scene, add {"op": "resolve", "id": string (its id from the OPEN THREADS list, exactly)}. ONLY concrete commitments or outcomes — never a vague idea or something the player merely considered. Usually 0-1 entries; omit when nothing changed. ]}\n' +
  'Ground EVERY field in what actually happened — never invent a person, item, quest, or fact. Do NOT list the player\'s own character. Omit any field you cannot fill.';

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

  // Parse, repairing a truncated object rather than persisting raw JSON — the
  // live bug: a token-capped response stored `{\n "summary": "…` VERBATIM as a
  // scene summary, and one such stub embedded a wrong PC name into canon. An
  // empty summary is the honest failure: the caller's F-3 deterministic stub
  // takes over instead of junk becoming memory.
  try {
    const unfenced = stripCodeFences(raw);
    const match = unfenced.match(/\{[\s\S]*\}/);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match ? match[0] : unfenced);
    } catch {
      const repaired = repairTruncatedJson(unfenced);
      if (!repaired) return { summary: "", entityRefs: [] };
      parsed = JSON.parse(repaired);
    }
    return {
      summary: String(parsed.summary ?? ""),
      entityRefs: Array.isArray(parsed.entityRefs) ? parsed.entityRefs.map(String) : [],
    };
  } catch {
    return { summary: "", entityRefs: [] };
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
  openThreads: { id: string; title: string }[] = [],
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
  const threadRoster = openThreads.length
    ? openThreads.map((t) => `${t.id} = ${t.title}`).join("\n")
    : "(none)";
  const user =
    `KNOWN NPCs (id = name: current description):\n${roster}\n\n` +
    `OPEN THREADS (id = title):\n${threadRoster}\n\n` +
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
  const str = (v: unknown, n: number) => (v ? String(v).trim().slice(0, n) : undefined);
  try {
    const unfenced = stripCodeFences(raw);
    const match = unfenced.match(/\{[\s\S]*\}/);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match ? match[0] : unfenced);
    } catch {
      // Truncated output — salvage the complete prefix instead of losing the
      // scene (or worse, persisting the raw JSON text as a summary).
      const repaired = repairTruncatedJson(unfenced);
      if (!repaired) throw new Error("unparseable");
      parsed = JSON.parse(repaired);
    }
    const npcUpdates: NpcAnalysis[] = (Array.isArray(parsed.npcs) ? parsed.npcs : [])
      .filter((u: unknown): u is Record<string, unknown> => !!u && typeof u === "object")
      .map((u: Record<string, unknown>): NpcAnalysis => {
        const id = u.id ? String(u.id) : undefined;
        return {
          id: id && knownIds.has(id) ? id : undefined, // only trust a REAL known id
          name: str(u.name, 60),
          presence: u.presence === "mentioned" ? "mentioned" : u.presence === "present" ? "present" : undefined,
          role: str(u.role, 40),
          oneBreath: str(u.oneBreath, 200),
          note: str(u.note, 160),
          relationship: str(u.relationship, 60),
        };
      })
      // Keep anyone we can act on: a known NPC to refresh, OR a new figure with a name.
      .filter((u: NpcAnalysis) => u.id || u.name);
    const itemUpdates: ItemAnalysis[] = (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((i: unknown): i is Record<string, unknown> => !!i && typeof i === "object")
      .map((i: Record<string, unknown>) => ({ name: str(i.name, 60) ?? "", note: str(i.note, 120) }))
      .filter((i: ItemAnalysis) => i.name)
      .slice(0, 4);
    const threadUpdates: ThreadAnalysis[] = (Array.isArray(parsed.threads) ? parsed.threads : [])
      .filter((t: unknown): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t: Record<string, unknown>): ThreadAnalysis | null => {
        if (t.op === "open") {
          const title = str(t.title, 80);
          return title ? { op: "open", title, body: str(t.body, 200) } : null;
        }
        if (t.op === "resolve") {
          const id = str(t.id, 80);
          return id ? { op: "resolve", id } : null;
        }
        return null;
      })
      .filter((t: ThreadAnalysis | null): t is ThreadAnalysis => t !== null)
      .slice(0, 3);
    return {
      summary: String(parsed.summary ?? ""),
      entityRefs: Array.isArray(parsed.entityRefs) ? parsed.entityRefs.map(String) : [],
      npcs: npcUpdates,
      items: itemUpdates,
      threads: threadUpdates,
    };
  } catch {
    // Empty summary = honest failure: the caller's deterministic F-3 stub takes
    // over. Never persist raw model text as memory.
    return { summary: "", entityRefs: [], npcs: [], items: [], threads: [] };
  }
}
