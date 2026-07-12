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
import { enemyTiers, shipClasses } from "@/content";
import { shipIsOwned, shipThreadId } from "@/shared/recap";

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
  private tickedRolls: { characterId: string; skill: string }[] = [];
  private clockAdvances: { clockId: string; amount: number; reason: string }[] = [];
  worldEvents: WorldEvent[] = [];
  /** Suggested clickable actions offered by the narrator this turn. */
  choices: string[] = [];
  private enemyCounter = 0;
  sceneEndReport: ReturnType<typeof runSceneEnd> | null = null;

  constructor(state: CampaignState, rng: RNG = liveRng) {
    this.state = state;
    this.rng = rng;
  }

  private char(id: string): Character | undefined {
    return this.state.characters.find((c) => c.id === id);
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
    if (res.tickEligible) {
      this.tickedRolls.push({ characterId: character.id, skill: String(input.skill) });
    }
    return {
      breakdown: res.breakdown,
      total: res.total,
      outcome: res.outcome,
      tickEligible: res.tickEligible,
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

  private adjustResource(input: Record<string, unknown>) {
    const targetId = String(input.targetId);
    const field = String(input.field);
    const delta = Number(input.delta);

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
      tickedRolls: this.tickedRolls,
      clockAdvances: this.clockAdvances,
      combatEnded: Boolean(input.combatEnded),
      tendaysDelta: input.tendaysDelta ? Number(input.tendaysDelta) : 0,
    });
    this.state = report.state;
    this.sceneEndReport = report;
    this.events.push(...report.events);
    return {
      title: input.title,
      checklist: report.checklist,
    };
  }

  private offerChoices(input: Record<string, unknown>) {
    const choices = ((input.choices as string[]) ?? [])
      .map((c) => String(c).trim())
      .filter(Boolean)
      .slice(0, 4);
    this.choices = choices;
    return { offered: choices.length };
  }

  private dmOverride(input: Record<string, unknown>) {
    const breakdown = `DM OVERRIDE: ${input.description} — ${input.reason}`;
    this.events.push({ type: "note", breakdown });
    return { applied: true, note: breakdown };
  }
}
