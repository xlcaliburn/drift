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

/** Optional field that ALSO tolerates the model emitting `null` (cheap models
 *  routinely write `"check": null` for "no check" — Zod's .optional() rejects
 *  null, which would fail the whole turn). Coerces null → undefined. */
const optionalNullable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === null ? undefined : v), schema.optional());

/** A skill check the engine resolves: d20 + computed modifier vs DC. */
export const CheckSpec = z.object({
  skill: z.string().min(1),
  dc: z.coerce.number().int().min(5).max(30),
  /** Only stakes=true rolls at DC 13+ earn skill ticks (levelling). */
  stakes: z.coerce.boolean().default(false),
  /** Damage the engine rolls and applies when this check FAILS — e.g. "1d6",
   *  "2d6", "8". This is how failure becomes real (and lethal). */
  failDamage: optionalNullable(z.string().regex(/^\s*\d+\s*(d\s*\d+)?\s*([+-]\s*\d+)?\s*$/i)),
  /** What the failDamage hits: "pc" (default, character HP) or "ship" (hull) —
   *  a flying/docking mishap damages the SHIP, not the pilot. Engine-clamped. */
  target: optionalNullable(z.enum(["pc", "ship"])),
});
export type CheckSpec = z.infer<typeof CheckSpec>;

/** An unavoidable hazard the PC (or ship) must survive THIS turn: a save (skill
 *  vs DC); on failure the engine rolls `damage` and applies it to the target. */
export const DangerSpec = z.object({
  skill: z.string().min(1),
  dc: z.coerce.number().int().min(5).max(30),
  damage: z.string().regex(/^\s*\d+\s*(d\s*\d+)?\s*([+-]\s*\d+)?\s*$/i),
  note: optionalNullable(z.string()),
  /** "pc" (default, character HP) or "ship" (hull damage — debris, a hard burn). */
  target: optionalNullable(z.enum(["pc", "ship"])),
});
export type DangerSpec = z.infer<typeof DangerSpec>;

/** A combat action carried by an engine-generated combat choice. */
export const CombatActionSpec = z.object({
  type: z.enum(["attack", "aim", "cover", "stim", "flee", "item"]),
  enemyId: optionalNullable(z.string()),
  /** For type "item": catalog id of the consumable to use. */
  itemId: optionalNullable(z.string()),
});

/** A clickable next action; `check` makes clicking it roll before narration;
 *  `combatAction` routes it through the combat round engine. */
export const ChoiceOption = z.object({
  label: z.string().min(1).max(160),
  check: optionalNullable(CheckSpec),
  combatAction: optionalNullable(CombatActionSpec),
});
export type ChoiceOption = z.infer<typeof ChoiceOption>;

/** The model declaring that this beat turns into a fight. Only tier/count/scale/
 *  surprise pass through — the engine owns the stats. */
export const CombatStartSpec = z.object({
  tier: z.enum(["T1", "T2", "T3"]),
  count: optionalNullable(z.coerce.number().int().min(1).max(4)),
  name: optionalNullable(z.string()),
  scale: optionalNullable(z.enum(["personal", "ship"])),
  /** For ship fights: the enemy hull class (defaults from tier). */
  shipClass: optionalNullable(z.enum(["scout", "fighter", "hauler", "gunship", "corvette"])),
  surprise: optionalNullable(z.enum(["player", "enemy", "none"])),
});
export type CombatStartSpec = z.infer<typeof CombatStartSpec>;

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
  roll: optionalNullable(CheckSpec),
  /** An unavoidable hazard the PC must survive this turn (save-or-take-damage). */
  danger: optionalNullable(DangerSpec),
  /** This beat becomes a fight — the engine spawns enemies and takes over. */
  combatStart: optionalNullable(CombatStartSpec),
  /** The player uses a consumable out of combat — the engine applies the effect. */
  useItem: optionalNullable(z.object({ itemId: z.string().min(1) })),
  /** Job/bounty/deal concluded → the ENGINE rolls the credits inside the tier's
   *  payout band (ECONOMY.md — the model never sets amounts). */
  payout: optionalNullable(
    z.object({
      tier: z.enum(["T0", "T1", "T2", "T3"]),
      reason: optionalNullable(z.string()),
    }),
  ),
  /** Canon feed entry when the beat shifts a faction's standing. */
  worldEvent: optionalNullable(
    z.object({
      headline: z.string().min(1),
      detail: optionalNullable(z.string()),
      factionIds: z.array(z.string()).default([]),
    }),
  ),
  /** Named NPCs introduced or used this turn — the engine persists new ones to the
   *  world's cast (at the current location) so they're REMEMBERED and recognized
   *  when the player returns. `disposition` nudges their standing with the player
   *  (±1, engine-clamped -3..+3); `note` overwrites their one-line last-interaction
   *  memory; `relationship` labels who they are to the player (set once). */
  npcs: optionalNullable(
    z.array(
      z.object({
        name: z.string().min(1).max(60),
        oneBreath: optionalNullable(z.string()),
        disposition: optionalNullable(z.coerce.number().int().min(-1).max(1)),
        note: optionalNullable(z.string().max(160)),
        relationship: optionalNullable(z.string().max(60)),
      }),
    ).max(4),
  ),
  /** Scene-card updates (CONTINUITY.md tier NOW): `situation` overwrites the
   *  one-line "what is happening"; `beats` appends promises/threats/agreements
   *  made this turn (engine caps both). */
  scene: optionalNullable(
    z.object({
      situation: optionalNullable(z.string().max(300)),
      beats: optionalNullable(z.array(z.string().min(1).max(200)).max(3)),
      /** Where the player IS now — set when they move somewhere the location
       *  table can't name (aboard a ship, in transit, in the black). */
      place: optionalNullable(z.string().max(120)),
    }),
  ),
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
 * Last-resort repair when validation failed. First try to salvage from the JSON
 * object itself — validation often fails on a minor field (a bad `check`) while
 * `narration`/`choices` are perfectly usable, so pull those out (dropping the
 * unparseable checks). Only if there's no usable JSON do we treat the text as raw
 * prose and strip any inline menu. Either way the player gets clean narration +
 * clickable choices; the raw JSON never reaches them.
 */
export function repairTurnPlan(text: string): TurnPlan {
  const obj = extractJsonObject(text);
  if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    if (typeof o.narration === "string" && o.narration.trim()) {
      const choices = Array.isArray(o.choices)
        ? o.choices
            .map((c) => (typeof c === "string" ? c : (c as { label?: unknown })?.label))
            .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
            .map((label) => ({ label }))
        : [];
      return TurnPlan.parse({ narration: o.narration.trim(), choices });
    }
  }
  const { narration, choices } = parseInlineMenu(text.trim());
  return TurnPlan.parse({
    // A non-empty in-fiction beat beats a bare "…" when generation returns nothing
    // (e.g. a passive "wait and watch" the model under-answered).
    narration: narration || "The moment holds, and the lanes keep turning around you.",
    choices: choices.map((label) => ({ label })),
  });
}
