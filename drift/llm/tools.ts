import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tool definitions handed to the narrator. The LLM proposes mechanics by
 * calling these; the engine (engineBridge.ts) executes them deterministically
 * and returns results. The LLM never does math itself.
 */
export const tools: Anthropic.Tool[] = [
  {
    name: "roll_check",
    description:
      "Roll a skill check for a character. Use for any uncertain action with stakes. The engine applies the precomputed modifier and returns the full breakdown. Set stakes=true only when failure has real consequences (required for tick eligibility).",
    input_schema: {
      type: "object",
      properties: {
        characterId: { type: "string", description: "e.g. 'vess', 'denna', 'josen'" },
        skill: { type: "string", description: "skill/action key, e.g. 'piloting', 'gunnery', 'streetwise', 'shipSensors', 'deathSave'" },
        dc: { type: "integer", description: "difficulty class before ship modifiers" },
        stakes: { type: "boolean" },
        situationalMod: { type: "integer", description: "one-off modifier (assist, cover). Optional." },
        useShipDcModifier: { type: "boolean", description: "apply the ship's DC modifier (racing thrusters -2) for piloting checks" },
        reason: { type: "string" },
      },
      required: ["characterId", "skill", "dc"],
    },
  },
  {
    name: "resolve_attack",
    description:
      "Resolve one attack. For ship combat, target an enemy spawned by spawn_encounter (by id) or 'lark'. Applies the interaction matrix, shields, PD, and crit rules.",
    input_schema: {
      type: "object",
      properties: {
        attackerSide: { type: "string", enum: ["player", "enemy"] },
        scale: { type: "string", enum: ["ship", "personal"] },
        attackerId: { type: "string", description: "'lark' / character id / enemy id — used to source the attack modifier" },
        attackMod: { type: "integer", description: "override the attack modifier if the attacker has no stored one" },
        weaponType: { type: "string", enum: ["kinetic", "energy", "missile", "ion"] },
        damage: { type: "string", description: "dice, e.g. '2d8'" },
        targetId: { type: "string" },
      },
      required: ["attackerSide", "scale", "weaponType", "damage", "targetId"],
    },
  },
  {
    name: "spawn_encounter",
    description:
      "Instantiate statted enemies from the tier/class tables within budget. Enforces the ramp rule (first encounter with a new tier = 1-2 ships). Returns enemy ids to target with resolve_attack.",
    input_schema: {
      type: "object",
      properties: {
        composition: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tier: { type: "string", enum: ["T1", "T2", "T3"] },
              shipClass: { type: "string", enum: ["scout", "fighter", "hauler", "gunship", "corvette"] },
              name: { type: "string" },
            },
            required: ["tier"],
          },
        },
      },
      required: ["composition"],
    },
  },
  {
    name: "adjust_resource",
    description: "Apply a validated change to a resource: hp, credits, stims, ammo/missiles, loyalty.",
    input_schema: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "character id or 'lark'" },
        field: { type: "string", enum: ["hp", "credits", "stims", "missiles", "loyalty"] },
        delta: { type: "integer" },
        reason: { type: "string" },
      },
      required: ["targetId", "field", "delta"],
    },
  },
  {
    name: "advance_clock",
    description:
      "Advance a clock because its trigger fired this scene. Returns any milestone effects crossed (these are non-optional and must be narrated).",
    input_schema: {
      type: "object",
      properties: {
        clockId: { type: "string", description: "e.g. 'clk-sable', 'clk-talos', 'clk-josen'" },
        amount: { type: "integer", description: "default 1" },
        reason: { type: "string" },
      },
      required: ["clockId", "reason"],
    },
  },
  {
    name: "adjust_rep",
    description: "Shift a faction's reputation (clamped -5..+5) after a significant act.",
    input_schema: {
      type: "object",
      properties: {
        factionId: { type: "string" },
        delta: { type: "integer" },
        reason: { type: "string" },
      },
      required: ["factionId", "delta", "reason"],
    },
  },
  {
    name: "update_thread",
    description: "Create, develop, or resolve a story thread.",
    input_schema: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["create", "develop", "resolve"] },
        threadId: { type: "string", description: "required for develop/resolve" },
        title: { type: "string" },
        body: { type: "string" },
        entityRefs: { type: "array", items: { type: "string" } },
      },
      required: ["op"],
    },
  },
  {
    name: "log_world_event",
    description:
      "Record a faction-impacting event (asset destroyed, contact hit, territory shifted). Feeds the shared-universe canon feed. Call whenever a scene meaningfully changes a faction's position — even in solo play.",
    input_schema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "one sentence, third person" },
        detail: { type: "string" },
        factionIds: { type: "array", items: { type: "string" } },
        locationId: { type: "string" },
      },
      required: ["headline", "factionIds"],
    },
  },
  {
    name: "end_scene",
    description:
      "End the current scene. Triggers the DM checklist pipeline (ticks, wages, dock fees, clock time-triggers, arrival flag) and requests a summary. Provide the scene bookkeeping flags.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        paying: { type: "boolean", description: "was this a paying job (triggers crew wages)?" },
        dockings: { type: "integer" },
        arrivedAtLocationId: { type: "string" },
        combatEnded: { type: "boolean" },
        tendaysDelta: { type: "integer" },
      },
      required: ["title"],
    },
  },
  {
    name: "offer_choices",
    description:
      "After narrating, offer the player 2-4 short, concrete suggested actions they can click. Keep each under ~10 words, phrased as an action Vess could take right now. The player can always type their own instead, so don't add a 'something else' option yourself. Call this once at the end of a beat (not during combat resolution).",
    input_schema: {
      type: "object",
      properties: {
        choices: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
      },
      required: ["choices"],
    },
  },
  {
    name: "dm_override",
    description:
      "Escape hatch for bending the rules deliberately. The change is applied and logged verbatim with your stated reason. Use sparingly.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        reason: { type: "string" },
      },
      required: ["description", "reason"],
    },
  },
];
