import { z } from "zod";
import { parseInlineMenu } from "./narration";

/**
 * Structured narrator turn — the JSON contract for cheap models.
 *
 * Rationale (learned the hard way with DeepSeek): a ~40-rule prose prompt is
 * noise to a small model, negative constraints ("never write menus") lose to its
 * AI-dungeon prior, and freeform output lets one violation contaminate history.
 * So the model fills FIELDS and the engine owns presentation and mechanics: a
 * prose menu becomes structurally impossible, choices can carry an attached
 * skill check the ENGINE rolls when clicked, and every mechanical intent
 * (world event, scene end, clock) arrives as data the engine validates.
 */

/** A skill check the engine resolves: d20 + computed modifier vs DC. */
export const CheckSpec = z.object({
  skill: z.string().min(1),
  dc: z.coerce.number().int().min(5).max(30),
  /** Only stakes=true rolls at DC 13+ earn skill ticks (levelling). */
  stakes: z.coerce.boolean().default(false),
});
export type CheckSpec = z.infer<typeof CheckSpec>;

/** A clickable next action; `check` makes clicking it roll before narration. */
export const ChoiceOption = z.object({
  label: z.string().min(1).max(160),
  check: CheckSpec.optional(),
});
export type ChoiceOption = z.infer<typeof ChoiceOption>;

/** Model may emit a bare string choice — normalize to {label}. */
const ChoiceLoose = z.preprocess(
  (v) => (typeof v === "string" ? { label: v } : v),
  ChoiceOption,
);

export const TurnPlan = z.object({
  /** The beat's prose. No option lists, no dice math — fields carry those. */
  narration: z.string().min(1),
  /** 2-4 next actions (may be empty when the scene ends). */
  choices: z.array(ChoiceLoose).max(6).default([]),
  /** A check the CURRENT player action itself requires (pre-roll not done). */
  roll: CheckSpec.optional(),
  /** Canon feed entry when the beat shifts a faction's standing. */
  worldEvent: z
    .object({
      headline: z.string().min(1),
      detail: z.string().optional(),
      factionIds: z.array(z.string()).default([]),
    })
    .optional(),
  /** Scene wrap — engine runs the checklist (wages, fees, clocks). */
  sceneEnd: z
    .object({
      title: z.string().optional(),
      paying: z.coerce.boolean().optional(),
      dockings: z.coerce.number().int().min(0).optional(),
      arrivedAtLocationId: z.string().optional(),
      combatEnded: z.coerce.boolean().optional(),
      tendaysDelta: z.coerce.number().int().min(0).optional(),
    })
    .nullish(),
  /** Advance a clock (milestones are engine-enforced). */
  clockAdvances: z
    .array(
      z.object({
        clockId: z.string().min(1),
        amount: z.coerce.number().int().min(1).max(4).default(1),
        reason: z.string().default(""),
      }),
    )
    .default([]),
});
export type TurnPlan = z.infer<typeof TurnPlan>;

/** Locate and parse the first balanced JSON object in a model response
 *  (tolerates ```json fences and prose around it). */
export function extractJsonObject(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface ParsedPlan {
  plan: TurnPlan | null;
  /** Human-readable validation error (fed back to the model on retry). */
  error?: string;
}

/** Parse + validate a model response into a TurnPlan. */
export function parseTurnPlan(text: string): ParsedPlan {
  const obj = extractJsonObject(text);
  if (obj === null) return { plan: null, error: "response contained no valid JSON object" };
  const res = TurnPlan.safeParse(obj);
  if (!res.success) {
    const issue = res.error.issues[0];
    return { plan: null, error: `${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "invalid"}` };
  }
  return { plan: res.data };
}

/**
 * Last-resort repair when the model never produced valid JSON: treat the raw
 * text as narration, strip any inline menu, and reuse its options as choices.
 * The turn stays playable; the artifact never reaches the player.
 */
export function repairTurnPlan(text: string): TurnPlan {
  const { narration, choices } = parseInlineMenu(text.trim());
  return TurnPlan.parse({
    narration: narration || "…",
    choices: choices.map((label) => ({ label })),
  });
}
