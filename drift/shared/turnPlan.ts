import { z } from "zod";
import { parseInlineMenu } from "./narration";
import { VERB_LIST } from "./actions";

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

/** A skill check the engine resolves: d20 + computed modifier vs DC. `verb`
 *  (ACTIONS.md) overrides `skill` when present — the engine derives the skill,
 *  so the model can tag a typed action with a verb instead of guessing a skill. */
export const CheckSpec = z.object({
  /** Optional when `verb` is given — the engine derives the skill from the verb. */
  skill: optionalNullable(z.string().min(1)),
  verb: optionalNullable(z.enum(VERB_LIST)),
  dc: z.coerce.number().int().min(5).max(30),
  /** Only stakes=true rolls at DC 13+ earn skill ticks (levelling). */
  stakes: z.coerce.boolean().default(false),
  /** Danger level 1-5: a failed hazard check deals (0..2) × level damage. Shown
   *  to the player as ⚠ on the option BEFORE they commit; 5 can one-shot a fresh
   *  character. The engine owns the roll. */
  hazardLevel: optionalNullable(z.coerce.number().int().min(1).max(5)),
  /** Legacy dice form ("1d6") — the engine converts it to a hazard level. */
  failDamage: optionalNullable(z.string().regex(/^\s*\d+\s*(d\s*\d+)?\s*([+-]\s*\d+)?\s*$/i)),
  /** What a failure hits: "pc" (default, character HP) or "ship" (hull) —
   *  a flying/docking mishap damages the SHIP, not the pilot. Engine-clamped. */
  target: optionalNullable(z.enum(["pc", "ship"])),
  /** The RISK tier the DC was derived from (safe/risky/reckless) — carried on a
   *  resolved choice's check so the UI can show the gamble. Engine-set. */
  risk: optionalNullable(z.enum(["safe", "risky", "reckless"])),
});
export type CheckSpec = z.infer<typeof CheckSpec>;

/** An unavoidable hazard the PC (or ship) must survive THIS turn: a save (skill
 *  vs DC); on failure the engine deals (0..2) × hazardLevel to the target. */
export const DangerSpec = z.object({
  skill: z.string().min(1),
  dc: z.coerce.number().int().min(5).max(30),
  hazardLevel: optionalNullable(z.coerce.number().int().min(1).max(5)),
  /** Legacy dice form — converted to a hazard level by the engine. */
  damage: optionalNullable(z.string().regex(/^\s*\d+\s*(d\s*\d+)?\s*([+-]\s*\d+)?\s*$/i)),
  note: optionalNullable(z.string()),
  /** "pc" (default, character HP) or "ship" (hull damage — debris, a hard burn). */
  target: optionalNullable(z.enum(["pc", "ship"])),
});
export type DangerSpec = z.infer<typeof DangerSpec>;

/** A combat action carried by an engine-generated combat choice. */
export const CombatActionSpec = z.object({
  type: z.enum(["attack", "aim", "cover", "stim", "flee", "item", "switch"]),
  enemyId: optionalNullable(z.string()),
  /** For type "item": catalog id of the consumable to use. */
  itemId: optionalNullable(z.string()),
  /** For type "switch": the gear name of the weapon to draw. */
  weaponName: optionalNullable(z.string()),
});

/** A desperate act carried by an engine-generated Bleeding Out choice (death.ts).
 *  Engine-owned like CombatActionSpec — the model never authors these. */
export const DownedActionSpec = z.object({
  kind: z.enum(["hold", "cover", "item", "help"]),
  itemId: optionalNullable(z.string()),
});

/** A clickable next action. Preferred: tag an attemptable option with a `verb`
 *  (+ optional `difficulty`) — the ENGINE maps verb → skill and builds the check,
 *  so the model can't pick the wrong skill (ACTIONS.md). `check` is the legacy
 *  escape hatch for an action no verb covers; `combatAction` routes through the
 *  combat round engine. */
export const ChoiceOption = z.object({
  label: z.string().min(1).max(160),
  verb: optionalNullable(z.enum(VERB_LIST)),
  /** The gamble: safe ≈ 80% / risky ≈ 55% / reckless ≈ 30% — the ENGINE derives
   *  the DC from THIS character's odds. Preferred over `difficulty`. */
  risk: optionalNullable(z.enum(["safe", "risky", "reckless"])),
  /** Legacy fixed-DC tag (easy/normal/hard). Kept for back-compat; maps to a risk
   *  tier when `risk` is absent. */
  difficulty: optionalNullable(z.enum(["easy", "normal", "hard"])),
  check: optionalNullable(CheckSpec),
  combatAction: optionalNullable(CombatActionSpec),
  /** Set on an engine-generated Bleeding Out chip — routes the click to the
   *  death-save resolver instead of a normal turn. */
  downedAction: optionalNullable(DownedActionSpec),
  /** Set on an engine-generated "Use X" consumable chip (out of combat) — the
   *  catalog id the engine applies DETERMINISTICALLY, so a heal never depends on
   *  the model remembering to fire useItem. */
  useItemId: optionalNullable(z.string()),
  /** Set on an engine-generated "Repair hull" dock chip — the engine repairs
   *  deterministically at ¢12/HP (ECONOMY E-3). */
  repairHull: optionalNullable(z.boolean()),
  /** Set on an engine-generated "Rest up with <patron>" chip — the free early-game
   *  safety net (STARTER.md). */
  patronRest: optionalNullable(z.boolean()),
  /** Set on a full-pack SWAP chip: the carried gear name to drop to take the
   *  parked pending pickup (ITEMS.md slice B). */
  swapDrop: optionalNullable(z.string()),
  /** Set on the "leave it behind" chip that declines the pending pickup. */
  swapDecline: optionalNullable(z.boolean()),
  /** Set on a job-board chip: the job id to accept (offered → active). QUESTS.md. */
  acceptJob: optionalNullable(z.string()),
  /** Set on a job-board chip: the job id to abandon (active → failed). */
  abandonJob: optionalNullable(z.string()),
});
export type ChoiceOption = z.infer<typeof ChoiceOption>;

/** One distinct foe or group in a fight the model just narrated: a named boss is
 *  one entry (count 1, name "Calvo"); a pack of identical goons is one entry
 *  (count N, a shared name "Heavy" → engine names them "Heavy 1", "Heavy 2"…). */
export const EnemyGroupSpec = z.object({
  tier: z.enum(["T1", "T2", "T3"]),
  count: optionalNullable(z.coerce.number().int().min(1).max(4)),
  name: optionalNullable(z.string()),
  /** A NAMED boss / major antagonist — the longer fight (engine gives them a
   *  1.8× HP multiplier). A goon pack is NOT major. */
  major: optionalNullable(z.boolean()),
});
export type EnemyGroupSpec = z.infer<typeof EnemyGroupSpec>;

/** The model declaring that this beat turns into a fight. Only tier/count/scale/
 *  surprise pass through — the engine owns the stats. `enemies` describes a fight
 *  with MULTIPLE distinct foes/groups (a boss + his heavies); the legacy top-level
 *  tier/count/name still works for a single lone group. Personal scale only. */
export const CombatStartSpec = z.object({
  tier: z.enum(["T1", "T2", "T3"]),
  count: optionalNullable(z.coerce.number().int().min(1).max(4)),
  name: optionalNullable(z.string()),
  /** Multiple distinct foes/groups — one entry per named boss or goon pack (max 4
   *  groups). When present it takes precedence over the legacy tier/count/name. */
  enemies: optionalNullable(z.array(EnemyGroupSpec).min(1).max(4)),
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
  /** The player BUYS from the local market (ITEMS.md slice E). The catalog id must
   *  be on the MARKET HERE shelves; the ENGINE validates stock/credits/pack space,
   *  debits, and prints the figure — the model only narrates the counter. */
  purchase: optionalNullable(
    z.object({
      itemId: z.string().min(1),
      qty: optionalNullable(z.coerce.number().int().min(1).max(5)),
    }),
  ),
  /** The player SELLS carried gear (flat ~40% of value, engine-priced). `name`
   *  is the gear entry as listed on the PC gear line. */
  sell: optionalNullable(z.object({ name: z.string().min(1).max(60) })),
  /** The player has the ship's HULL repaired at a dock (ECONOMY E-3). `hp`
   *  optional (full patch if omitted). The ENGINE charges ¢12/HP and prints the
   *  figure; never refused for lack of funds — the balance goes negative (debt). */
  repair: optionalNullable(z.object({ hp: optionalNullable(z.coerce.number().int().min(1).max(999)) })),
  /** The player rests up with their faction PATRON (STARTER.md) — the ENGINE applies
   *  the free early-game safety net (full HP/hull, stims to a floor, a stipend when
   *  broke). Only when they're WITH the patron and still a struggling rookie. */
  patronRest: optionalNullable(z.boolean()),
  /** Rook Station body-modification (Chrome's studio): the player pays ¢500 to
   *  reshape their APPEARANCE and (optionally) weave the change into their STORY.
   *  The ENGINE charges and applies it; refused if they can't afford it or aren't
   *  at Rook. Emit only when the player has actually committed to and described it. */
  bodyMod: optionalNullable(
    z.object({
      appearance: optionalNullable(z.string().max(400)),
      story: optionalNullable(z.string().max(400)),
    }),
  ),
  /** Job/bounty/deal concluded → the ENGINE rolls the credits inside the tier's
   *  payout band (ECONOMY.md — the model never sets amounts). */
  payout: optionalNullable(
    z.object({
      tier: z.enum(["T0", "T1", "T2", "T3"]),
      reason: optionalNullable(z.string()),
    }),
  ),
  /** Monetary bids/quotes the model PRESENTS but the player hasn't taken (a job's
   *  posted pay, a rival buyer's counter-bid). An offer is a TIER, never a number —
   *  the ENGINE rolls the figure inside the tier's band and shows it. A better
   *  rival offer is a HIGHER tier. `from` labels who's offering. (ECONOMY.md —
   *  this is the anti-runaway for narrated negotiations; the model must never
   *  state a credit amount itself.) */
  offers: optionalNullable(
    z.array(
      z.object({
        tier: z.enum(["T0", "T1", "T2", "T3"]),
        from: optionalNullable(z.string()),
      }),
    ).max(3),
  ),
  /** Canon feed entry when the beat shifts a faction's standing. */
  worldEvent: optionalNullable(
    z.object({
      headline: z.string().min(1),
      detail: optionalNullable(z.string()),
      factionIds: z.array(z.string()).default([]),
    }),
  ),
  /** QUEST TRACKING (the fence-job-that-never-ended bug). OPEN a thread the moment
   *  the player takes on a real objective (a job, a hunt, a goal) so it's tracked
   *  and can't drift forgotten; RESOLVE it (by `id` from the thread list) the moment
   *  it's done or abandoned. Without this a job lives only in prose and never ends.
   *  The engine caps + dedupes; don't open a thread for trivial chatter. */
  threads: optionalNullable(
    z.array(
      z.object({
        op: z.enum(["open", "resolve"]),
        /** Required to OPEN — a short objective title ("Fence the salvage via Yoren"). */
        title: optionalNullable(z.string().max(80)),
        /** One line on what/why (open only). */
        body: optionalNullable(z.string().max(240)),
        /** Required to RESOLVE — the thread id from the "Relevant threads" list. */
        id: optionalNullable(z.string()),
      }),
    ).max(3),
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
  /** Items the player GAINED or LOST in the fiction this turn (a looted facemask,
   *  a bought crowbar, a confiscated pistol). The engine adds/removes them from
   *  gear so they persist in state and context — they never vanish when the
   *  narration scrolls away. */
  items: optionalNullable(
    z.array(
      z.object({
        name: z.string().min(1).max(60),
        action: z.enum(["gain", "lose"]).default("gain"),
        note: optionalNullable(z.string().max(120)),
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
      /** ONGOING environmental dangers active right now ("toxic coolant fog").
       *  OVERWRITES the current list — send [] when the danger is dealt with. */
      dangers: optionalNullable(z.array(z.string().min(1).max(80)).max(3)),
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

/** The stub repairTurnPlan emits when a response held NOTHING usable — exported
 *  so the turn pipeline can recognize a truly failed generation and error out
 *  (with retry) instead of quietly advancing the story on this filler. */
export const REPAIR_FALLBACK_NARRATION = "The moment holds, and the lanes keep turning around you.";

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
export function repairTurnPlan(text: string, opts?: { jsonOnly?: boolean }): TurnPlan {
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
  // JSON turns REQUIRE an object. With none found, the text is raw prose — for a
  // hybrid model that's its chain-of-thought ("We need to generate a JSON…"), NOT
  // player narration. Fail the turn (sentinel) instead of leaking the thinking.
  if (opts?.jsonOnly) return TurnPlan.parse({ narration: REPAIR_FALLBACK_NARRATION, choices: [] });
  const { narration, choices } = parseInlineMenu(text.trim());
  return TurnPlan.parse({
    // Sentinel beat when generation returned nothing salvageable. Callers treat a
    // repair that lands EXACTLY here as a FAILED turn (surface an error + retry)
    // rather than advancing the story on fabricated filler.
    narration: narration || REPAIR_FALLBACK_NARRATION,
    choices: choices.map((label) => ({ label })),
  });
}
