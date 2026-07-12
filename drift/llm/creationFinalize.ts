import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Character } from "@/shared/schemas";
import type { CreationInput } from "@/shared/multiplayer";
import { factionBriefs } from "@/content/briefs";
import { suggestName, exampleMoralCodes } from "@/content/examples";
import { openingFor, type GeneratedOpening } from "@/content/openings";
import { deepseekChat, deepseekAvailable, isDeepSeekModel, resolveModel } from "./deepseek";

/**
 * Post-creation AI pass: turn the questionnaire answers + computed sheet into a
 * personalized backstory and voice, INVENT any optional flavor the player left
 * blank (the line they won't cross, a loss, a tie, a tell), and sanity-check the
 * free-text fields (name, moral code, signature) — flagging problems with a
 * canon-fitting suggestion but never overriding the player's choice. One cheap
 * call (DeepSeek, else Haiku), with a deterministic fallback so creation still
 * works with no API key.
 */

export type CreationNoteField = "name" | "moralCode" | "uniqueSkill";

export interface CreationNote {
  field: CreationNoteField;
  severity: "ok" | "warn";
  /** Player-facing explanation of the issue. */
  message: string;
  /** Concrete canon-fitting alternative the player may accept (name field). */
  suggestion?: string;
}

export interface CreationFinalize {
  backstory: string;
  /** The character's line-they-won't-cross — verbatim if given, else invented. */
  moralCode: string;
  /** 1-2 sentences of personality/voice for playing them (esp. as an NPC). */
  voiceNotes: string;
  notes: CreationNote[];
  /** Personalized cold-open (context + starting quest) generated from the
   *  faction's starting points. Undefined → newCampaign uses the static opening. */
  opening?: GeneratedOpening;
}

const SYSTEM = `You finalize a newly created player character for DRIFT, a gritty, lawless space-opera TTRPG set among three stations (Meridian Ring, Rook, Talos) and the dead lanes between them. Consequences stick; nobody is coming to save anyone.

You are given the player's creation answers and their computed sheet. Some flavor fields may be marked (blank) — the player skipped them. Do the following:

1. BACKSTORY: Write 2-4 sentences of second-person ("You...") backstory that weave the character's faction, background, ambition, and signature into one specific person in this world — and fold in their flavor (the line they won't cross, a loss, a tie, a tell), INVENTING fitting ones for any left (blank). Concrete and grounded — a real history, not a vibe. No stats, no rules talk.

2. MORAL CODE: Return the character's line-they-won't-cross as "moralCode" — verbatim if they gave one, otherwise a short, fitting one you invent (e.g. "people aren't cargo").

3. VOICE: Return "voiceNotes" — 1-2 sentences on how they carry themselves (tone, manner, their tell), usable to play them consistently as an NPC.

4. REVIEW the player-provided free-text and flag genuine problems only (do not nitpick, and do NOT flag fields left blank — you are inventing those):
   - name: flag if it reads like a gamer handle/username (digits, leetspeak, all-lowercase-no-surname, underscores) rather than a person the lanes would name. Provide a canon-fitting SUGGESTION (a real-sounding name).
   - moralCode: only if the player PROVIDED one, flag if it isn't actually a line-you-won't-cross or contradicts the character.
   - uniqueSkill: flag if the trigger scenario is too broad/overpowered to adjudicate (e.g. "any fight", "whenever I want") or too vague. Suggest narrowing to one clear situation.

5. OPENING: Using the STARTING SITUATION block (the faction's live setup and candidate leads), write a customized cold-open for THIS character. Return "opening":
   - "situation": 1-2 sentences of present-tense context — the scene they are standing in RIGHT NOW. Drop them into the faction's live tension and tie in their ambition or background; name an anchor NPC or place where natural. Do NOT restate their backstory; this is where they are, not who they were. No stats.
   - "questTitle": a short, concrete first-quest title that is a GOAL (e.g. "Collect the Vantry debt", "Get aboard the salvage run") — never a generic "earn your place".
   - "questBody": 2-3 sentences framing that first job — what to do, who's involved, and the choice or risk it poses — drawn from the candidate leads and fitted to this character.
   Pick and personalize ONE lead; stay inside the given canon (don't invent new stations/factions).

Reply ONLY with JSON, no prose:
{"backstory": string, "moralCode": string, "voiceNotes": string, "notes": [{"field": "name"|"moralCode"|"uniqueSkill", "severity": "ok"|"warn", "message": string, "suggestion"?: string}], "opening": {"situation": string, "questTitle": string, "questBody": string}}
Only include a note when severity is "warn". Return "notes": [] if everything is fine.`;

function cheapModel() {
  return (
    process.env.SUMMARIZER_MODEL ??
    (deepseekAvailable() ? "deepseek-chat" : "claude-haiku-4-5-20251001")
  );
}

/** Stable [0,1) seed from a string, so the fallback name suggestion is testable. */
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Heuristic name check used for the no-API fallback and as a safety net. */
function looksLikeHandle(name: string): boolean {
  const n = name.trim();
  return (
    /\d/.test(n) || // digits
    /_/.test(n) || // underscores
    /(.)\1{2,}/i.test(n) || // 3+ repeated chars (killll, xXx)
    (!/\s/.test(n) && n === n.toLowerCase() && n.length > 3) // one all-lowercase token
  );
}

function fallback(input: CreationInput, character: Character): CreationFinalize {
  const notes: CreationNote[] = [];
  if (looksLikeHandle(input.name)) {
    notes.push({
      field: "name",
      severity: "warn",
      message:
        "That name reads more like a handle than a person. The lanes would call someone like you by a real name.",
      suggestion: suggestName(seedFrom(input.name)),
    });
  }
  // No AI: keep the player's line if given, else pick a deterministic default.
  const moralCode =
    input.flavor.moralCode?.trim() ||
    exampleMoralCodes[Math.floor(seedFrom(input.name) * exampleMoralCodes.length)];
  return { backstory: character.backstory ?? "", moralCode, voiceNotes: "", notes };
}

export async function finalizeCreation(
  input: CreationInput,
  character: Character,
): Promise<CreationFinalize> {
  const factionName =
    factionBriefs.find((f) => f.factionId === input.parentFactionId)?.name ?? input.parentFactionId;

  const sig =
    input.uniqueSkill.kind === "passive"
      ? `passive +${input.uniqueSkill.passiveAmount} to ${input.uniqueSkill.passiveTarget}`
      : `nat-20 trigger when: ${input.uniqueSkill.triggerScenario}`;

  const blank = (v?: string) => (v && v.trim() ? v.trim() : "(blank)");

  // Faction "starting points" — hardcoded canon that seeds the opening the model
  // writes. Absent only for a faction with no authored opening (then no OPENING
  // block is sent and newCampaign falls back to its static/generic opening).
  const factionOpening = openingFor(input.parentFactionId);
  const seed = factionOpening?.seed;
  // Starting mobility, so the cold-open never implies they own a ship they don't:
  // a faction loaner (flown, not owned) or no ship at all (begs/borrows passage).
  const mobility = factionOpening?.loaner
    ? `They fly ${factionOpening.loaner.name}, a ${factionName} LOANER they do NOT own yet — the faction can pull it; the title is earned later. Don't call it "yours".`
    : "They have NO ship yet — they beg and borrow passage. Don't give them a ship in the opening.";
  const startingSituation = seed
    ? `
--- STARTING SITUATION (${factionName}) — build the OPENING from this ---
Their standing: a brand-new, LOW-LEVEL minion of ${factionName} with little pull — unproven, treated as such.
Starting mobility: ${mobility}
Where they are RIGHT NOW (set the opening here): ${seed.startLocation}
Faction wants from a recruit: ${seed.recruitGoal}
Anchors (use these; don't invent new ones): ${seed.anchors}
Live tension: ${seed.tension}
Candidate leads (pick and personalize ONE): ${seed.leads.map((l) => `(${l})`).join(" ")}`
    : "";

  const user = `Faction: ${factionName}
Background: ${input.background}
Focus: ${input.bias}
Code lean: ${input.alignment}
Ambition: ${input.ambition}
Name (free text): ${input.name}
Signature "${input.uniqueSkill.name}" (free text): ${input.uniqueSkill.description} — ${sig}
Starting skills: ${character.skills.map((s) => `${s.name} ${s.level}`).join(", ")}
--- Optional flavor (invent any marked (blank)) ---
Line they won't cross: ${blank(input.flavor.moralCode)}
A loss/scar: ${blank(input.flavor.loss)}
A debt/tie: ${blank(input.flavor.tie)}
A tell/mannerism: ${blank(input.flavor.tell)}${startingSituation}`;

  // Try the cheapest model first; if it errors at runtime (e.g. DeepSeek 402
  // insufficient balance), fall back to Anthropic Haiku before giving up on the
  // AI pass entirely. Only then use the deterministic fallback.
  const primary = resolveModel(cheapModel());
  const candidates = [primary];
  if (isDeepSeekModel(primary) && process.env.ANTHROPIC_API_KEY) {
    candidates.push("claude-haiku-4-5-20251001");
  }

  let raw: string | null = null;
  for (const model of candidates) {
    try {
      if (isDeepSeekModel(model)) {
        const resp = await deepseekChat({
          model,
          maxTokens: 800,
          system: [{ type: "text", text: SYSTEM }],
          messages: [{ role: "user", content: user }],
        });
        const text = resp.content.find((b) => b.type === "text");
        raw = text && text.type === "text" ? text.text : "{}";
      } else {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const resp = await client.messages.create({
          model,
          max_tokens: 800,
          system: SYSTEM,
          messages: [{ role: "user", content: user }],
        });
        const text = resp.content.find((b) => b.type === "text");
        raw = text && text.type === "text" ? text.text : "{}";
      }
      break; // success
    } catch (e) {
      console.error(`[creationFinalize] model ${model} failed:`, e instanceof Error ? e.message : e);
    }
  }

  if (raw === null) {
    console.error("[creationFinalize] all models failed, using deterministic fallback");
    return fallback(input, character);
  }

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const backstory = String(parsed.backstory ?? "").trim() || (character.backstory ?? "");
    const moralCode =
      String(parsed.moralCode ?? "").trim() ||
      input.flavor.moralCode?.trim() ||
      exampleMoralCodes[Math.floor(seedFrom(input.name) * exampleMoralCodes.length)];
    const voiceNotes = String(parsed.voiceNotes ?? "").trim();
    const rawNotes = Array.isArray(parsed.notes) ? parsed.notes : [];
    const notes: CreationNote[] = rawNotes
      .filter((n: unknown): n is Record<string, unknown> => !!n && typeof n === "object")
      .filter((n: Record<string, unknown>) => n.severity === "warn")
      .filter((n: Record<string, unknown>) =>
        ["name", "moralCode", "uniqueSkill"].includes(String(n.field)),
      )
      .map((n: Record<string, unknown>) => ({
        field: n.field as CreationNoteField,
        severity: "warn" as const,
        message: String(n.message ?? ""),
        suggestion: n.suggestion ? String(n.suggestion) : undefined,
      }))
      .filter((n: CreationNote) => n.message.length > 0);

    // Safety net: if the model missed an obvious handle, add the heuristic note.
    if (!notes.some((n) => n.field === "name") && looksLikeHandle(input.name)) {
      notes.push(fallback(input, character).notes.find((n) => n.field === "name")!);
    }

    // Personalized cold-open — only accept it if all three parts came back
    // non-empty; otherwise leave it undefined and let newCampaign use the static
    // faction opening (a half-built opening is worse than the solid fallback).
    let opening: GeneratedOpening | undefined;
    const o = parsed.opening;
    if (o && typeof o === "object") {
      const situation = String(o.situation ?? "").trim();
      const questTitle = String(o.questTitle ?? "").trim();
      const questBody = String(o.questBody ?? "").trim();
      if (situation && questTitle && questBody) opening = { situation, questTitle, questBody };
    }

    return { backstory, moralCode, voiceNotes, notes, opening };
  } catch (e) {
    console.error("[creationFinalize] response parse failed, using fallback:", e);
    return fallback(input, character);
  }
}
