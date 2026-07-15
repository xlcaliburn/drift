import Anthropic from "@anthropic-ai/sdk";
import type { CampaignState, Character } from "@/shared/schemas";
import type { ChatEntry } from "@/shared/chat";
import { liveRng, type RNG } from "@/engine";
import { TurnRuntime } from "./engineBridge";
import { extractJsonObject } from "./deepseek";
import { AppealRuling, type AppealAdjustment } from "@/shared/appeal";
import { dispositionLabel, DISPOSITION_MIN, DISPOSITION_MAX, type SceneCard, type NpcRelations } from "@/shared/scene";

/** The strong judge — a genuine dispute deserves the good model. */
const APPEAL_MODEL = "claude-sonnet-5";
/** How much recent transcript the judge sees (≈ the last ~10 scenes of play). */
const APPEAL_TRANSCRIPT_ENTRIES = 60;
/** Sanity clamp on a single credit correction (the engine still floors at 0). */
const APPEAL_CREDIT_CAP = 5000;

export interface AppealInput {
  state: CampaignState;
  transcript: ChatEntry[];
  appealText: string;
  sceneCard?: SceneCard;
  npcRelations?: NpcRelations;
  rng?: RNG;
  apiKey?: string;
}

export interface AppealResult {
  /** Player-facing ruling prose (shown as the DM line). */
  ruling: string;
  granted: boolean;
  /** Prefixed system lines for each applied adjustment (⚖ …). */
  engineLines: string[];
  state: CampaignState;
  npcRelations: NpcRelations;
  model: string;
  promptDump: string;
  exchangeDump: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  latencyMs: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const APPEAL_SYSTEM = `You are the APPEALS JUDGE for DRIFT, a space-opera TTRPG. In DRIFT the ENGINE owns all mechanics (HP, credits, items, dice, standing) and a routine narrator writes the prose. Sometimes they DESYNC: the prose says something happened (an NPC handed the player a stim, a payment landed, they dodged a hit) but the engine never recorded it — or recorded something the fiction didn't support. A player is APPEALING such an outcome.

Your job: read the recent play + the current character sheet, judge whether the appeal has MERIT, and if so return the engine-legal CORRECTION.

RULES:
- Ground every ruling in what the TRANSCRIPT actually established. Grant only what the fiction genuinely supports — an NPC clearly gave them the item, a job clearly concluded, the hit clearly missed. If the fiction never established it (the player just wants free stuff), DENY it (granted:false, no adjustments).
- Be fair but not a pushover. A plausible, fiction-supported correction is granted; a wishlist is denied. When in doubt and the stakes are small (a stim, minor HP), lean toward granting; for large sums or big gear, require clear fictional support.
- The engine re-clamps everything (HP ≤ max, credits ≥ 0, standing ∈ [-3,3]), so propose the CORRECT end-state, not an exaggeration.

Output ONLY a JSON object (no prose around it):
{
  "granted": boolean,
  "ruling": "2-4 sentences, second person, explaining the decision to the player",
  "adjustments": [ ... ]   // [] when denied
}
Adjustment kinds (use the fewest that fix it):
  {"kind":"grantItem","name":"stim","qty":1}          // qty 1-5; use catalog names when you can (stim, medkit)
  {"kind":"removeItem","name":"..."}
  {"kind":"adjustHp","delta":6}                         // + heal, - damage
  {"kind":"adjustCredits","delta":400}                  // + or -
  {"kind":"adjustStims","delta":1}
  {"kind":"adjustDisposition","npc":"Draven","delta":1} // npc by name; delta ±1..±3
  {"kind":"clearInjury","name":"Downed"}`;

function sheet(state: CampaignState): string {
  const pc = state.characters.find((c) => c.kind === "pc");
  if (!pc) return "(no character)";
  const gear = (pc.gear ?? [])
    .map((g) => `${g.name}${g.qty && g.qty > 1 ? ` ×${g.qty}` : ""}`)
    .join(", ");
  const inj = (pc.injuries ?? []).map((i) => i.name).join(", ") || "none";
  return [
    `${pc.name} — HP ${pc.hp}/${pc.maxHp}, ¢${pc.credits ?? 0}, stims ${pc.stims ?? 0}`,
    `Gear: ${gear || "(empty)"}`,
    `Injuries: ${inj}`,
  ].join("\n");
}

function presentNpcs(state: CampaignState, sceneCard?: SceneCard): string {
  const ids = sceneCard?.presentNpcIds ?? [];
  const names = ids
    .map((id) => state.npcs.find((n) => n.id === id)?.name)
    .filter(Boolean);
  return names.length ? `Present: ${names.join(", ")}` : "";
}

function resolveNpcId(state: CampaignState, ref: string): string | undefined {
  const lc = ref.trim().toLowerCase();
  return state.npcs.find((n) => n.id === lc || n.name.toLowerCase() === lc)?.id;
}

/** Apply one adjustment through the runtime, returning a ⚖ display line (or null). */
function applyAdjustment(rt: TurnRuntime, adj: AppealAdjustment): string | null {
  const pc = rt.state.characters.find((c) => c.kind === "pc");
  if (!pc) return null;
  const setPc = (patch: (c: Character) => Character) => {
    rt.state = {
      ...rt.state,
      characters: rt.state.characters.map((c) => (c.id === pc.id ? patch(c) : c)),
    };
  };
  switch (adj.kind) {
    case "grantItem": {
      // An appeal is an AUTHORIZED grant — legitimise the turn so the gear gate
      // (which blocks free weapons from the narrator) lets it through.
      rt.markQuestCompleted();
      let line: string | null = null;
      for (let i = 0; i < (adj.qty ?? 1); i++) line = rt.applyGearChange(adj.name, "gain", "appeal ruling");
      return line ? `⚖ ${line.replace(/^🎒\s*/, "")}` : `⚖ Granted ${adj.name}`;
    }
    case "removeItem": {
      const line = rt.applyGearChange(adj.name, "lose");
      return line ? `⚖ ${line.replace(/^🎒\s*/, "")}` : null;
    }
    case "adjustHp": {
      const before = pc.hp;
      const to = clamp(before + adj.delta, 0, pc.maxHp);
      if (to === before) return null;
      setPc((c) => ({
        ...c,
        hp: to,
        injuries: to > 0 ? (c.injuries ?? []).filter((i) => i.name !== "Downed") : c.injuries,
      }));
      return `⚖ HP ${before} → ${to}`;
    }
    case "adjustCredits": {
      const before = pc.credits ?? 0;
      const to = Math.max(0, before + clamp(adj.delta, -APPEAL_CREDIT_CAP, APPEAL_CREDIT_CAP));
      if (to === before) return null;
      setPc((c) => ({ ...c, credits: to }));
      return `⚖ Credits ${before} → ${to} (¢${to - before >= 0 ? "+" : ""}${to - before})`;
    }
    case "adjustStims": {
      const before = pc.stims ?? 0;
      const to = Math.max(0, before + adj.delta);
      if (to === before) return null;
      setPc((c) => ({ ...c, stims: to }));
      return `⚖ Stims ${before} → ${to}`;
    }
    case "adjustDisposition": {
      const npcId = resolveNpcId(rt.state, adj.npc);
      if (!npcId) return null;
      const rel = rt.npcRelations[npcId] ?? { disposition: 0 };
      const before = rel.disposition;
      const to = clamp(before + adj.delta, DISPOSITION_MIN, DISPOSITION_MAX);
      if (to === before) return null;
      rel.disposition = to;
      rt.npcRelations[npcId] = rel;
      const name = rt.state.npcs.find((n) => n.id === npcId)?.name ?? adj.npc;
      return `⚖ ${name}: ${dispositionLabel(before)} → ${dispositionLabel(to)}`;
    }
    case "clearInjury": {
      const lc = adj.name.trim().toLowerCase();
      const had = (pc.injuries ?? []).some((i) => i.name.toLowerCase() === lc);
      if (!had) return null;
      const reviving = lc === "downed" || lc === "dead";
      setPc((c) => ({
        ...c,
        injuries: (c.injuries ?? []).filter((i) => i.name.toLowerCase() !== lc),
        hp: reviving ? Math.max(1, c.hp) : c.hp,
      }));
      return `⚖ Cleared: ${adj.name}`;
    }
  }
}

/** Apply a ruling's adjustments to a fresh runtime — pure w.r.t. the args (returns
 *  new state/relations + the ⚖ display lines). Exposed for testing + reuse. */
export function applyAppealAdjustments(
  state: CampaignState,
  adjustments: AppealAdjustment[],
  opts?: { sceneCard?: SceneCard; npcRelations?: NpcRelations; rng?: RNG },
): { state: CampaignState; npcRelations: NpcRelations; lines: string[] } {
  const rt = new TurnRuntime(state, opts?.rng ?? liveRng, {
    sceneCard: opts?.sceneCard,
    npcRelations: opts?.npcRelations,
  });
  const lines: string[] = [];
  for (const adj of adjustments) {
    const line = applyAdjustment(rt, adj);
    if (line) lines.push(line);
  }
  return { state: rt.state, npcRelations: rt.npcRelations, lines };
}

/**
 * Run an APPEAL: assemble the recent play + the character sheet + the request, ask
 * Sonnet to rule, then apply the engine-legal corrections it returns. Auto-applied;
 * the caller logs it for review.
 */
export async function runAppealTurn(input: AppealInput): Promise<AppealResult> {
  const startedAt = Date.now();
  const rng = input.rng ?? liveRng;
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  const recent = input.transcript
    .slice(-APPEAL_TRANSCRIPT_ENTRIES)
    .map((e) => `${e.role === "player" ? "PLAYER" : e.role === "dm" ? "DM" : "ENGINE"}: ${e.text}`)
    .join("\n");
  const user =
    `RECENT PLAY (oldest→newest — DM prose and ENGINE system lines interleaved):\n${recent}\n\n` +
    `CURRENT CHARACTER SHEET (the engine's truth right now):\n${sheet(input.state)}\n${presentNpcs(input.state, input.sceneCard)}\n\n` +
    `THE PLAYER'S APPEAL:\n"${input.appealText}"\n\n` +
    `Rule on it. Return ONLY the JSON object.`;
  const promptDump = `=== APPEAL SYSTEM ===\n${APPEAL_SYSTEM}\n\n=== USER ===\n${user}`;

  const anthropic = new Anthropic({ apiKey: input.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const resp = await anthropic.messages.create({
    model: APPEAL_MODEL,
    max_tokens: 900,
    system: APPEAL_SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  usage.inputTokens += resp.usage.input_tokens;
  usage.outputTokens += resp.usage.output_tokens;
  usage.cacheReadTokens += resp.usage.cache_read_input_tokens ?? 0;
  const raw = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");

  // Parse the verdict; a malformed judge response is a safe DENY (never a mystery grant).
  const parsed = AppealRuling.safeParse(JSON.parse(extractJsonObject(raw) ?? "null"));
  const ruling = parsed.success
    ? parsed.data
    : { granted: false, ruling: "The appeal couldn't be adjudicated cleanly — nothing was changed. Try rephrasing what you believe should have happened.", adjustments: [] as AppealAdjustment[] };

  const applied = ruling.granted
    ? applyAppealAdjustments(input.state, ruling.adjustments, {
        sceneCard: input.sceneCard,
        npcRelations: input.npcRelations,
        rng,
      })
    : { state: input.state, npcRelations: input.npcRelations ?? {}, lines: [] };

  return {
    ruling: ruling.ruling,
    granted: ruling.granted && applied.lines.length > 0,
    engineLines: applied.lines,
    state: applied.state,
    npcRelations: applied.npcRelations,
    model: APPEAL_MODEL,
    promptDump,
    exchangeDump: `[APPEAL] ${input.appealText}\n\n[RULING]\n${raw}`,
    usage,
    latencyMs: Date.now() - startedAt,
  };
}
