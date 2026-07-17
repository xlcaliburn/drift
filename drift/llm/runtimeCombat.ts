import type { CampaignState, Character } from "@/shared/schemas";
import {
  rollCheck as rollCheckEngine,
  resolveShipAttack,
  resolvePersonalAttack,
  computeModifier,
  type RNG,
  type CombatTarget,
  type EngineEvent,
} from "@/engine";
import { enemyTiers, shipClasses, economy, isHazardSkill } from "@/content";
import { applyCombatDeaths } from "@/shared/npcFate";
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
import { crewAssistBonus } from "@/shared/crew";
import type { CombatState, CombatEnemy, CombatAction, CombatOutcome, PlayerCombatant } from "@/shared/combat";
import { catalogItem, itemCount, slotsUsed, maxSlotsFor, resolveGearItemId } from "@/shared/items";
import {
  applyStatus,
  tickStatuses,
  acPenalty,
  resistFactor,
  clearOnHeal,
  statusIcon,
  statusLabel,
  type StatusEffect,
  type StatusKind,
  type DamageType,
} from "@/shared/status";
import { inTutorial } from "@/shared/tutorial";
import { freshDeathSaves, advanceSaves } from "@/shared/death";
import type { SceneCard, NpcRelations } from "@/shared/scene";
import { applyHeal, consumeItem, reviveDowned } from "./runtimeHeal";
import { nudgeStandingFromCheck } from "./runtimeNarrative";

/**
 * The combat + check side of TurnRuntime, split out of engineBridge.ts as free
 * functions over a CombatRT surface. Covers damage application (personal + ship),
 * skill checks (rollCheck, with hazard damage + ticks + loot + rapport), attacks
 * and encounter spawns, and the multi-turn combat rounds (personal + ship). This
 * is the deterministic combat math — the one invariant; the runtime is the only
 * mutator. Fully covered by the combat* / deathGate / immediateTicks test suites.
 */
export interface CombatRT {
  state: CampaignState;
  rng: RNG;
  events: EngineEvent[];
  enemies: Map<string, CombatTarget>;
  enemyCounter: number;
  tickedThisScene: Set<string>;
  lootedThisTurn: boolean;
  // rollCheck moves standing on a passed social check → it calls
  // nudgeStandingFromCheck, which needs these (the RelationRT subset).
  sceneCard: SceneCard;
  npcRelations: NpcRelations;
  nudgedThisTurn: Set<string>;
}

/** Victory loot band by top tier faced (ECONOMY.md). */
const LOOT_BAND: Record<"T1" | "T2" | "T3", [number, number]> = {
  T1: [20, 60],
  T2: [80, 200],
  T3: [350, 700],
};

/** Skills whose successful use ON a present NPC moves your STANDING (rapport). */
const RAPPORT_SKILLS = new Set(["negotiation"]);

const charOf = (rt: CombatRT, id: string): Character | undefined => rt.state.characters.find((c) => c.id === id);
const pcOf = (rt: CombatRT): Character | undefined => rt.state.characters.find((c) => c.kind === "pc");
const isDeadChar = (c: Character): boolean => (c.injuries ?? []).some((i) => i.name === "Dead");
const isShipTarget = (rt: CombatRT, id: string): boolean =>
  !!rt.state.ship && (id === rt.state.ship.id || id === "ship" || id === "lark");

// ── Status system (ITEMS.md) — read gear traits + resolve per-round effects ──

interface PlayerDefense {
  resist?: DamageType;
  vuln?: DamageType;
  statusGuard: StatusKind[];
  mobilityPenalty: boolean;
}

/** The catalog item of the best armor piece worn (highest AC), whose TRAITS
 *  (resist/vuln/statusGuard/mobility) apply — mirrors bestArmor's "best single piece". */
function wornArmorItem(pc: Character) {
  let best: ReturnType<typeof catalogItem>;
  let bestAc = -1;
  for (const g of pc.gear ?? []) {
    const id = resolveGearItemId(g);
    const it = id ? catalogItem(id) : undefined;
    if (!it || it.type !== "armor") continue;
    const ac = it.acBonus ?? 0;
    if (ac > bestAc) { bestAc = ac; best = it; }
  }
  return best;
}

function playerDefense(pc: Character): PlayerDefense {
  const a = wornArmorItem(pc);
  return { resist: a?.resist, vuln: a?.vuln, statusGuard: a?.statusGuard ?? [], mobilityPenalty: !!a?.mobilityPenalty };
}

/** Tools that AID a skill check when carried — the reusable alternative to a
 *  one-shot charge (ITEMS.md slice 4): a scanner sharpens perception, lockpicks help
 *  with locks/mechanisms, a grapnel with climbs. Makes a tool worth its slot + price. */
const TOOL_SKILL_BONUS: Record<string, Partial<Record<string, number>>> = {
  scanner: { perception: 2, streetwise: 1 },
  lockpicks: { mechanics: 2, electronics: 2 },
  grapnel: { athletics: 2 },
};

/** Total bonus a character's held tools grant to a given skill check. */
export function toolBonus(pc: Character, skill: string): number {
  let bonus = 0;
  for (const [toolId, skillMap] of Object.entries(TOOL_SKILL_BONUS)) {
    if (itemCount(pc, toolId) > 0) bonus += skillMap[skill] ?? 0;
  }
  return bonus;
}

/** The drawn weapon's on-hit status + damage type + armor-pierce, from the catalog. */
function drawnWeaponTraits(weapon?: Character["gear"][number]): {
  weaponType?: DamageType;
  weaponOnHit?: StatusKind;
  armorPen: number;
} {
  const id = weapon ? resolveGearItemId(weapon) : undefined;
  const it = id ? catalogItem(id) : undefined;
  return { weaponType: it?.damageType, weaponOnHit: it?.onHit, armorPen: it?.armorPen ?? 0 };
}

/**
 * Round-start status resolution for the player + every live enemy: DoT ticks,
 * duration decrements, and the Shocked-skip flags for this round. Mutates the passed
 * `enemies` (hp + statuses). Returns the player's post-tick statuses, the set of
 * enemies that are Shocked (they skip their volley), whether the player is Shocked
 * (skips their action), and a fatal outcome if the player's own DoT dropped them.
 */
function tickRoundStatuses(
  rt: CombatRT,
  enemies: CombatEnemy[],
  playerStatuses: StatusEffect[],
  lines: string[],
): { playerStatuses: StatusEffect[]; skipIds: Set<string>; playerSkip: boolean; outcome: CombatOutcome | null } {
  const pc = pcOf(rt)!;
  const pt = tickStatuses(playerStatuses, "You", rt.rng);
  lines.push(...pt.lines);
  let outcome: CombatOutcome | null = null;
  if (pt.damage > 0) {
    const harm = applyDamage(rt, pc.id, pt.damage, "status effect");
    if (harm.died) outcome = "dead";
    else if (harm.downed) outcome = "downed";
  }
  const skipIds = new Set<string>();
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const et = tickStatuses(e.statuses, e.name, rt.rng);
    lines.push(...et.lines);
    e.statuses = et.statuses;
    if (et.skipTurn) skipIds.add(e.id);
    if (et.damage > 0) {
      e.hp = Math.max(0, e.hp - et.damage);
      if (e.hp <= 0) lines.push(`☠ ${e.name} succumbs to it.`);
    }
  }
  return { playerStatuses: pt.statuses, skipIds, playerSkip: pt.skipTurn, outcome };
}

// ── Crew in combat (CREW.md §4) — the party fights beside the PC ──

/** Living, standing crew (kind "party", up, not dead). */
function standingCrew(rt: CombatRT): Character[] {
  return rt.state.characters.filter((c) => c.kind === "party" && c.hp > 0 && !isDeadChar(c));
}

/** A living medic whose once-per-fight stabilize is unspent. */
function readyMedic(rt: CombatRT, combat: CombatState): Character | undefined {
  return standingCrew(rt).find((c) => c.crewRole === "medic" && !(combat.medicSpentIds ?? []).includes(c.id));
}

/** The medic catches a DOWNED character — the PC dropping mid-volley (the difference
 *  between "left for dead" and back on your feet), or a downed crewmate on the crew
 *  phase: 1d4 heal, Downed + death-saves cleared, ONCE per fight per medic. */
function medicStabilize(rt: CombatRT, combat: CombatState, targetId: string, lines: string[]): boolean {
  const medic = readyMedic(rt, combat);
  const target = charOf(rt, targetId);
  if (!medic || !target) return false;
  combat.medicSpentIds = [...(combat.medicSpentIds ?? []), medic.id];
  const hp = rt.rng.int(1, 4);
  reviveDowned(rt, targetId, hp);
  lines.push(`⚕ ${medic.name} drags ${target.kind === "pc" ? "you" : target.name} back up — ${hp} HP.`);
  rt.events.push({ type: "note", breakdown: `${medic.name} stabilized ${target.name} (medic — once per fight).` });
  return true;
}

/** Crew act after the player — ONE summary line per round (C-3): muscle/gunner
 *  attack the front enemy, the medic patches a downed crewmate, the rest hold
 *  position (their value is out-of-fight passives). Mutates `enemies`. */
function crewPhase(rt: CombatRT, combat: CombatState, enemies: CombatEnemy[], lines: string[]): void {
  const acts: string[] = [];
  for (const m of standingCrew(rt)) {
    if (m.crewRole === "medic") {
      const downedMate = rt.state.characters.find(
        (c) =>
          c.kind === "party" && c.id !== m.id && !isDeadChar(c) &&
          c.hp <= 0 && (c.injuries ?? []).some((i) => i.name === "Downed"),
      );
      if (downedMate) medicStabilize(rt, combat, downedMate.id, lines);
      continue;
    }
    if (m.crewRole !== "muscle" && m.crewRole !== "gunner") continue; // hold position
    const target = enemies.find((e) => e.hp > 0);
    if (!target) break;
    const w = defaultWeapon(m);
    const effAc = Math.max(1, target.ac - acPenalty(target.statuses));
    const r = playerAttack({ ...target, ac: effAc }, computeModifier(m, weaponSkill(w?.name)), w?.damage ? String(w.damage) : "1d4", 0, rt.rng);
    target.hp = r.enemyHpAfter;
    target.shieldReady = r.shieldReadyAfter;
    acts.push(
      r.hit
        ? r.damage > 0
          ? `${m.name} hits ${target.name} — ${r.damage}${r.killed ? ` · ${target.name} down` : ""}`
          : `${m.name} hits ${target.name}'s shield`
        : `${m.name} misses ${target.name}`,
    );
  }
  if (acts.length) lines.push(`🧑‍🚀 Crew — ${acts.join(" · ")}.`);
}

export function applyDamage(rt: CombatRT, characterId: string, amount: number, reason: string) {
  const c = charOf(rt, characterId);
  if (!c || amount <= 0) return { hpAfter: c?.hp ?? 0, taken: 0, downed: false, died: false };
  const before = c.hp;
  const hp = Math.max(0, before - amount);
  let injuries = c.injuries ?? [];
  let downed = false;
  let died = false;
  // No permadeath during the tutorial — the worst that happens is staying Downed.
  const lethal = !inTutorial(rt.state);
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
  // Seed the death-save track the moment they go down; a hit that lands WHILE already
  // down tacks on a failure — the D&D "struck while down".
  let deathSaves = c.deathSaves;
  if (downed) deathSaves = deathSaves ?? freshDeathSaves();
  if (before === 0 && !died && deathSaves) deathSaves = advanceSaves(deathSaves, { failures: 1 });
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((x) =>
      x.id === characterId ? { ...x, hp, injuries, ...(deathSaves ? { deathSaves } : {}) } : x,
    ),
  };
  const tag = died ? " · KILLED" : downed ? " · DOWNED" : "";
  rt.events.push({
    type: "resource",
    breakdown: `${c.name} takes ${amount} damage — ${before}→${hp} HP${tag}`,
    field: "hp",
    delta: -amount,
  });
  if (died) rt.events.push({ type: "note", breakdown: `${c.name} has DIED. ${reason}` });
  return { hpAfter: hp, taken: amount, downed, died };
}

export function rollCheck(rt: CombatRT, input: Record<string, unknown>) {
  const character = charOf(rt, String(input.characterId));
  if (!character) return { error: `unknown character ${input.characterId}` };
  const dcMod = input.useShipDcModifier && rt.state.ship ? rt.state.ship.dcModifier : 0;
  // A held tool aids its skill (scanner→perception, lockpicks→locks, grapnel→climb),
  // and a crew SPECIALIST assists the PC's checks (engineer→mechanics, pilot→piloting,
  // face→negotiation/streetwise — CREW.md §4 passives). Both ride the auditable
  // `situational` slot of the breakdown.
  const tool = toolBonus(character, String(input.skill));
  const assist = character.kind === "pc" ? crewAssistBonus(rt.state, String(input.skill)) : 0;
  const res = rollCheckEngine(
    {
      character,
      skill: String(input.skill),
      dc: Number(input.dc),
      stakes: Boolean(input.stakes),
      situationalMod: (input.situationalMod ? Number(input.situationalMod) : 0) + tool + assist,
      dcModifier: dcMod,
    },
    rt.rng,
  );
  rt.events.push(res.event);
  // Award the skill tick IMMEDIATELY (cheap narrators rarely call end_scene). The
  // per-character set enforces the max-1-tick-per-skill-per-scene cap.
  let tick: string | undefined;
  let tickCapped: string | undefined;
  if (res.tickEligible) {
    const skillName = String(input.skill);
    const perChar = new Set(
      [...rt.tickedThisScene]
        .filter((k) => k.startsWith(`${character.id}:`))
        .map((k) => k.slice(character.id.length + 1)),
    );
    // XP scales with the roll: 2 on a success, 1 on a failure.
    const award = awardTick(character, skillName, perChar, res.outcome === "success" ? 2 : 1);
    if (award.ticked) {
      rt.tickedThisScene.add(`${character.id}:${skillName}`);
      rt.state = {
        ...rt.state,
        characters: rt.state.characters.map((c) => (c.id === character.id ? award.character : c)),
      };
      rt.events.push(award.event);
      tick = award.event.breakdown;
    } else {
      tickCapped = skillName;
    }
  }
  // Real stakes: a failed roll that carries failDamage HURTS — but only from a
  // PHYSICAL HAZARD (a hazard skill, or an explicit danger save via input.hazard).
  let harm: { taken: number; hpAfter: number; downed: boolean; died: boolean } | undefined;
  let shipHarm: { taken: number; hpAfter: number; disabled: boolean } | undefined;
  if (res.outcome === "failure" && (input.hazardLevel || input.failDamage)) {
    const skill = String(input.skill);
    const explicit = input.hazardLevel ? Number(input.hazardLevel) : 0;
    const derived = !explicit && input.failDamage ? Math.ceil(maxDice(String(input.failDamage)) / 2) : 0;
    const level = Math.max(1, Math.min(economy.damageRules.maxHazardLevel, explicit || derived || 1));
    const dealt = rt.rng.int(0, economy.damageRules.hazardBase) * level;
    if (dealt > 0 && input.target === "ship" && rt.state.ship) {
      // A flying/docking mishap damages the HULL, not the pilot.
      const sh = applyShipDamage(rt, dealt);
      shipHarm = { taken: sh.taken, hpAfter: sh.hpAfter, disabled: sh.disabled };
    } else if (dealt > 0 && input.target !== "ship" && (Boolean(input.hazard) || isHazardSkill(skill))) {
      harm = applyDamage(rt, character.id, dealt, `Failed ${skill} check.`);
    }
  }
  // Engine-owned loot: a successful loot/scavenge ATTEMPT is where items come from —
  // the engine decides the haul; the player never names it.
  let loot: string | undefined;
  if (input.loot && res.outcome === "success") {
    const drop = generateScavengeLoot(rt.rng, { crit: res.critical });
    rt.lootedThisTurn = true;
    const target = charOf(rt, character.id);
    if (target) {
      // Capacity-aware (ITEMS.md slice B): each find must fit or it's left in the wreck.
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
      rt.state = {
        ...rt.state,
        characters: rt.state.characters.map((c) =>
          c.id === character.id ? { ...c, gear, credits: (c.credits ?? 0) + drop.credits } : c,
        ),
      };
    }
    rt.events.push({ type: "note", breakdown: drop.line });
    loot = drop.line;
  }
  // Relationship: a passed SOCIAL check on the present NPC moves your standing.
  let standing: string | undefined;
  if (RAPPORT_SKILLS.has(String(input.skill))) {
    standing = nudgeStandingFromCheck(rt, res.outcome, res.critical, res.criticalFailure);
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

function attackModFor(rt: CombatRT, attackerId: string | undefined, scale: string): number {
  if (!attackerId) return 5;
  const c = charOf(rt, attackerId);
  if (c) return computeModifier(c, scale === "ship" ? "gunnery" : "smallArms");
  // enemy attacker: use stored tier atk if present
  const enemy = rt.enemies.get(attackerId) as (CombatTarget & { atk?: number }) | undefined;
  return enemy?.atk ?? 5;
}

export function resolveAttack(rt: CombatRT, input: Record<string, unknown>) {
  const scale = String(input.scale);
  const attackMod =
    input.attackMod !== undefined
      ? Number(input.attackMod)
      : attackModFor(rt, input.attackerId as string | undefined, scale);
  const targetId = String(input.targetId);

  // Build the target from ship, character, or spawned enemy.
  let target: CombatTarget;
  let commit: (hpAfter: number, shieldReady: boolean) => void;

  if (isShipTarget(rt, targetId)) {
    const s = rt.state.ship!;
    target = {
      id: s.id,
      name: s.name,
      hp: s.hp,
      ac: s.ac,
      armored: s.damageReduction > 0,
      shieldReady: s.hasShield && s.shieldReady,
    };
    commit = (hp, shield) => {
      rt.state = { ...rt.state, ship: { ...s, hp, shieldReady: shield } };
    };
  } else if (rt.enemies.has(targetId)) {
    target = rt.enemies.get(targetId)!;
    commit = (hp, shield) => {
      rt.enemies.set(targetId, { ...target, hp, shieldReady: shield });
    };
  } else {
    const c = charOf(rt, targetId);
    if (!c) return { error: `unknown target ${targetId}` };
    target = { id: c.id, name: c.name, hp: c.hp, ac: c.ac };
    commit = (hp) => {
      rt.state = {
        ...rt.state,
        characters: rt.state.characters.map((x) => (x.id === c.id ? { ...x, hp } : x)),
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
          rt.rng,
        )
      : resolvePersonalAttack(
          {
            attackerSide: input.attackerSide === "enemy" ? "enemy" : "player",
            attackMod,
            damage: String(input.damage),
            target: { ...target, damageReduction: 0 },
          },
          rt.rng,
        );

  rt.events.push(...res.events);
  commit(res.targetHpAfter, res.targetShieldReadyAfter);
  return {
    breakdown: res.breakdown,
    hit: res.hit,
    damageDealt: res.damageDealt,
    targetHpAfter: res.targetHpAfter,
    destroyed: res.targetHpAfter <= 0,
  };
}

export function spawnEncounter(rt: CombatRT, input: Record<string, unknown>) {
  const composition = (input.composition as Array<Record<string, unknown>>) ?? [];
  const spawned: Array<{ id: string; name: string; hp: number; ac: number }> = [];
  for (const spec of composition) {
    const tierKey = String(spec.tier) as keyof typeof enemyTiers.tiers;
    const tier = enemyTiers.tiers[tierKey];
    const classKey = spec.shipClass ? (String(spec.shipClass) as keyof typeof shipClasses.classes) : null;
    const cls = classKey ? shipClasses.classes[classKey] : null;

    const hpRange = (cls?.hpRange ?? tier?.hpRange ?? [15, 20]) as [number, number];
    const hp = rt.rng.int(hpRange[0], hpRange[1]);
    const acRange = (cls?.acRange ?? (tier as { acRange?: [number, number]; ac?: number })?.acRange) as
      | [number, number]
      | undefined;
    const ac = acRange ? rt.rng.int(acRange[0], acRange[1]) : (tier as { ac?: number })?.ac ?? 14;

    const id = `enemy-${++rt.enemyCounter}`;
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
    rt.enemies.set(id, target);
    spawned.push({ id, name, hp, ac });
  }
  rt.events.push({ type: "note", breakdown: `Spawned: ${spawned.map((s) => `${s.name}(${s.id}, ${s.hp}hp/AC${s.ac})`).join(", ")}` });
  return { enemies: spawned };
}

/** The weapon the character fights BEST with — highest to-hit for the weapon's own
 *  skill (a blade rolls melee/might, a gun rolls smallArms/reflex), tie-broken by
 *  damage. Why a melee build defaults to his knife instead of auto-firing a gun. */
function defaultWeapon(pc: Character): Character["gear"][number] | undefined {
  const weapons = pc.gear.filter((g) => g.damage);
  if (!weapons.length) return undefined;
  return [...weapons].sort((a, b) => {
    const ma = computeModifier(pc, weaponSkill(a.name));
    const mb = computeModifier(pc, weaponSkill(b.name));
    if (mb !== ma) return mb - ma;
    return maxDice(String(b.damage)) - maxDice(String(a.damage));
  })[0];
}

function personalCombatant(rt: CombatRT, weaponName?: string): PlayerCombatant {
  const pc = pcOf(rt)!;
  const weapons = pc.gear.filter((g) => g.damage);
  // The drawn weapon if named + still carried, else the character-aware default.
  const weapon = (weaponName ? weapons.find((g) => g.name === weaponName) : undefined) ?? defaultWeapon(pc);
  const weaponDamage = weapon?.damage ?? "1d4"; // unarmed → 1d4
  // Attack with the WEAPON's skill (melee for a blade, smallArms for a gun); unarmed
  // reads as melee. This was the always-miss bug: smallArms was forced.
  const attackMod = computeModifier(pc, weaponSkill(weapon?.name));
  const combatLevel = Math.max(
    0,
    ...["smallArms", "gunnery", "melee"].map((s) => pc.skills.find((k) => k.name === s)?.level ?? 0),
  );
  return {
    hp: pc.hp, maxHp: pc.maxHp, ac: pc.ac, attackMod, weaponDamage, combatLevel,
    ...drawnWeaponTraits(weapon),
    ...playerDefense(pc),
  };
}

/** Enemies attack the party; halts the instant the PLAYER drops with no medic to
 *  catch them (COMBAT D-4 + CREW.md §4). Fire is split at random across the PC +
 *  STANDING crew; a downed crew member stops being a target (the medic can pick
 *  them up on the crew phase). A Shocked enemy (`skipIds`) loses its volley.
 *  Incoming PLAYER damage is scaled by armor resist/vuln vs the enemy's damage
 *  type, and a T2+ enemy's on-hit status lands unless the armor guards it (crew
 *  keep flat AC and no statuses in v1). `combat.playerStatuses`/`medicSpentIds`
 *  are mutated. */
function enemyVolley(rt: CombatRT, combat: CombatState, lines: string[], skipIds: Set<string> = new Set()): CombatOutcome {
  const def = playerDefense(pcOf(rt)!);
  for (const enemy of combat.enemies) {
    if (enemy.hp <= 0) continue;
    if (skipIds.has(enemy.id)) {
      lines.push(`⚡ ${enemy.name} is Shocked — can't act.`);
      continue;
    }
    const swings = enemy.multiAttack ? 2 : 1;
    for (let i = 0; i < swings; i++) {
      const pc = pcOf(rt)!;
      if (pc.hp <= 0) return isDeadChar(pc) ? "dead" : "downed";
      // Split fire across the standing party.
      const targets: Character[] = [pc, ...standingCrew(rt)];
      const pick = targets.length === 1 ? pc : targets[rt.rng.int(0, targets.length - 1)];
      if (pick.kind === "pc") {
        // Corroded armor lowers the player's AC; cover still helps.
        const targetAc = pc.ac + combat.playerCoverAc - acPenalty(combat.playerStatuses);
        const atk = enemyAttack(enemy, targetAc, rt.rng);
        lines.push(`💢 ${atk.breakdown}`);
        if (atk.hit) {
          const factor = resistFactor(enemy.personalDamageType, def.resist, def.vuln);
          const dmg = Math.max(1, Math.round(atk.damage * factor));
          const harm = applyDamage(rt, pc.id, dmg, `${enemy.name}'s attack.`);
          const tag = factor < 1 ? " (resisted)" : factor > 1 ? " (vulnerable)" : "";
          lines.push(
            `💥 You take ${harm.taken}${tag} — ${harm.hpAfter + harm.taken}→${harm.hpAfter} HP` +
              (harm.died ? " · KILLED" : harm.downed ? " · DOWNED" : ""),
          );
          // T2+ enemy's on-hit status — blocked only by matching armor immunity.
          if (enemy.onHit && !def.statusGuard.includes(enemy.onHit)) {
            combat.playerStatuses = applyStatus(combat.playerStatuses ?? [], enemy.onHit);
            lines.push(`${statusIcon(enemy.onHit)} You're now ${statusLabel(enemy.onHit)}.`);
          }
          if (harm.died) return "dead";
          // The medic catches you as you fall (once per fight) — else the fight halts.
          if (harm.downed && !medicStabilize(rt, combat, pc.id, lines)) return "downed";
        }
      } else {
        // A crew member takes the swing.
        const atk = enemyAttack(enemy, pick.ac, rt.rng);
        lines.push(`💢 ${atk.breakdown} — at ${pick.name}`);
        if (atk.hit) {
          const harm = applyDamage(rt, pick.id, atk.damage, `${enemy.name}'s attack.`);
          lines.push(
            `💥 ${pick.name} takes ${harm.taken} — ${harm.hpAfter + harm.taken}→${harm.hpAfter} HP` +
              (harm.died ? " · KILLED" : harm.downed ? " · DOWNED" : ""),
          );
        }
      }
    }
  }
  return "continue";
}

/** Begin a fight from pre-spawned enemies; resolve enemy surprise (ambush = a free
 *  enemy volley before the player acts; you-ambush → an opening edge). */
function beginCombat(
  rt: CombatRT,
  scale: "personal" | "ship",
  enemies: CombatEnemy[],
  surprise: "player" | "enemy" | "none",
): { combat: CombatState; lines: string[]; outcome: CombatOutcome } {
  const pc = pcOf(rt);
  const combat: CombatState = {
    active: true,
    round: 1,
    scale,
    enemies,
    playerCoverAc: 0,
    // Ship-scale surprise keeps its flat aim edge; personal-scale surprise uses the
    // D&D rule (opening strike at advantage + the foe can't answer round 1).
    playerAimBonus: scale === "ship" && surprise === "player" ? 2 : 0,
    playerSurprise: scale === "personal" && surprise === "player",
    fleeAttempts: 0,
    // Draw the weapon this character fights best with; the player can switch.
    ...(scale === "personal" && pc ? { weaponName: defaultWeapon(pc)?.name } : {}),
  };
  const lines = [`⚔ ${scale === "ship" ? "Ship combat" : "Combat"} — ${enemies.map((e) => e.name).join(", ")}.`];
  let outcome: CombatOutcome = "continue";
  if (surprise === "enemy") {
    lines.push("Ambushed — they fire first.");
    outcome = scale === "ship" ? enemyShipVolley(rt, combat, false, lines) : enemyVolley(rt, combat, lines);
    if (outcome !== "continue") combat.active = false;
  }
  return { combat, lines, outcome };
}

/** Start a personal (on-foot) fight. */
export function startCombat(rt: CombatRT, specs: SpawnSpec[], surprise: "player" | "enemy" | "none") {
  return beginCombat(rt, "personal", spawnCombatEnemies(specs, rt.rng), surprise);
}

/** Start a ship-scale fight. */
export function startShipCombat(rt: CombatRT, specs: ShipSpawnSpec[], surprise: "player" | "enemy" | "none") {
  return beginCombat(rt, "ship", spawnCombatShips(specs, rt.rng), surprise);
}

/** Resolve one round — dispatch by scale. */
export function resolveCombatRound(
  rt: CombatRT,
  combat: CombatState,
  action: CombatAction,
): { combat: CombatState; lines: string[]; outcome: CombatOutcome; loot: number } {
  const res = combat.scale === "ship" ? resolveShipRound(rt, combat, action) : resolvePersonalRound(rt, combat, action);
  // ── NPC FATE (shared/npcFate.ts, CHECKS.md §2): the moment a fight ENDS, any
  // defeated enemy whose name matches a living cast NPC is recorded dead —
  // status + a relation-log note. This dispatcher is the single seam every fight
  // path flows through (combat turns, the gun-skill reroute's in-turn resolution,
  // downed-turn hostiles), so a named casualty can never quietly stay "alive" in
  // the cast and be re-narrated later. Personal scale only: a defeated SHIP's
  // crew fate is the narrator's to tell (adrift ≠ dead).
  if (combat.active && !res.combat.active && combat.scale === "personal") {
    const dead = res.combat.enemies.filter((e) => e.hp <= 0).map((e) => e.name);
    if (dead.length) {
      const marked = applyCombatDeaths({
        state: rt.state,
        npcRelations: rt.npcRelations,
        deadEnemyNames: dead,
        place: rt.sceneCard.place,
        sceneSeq: rt.sceneCard.seq,
      });
      rt.state = marked.state;
      for (const name of marked.deadNames) {
        rt.events.push({ type: "note", breakdown: `${name} is dead — recorded in the world's cast.` });
      }
    }
  }
  return res;
}

function resolvePersonalRound(
  rt: CombatRT,
  combat: CombatState,
  action: CombatAction,
): { combat: CombatState; lines: string[]; outcome: CombatOutcome; loot: number } {
  const lines: string[] = [];
  const cbt = personalCombatant(rt, combat.weaponName);
  let enemies = combat.enemies.map((e) => ({ ...e }));
  let aim = combat.playerAimBonus;
  let cover = combat.playerCoverAc;
  let fleeAttempts = combat.fleeAttempts;
  // Surprise round: the player struck an unaware foe. The opening strike rolls with
  // advantage and the surprised enemies get NO return volley this round (D&D).
  const surpriseRound = combat.playerSurprise === true;

  // Drawing another weapon is FREE — a quick swap that doesn't cost the round.
  if (action.type === "switch") {
    const pc = pcOf(rt);
    const w = pc?.gear.find((g) => g.damage && g.name === action.weaponName);
    if (w) {
      lines.push(`🔁 You draw your ${w.name}.`);
      return { combat: { ...combat, weaponName: w.name, playerSurprise: surpriseRound }, lines, outcome: "continue", loot: 0 };
    }
  }

  // ── Round start: statuses tick (DoT + Shocked skips) for everyone. The player's
  //    own burning/bleeding can drop them; a Shocked player loses their action. ──
  let playerStatuses = combat.playerStatuses ?? [];
  const tick = tickRoundStatuses(rt, enemies, playerStatuses, lines);
  playerStatuses = tick.playerStatuses;
  if (tick.outcome) {
    // Burning out on the deck with a medic in the crew: they catch you (once/fight).
    const rescued = tick.outcome === "downed" && medicStabilize(rt, combat, pcOf(rt)!.id, lines);
    if (!rescued) {
      return { combat: { ...combat, enemies, playerStatuses, active: false }, lines, outcome: tick.outcome, loot: 0 };
    }
  }

  switch (tick.playerSkip ? "skip" : action.type) {
    case "attack": {
      const enemy = enemies.find((e) => e.id === action.enemyId && e.hp > 0) ?? enemies.find((e) => e.hp > 0);
      if (enemy) {
        // Corroded armor + armor-piercing rounds lower the effective AC.
        const effAc = Math.max(1, enemy.ac - acPenalty(enemy.statuses) - cbt.armorPen);
        const r = playerAttack({ ...enemy, ac: effAc }, cbt.attackMod, cbt.weaponDamage, aim, rt.rng, surpriseRound);
        lines.push(`🎯 ${r.breakdown}`);
        const shieldBlocked = enemy.shieldReady && r.hit && r.damage === 0;
        enemy.hp = r.enemyHpAfter;
        enemy.shieldReady = r.shieldReadyAfter;
        // On-hit status: shock arcs THROUGH a shield; burn/bleed/corrode are blocked by one.
        if (r.hit && cbt.weaponOnHit && (cbt.weaponOnHit === "shocked" || !shieldBlocked)) {
          enemy.statuses = applyStatus(enemy.statuses ?? [], cbt.weaponOnHit);
          lines.push(`${statusIcon(cbt.weaponOnHit)} ${enemy.name}: ${statusLabel(cbt.weaponOnHit)}.`);
        }
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
      if (cbt.mobilityPenalty) {
        cover = 0;
        aim = 0;
        lines.push("🛡 Too heavy to take evasive cover — the carapace won't let you duck.");
      } else {
        cover = 2;
        aim = 0;
        lines.push("🛡 You take cover (+2 AC until you move).");
      }
      break;
    case "stim":
    case "item": {
      const pc = pcOf(rt)!;
      const itemId = action.type === "stim" ? "stim" : action.itemId ?? "";
      const item = catalogItem(itemId);
      if (!item || itemCount(pc, itemId) <= 0) {
        lines.push("Nothing to use.");
        cover = 0;
        break;
      }
      const eff = item.effect;
      if (eff?.kind === "heal") {
        // Nothing to treat — full HP and no bleed/burn to clear → the item is
        // NOT spent (mirrors the "Nothing to use." dead-end, round still passes).
        if (pc.hp >= pc.maxHp && clearOnHeal(playerStatuses).cleared.length === 0) {
          lines.push(`🩹 You're unhurt — the ${item.name} stays in its sleeve.`);
          cover = 0;
          break;
        }
        const before = pc.hp;
        const after = applyHeal(rt, pc.id, rollDamage(eff.dice ?? "1d6+2", rt.rng));
        consumeItem(rt, pc.id, itemId);
        lines.push(`🩹 ${item.name}: +${after - before} HP — ${before}→${after}.`);
        // A patch also stops the bleeding/burning it treats.
        const healed = clearOnHeal(playerStatuses);
        playerStatuses = healed.statuses;
        if (healed.cleared.length) {
          lines.push(`🩹 That stops your ${healed.cleared.map((k) => statusLabel(k).toLowerCase()).join(" & ")}.`);
        }
        cover = 0;
      } else if (eff?.kind === "aoe") {
        const dmg = rollDamage(eff.dice ?? "2d6", rt.rng);
        enemies = enemies.map((e) => (e.hp > 0 ? { ...e, hp: Math.max(0, e.hp - dmg) } : e));
        consumeItem(rt, pc.id, itemId);
        lines.push(`💥 ${item.name}: ${dmg} to every enemy.`);
        aim = 0;
        cover = 0;
      } else if (eff?.kind === "autoFlee") {
        consumeItem(rt, pc.id, itemId);
        lines.push(`🌫 ${item.name} — you break contact and slip clear.`);
        return { combat: { ...combat, active: false }, lines, outcome: "escaped", loot: 0 };
      } else {
        lines.push(`${item.name} does nothing here.`);
        cover = 0;
      }
      break;
    }
    case "flee": {
      const pc = pcOf(rt)!;
      const dc = fleeDC(threatLevel(enemies), cbt.combatLevel, fleeAttempts);
      const mod = computeModifier(pc, "stealth");
      const d20 = rt.rng.int(1, 20);
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

  // Crew act after the player — attacks, or the medic patching a downed mate
  // (one summary line per round, C-3). They fight on the surprise round too.
  crewPhase(rt, combat, enemies, lines);

  // Deaths resolve; victory if the field is clear.
  enemies = enemies.filter((e) => e.hp > 0);
  if (enemies.length === 0) {
    const tier = combat.enemies.reduce<"T1" | "T2" | "T3">(
      (m, e) => (LOOT_BAND[e.tier][1] > LOOT_BAND[m][1] ? e.tier : m),
      "T1",
    );
    const [lo, hi] = LOOT_BAND[tier];
    const loot = rt.rng.int(lo, hi);
    const pc = pcOf(rt)!;
    rt.state = {
      ...rt.state,
      characters: rt.state.characters.map((x) => (x.id === pc.id ? { ...x, credits: (x.credits ?? 0) + loot } : x)),
    };
    lines.push(`💰 Cleared them out — recovered ¢${loot}.`);
    return { combat: { ...combat, enemies, active: false }, lines, outcome: "victory", loot };
  }

  // Enemy volley (halts if the player drops) — SKIPPED on the surprise round.
  const next: CombatState = {
    ...combat, enemies, playerStatuses, playerAimBonus: aim, playerCoverAc: cover, fleeAttempts, playerSurprise: false,
  };
  if (surpriseRound) {
    lines.push("You struck from surprise — they don't get to answer this round.");
    next.round += 1;
    return { combat: next, lines, outcome: "continue", loot: 0 };
  }
  const outcome = enemyVolley(rt, next, lines, tick.skipIds);
  if (outcome === "continue") {
    next.round += 1;
    return { combat: next, lines, outcome, loot: 0 };
  }
  return { combat: { ...next, active: false }, lines, outcome, loot: 0 };
}

/** Apply hull damage to the player's ship. Hull 0 = DISABLED (adrift), not death. */
export function applyShipDamage(rt: CombatRT, amount: number) {
  const s = rt.state.ship;
  if (!s || amount <= 0) return { hpAfter: s?.hp ?? 0, taken: 0, disabled: false };
  const before = s.hp;
  const hp = Math.max(0, before - amount);
  rt.state = { ...rt.state, ship: { ...s, hp } };
  const disabled = hp === 0 && before > 0;
  rt.events.push({
    type: "resource",
    breakdown: `${s.name} hull ${before}→${hp}${disabled ? " · DISABLED" : ""}`,
    field: "hp",
    delta: -amount,
  });
  return { hpAfter: hp, taken: amount, disabled };
}

/** Enemy ships fire on the player's hull; halts the instant it's disabled. */
function enemyShipVolley(rt: CombatRT, combat: CombatState, evasive: boolean, lines: string[]): CombatOutcome {
  const pc = pcOf(rt);
  for (const enemy of combat.enemies) {
    const swings = enemy.multiAttack ? 2 : 1;
    for (let i = 0; i < swings; i++) {
      const s = rt.state.ship;
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
        rt.rng,
      );
      lines.push(`💢 ${enemy.name}: ${res.breakdown}`);
      if (res.targetShieldReadyAfter !== (s.hasShield && s.shieldReady)) {
        rt.state = { ...rt.state, ship: { ...s, shieldReady: res.targetShieldReadyAfter } };
      }
      if (res.hit && res.damageDealt > 0) {
        const harm = applyShipDamage(rt, res.damageDealt);
        lines.push(`💥 Hull takes ${harm.taken}${harm.disabled ? " · DISABLED" : ""}`);
        if (harm.disabled) return "disabled";
      }
    }
  }
  // Combat left the PC untouched — an environment threat (E-6) never triggers here.
  void pc;
  return "continue";
}

function resolveShipRound(
  rt: CombatRT,
  combat: CombatState,
  action: CombatAction,
): { combat: CombatState; lines: string[]; outcome: CombatOutcome; loot: number } {
  const lines: string[] = [];
  const s = rt.state.ship;
  if (!s) {
    return { combat: { ...combat, active: false }, lines: ["You have no ship to fight in."], outcome: "escaped", loot: 0 };
  }
  const pc = pcOf(rt)!;
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
            rt.rng,
          );
          lines.push(`🎯 ${res.breakdown}`);
          enemy.hp = res.targetHpAfter;
          enemy.shieldReady = res.targetShieldReadyAfter;
          if (res.targetHpAfter <= 0) lines.push(`☠ ${enemy.name} is wrecked.`);
          if (w?.type === "missile") {
            rt.state = {
              ...rt.state,
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
        rt.state = { ...rt.state, ship: { ...rt.state.ship!, shieldReady: true } };
        consumeItem(rt, pc.id, item.id);
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
        rt.state = { ...rt.state, ship: { ...s, burstDriveReady: false } };
        return { combat: { ...combat, active: false }, lines, outcome: "escaped", loot: 0 };
      }
      const dc = fleeDC(threatLevel(enemies), combatLevel, fleeAttempts);
      const mod = computeModifier(pc, "piloting");
      const d20 = rt.rng.int(1, 20);
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
    const loot = rt.rng.int(lo, hi);
    rt.state = {
      ...rt.state,
      characters: rt.state.characters.map((x) => (x.id === pc.id ? { ...x, credits: (x.credits ?? 0) + loot } : x)),
    };
    lines.push(`💰 Enemy driven off / destroyed — salvage worth ¢${loot}.`);
    return { combat: { ...combat, enemies, active: false }, lines, outcome: "victory", loot };
  }

  const next: CombatState = { ...combat, enemies, playerCoverAc: evasive ? 1 : 0, playerAimBonus: 0, fleeAttempts };
  const outcome = enemyShipVolley(rt, next, evasive, lines);
  if (outcome === "continue") {
    next.round += 1;
    return { combat: next, lines, outcome, loot: 0 };
  }
  return { combat: { ...next, active: false }, lines, outcome, loot: 0 };
}
