import type { CampaignState, Character, WorldEvent, Thread } from "@/shared/schemas";
import {
  rollCheck,
  resolveShipAttack,
  resolvePersonalAttack,
  advanceClock,
  runSceneEnd,
  computeModifier,
  liveRng,
  type RNG,
  type CombatTarget,
  type EngineEvent,
} from "@/engine";
import { enemyTiers, shipClasses, economy, isHazardSkill } from "@/content";
import { awardTick } from "@/engine/progression";
import { rollDamage, maxDice } from "@/engine/dice";
import { generateScavengeLoot } from "@/engine/loot";
import { generateQuirk, generateBackstory, generateNpcFlavor } from "@/shared/npcFlavor";
import {
  spawnCombatEnemies,
  spawnCombatShips,
  playerAttack,
  enemyAttack,
  type SpawnSpec,
  type ShipSpawnSpec,
} from "@/engine/combatEngine";
import { fleeDC, threatLevel } from "@/shared/combat";
import type { CombatState, CombatEnemy, CombatAction, CombatOutcome, PlayerCombatant } from "@/shared/combat";
import { catalogItem, itemCount, allItems } from "@/shared/items";
import {
  freshSceneCard,
  dispositionLabel,
  MAX_BEATS,
  MAX_BEAT_CHARS,
  MAX_SITUATION_CHARS,
  DISPOSITION_MIN,
  DISPOSITION_MAX,
  type SceneCard,
  type NpcRelations,
} from "@/shared/scene";
import { shipIsOwned, shipThreadId } from "@/shared/recap";
import { inTutorial, TUTORIAL_CHOICE_COUNT } from "@/shared/tutorial";

/** Victory loot band by top tier faced (ECONOMY.md). */
const LOOT_BAND: Record<"T1" | "T2" | "T3", [number, number]> = {
  T1: [20, 60],
  T2: [80, 200],
  T3: [350, 700],
};

/** Standing at or below this with your parent faction, while still flying their
 *  loaner, gets the ship repossessed (see adjustRep). A real betrayal — starting
 *  parent rep is +1, so this only fires after you turn hard on your own side. */
const SHIP_SEIZE_REP = -2;

/**
 * Bridges narrator tool calls to deterministic engine functions, accumulating
 * the scene bookkeeping (tick-eligible rolls, clock advances, costs, world
 * events) so end_scene can run the DM checklist pipeline in one shot.
 */
export class TurnRuntime {
  state: CampaignState;
  rng: RNG;
  events: EngineEvent[] = [];
  enemies = new Map<string, CombatTarget>();
  private clockAdvances: { clockId: string; amount: number; reason: string }[] = [];
  worldEvents: WorldEvent[] = [];
  /** Suggested clickable actions offered by the narrator this turn. */
  choices: string[] = [];
  private enemyCounter = 0;
  sceneEndReport: ReturnType<typeof runSceneEnd> | null = null;
  /** Skills already ticked this scene, as "characterId:skill" keys. Ticks are
   *  awarded IMMEDIATELY on a qualifying roll (leveling must not depend on the
   *  narrator remembering end_scene); this set enforces the 1/skill/scene cap
   *  across turns and is persisted by the session, reset at scene end. */
  tickedThisScene: Set<string>;
  /** Current scene's working memory (CONTINUITY.md) — mutated in place; the
   *  session object is the owner, the route resets it on scene close. */
  sceneCard: SceneCard;
  /** Player↔NPC standing overlay — mutated in place, session-owned. */
  npcRelations: NpcRelations;
  /** NPCs already disposition-nudged this turn (engine cap: ±1/NPC/turn). */
  private nudgedThisTurn = new Set<string>();
  /** True once a quest/job concluded THIS turn (a payout was awarded, or a thread
   *  resolved). Disposition only moves on such turns — standing is earned by
   *  completing work, not by chatting (built-in engine gate, not a prompt rule). */
  private questCompletedThisTurn = false;

  /** Unlock disposition movement for this turn — called when a job/quest actually
   *  completes (payout awarded, thread resolved). Public so any completion path
   *  (and tests) can signal it. */
  markQuestCompleted() {
    this.questCompletedThisTurn = true;
  }

  /** True once the engine rolled loot this turn (a successful scavenge/loot check).
   *  Also lets the narrator's own items[] gains through — they corroborate what the
   *  engine just generated rather than conjuring something new. */
  private lootedThisTurn = false;

  constructor(
    state: CampaignState,
    rng: RNG = liveRng,
    opts?: { tickedThisScene?: Set<string>; sceneCard?: SceneCard; npcRelations?: NpcRelations },
  ) {
    this.state = state;
    this.rng = rng;
    this.tickedThisScene = opts?.tickedThisScene ?? new Set();
    this.sceneCard = opts?.sceneCard ?? freshSceneCard();
    this.npcRelations = opts?.npcRelations ?? {};
  }

  private char(id: string): Character | undefined {
    return this.state.characters.find((c) => c.id === id);
  }

  /** Is this character dead (an injury marks it)? Guards further play. */
  static isDead(c: Character): boolean {
    return (c.injuries ?? []).some((i) => i.name === "Dead");
  }

  /**
   * Apply damage to a character and resolve the life-and-death consequences —
   * this is what makes stakes real and death POSSIBLE:
   *   HP > 0 → 0        : DOWNED (critical; one more hit is fatal)
   *   already at 0, hit : DEAD
   * Returns the outcome so the caller can surface it to the player + narrator.
   */
  private applyDamage(characterId: string, amount: number, reason: string) {
    const c = this.char(characterId);
    if (!c || amount <= 0) return { hpAfter: c?.hp ?? 0, taken: 0, downed: false, died: false };
    const before = c.hp;
    const hp = Math.max(0, before - amount);
    let injuries = c.injuries ?? [];
    let downed = false;
    let died = false;
    // No permadeath during the tutorial — the worst that happens is staying
    // Downed. Real stakes, but a brand-new player can't lose the character in
    // their first few quests (they shouldn't be able to die learning the ropes).
    const lethal = !inTutorial(this.state);
    if (before === 0 && lethal) {
      // Struck while already down → killed.
      died = true;
      injuries = [...injuries.filter((i) => i.name !== "Downed"), { name: "Dead", effect: reason }];
    } else if (hp === 0 || before === 0) {
      downed = true;
      if (!injuries.some((i) => i.name === "Downed")) {
        injuries = [...injuries, { name: "Downed", effect: "critical — bleeding out; one more hit is fatal" }];
      }
    }
    this.state = {
      ...this.state,
      characters: this.state.characters.map((x) => (x.id === characterId ? { ...x, hp, injuries } : x)),
    };
    const tag = died ? " · KILLED" : downed ? " · DOWNED" : "";
    this.events.push({
      type: "resource",
      breakdown: `${c.name} takes ${amount} damage — ${before}→${hp} HP${tag}`,
      field: "hp",
      delta: -amount,
    });
    if (died) this.events.push({ type: "note", breakdown: `${c.name} has DIED. ${reason}` });
    return { hpAfter: hp, taken: amount, downed, died };
  }

  /** Does this target id refer to the player's ship? Accepts the real ship id,
   *  the generic "ship" token, and legacy "lark" (the fixture's ship id). */
  private isShipTarget(id: string): boolean {
    return !!this.state.ship && (id === this.state.ship.id || id === "ship" || id === "lark");
  }

  execute(name: string, input: Record<string, unknown>): unknown {
    switch (name) {
      case "roll_check":
        return this.rollCheck(input);
      case "resolve_attack":
        return this.resolveAttack(input);
      case "spawn_encounter":
        return this.spawnEncounter(input);
      case "adjust_resource":
        return this.adjustResource(input);
      case "advance_clock":
        return this.advanceClock(input);
      case "adjust_rep":
        return this.adjustRep(input);
      case "update_thread":
        return this.updateThread(input);
      case "log_world_event":
        return this.logWorldEvent(input);
      case "end_scene":
        return this.endScene(input);
      case "award_payout":
        return this.awardPayout(input);
      case "use_item":
        return this.useItem(String(input.itemId ?? ""), input.characterId ? String(input.characterId) : undefined);
      case "offer_choices":
        return this.offerChoices(input);
      case "dm_override":
        return this.dmOverride(input);
      default:
        return { error: `unknown tool: ${name}` };
    }
  }

  private rollCheck(input: Record<string, unknown>) {
    const character = this.char(String(input.characterId));
    if (!character) return { error: `unknown character ${input.characterId}` };
    const dcMod = input.useShipDcModifier && this.state.ship ? this.state.ship.dcModifier : 0;
    const res = rollCheck(
      {
        character,
        skill: String(input.skill),
        dc: Number(input.dc),
        stakes: Boolean(input.stakes),
        situationalMod: input.situationalMod ? Number(input.situationalMod) : 0,
        dcModifier: dcMod,
      },
      this.rng,
    );
    this.events.push(res.event);
    // Award the skill tick IMMEDIATELY (was: batched to end_scene, which cheap
    // narrators rarely call — so nobody leveled). The per-character set enforces
    // the max-1-tick-per-skill-per-scene cap across the whole scene.
    let tick: string | undefined;
    let tickCapped: string | undefined;
    if (res.tickEligible) {
      const skillName = String(input.skill);
      const perChar = new Set(
        [...this.tickedThisScene]
          .filter((k) => k.startsWith(`${character.id}:`))
          .map((k) => k.slice(character.id.length + 1)),
      );
      const award = awardTick(character, skillName, perChar);
      if (award.ticked) {
        this.tickedThisScene.add(`${character.id}:${skillName}`);
        this.state = {
          ...this.state,
          characters: this.state.characters.map((c) => (c.id === character.id ? award.character : c)),
        };
        this.events.push(award.event);
        tick = award.event.breakdown;
      } else {
        // Tick-eligible but this skill already improved this scene (1/scene cap) —
        // tell the player, or the un-moving bar reads as a bug.
        tickCapped = skillName;
      }
    }
    // Real stakes: a failed roll that carries failDamage HURTS — but only from a
    // PHYSICAL HAZARD (a hazard skill, or an explicit danger save via input.hazard).
    // A failed ability check (perception, negotiation, mechanics…) never costs HP —
    // it just fails (D&D: ability checks don't deal damage, saves do). And any hit
    // is capped at a fraction of max HP, so one bad roll can't gut you (no 5-of-7).
    // Hazard damage (flat, transparent): a failed hazard check deals
    // rng(0..hazardBase) × hazardLevel — level 1-5, shown to the player as ⚠
    // BEFORE they commit. Level 5 max = 10 = a fresh character's base HP, so a
    // deadly hazard can genuinely one-shot; a ⚠1 scrape caps at 2. Legacy dice
    // (failDamage "2d6") are converted to a level so old shapes keep working.
    let harm: { taken: number; hpAfter: number; downed: boolean; died: boolean } | undefined;
    let shipHarm: { taken: number; hpAfter: number; disabled: boolean } | undefined;
    if (res.outcome === "failure" && (input.hazardLevel || input.failDamage)) {
      const skill = String(input.skill);
      const explicit = input.hazardLevel ? Number(input.hazardLevel) : 0;
      const derived = !explicit && input.failDamage ? Math.ceil(maxDice(String(input.failDamage)) / 2) : 0;
      const level = Math.max(1, Math.min(economy.damageRules.maxHazardLevel, explicit || derived || 1));
      const dealt = this.rng.int(0, economy.damageRules.hazardBase) * level;
      if (dealt > 0 && input.target === "ship" && this.state.ship) {
        // A flying/docking mishap damages the HULL, not the pilot. Hull 0 =
        // disabled (adrift), never death.
        const sh = this.applyShipDamage(dealt);
        shipHarm = { taken: sh.taken, hpAfter: sh.hpAfter, disabled: sh.disabled };
      } else if (dealt > 0 && input.target !== "ship" && (Boolean(input.hazard) || isHazardSkill(skill))) {
        harm = this.applyDamage(character.id, dealt, `Failed ${skill} check.`);
      }
    }
    // Engine-owned loot: a successful loot/scavenge ATTEMPT is where items come
    // from — the engine decides the haul (scrap + creds; a crit does better), the
    // player never names it. Also unlocks the narrator's items[] for the turn so a
    // corroborating "you pocket the shard" line is allowed to persist.
    let loot: string | undefined;
    if (input.loot && res.outcome === "success") {
      const drop = generateScavengeLoot(this.rng, { crit: res.critical });
      this.lootedThisTurn = true;
      const target = this.char(character.id);
      if (target) {
        let gear = [...(target.gear ?? [])];
        for (const g of drop.gear) gear.push({ name: g.name, detail: g.detail });
        for (const itemId of drop.consumables) {
          const cat = catalogItem(itemId);
          if (!cat) continue;
          const ex = gear.find((x) => x.itemId === itemId);
          gear = ex
            ? gear.map((x) => (x === ex ? { ...x, qty: (x.qty ?? 1) + 1 } : x))
            : [...gear, { name: cat.name, itemId: cat.id, qty: 1 }];
        }
        this.state = {
          ...this.state,
          characters: this.state.characters.map((c) =>
            c.id === character.id ? { ...c, gear, credits: (c.credits ?? 0) + drop.credits } : c,
          ),
        };
      }
      this.events.push({ type: "note", breakdown: drop.line });
      loot = drop.line;
    }
    return {
      breakdown: res.breakdown,
      total: res.total,
      outcome: res.outcome,
      critical: res.critical,
      criticalFailure: res.criticalFailure,
      tickEligible: res.tickEligible,
      ...(tick ? { tick } : {}),
      ...(tickCapped ? { tickCapped } : {}),
      ...(loot ? { loot } : {}),
      ...(harm && harm.taken > 0
        ? { damage: harm.taken, hpAfter: harm.hpAfter, downed: harm.downed, died: harm.died }
        : {}),
      ...(shipHarm && shipHarm.taken > 0
        ? { shipDamage: shipHarm.taken, shipHpAfter: shipHarm.hpAfter, shipDisabled: shipHarm.disabled }
        : {}),
    };
  }

  private attackModFor(attackerId: string | undefined, scale: string): number {
    if (!attackerId) return 5;
    const c = this.char(attackerId);
    if (c) return computeModifier(c, scale === "ship" ? "gunnery" : "smallArms");
    // enemy attacker: use stored tier atk if present
    const enemy = this.enemies.get(attackerId) as (CombatTarget & { atk?: number }) | undefined;
    return enemy?.atk ?? 5;
  }

  private resolveAttack(input: Record<string, unknown>) {
    const scale = String(input.scale);
    const attackMod =
      input.attackMod !== undefined
        ? Number(input.attackMod)
        : this.attackModFor(input.attackerId as string | undefined, scale);
    const targetId = String(input.targetId);

    // Build the target from ship, character, or spawned enemy.
    let target: CombatTarget;
    let commit: (hpAfter: number, shieldReady: boolean) => void;

    if (this.isShipTarget(targetId)) {
      const s = this.state.ship!;
      target = {
        id: s.id,
        name: s.name,
        hp: s.hp,
        ac: s.ac,
        armored: s.damageReduction > 0,
        shieldReady: s.hasShield && s.shieldReady,
      };
      commit = (hp, shield) => {
        this.state = { ...this.state, ship: { ...s, hp, shieldReady: shield } };
      };
    } else if (this.enemies.has(targetId)) {
      target = this.enemies.get(targetId)!;
      commit = (hp, shield) => {
        this.enemies.set(targetId, { ...target, hp, shieldReady: shield });
      };
    } else {
      const c = this.char(targetId);
      if (!c) return { error: `unknown target ${targetId}` };
      target = { id: c.id, name: c.name, hp: c.hp, ac: c.ac };
      commit = (hp) => {
        this.state = {
          ...this.state,
          characters: this.state.characters.map((x) => (x.id === c.id ? { ...x, hp } : x)),
        };
      };
    }

    const res =
      scale === "ship"
        ? resolveShipAttack(
            {
              attackerSide: input.attackerSide === "enemy" ? "enemy" : "player",
              attackMod,
              weaponType: input.weaponType as "kinetic" | "energy" | "missile" | "ion",
              damage: String(input.damage),
              target,
            },
            this.rng,
          )
        : resolvePersonalAttack(
            {
              attackerSide: input.attackerSide === "enemy" ? "enemy" : "player",
              attackMod,
              damage: String(input.damage),
              target: { ...target, damageReduction: 0 },
            },
            this.rng,
          );

    this.events.push(...res.events);
    commit(res.targetHpAfter, res.targetShieldReadyAfter);
    return {
      breakdown: res.breakdown,
      hit: res.hit,
      damageDealt: res.damageDealt,
      targetHpAfter: res.targetHpAfter,
      destroyed: res.targetHpAfter <= 0,
    };
  }

  private spawnEncounter(input: Record<string, unknown>) {
    const composition = (input.composition as Array<Record<string, unknown>>) ?? [];
    const spawned: Array<{ id: string; name: string; hp: number; ac: number }> = [];
    for (const spec of composition) {
      const tierKey = String(spec.tier) as keyof typeof enemyTiers.tiers;
      const tier = enemyTiers.tiers[tierKey];
      const classKey = spec.shipClass ? (String(spec.shipClass) as keyof typeof shipClasses.classes) : null;
      const cls = classKey ? shipClasses.classes[classKey] : null;

      const hpRange = (cls?.hpRange ?? tier?.hpRange ?? [15, 20]) as [number, number];
      const hp = this.rng.int(hpRange[0], hpRange[1]);
      const acRange = (cls?.acRange ?? (tier as { acRange?: [number, number]; ac?: number })?.acRange) as
        | [number, number]
        | undefined;
      const ac = acRange ? this.rng.int(acRange[0], acRange[1]) : (tier as { ac?: number })?.ac ?? 14;

      const id = `enemy-${++this.enemyCounter}`;
      const name = String(spec.name ?? `${tier?.label ?? "Enemy"} ${cls?.label ?? ""}`.trim());
      const isEvasive = classKey === "scout" || classKey === "fighter";
      const target: CombatTarget & { atk?: number } = {
        id,
        name,
        hp,
        ac,
        isEvasive,
        armored: classKey === "hauler",
        shieldReady: classKey === "gunship" || classKey === "corvette",
        hasPointDefense: classKey === "corvette",
        atk: tier?.atk ?? 5,
      };
      this.enemies.set(id, target);
      spawned.push({ id, name, hp, ac });
    }
    this.events.push({ type: "note", breakdown: `Spawned: ${spawned.map((s) => `${s.name}(${s.id}, ${s.hp}hp/AC${s.ac})`).join(", ")}` });
    return { enemies: spawned };
  }

  /**
   * Engine-clamped income (ECONOMY.md): the model names a job tier; the ENGINE
   * rolls the credits inside that tier's band. A negotiation check resolved this
   * turn shades the roll: success → upper half, failure → lower half.
   */
  private awardPayout(input: Record<string, unknown>) {
    const tier = String(input.tier) as "T0" | "T1" | "T2" | "T3";
    const band = economy.jobPayouts[tier];
    if (!Array.isArray(band)) return { error: `unknown payout tier ${input.tier}` };
    const pc = this.state.characters.find((c) => c.kind === "pc");
    if (!pc) return { error: "no player character" };
    // A payout means a job/quest concluded — unlock disposition movement this turn.
    this.markQuestCompleted();
    const [lo, hi] = band as [number, number];
    const mid = Math.round((lo + hi) / 2);
    const mood = input.mood === "high" ? "high" : input.mood === "low" ? "low" : undefined;
    const amount = this.rng.int(mood === "high" ? mid : lo, mood === "low" ? mid : hi);
    this.state = {
      ...this.state,
      characters: this.state.characters.map((c) =>
        c.id === pc.id ? { ...c, credits: (c.credits ?? 0) + amount } : c,
      ),
    };
    const reason = input.reason ? ` — ${String(input.reason)}` : "";
    this.events.push({
      type: "resource",
      breakdown: `Payment: +¢${amount} (${tier}${reason})`,
      field: "credits",
      delta: amount,
    });
    return { amount, tier };
  }

  private adjustResource(input: Record<string, unknown>) {
    const targetId = String(input.targetId);
    const field = String(input.field);
    let delta = Number(input.delta);
    // Money moves through the engine: model credit GRANTS above the flavor cap
    // are clamped (real income goes through award_payout's tier bands), and a
    // single debit can't exceed the per-turn cap (prevents wallet-zeroing).
    if (field === "credits") {
      const { flavorGrantCap, maxDebitPerTurn } = economy.jobPayouts;
      if (delta > flavorGrantCap) delta = flavorGrantCap;
      if (delta < -maxDebitPerTurn) delta = -maxDebitPerTurn;
    }

    if (this.isShipTarget(targetId)) {
      const s = this.state.ship!;
      if (field === "hp") {
        const hp = Math.max(0, Math.min(s.maxHp, s.hp + delta));
        this.state = { ...this.state, ship: { ...s, hp } };
        this.events.push({ type: "resource", breakdown: `${s.name} HP ${s.hp}→${hp}`, field, delta });
        return { field, value: hp };
      }
      if (field === "missiles") {
        const pod = s.weapons.find((w) => w.type === "missile");
        const val = Math.max(0, (pod?.ammo ?? 0) + delta);
        this.state = {
          ...this.state,
          ship: { ...s, weapons: s.weapons.map((w) => (w.type === "missile" ? { ...w, ammo: val } : w)) },
        };
        this.events.push({ type: "resource", breakdown: `${s.name} missiles → ${val}`, field, delta });
        return { field, value: val };
      }
    }

    const c = this.char(targetId);
    if (!c) return { error: `unknown target ${targetId}` };
    let value: number;
    const patch: Partial<Character> = {};
    if (field === "hp") value = (patch.hp = Math.max(0, Math.min(c.maxHp, c.hp + delta)));
    else if (field === "credits") value = (patch.credits = (c.credits ?? 0) + delta);
    else if (field === "stims") value = (patch.stims = Math.max(0, c.stims + delta));
    else if (field === "loyalty") value = (patch.loyalty = Math.max(0, Math.min(5, (c.loyalty ?? 0) + delta)));
    else return { error: `unsupported field ${field}` };

    this.state = {
      ...this.state,
      characters: this.state.characters.map((x) => (x.id === c.id ? { ...x, ...patch } : x)),
    };
    this.events.push({ type: "resource", breakdown: `${c.name} ${field} → ${value}`, field, delta });
    return { field, value };
  }

  private advanceClock(input: Record<string, unknown>) {
    const clockId = String(input.clockId);
    const clock = this.state.clocks.find((c) => c.id === clockId);
    if (!clock) return { error: `unknown clock ${clockId}` };
    const amount = input.amount ? Number(input.amount) : 1;
    const reason = String(input.reason ?? "");
    // Preview the milestone effects now (authoritative apply happens at end_scene).
    const res = advanceClock(clock, amount, reason);
    this.clockAdvances.push({ clockId, amount, reason });
    this.events.push(res.event);
    return { breakdown: res.event.breakdown, crossedMilestones: res.crossedMilestones };
  }

  private adjustRep(input: Record<string, unknown>) {
    const factionId = String(input.factionId);
    const delta = Number(input.delta);
    const rep = this.state.factionRep.find((r) => r.factionId === factionId);
    if (!rep) return { error: `unknown faction ${factionId}` };
    const from = rep.rep;
    const to = Math.max(-5, Math.min(5, from + delta));
    this.state = {
      ...this.state,
      factionRep: this.state.factionRep.map((r) =>
        r.factionId === factionId
          ? // Mark the faction as "encountered" the first time its rep is touched, so
            // the sheet keeps showing it even if rep later swings back to neutral 0.
            { ...r, rep: to, standing: r.standing ?? "Encountered" }
          : r,
      ),
    };
    this.events.push({ type: "rep", breakdown: `Rep ${factionId}: ${from}→${to}`, factionId, from, to });

    // Loaner repossession: crater your standing with the faction whose ship you
    // fly — before you've earned the title — and they pull it. Deterministic
    // consequence (like a clock milestone); the narrator must narrate it.
    const pc = this.state.characters.find((c) => c.kind === "pc");
    if (
      pc?.parentFactionId === factionId &&
      to <= SHIP_SEIZE_REP &&
      this.state.ship &&
      !shipIsOwned(this.state)
    ) {
      const shipName = this.state.ship.name;
      const factionName = this.state.factions.find((f) => f.id === factionId)?.name ?? "Your faction";
      this.state = {
        ...this.state,
        ship: undefined,
        threads: this.state.threads.map((t) =>
          t.id === shipThreadId(this.state.campaign.id)
            ? {
                ...t,
                title: "Earn a hull of your own",
                body: `${factionName} repossessed ${shipName} when your standing with them cratered. You're grounded — beg and borrow passage until you can get a hull that answers to you alone.`,
              }
            : t,
        ),
      };
      this.events.push({
        type: "note",
        breakdown: `${factionName} repossessed ${shipName} — standing cratered to ${to}. You are grounded.`,
      });
      return { factionId, from, to, shipSeized: { name: shipName, by: factionId } };
    }

    return { factionId, from, to };
  }

  private updateThread(input: Record<string, unknown>) {
    const op = String(input.op);
    if (op === "create") {
      const thread: Thread = {
        id: `th-${Date.now()}`,
        campaignId: this.state.campaign.id,
        title: String(input.title ?? "Untitled thread"),
        body: String(input.body ?? ""),
        status: "active",
        entityRefs: (input.entityRefs as string[]) ?? [],
      };
      this.state = { ...this.state, threads: [...this.state.threads, thread] };
      return { created: thread.id };
    }
    const threadId = String(input.threadId);
    // Resolving a live thread is a quest completion — unlock disposition this turn.
    if (op === "resolve" && this.state.threads.some((t) => t.id === threadId && t.status !== "resolved")) {
      this.markQuestCompleted();
    }
    this.state = {
      ...this.state,
      threads: this.state.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              body: input.body ? String(input.body) : t.body,
              status: op === "resolve" ? "resolved" : t.status,
            }
          : t,
      ),
    };
    return { updated: threadId, op };
  }

  private logWorldEvent(input: Record<string, unknown>) {
    const ev: WorldEvent = {
      id: `we-${Date.now()}`,
      universeId: this.state.universe.id,
      sourceCampaignId: this.state.campaign.id,
      factionIds: (input.factionIds as string[]) ?? [],
      locationId: input.locationId ? String(input.locationId) : undefined,
      headline: String(input.headline),
      detail: input.detail ? String(input.detail) : undefined,
      visibility: "private", // universe owner promotes to 'canon' via review queue
    };
    this.worldEvents.push(ev);
    this.events.push({ type: "note", breakdown: `World event logged: ${ev.headline}` });
    return { logged: ev.id };
  }

  private endScene(input: Record<string, unknown>) {
    const report = runSceneEnd(this.state, {
      paying: Boolean(input.paying),
      dockings: input.dockings ? Number(input.dockings) : 0,
      arrivedAtLocationId: input.arrivedAtLocationId ? String(input.arrivedAtLocationId) : undefined,
      // Ticks are awarded immediately in rollCheck now; nothing left to batch.
      tickedRolls: [],
      clockAdvances: this.clockAdvances,
      combatEnded: Boolean(input.combatEnded),
      tendaysDelta: input.tendaysDelta ? Number(input.tendaysDelta) : 0,
    });
    this.state = report.state;
    // Stabilise the wounded between scenes: a Downed (but living) character is
    // patched up — cleared of Downed and brought to at least 1 HP — so nobody
    // carries a bleeding-out, 0-HP crisis (or a soft-lock) into the next scene.
    this.state = {
      ...this.state,
      characters: this.state.characters.map((c) => {
        if (TurnRuntime.isDead(c)) return c;
        if (!(c.injuries ?? []).some((i) => i.name === "Downed")) return c;
        return { ...c, hp: Math.max(1, c.hp), injuries: c.injuries.filter((i) => i.name !== "Downed") };
      }),
    };
    this.sceneEndReport = report;
    // New scene → the per-scene tick cap resets.
    this.tickedThisScene.clear();
    this.events.push(...report.events);
    return {
      title: input.title,
      checklist: report.checklist,
    };
  }

  /**
   * Persist a named NPC the narrator introduced/used this turn, so the world
   * REMEMBERS them (continuity — an NPC recognized on return). Deduped by name:
   * a new NPC is added to the cast at the current location; an existing one is
   * refreshed to "here now" and gets a description if it lacked one. Returns
   * whether a new NPC was created.
   */
  registerNpc(name: string, oneBreath?: string, role?: string): { added: boolean; id: string } {
    const trimmed = name.trim();
    const here = this.state.campaign.currentLocationId;
    const cleanRole = role?.trim() || undefined;
    const existing = this.state.npcs.find((n) => n.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      this.state = {
        ...this.state,
        npcs: this.state.npcs.map((n) =>
          n.id === existing.id
            ? {
                ...n,
                locationId: here ?? n.locationId,
                oneBreath: n.oneBreath || oneBreath || n.oneBreath,
                // Fill a role only if we didn't already know one (set-once).
                role: n.role ?? cleanRole,
                // Backfill canonical flavor for NPCs that predate it (set-once,
                // deterministic from id). A quirk is safe for anyone; a generated
                // backstory only for GENERATED NPCs — a hand-seeded NPC's oneBreath
                // is already its authored backstory, so we don't overwrite it.
                quirk: n.quirk ?? generateQuirk(n.id),
                backstory: n.backstory ?? (n.originCampaignId ? generateBackstory(n.id) : undefined),
              }
            : n,
        ),
      };
      return { added: false, id: existing.id };
    }
    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "npc";
    const id = `npc-gen-${slug}-${this.state.npcs.length}`;
    const npc = {
      id,
      universeId: this.state.universe.id,
      name: trimmed,
      oneBreath: (oneBreath ?? "").trim() || `Someone the player met${here ? " here" : ""}.`,
      ...(here ? { locationId: here } : {}),
      ...(cleanRole ? { role: cleanRole } : {}),
      // Provenance so a promoted NPC (persistSession) traces back to this campaign.
      originCampaignId: this.state.campaign.id,
      // Canonical personality + backstory hook — engine-generated, shared, set once.
      ...generateNpcFlavor(id),
    };
    this.state = { ...this.state, npcs: [...this.state.npcs, npc] };
    return { added: true, id };
  }

  /**
   * Narrative item pickup/loss (a looted facemask, a confiscated pistol): the
   * model proposes, the engine writes it into the PC's GEAR so it persists in
   * state, context, and the sidebar — it can never vanish with old messages.
   * Gains dedupe by name (flavor items, no catalog id — ITEMS.md IT-1); losses
   * only remove non-catalog gear (catalog stacks are spent via useItem, and the
   * model may not delete mechanical items). Returns a display line, or null.
   */
  applyGearChange(name: string, action: "gain" | "lose", note?: string): string | null {
    const pc = this.pc();
    if (!pc) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    // Item GAINS are engine-authored, not player-authored: the model may only hand
    // over gear on a turn the engine recognises a legitimate source — a successful
    // scavenge/loot roll (lootedThisTurn) or a quest reward (questCompletedThisTurn).
    // Otherwise "I find a rocket launcher" grants nothing. Losses stay open (a
    // confiscation is a valid consequence any time).
    if (action === "gain" && !this.lootedThisTurn && !this.questCompletedThisTurn) return null;
    // A gained item that IS a catalog item (a looted "medkit") must become the
    // MECHANICAL item — with itemId — or useItem's possession check will fail
    // and the model will narrate heals that never happen (the medkit bug).
    const norm = trimmed.toLowerCase().replace(/^(a|an|the)\s+/, "");
    const cat =
      action === "gain"
        ? allItems().find((it) => it.name.toLowerCase() === norm || it.id.toLowerCase() === norm)
        : undefined;
    const existing = pc.gear.find((g) =>
      cat ? g.itemId === cat.id : g.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (action === "gain") {
      if (cat) {
        // Catalog item: stack it (a second medkit is +1, not a no-op).
        const gear = existing
          ? pc.gear.map((g) => (g === existing ? { ...g, qty: (g.qty ?? 1) + 1 } : g))
          : [...pc.gear, { name: cat.name, itemId: cat.id, qty: 1 }];
        this.state = {
          ...this.state,
          characters: this.state.characters.map((c) => (c.id === pc.id ? { ...c, gear } : c)),
        };
        const n = (existing?.qty ?? 0) + 1;
        return `🎒 Gained: ${cat.name}${n > 1 ? ` (×${n})` : ""}`;
      }
      if (existing) return null; // flavor item already carried — nothing to do
      const gear = [...pc.gear, { name: trimmed, ...(note?.trim() ? { detail: note.trim() } : {}) }];
      this.state = {
        ...this.state,
        characters: this.state.characters.map((c) => (c.id === pc.id ? { ...c, gear } : c)),
      };
      return `🎒 Gained: ${trimmed}`;
    }
    if (!existing || existing.itemId) return null; // absent, or catalog-owned (engine-only)
    const gear = pc.gear.filter((g) => g !== existing);
    this.state = {
      ...this.state,
      characters: this.state.characters.map((c) => (c.id === pc.id ? { ...c, gear } : c)),
    };
    return `🎒 Lost: ${existing.name}`;
  }

  /** Mark an NPC as present in the current scene — they ride retrieval every
   *  turn of the scene without needing to be re-named (CONTINUITY tier NOW). */
  markPresent(npcId: string) {
    if (!this.sceneCard.presentNpcIds.includes(npcId)) this.sceneCard.presentNpcIds.push(npcId);
  }

  /** Apply the model's scene-card proposal: `situation`/`place`/`dangers`
   *  overwrite, `beats` append. Engine caps everything (F-2/F-4). */
  updateScene(situation?: string, beats?: string[], place?: string, dangers?: string[]) {
    if (situation?.trim()) this.sceneCard.situation = situation.trim().slice(0, MAX_SITUATION_CHARS);
    if (place?.trim()) {
      this.sceneCard.place = place.trim().slice(0, 120);
      this.sceneCard.placeSeq = this.sceneCard.seq; // stamp freshness for the sidebar
    }
    // Overwrite semantics: [] explicitly CLEARS a dealt-with danger.
    if (dangers) this.sceneCard.dangers = dangers.map((d) => d.trim().slice(0, 80)).filter(Boolean).slice(0, 3);
    for (const b of beats ?? []) {
      const beat = b.trim().slice(0, MAX_BEAT_CHARS);
      if (!beat) continue;
      if (this.sceneCard.beats.some((x) => x.toLowerCase() === beat.toLowerCase())) continue;
      if (this.sceneCard.beats.length >= MAX_BEATS) this.sceneCard.beats.shift(); // oldest out
      this.sceneCard.beats.push(beat);
    }
  }

  /** Keep Here & now LIVE: when the model didn't set a `situation` this turn, derive
   *  it from the turn's narration (first sentence, capped) so the box reflects the
   *  current beat instead of showing a stale line from turns ago. */
  refreshSituation(narration: string) {
    const text = narration.trim();
    if (!text) return;
    const first = text.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? text;
    const s = first.trim().replace(/\s+/g, " ").slice(0, MAX_SITUATION_CHARS);
    if (s) this.sceneCard.situation = s;
  }

  /**
   * Update the player's standing with an NPC (CONTINUITY tier CANON). The model
   * proposes; the engine owns the math: delta clamped to ±1, one nudge per NPC
   * per turn, range −3..+3. `relationship` is set-once (first write wins — the
   * creation-seeded tie can't be overwritten by a later whim); `note` overwrites
   * (rolling last-interaction memory). Returns a display line when the standing
   * actually moved (D-4: visible, like ticks).
   */
  updateNpcRelation(
    npcId: string,
    upd: { disposition?: number; note?: string; relationship?: string },
  ): { line?: string } {
    const rel = this.npcRelations[npcId] ?? { disposition: 0 };
    let line: string | undefined;
    if (upd.disposition && this.questCompletedThisTurn && !this.nudgedThisTurn.has(npcId)) {
      this.nudgedThisTurn.add(npcId);
      const delta = Math.max(-1, Math.min(1, Math.round(upd.disposition)));
      const to = Math.max(DISPOSITION_MIN, Math.min(DISPOSITION_MAX, rel.disposition + delta));
      if (to !== rel.disposition) {
        const name = this.state.npcs.find((n) => n.id === npcId)?.name ?? npcId;
        line = `👤 ${name}: ${dispositionLabel(rel.disposition)} → ${dispositionLabel(to)}`;
        rel.disposition = to;
      }
    }
    if (upd.relationship?.trim() && !rel.relationship) rel.relationship = upd.relationship.trim();
    if (upd.note?.trim()) {
      rel.lastNote = upd.note.trim().slice(0, 160);
      rel.lastSceneSeq = this.sceneCard.seq;
    }
    this.npcRelations[npcId] = rel;
    return { line };
  }

  // ── Multi-turn combat (COMBAT.md) ──────────────────────────────────────────

  private pc(): Character | undefined {
    return this.state.characters.find((c) => c.kind === "pc");
  }

  /** Heal a character, clamped to maxHp. Any heal that brings them above 0 HP
   *  clears Downed — you're back on your feet (bloodied, but up). Returns new HP. */
  private applyHeal(characterId: string, amount: number): number {
    const c = this.char(characterId);
    if (!c) return 0;
    const hp = Math.min(c.maxHp, c.hp + Math.max(0, amount));
    const injuries = hp > 0 ? (c.injuries ?? []).filter((i) => i.name !== "Downed") : c.injuries;
    this.state = {
      ...this.state,
      characters: this.state.characters.map((x) => (x.id === characterId ? { ...x, hp, injuries } : x)),
    };
    return hp;
  }

  /** Remove a named injury (e.g. medkit stabilising a Downed ally). */
  private clearInjury(characterId: string, name: string) {
    this.state = {
      ...this.state,
      characters: this.state.characters.map((x) =>
        x.id === characterId ? { ...x, injuries: (x.injuries ?? []).filter((i) => i.name !== name) } : x,
      ),
    };
  }

  /**
   * Spend one of a catalog consumable: decrement a gear stack (`itemId`/`qty`),
   * or fall back to the legacy `stims` counter (ITEMS.md IT-5). Returns whether
   * anything was consumed. The catalog effect is applied by the caller.
   */
  private consumeItem(characterId: string, itemId: string): boolean {
    const c = this.char(characterId);
    if (!c) return false;
    const gear = [...c.gear];
    const idx = gear.findIndex((g) => g.itemId === itemId && (g.qty ?? 1) > 0);
    if (idx >= 0) {
      const q = (gear[idx].qty ?? 1) - 1;
      if (q <= 0) gear.splice(idx, 1);
      else gear[idx] = { ...gear[idx], qty: q };
      this.state = {
        ...this.state,
        characters: this.state.characters.map((x) => (x.id === characterId ? { ...x, gear } : x)),
      };
      return true;
    }
    if (itemId === "stim" && c.stims > 0) {
      this.state = {
        ...this.state,
        characters: this.state.characters.map((x) => (x.id === characterId ? { ...x, stims: x.stims - 1 } : x)),
      };
      return true;
    }
    return false;
  }

  /**
   * Use a consumable OUT of combat (in-combat use runs through the round
   * resolvers). Validates possession, applies the catalog effect, consumes one,
   * and returns a player-facing line. Combat-only effects (aoe/autoFlee/
   * restoreShield) used here just flavor-narrate + consume.
   */
  useItem(itemId: string, characterId?: string): { line?: string; error?: string } {
    const c = characterId ? this.char(characterId) : this.pc();
    if (!c) return { error: "no character" };
    const item = catalogItem(itemId);
    if (!item) return { error: `unknown item: ${itemId}` };
    if (itemCount(c, itemId) <= 0) return { error: `no ${item.name} left` };
    const eff = item.effect;
    let line = `${item.name} used.`;

    if (eff?.kind === "heal") {
      const healed = rollDamage(eff.dice ?? "1d6+2", this.rng);
      const before = c.hp;
      const after = this.applyHeal(c.id, healed);
      if (eff.clearsDowned && after > 0) this.clearInjury(c.id, "Downed");
      line = `🩹 ${item.name}: +${after - before} HP — ${before}→${after}.`;
    } else if (eff?.kind === "healShip" && this.state.ship) {
      const s = this.state.ship;
      const healed = rollDamage(eff.dice ?? "1d6+2", this.rng);
      const after = Math.min(s.maxHp, s.hp + healed);
      this.state = { ...this.state, ship: { ...s, hp: after } };
      line = `🔧 ${item.name}: +${after - s.hp} hull — ${s.hp}→${after}.`;
    } else if (eff?.kind === "reloadMissiles" && this.state.ship) {
      const s = this.state.ship;
      const add = eff.amount ?? 2;
      const weapons = s.weapons.map((w) => (w.type === "missile" ? { ...w, ammo: (w.ammo ?? 0) + add } : w));
      this.state = { ...this.state, ship: { ...s, weapons } };
      line = `🚀 ${item.name}: +${add} missiles.`;
    } else if (eff?.kind === "restoreShield" && this.state.ship) {
      this.state = { ...this.state, ship: { ...this.state.ship, shieldReady: true } };
      line = `⛨ ${item.name} — shields restored.`;
    }

    this.consumeItem(c.id, itemId);
    return { line };
  }

  /** Derive the PC's personal-scale combat profile (best weapon, combat level). */
  private personalCombatant(): PlayerCombatant {
    const pc = this.pc()!;
    const attackMod = computeModifier(pc, "smallArms");
    const weapon = [...pc.gear]
      .filter((g) => g.damage)
      .sort((a, b) => maxDice(String(b.damage)) - maxDice(String(a.damage)))[0];
    const weaponDamage = weapon?.damage ?? "1d4"; // unarmed
    const combatLevel = Math.max(
      0,
      ...["smallArms", "gunnery", "melee"].map((s) => pc.skills.find((k) => k.name === s)?.level ?? 0),
    );
    return { hp: pc.hp, maxHp: pc.maxHp, ac: pc.ac, attackMod, weaponDamage, combatLevel };
  }

  /** Enemies attack the player; halts the instant the player drops (COMBAT D-4). */
  private enemyVolley(combat: CombatState, lines: string[]): CombatOutcome {
    const pc = this.pc()!;
    const targetAc = pc.ac + combat.playerCoverAc;
    for (const enemy of combat.enemies) {
      const swings = enemy.multiAttack ? 2 : 1;
      for (let i = 0; i < swings; i++) {
        if ((this.pc()?.hp ?? 0) <= 0) return TurnRuntime.isDead(this.pc()!) ? "dead" : "downed";
        const atk = enemyAttack(enemy, targetAc, this.rng);
        lines.push(`💢 ${atk.breakdown}`);
        if (atk.hit) {
          const harm = this.applyDamage(pc.id, atk.damage, `${enemy.name}'s attack.`);
          lines.push(
            `💥 You take ${harm.taken} — ${harm.hpAfter + harm.taken}→${harm.hpAfter} HP` +
              (harm.died ? " · KILLED" : harm.downed ? " · DOWNED" : ""),
          );
          if (harm.died) return "dead";
          if (harm.downed) return "downed";
        }
      }
    }
    return "continue";
  }

  /** Begin a fight from pre-spawned enemies; resolve enemy surprise (ambush = a
   *  free enemy volley before the player acts; you-ambush → an opening edge). */
  private beginCombat(
    scale: "personal" | "ship",
    enemies: CombatEnemy[],
    surprise: "player" | "enemy" | "none",
  ): { combat: CombatState; lines: string[]; outcome: CombatOutcome } {
    const combat: CombatState = {
      active: true,
      round: 1,
      scale,
      enemies,
      playerCoverAc: 0,
      playerAimBonus: surprise === "player" ? 2 : 0,
      fleeAttempts: 0,
    };
    const lines = [`⚔ ${scale === "ship" ? "Ship combat" : "Combat"} — ${enemies.map((e) => e.name).join(", ")}.`];
    let outcome: CombatOutcome = "continue";
    if (surprise === "enemy") {
      lines.push("Ambushed — they fire first.");
      outcome = scale === "ship" ? this.enemyShipVolley(combat, false, lines) : this.enemyVolley(combat, lines);
      if (outcome !== "continue") combat.active = false;
    }
    return { combat, lines, outcome };
  }

  /** Start a personal (on-foot) fight. */
  startCombat(specs: SpawnSpec[], surprise: "player" | "enemy" | "none") {
    return this.beginCombat("personal", spawnCombatEnemies(specs, this.rng), surprise);
  }

  /** Start a ship-scale fight. */
  startShipCombat(specs: ShipSpawnSpec[], surprise: "player" | "enemy" | "none") {
    return this.beginCombat("ship", spawnCombatShips(specs, this.rng), surprise);
  }

  /** Resolve one round — dispatch by scale. Pure w.r.t. the CombatState arg
   *  (returns a new one) but mutates player/ship HP through the runtime. */
  resolveCombatRound(
    combat: CombatState,
    action: CombatAction,
  ): { combat: CombatState; lines: string[]; outcome: CombatOutcome; loot: number } {
    return combat.scale === "ship"
      ? this.resolveShipRound(combat, action)
      : this.resolvePersonalRound(combat, action);
  }

  private resolvePersonalRound(
    combat: CombatState,
    action: CombatAction,
  ): { combat: CombatState; lines: string[]; outcome: CombatOutcome; loot: number } {
    const lines: string[] = [];
    const cbt = this.personalCombatant();
    let enemies = combat.enemies.map((e) => ({ ...e }));
    let aim = combat.playerAimBonus;
    let cover = combat.playerCoverAc;
    let fleeAttempts = combat.fleeAttempts;

    switch (action.type) {
      case "attack": {
        const enemy = enemies.find((e) => e.id === action.enemyId && e.hp > 0) ?? enemies.find((e) => e.hp > 0);
        if (enemy) {
          const r = playerAttack(enemy, cbt.attackMod, cbt.weaponDamage, aim, this.rng);
          lines.push(`🎯 ${r.breakdown}`);
          enemy.hp = r.enemyHpAfter;
          enemy.shieldReady = r.shieldReadyAfter;
          if (r.killed) lines.push(`☠ ${enemy.name} is down.`);
        }
        aim = 0;
        cover = 0;
        break;
      }
      case "aim":
        aim = 2;
        cover = 0;
        lines.push("🔺 You steady your aim (+2 to your next attack).");
        break;
      case "cover":
        cover = 2;
        aim = 0;
        lines.push("🛡 You take cover (+2 AC until you move).");
        break;
      case "stim":
      case "item": {
        const pc = this.pc()!;
        const itemId = action.type === "stim" ? "stim" : action.itemId ?? "";
        const item = catalogItem(itemId);
        if (!item || itemCount(pc, itemId) <= 0) {
          lines.push("Nothing to use.");
          cover = 0;
          break;
        }
        const eff = item.effect;
        if (eff?.kind === "heal") {
          const before = pc.hp;
          const after = this.applyHeal(pc.id, rollDamage(eff.dice ?? "1d6+2", this.rng));
          this.consumeItem(pc.id, itemId);
          lines.push(`🩹 ${item.name}: +${after - before} HP — ${before}→${after}.`);
          cover = 0;
        } else if (eff?.kind === "aoe") {
          const dmg = rollDamage(eff.dice ?? "2d6", this.rng);
          enemies = enemies.map((e) => (e.hp > 0 ? { ...e, hp: Math.max(0, e.hp - dmg) } : e));
          this.consumeItem(pc.id, itemId);
          lines.push(`💥 ${item.name}: ${dmg} to every enemy.`);
          aim = 0;
          cover = 0;
        } else if (eff?.kind === "autoFlee") {
          this.consumeItem(pc.id, itemId);
          lines.push(`🌫 ${item.name} — you break contact and slip clear.`);
          return { combat: { ...combat, active: false }, lines, outcome: "escaped", loot: 0 };
        } else {
          lines.push(`${item.name} does nothing here.`);
          cover = 0;
        }
        break;
      }
      case "flee": {
        const pc = this.pc()!;
        const dc = fleeDC(threatLevel(enemies), cbt.combatLevel, fleeAttempts);
        const mod = computeModifier(pc, "stealth");
        const d20 = this.rng.int(1, 20);
        const total = d20 + mod;
        fleeAttempts += 1;
        const escaped = total >= dc;
        lines.push(`🎲 Flee: d20(${d20})+${mod} = ${total} vs DC ${dc} → ${escaped ? "escaped" : "they cut you off"}`);
        if (escaped) {
          return { combat: { ...combat, active: false }, lines, outcome: "escaped", loot: 0 };
        }
        cover = 0;
        break;
      }
    }

    // Deaths resolve; victory if the field is clear.
    enemies = enemies.filter((e) => e.hp > 0);
    if (enemies.length === 0) {
      const tier = combat.enemies.reduce<"T1" | "T2" | "T3">(
        (m, e) => (LOOT_BAND[e.tier][1] > LOOT_BAND[m][1] ? e.tier : m),
        "T1",
      );
      const [lo, hi] = LOOT_BAND[tier];
      const loot = this.rng.int(lo, hi);
      const pc = this.pc()!;
      this.state = {
        ...this.state,
        characters: this.state.characters.map((x) => (x.id === pc.id ? { ...x, credits: (x.credits ?? 0) + loot } : x)),
      };
      lines.push(`💰 Cleared them out — recovered ¢${loot}.`);
      return { combat: { ...combat, enemies, active: false }, lines, outcome: "victory", loot };
    }

    // Enemy volley (halts if the player drops).
    const next: CombatState = { ...combat, enemies, playerAimBonus: aim, playerCoverAc: cover, fleeAttempts };
    const outcome = this.enemyVolley(next, lines);
    if (outcome === "continue") {
      next.round += 1;
      return { combat: next, lines, outcome, loot: 0 };
    }
    return { combat: { ...next, active: false }, lines, outcome, loot: 0 };
  }

  // ── Ship-scale combat ──────────────────────────────────────────────────────

  /** Apply hull damage to the player's ship. Hull 0 = DISABLED (adrift), not
   *  death — the aftermath is narrated (boarded / captured / towed). */
  private applyShipDamage(amount: number) {
    const s = this.state.ship;
    if (!s || amount <= 0) return { hpAfter: s?.hp ?? 0, taken: 0, disabled: false };
    const before = s.hp;
    const hp = Math.max(0, before - amount);
    this.state = { ...this.state, ship: { ...s, hp } };
    const disabled = hp === 0 && before > 0;
    this.events.push({
      type: "resource",
      breakdown: `${s.name} hull ${before}→${hp}${disabled ? " · DISABLED" : ""}`,
      field: "hp",
      delta: -amount,
    });
    return { hpAfter: hp, taken: amount, disabled };
  }

  /** Enemy ships fire on the player's hull; halts the instant it's disabled. */
  private enemyShipVolley(combat: CombatState, evasive: boolean, lines: string[]): CombatOutcome {
    const pc = this.pc();
    for (const enemy of combat.enemies) {
      const swings = enemy.multiAttack ? 2 : 1;
      for (let i = 0; i < swings; i++) {
        const s = this.state.ship;
        if (!s || s.hp <= 0) return "disabled";
        const res = resolveShipAttack(
          {
            attackerSide: "enemy",
            attackMod: enemy.atk,
            weaponType: enemy.weaponType ?? "kinetic",
            damage: enemy.damage,
            target: {
              id: s.id,
              name: s.name,
              hp: s.hp,
              ac: s.ac,
              armored: s.damageReduction > 0,
              shieldReady: s.hasShield && s.shieldReady,
              isEvasive: evasive,
              hasPointDefense: s.hasPointDefense,
            },
          },
          this.rng,
        );
        lines.push(`💢 ${enemy.name}: ${res.breakdown}`);
        if (res.targetShieldReadyAfter !== (s.hasShield && s.shieldReady)) {
          this.state = { ...this.state, ship: { ...s, shieldReady: res.targetShieldReadyAfter } };
        }
        if (res.hit && res.damageDealt > 0) {
          const harm = this.applyShipDamage(res.damageDealt);
          lines.push(`💥 Hull takes ${harm.taken}${harm.disabled ? " · DISABLED" : ""}`);
          if (harm.disabled) return "disabled";
        }
      }
    }
    // Combat left the PC untouched — an environment threat (E-6) never triggers here.
    void pc;
    return "continue";
  }

  private resolveShipRound(
    combat: CombatState,
    action: CombatAction,
  ): { combat: CombatState; lines: string[]; outcome: CombatOutcome; loot: number } {
    const lines: string[] = [];
    const s = this.state.ship;
    if (!s) {
      return { combat: { ...combat, active: false }, lines: ["You have no ship to fight in."], outcome: "escaped", loot: 0 };
    }
    const pc = this.pc()!;
    const gunneryMod = computeModifier(pc, "gunnery");
    const combatLevel = Math.max(
      0,
      ...["gunnery", "piloting"].map((k) => pc.skills.find((x) => x.name === k)?.level ?? 0),
    );
    let enemies = combat.enemies.map((e) => ({ ...e }));
    let evasive = combat.playerCoverAc > 0;
    let fleeAttempts = combat.fleeAttempts;

    switch (action.type) {
      case "attack": {
        const enemy = enemies.find((e) => e.id === action.enemyId && e.hp > 0) ?? enemies.find((e) => e.hp > 0);
        if (enemy) {
          const w = s.weapons[0];
          if (w?.type === "missile" && (w.ammo ?? 0) <= 0) {
            lines.push("Missile racks are dry.");
          } else {
            const res = resolveShipAttack(
              {
                attackerSide: "player",
                attackMod: gunneryMod,
                weaponType: (w?.type as "kinetic") ?? "kinetic",
                damage: w?.damage ?? "1d8",
                target: {
                  id: enemy.id,
                  name: enemy.name,
                  hp: enemy.hp,
                  ac: enemy.ac,
                  armored: enemy.armored,
                  shieldReady: enemy.shieldReady,
                  isEvasive: enemy.isEvasive,
                  hasPointDefense: enemy.hasPointDefense,
                },
              },
              this.rng,
            );
            lines.push(`🎯 ${res.breakdown}`);
            enemy.hp = res.targetHpAfter;
            enemy.shieldReady = res.targetShieldReadyAfter;
            if (res.targetHpAfter <= 0) lines.push(`☠ ${enemy.name} is wrecked.`);
            if (w?.type === "missile") {
              this.state = {
                ...this.state,
                ship: { ...s, weapons: s.weapons.map((x) => (x.type === "missile" ? { ...x, ammo: Math.max(0, (x.ammo ?? 0) - 1) } : x)) },
              };
            }
          }
        }
        evasive = false;
        break;
      }
      case "cover":
        evasive = true;
        lines.push("🛡 Evasive maneuvers — throwing off their targeting.");
        break;
      case "item": {
        const item = catalogItem(action.itemId ?? "");
        if (item?.effect?.kind === "restoreShield" && itemCount(pc, item.id) > 0) {
          this.state = { ...this.state, ship: { ...this.state.ship!, shieldReady: true } };
          this.consumeItem(pc.id, item.id);
          lines.push(`⛨ ${item.name} — shields back online.`);
        } else {
          lines.push("Nothing to use.");
        }
        evasive = false;
        break;
      }
      case "flee": {
        if (s.burstDriveReady) {
          lines.push("💨 Burst drive fires — you punch clear of the engagement.");
          this.state = { ...this.state, ship: { ...s, burstDriveReady: false } };
          return { combat: { ...combat, active: false }, lines, outcome: "escaped", loot: 0 };
        }
        const dc = fleeDC(threatLevel(enemies), combatLevel, fleeAttempts);
        const mod = computeModifier(pc, "piloting");
        const d20 = this.rng.int(1, 20);
        const total = d20 + mod;
        fleeAttempts += 1;
        const escaped = total >= dc;
        lines.push(`🎲 Break off: d20(${d20})+${mod} = ${total} vs DC ${dc} → ${escaped ? "clear" : "they stay on you"}`);
        if (escaped) return { combat: { ...combat, active: false }, lines, outcome: "escaped", loot: 0 };
        evasive = false;
        break;
      }
    }

    enemies = enemies.filter((e) => e.hp > 0);
    if (enemies.length === 0) {
      const [lo, hi] = LOOT_BAND[combat.enemies[0]?.tier ?? "T2"];
      const loot = this.rng.int(lo, hi);
      this.state = {
        ...this.state,
        characters: this.state.characters.map((x) => (x.id === pc.id ? { ...x, credits: (x.credits ?? 0) + loot } : x)),
      };
      lines.push(`💰 Enemy driven off / destroyed — salvage worth ¢${loot}.`);
      return { combat: { ...combat, enemies, active: false }, lines, outcome: "victory", loot };
    }

    const next: CombatState = { ...combat, enemies, playerCoverAc: evasive ? 1 : 0, playerAimBonus: 0, fleeAttempts };
    const outcome = this.enemyShipVolley(next, evasive, lines);
    if (outcome === "continue") {
      next.round += 1;
      return { combat: next, lines, outcome, loot: 0 };
    }
    return { combat: { ...next, active: false }, lines, outcome, loot: 0 };
  }

  private offerChoices(input: Record<string, unknown>) {
    // Tutorial backstop: while the player is still on training wheels, hard-clamp
    // every offer to a binary decision (exactly two options) even if the narrator
    // proposes more — the prompt asks for this too, this guarantees it. `this.state`
    // reflects any thread resolved earlier THIS turn, so the beat that resolves the
    // 3rd quest already reads as graduated and keeps its full set of choices.
    const cap = inTutorial(this.state) ? TUTORIAL_CHOICE_COUNT : 4;
    const choices = ((input.choices as string[]) ?? [])
      .map((c) => String(c).trim())
      .filter(Boolean)
      .slice(0, cap);
    this.choices = choices;
    return { offered: choices.length };
  }

  private dmOverride(input: Record<string, unknown>) {
    const breakdown = `DM OVERRIDE: ${input.description} — ${input.reason}`;
    this.events.push({ type: "note", breakdown });
    return { applied: true, note: breakdown };
  }
}
