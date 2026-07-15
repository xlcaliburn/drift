import type { CampaignState, Character, WorldEvent } from "@/shared/schemas";
import {
  rollCheck,
  resolveShipAttack,
  resolvePersonalAttack,
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
import {
  spawnCombatEnemies,
  spawnCombatShips,
  playerAttack,
  enemyAttack,
  type SpawnSpec,
  type ShipSpawnSpec,
} from "@/engine/combatEngine";
import { fleeDC, threatLevel, weaponSkill } from "@/shared/combat";
import type { CombatState, CombatEnemy, CombatAction, CombatOutcome, PlayerCombatant } from "@/shared/combat";
import { catalogItem, itemCount, slotsUsed, maxSlotsFor } from "@/shared/items";
import { applyHeal, consumeItem, useItem, resolveDeathSave } from "./runtimeHeal";
import {
  quoteOffer,
  awardPayout,
  adjustResource,
  bestArmor,
  grantSceneItem,
  applyGearChange,
  resolveSwap,
  declineSwap,
  buyItem,
  sellItem,
  repairShip,
  restWithPatron,
  syncDockDebt,
} from "./runtimeEconomy";
import type { Attributes } from "@/shared/schemas";
import {
  advanceClock,
  adjustRep,
  updateThread,
  logWorldEvent,
  endScene,
  registerNpc,
  setNpcOneBreath,
  markPresent,
  updateScene,
  refreshSituation,
  nudgeStandingFromCheck,
  updateNpcRelation,
  bodyMod,
  respec,
  setAppearance,
} from "./runtimeNarrative";
import { freshSceneCard, type SceneCard, type NpcRelations } from "@/shared/scene";
import { inTutorial, TUTORIAL_CHOICE_COUNT } from "@/shared/tutorial";
import {
  freshDeathSaves,
  advanceSaves,
  type DownedAction,
  type DeathOutcome,
} from "@/shared/death";

/** Victory loot band by top tier faced (ECONOMY.md). */
const LOOT_BAND: Record<"T1" | "T2" | "T3", [number, number]> = {
  T1: [20, 60],
  T2: [80, 200],
  T3: [350, 700],
};

/** Skills whose successful use ON a present NPC moves your STANDING with them — the
 *  engine-owned relationship mechanic. A passed social check warms them (+1, +2 on a
 *  crit); a fumble cools them (-1). Capped 1/NPC/turn. Standing no longer depends on
 *  the model's whim or only quest completion — you win people over by rolling well. */
const RAPPORT_SKILLS = new Set(["negotiation"]);

/** Does a gained item's name read as real GEAR (a weapon or armor)? Such gains
 *  stay gated to a legit loot/quest source even when they don't match the catalog,
 *  so the model can't hand out a free "rocket launcher"; inert flavor props (a
 *  keepsake, a rose bouquet) fall through and are always allowed. */
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
  /** Clock advances previewed this turn; committed at end_scene. Public so
   *  runtimeNarrative (advanceClock/endScene) can read+push. */
  clockAdvances: { clockId: string; amount: number; reason: string }[] = [];
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
  /** NPCs already disposition-nudged this turn (engine cap: ±1/NPC/turn). Public so
   *  runtimeNarrative's relationship functions can read+add. */
  nudgedThisTurn = new Set<string>();
  /** True once a quest/job concluded THIS turn (a payout was awarded, or a thread
   *  resolved). Disposition only moves on such turns — standing is earned by
   *  completing work, not by chatting (built-in engine gate, not a prompt rule).
   *  Public so runtimeEconomy's gear gate can read it. */
  questCompletedThisTurn = false;

  /** Unlock disposition movement for this turn — called when a job/quest actually
   *  completes (payout awarded, thread resolved). Public so any completion path
   *  (and tests) can signal it. */
  markQuestCompleted() {
    this.questCompletedThisTurn = true;
  }

  /** True once the engine rolled loot this turn (a successful scavenge/loot check).
   *  Also lets the narrator's own items[] gains through — they corroborate what the
   *  engine just generated rather than conjuring something new. Public so
   *  runtimeEconomy's gear gate can read it. */
  lootedThisTurn = false;

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
        injuries = [...injuries, { name: "Downed", effect: "critical — bleeding out; three failed saves is death" }];
      }
    }
    // Seed the death-save track the moment they go down (Bleeding Out); a hit that
    // lands WHILE already down tacks on a failure — the D&D "struck while down".
    let deathSaves = c.deathSaves;
    if (downed) deathSaves = deathSaves ?? freshDeathSaves();
    if (before === 0 && !died && deathSaves) deathSaves = advanceSaves(deathSaves, { failures: 1 });
    this.state = {
      ...this.state,
      characters: this.state.characters.map((x) =>
        x.id === characterId ? { ...x, hp, injuries, ...(deathSaves ? { deathSaves } : {}) } : x,
      ),
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
        return adjustResource(this, input);
      case "advance_clock":
        return advanceClock(this, input);
      case "adjust_rep":
        return adjustRep(this, input);
      case "update_thread":
        return updateThread(this, input);
      case "log_world_event":
        return logWorldEvent(this, input);
      case "end_scene":
        return endScene(this, input);
      case "award_payout":
        return awardPayout(this, input);
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
      // XP scales with the roll: 2 on a success, 1 on a failure (you learn more
      // from a win, but you still learn from trying).
      const award = awardTick(character, skillName, perChar, res.outcome === "success" ? 2 : 1);
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
        // Capacity-aware (ITEMS.md slice B): each find must fit or it's left in
        // the wreck — the line says so. Credits always fit.
        const cap = maxSlotsFor(target);
        let gear = [...(target.gear ?? [])];
        let leftBehind = false;
        for (const g of drop.gear) {
          const next = [...gear, { name: g.name, detail: g.detail }];
          if (slotsUsed({ ...target, gear: next }) > cap) {
            leftBehind = true;
            continue;
          }
          gear = next;
        }
        for (const itemId of drop.consumables) {
          const cat = catalogItem(itemId);
          if (!cat) continue;
          const ex = gear.find((x) => x.itemId === itemId);
          const next = ex
            ? gear.map((x) => (x === ex ? { ...x, qty: (x.qty ?? 1) + 1 } : x))
            : [...gear, { name: cat.name, itemId: cat.id, qty: 1 }];
          if (slotsUsed({ ...target, gear: next }) > cap) {
            leftBehind = true;
            continue;
          }
          gear = next;
        }
        if (leftBehind) drop.line += " · pack full — some of it stays in the wreck";
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
    // Relationship: a passed SOCIAL check on the present NPC moves your standing.
    let standing: string | undefined;
    if (RAPPORT_SKILLS.has(String(input.skill))) {
      standing = nudgeStandingFromCheck(this, res.outcome, res.critical, res.criticalFailure);
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
      ...(standing ? { standing } : {}),
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
  /** A negotiation-shaded QUOTE inside a job tier's band — a bid the model presents
   *  (grants nothing). runtimeEconomy.quoteOffer. */
  quoteOffer(tier: "T0" | "T1" | "T2" | "T3", mood?: "high" | "low"): number | null {
    return quoteOffer(this, tier, mood);
  }

  // ── World / narrative (clocks, rep, threads, world events, scene close, NPCs,
  //    relations, character services) — runtimeNarrative.ts. advanceClock/adjustRep/
  //    updateThread/logWorldEvent/endScene are dispatched by execute() as free fns;
  //    the rest keep delegating methods for their external/applyPlan callers. ──

  /** Persist a named NPC the narrator introduced (runtimeNarrative.registerNpc). */
  registerNpc(name: string, oneBreath?: string, role?: string): { added: boolean; id: string } {
    return registerNpc(this, name, oneBreath, role);
  }

  /** Force-refresh a cast NPC's one-liner (runtimeNarrative.setNpcOneBreath). */
  setNpcOneBreath(id: string, oneBreath: string, role?: string) {
    setNpcOneBreath(this, id, oneBreath, role);
  }

  /** A flavor scene item (a keepsake, a note) — runtimeEconomy.grantSceneItem. */
  grantSceneItem(name: string, note?: string): string | null {
    return grantSceneItem(this, name, note);
  }

  /** Narrative item pickup/loss written into the PC's gear (runtimeEconomy). */
  applyGearChange(name: string, action: "gain" | "lose", note?: string): string | null {
    return applyGearChange(this, name, action, note);
  }

  /** Full-pack swap: drop to take the parked pickup (runtimeEconomy.resolveSwap). */
  resolveSwap(dropName: string): { line?: string; error?: string } {
    return resolveSwap(this, dropName);
  }

  /** Leave a parked pending pickup behind (runtimeEconomy.declineSwap). */
  declineSwap(): { line?: string } {
    return declineSwap(this);
  }

  // ── Shops + dock services (ITEMS.md E / ECONOMY E-3) — runtimeEconomy.ts ─────

  /** Buy from the local market (runtimeEconomy.buyItem). */
  buyItem(itemId: string, qty = 1): { line?: string; error?: string } {
    return buyItem(this, itemId, qty);
  }

  /** Sell carried gear at the flat 40% rate (runtimeEconomy.sellItem). */
  sellItem(name: string): { line?: string; error?: string } {
    return sellItem(this, name);
  }

  /** Dock hull repair at ¢12/HP, credit extended (runtimeEconomy.repairShip). */
  repairShip(hpWanted?: number): { line?: string; error?: string } {
    return repairShip(this, hpWanted);
  }

  /** The faction PATRON's free safety net (runtimeEconomy.restWithPatron). */
  restWithPatron(): { line?: string; error?: string } {
    return restWithPatron(this);
  }

  /** Reconcile the Dock-debt thread with the wallet (runtimeEconomy.syncDockDebt). */
  syncDockDebt() {
    syncDockDebt(this);
  }

  /**
   * Rook Station body-modification service (Chrome's studio). For a flat ¢500 the
   * artist reshapes the character's APPEARANCE and works the change into their
   * STORY (appended to backstory) — a diegetic way to re-customize a character.
   * Elective/cosmetic, so it's REFUSED when they can't afford it (unlike survival
   * dock repair). Gated to Rook; the engine owns the charge and the writes.
   */
  /** Rook body-mod: reshape appearance + weave into story (runtimeNarrative.bodyMod). */
  bodyMod(input: { appearance?: string; story?: string }): { line?: string; error?: string } {
    return bodyMod(this, input);
  }

  /** Full Rook remake — rename/reallocate/reshape (runtimeNarrative.respec). */
  respec(input: { name?: string; attributes?: Attributes; appearance?: string }): { line?: string; error?: string } {
    return respec(this, input);
  }

  /** Set the PC's appearance text without charging (runtimeNarrative.setAppearance). */
  setAppearance(text: string) {
    setAppearance(this, text);
  }

  /** Mark an NPC present in the current scene (runtimeNarrative.markPresent). */
  markPresent(npcId: string) {
    markPresent(this, npcId);
  }

  /** Apply the model's scene-card proposal (runtimeNarrative.updateScene). */
  updateScene(situation?: string, beats?: string[], place?: string, dangers?: string[]) {
    updateScene(this, situation, beats, place, dangers);
  }

  /** Derive Here & now from the narration when the model didn't set it
   *  (runtimeNarrative.refreshSituation). */
  refreshSituation(narration: string) {
    refreshSituation(this, narration);
  }

  /** Update the player's standing with an NPC (runtimeNarrative.updateNpcRelation). */
  updateNpcRelation(
    npcId: string,
    upd: { disposition?: number; note?: string; relationship?: string },
  ): { line?: string } {
    return updateNpcRelation(this, npcId, upd);
  }

  // ── Multi-turn combat (COMBAT.md) ──────────────────────────────────────────

  private pc(): Character | undefined {
    return this.state.characters.find((c) => c.kind === "pc");
  }

  /** Resolve ONE turn of Bleeding Out (COMBAT.md — runtimeHeal.resolveDeathSave). */
  resolveDeathSave(
    action: DownedAction,
    ctx: { hostilePresent?: boolean; hazardPresent?: boolean } = {},
  ): { lines: string[]; outcome: DeathOutcome | "recovered" } {
    return resolveDeathSave(this, action, ctx);
  }

  /** Use a consumable OUT of combat (runtimeHeal.useItem). */
  useItem(itemId: string, characterId?: string): { line?: string; error?: string } {
    return useItem(this, itemId, characterId);
  }

  /** Derive the PC's personal-scale combat profile (best weapon, combat level). */
  /** The weapon the character fights BEST with — highest to-hit for the weapon's
   *  own skill (a blade rolls melee/might, a gun rolls smallArms/reflex), tie-broken
   *  by damage. This is why a melee build defaults to his knife instead of auto-
   *  firing a gun he has no ranged skill for. */
  private defaultWeapon(pc: Character): Character["gear"][number] | undefined {
    const weapons = pc.gear.filter((g) => g.damage);
    if (!weapons.length) return undefined;
    return [...weapons].sort((a, b) => {
      const ma = computeModifier(pc, weaponSkill(a.name));
      const mb = computeModifier(pc, weaponSkill(b.name));
      if (mb !== ma) return mb - ma;
      return maxDice(String(b.damage)) - maxDice(String(a.damage));
    })[0];
  }

  private personalCombatant(weaponName?: string): PlayerCombatant {
    const pc = this.pc()!;
    const weapons = pc.gear.filter((g) => g.damage);
    // The drawn weapon if named + still carried, else the character-aware default.
    const weapon = (weaponName ? weapons.find((g) => g.name === weaponName) : undefined) ?? this.defaultWeapon(pc);
    const weaponDamage = weapon?.damage ?? "1d4"; // unarmed → 1d4
    // Attack with the WEAPON's skill (melee for a blade, smallArms for a gun);
    // unarmed reads as melee. This was the always-miss bug: smallArms was forced.
    const attackMod = computeModifier(pc, weaponSkill(weapon?.name));
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
    const pc = this.pc();
    const combat: CombatState = {
      active: true,
      round: 1,
      scale,
      enemies,
      playerCoverAc: 0,
      // Ship-scale surprise keeps its flat aim edge; personal-scale surprise uses the
      // D&D rule instead (opening strike at advantage + the foe can't answer round 1).
      playerAimBonus: scale === "ship" && surprise === "player" ? 2 : 0,
      playerSurprise: scale === "personal" && surprise === "player",
      fleeAttempts: 0,
      // Draw the weapon this character fights best with; the player can switch.
      ...(scale === "personal" && pc ? { weaponName: this.defaultWeapon(pc)?.name } : {}),
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
    const cbt = this.personalCombatant(combat.weaponName);
    let enemies = combat.enemies.map((e) => ({ ...e }));
    let aim = combat.playerAimBonus;
    let cover = combat.playerCoverAc;
    let fleeAttempts = combat.fleeAttempts;
    // Surprise round: the player struck an unaware foe. The opening strike rolls with
    // advantage and the surprised enemies get NO return volley this round (D&D). One
    // round only — cleared on `next` so round 2 onward is a normal exchange.
    const surpriseRound = combat.playerSurprise === true;

    // Drawing another weapon is FREE — a quick swap that doesn't cost the round or
    // draw a volley, so a fight isn't a trap when you opened with the wrong tool.
    if (action.type === "switch") {
      const pc = this.pc();
      const w = pc?.gear.find((g) => g.damage && g.name === action.weaponName);
      if (w) {
        lines.push(`🔁 You draw your ${w.name}.`);
        return { combat: { ...combat, weaponName: w.name, playerSurprise: surpriseRound }, lines, outcome: "continue", loot: 0 };
      }
    }

    switch (action.type) {
      case "attack": {
        const enemy = enemies.find((e) => e.id === action.enemyId && e.hp > 0) ?? enemies.find((e) => e.hp > 0);
        if (enemy) {
          const r = playerAttack(enemy, cbt.attackMod, cbt.weaponDamage, aim, this.rng, surpriseRound);
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
          const after = applyHeal(this, pc.id, rollDamage(eff.dice ?? "1d6+2", this.rng));
          consumeItem(this, pc.id, itemId);
          lines.push(`🩹 ${item.name}: +${after - before} HP — ${before}→${after}.`);
          cover = 0;
        } else if (eff?.kind === "aoe") {
          const dmg = rollDamage(eff.dice ?? "2d6", this.rng);
          enemies = enemies.map((e) => (e.hp > 0 ? { ...e, hp: Math.max(0, e.hp - dmg) } : e));
          consumeItem(this, pc.id, itemId);
          lines.push(`💥 ${item.name}: ${dmg} to every enemy.`);
          aim = 0;
          cover = 0;
        } else if (eff?.kind === "autoFlee") {
          consumeItem(this, pc.id, itemId);
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

    // Enemy volley (halts if the player drops) — SKIPPED on the surprise round: the
    // ambushed foe is caught flat-footed and can't answer until it has had a turn.
    const next: CombatState = {
      ...combat, enemies, playerAimBonus: aim, playerCoverAc: cover, fleeAttempts, playerSurprise: false,
    };
    if (surpriseRound) {
      lines.push("You struck from surprise — they don't get to answer this round.");
      next.round += 1;
      return { combat: next, lines, outcome: "continue", loot: 0 };
    }
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
          consumeItem(this, pc.id, item.id);
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
