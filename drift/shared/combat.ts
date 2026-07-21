/**
 * Multi-turn combat state (COMBAT.md). Scene-scoped runtime data, persisted in
 * campaign_runtime alongside transcript/history — NOT part of the mechanical
 * CampaignState. Null when there is no fight. The engine owns every number here;
 * the narrator only voices results.
 */
import { USE_NEGATION_RE, type UsableConsumable } from "./items";
import type { StatusEffect, DamageType, StatusKind } from "./status";
import { ship2Presets, type Allocation, type Ship2Profile } from "./ship2";

export type CombatTier = "T1" | "T2" | "T3";

/** Which CombatSystem resolves this fight's rounds (Modularity M5 —
 *  COMBAT_V2.md). "classic" is today's d20 engine (both scales); "ship2"
 *  arrives in slice 2 as the Eclipse-style power/dice ship system. Optional
 *  on CombatState because it's a NEW field on persisted jsonb — legacy rows
 *  have none (the house jsonb rule); every load path normalizes to
 *  "classic" (lib/state.ts) and the dispatcher defensively falls back too. */
export type CombatSystemId = "classic" | "ship2";

export interface CombatEnemy {
  id: string;
  name: string;
  tier: CombatTier;
  hp: number;
  maxHp: number;
  ac: number;
  atk: number;
  /** Damage dice, e.g. "2d8". */
  damage: string;
  /** T2+ / shielded ships negate the first hit. */
  shieldReady: boolean;
  /** T3 elites / corvettes attack twice. */
  multiAttack: boolean;
  // ── Status system (ITEMS.md) ──
  /** Active statuses on this enemy (burning/bleeding/etc.). */
  statuses?: StatusEffect[];
  /** Personal scale: this enemy's attack damage TYPE (drives player armor resist).
   *  Absent = kinetic. T2+ only (T1 enemies are plain kinetic). */
  personalDamageType?: DamageType;
  /** Personal scale: a status this enemy inflicts on a hit. T2+ only. */
  onHit?: StatusKind;
  // ── Ship-scale only (undefined for personal enemies) ──
  weaponType?: "kinetic" | "energy" | "missile" | "ion";
  isEvasive?: boolean;
  hasPointDefense?: boolean;
  armored?: boolean;
  // ── ship2 only (HANDOFF_COMBAT_V2_2.md) ──
  /** The shipClass this enemy ship spawned as — its ship2 profile/mounts/
   *  policy re-derive from this EVERY round (shared/ship2.ts's
   *  deriveEnemyShip2Profile); unlike the player's, never frozen (no crew
   *  passives to account for, so there's nothing to freeze). */
  ship2Class?: string;
  /** Remaining missile-rack ammo, if this enemy's class owns one. Enemy
   *  ships don't reload. */
  missileAmmo?: number;
}

export interface CombatState {
  active: boolean;
  round: number; // 1-based
  scale: "personal" | "ship";
  enemies: CombatEnemy[];
  /** The weapon the player has drawn this fight (gear name). Personal scale only;
   *  set to a sensible default at combat start, changeable via a "switch" action. */
  weaponName?: string;
  /** +AC vs the enemy volley while in cover (persists until the player acts otherwise). */
  playerCoverAc: number;
  /** +to-hit on the player's next attack (consumed after one attack). */
  playerAimBonus: number;
  /** The player opened from surprise (they struck an unaware foe). For ONE round
   *  the opening strike rolls with advantage and the surprised enemies can't act —
   *  the D&D surprise rule. Cleared after the first round resolves. Personal scale
   *  only (ship surprise keeps its aim-bonus edge). */
  playerSurprise?: boolean;
  /** Escalates the flee DC on repeated attempts. */
  fleeAttempts: number;
  /** Statuses currently on the PLAYER (burning/bleeding/shocked/corroded). */
  playerStatuses?: StatusEffect[];
  /** Crew medics who have spent their once-per-fight stabilize (CREW.md §4). */
  medicSpentIds?: string[];
  /** See CombatSystemId. Set by beginCombat; normalized on load for legacy rows. */
  system?: CombatSystemId;
  /** ship2 only (HANDOFF_COMBAT_V2_2.md) — the player's FROZEN profile (derived
   *  once at fight start; mid-fight upgrades never shift a live round's math)
   *  and the round-1 surprise reactor modifier: +1 if the player ambushed,
   *  −1 if the player was ambushed, applied to the player's effective reactor
   *  that round only (the enemy gets the negated value). Absent for classic
   *  ship fights (legacy or newly-started ground fights never set it). */
  ship2?: { player: Ship2Profile; surpriseMod?: number };
  /** Per-CREW-MEMBER aim/cover, personal scale only (HANDOFF_PLAYTEST_POLISH_1.md
   *  — mirrors playerAimBonus/playerCoverAc's exact semantics one level down):
   *  an `aim` order sets +2 to that member's NEXT attack roll (consumed then,
   *  same round or a later one); a `cover` order sets +2 to their effective AC
   *  against the enemy volley until they next attack. NEW field on persisted
   *  jsonb — legacy rows have none; every read must default missing entries to
   *  {aim:0, coverAc:0} (`combat.memberMods?.[id]?.aim ?? 0`), never assume set. */
  memberMods?: Record<string, { aim?: number; coverAc?: number }>;
}

export type CombatActionType = "attack" | "aim" | "cover" | "stim" | "flee" | "item" | "switch" | "allocate";
export interface CombatAction {
  type: CombatActionType;
  enemyId?: string;
  /** For type "item": the catalog id of the consumable to use. */
  itemId?: string;
  /** For type "switch": the gear name of the weapon to draw. */
  weaponName?: string;
  /** For type "allocate" (ship2 — HANDOFF_COMBAT_V2_2.md): this round's power
   *  allocation. The engine re-validates it against the live profile
   *  (validateAllocation) — never trusts this payload as-is. */
  alloc?: Allocation;
}

/** Which combat skill a weapon rolls to hit with — a blade/baton is melee (might),
 *  anything else that deals damage is a firearm (smallArms, reflex). This is why a
 *  melee build kept missing: the engine used to force smallArms for EVERY weapon,
 *  so a knife-fighter auto-fired a gun at his ranged modifier (0). */
const MELEE_WEAPON_RE =
  /\b(knife|blade|baton|sword|axe|club|fist|machete|cleaver|wrench|torch|shiv|spear|staff|hammer|bat|cutlass|dagger|melee|knuckle|prod|pipe|cutting)\b/i;
export function weaponSkill(name: string | undefined): "melee" | "smallArms" {
  return name && MELEE_WEAPON_RE.test(name) ? "melee" : "smallArms";
}
/** How the round ended (or didn't). "disabled" is the ship-scale analog of
 *  "downed" — hull at 0, adrift, aftermath narrated (not instant death). */
export type CombatOutcome = "continue" | "victory" | "escaped" | "downed" | "dead" | "disabled";

/** The player's derived combat profile for the current scale. */
export interface PlayerCombatant {
  hp: number;
  maxHp: number;
  ac: number;
  attackMod: number;
  weaponDamage: string;
  /** Best combat-skill level, for the flee-disparity math. */
  combatLevel: number;
  // ── Drawn weapon traits (ITEMS.md status system) ──
  weaponType?: DamageType;
  weaponOnHit?: StatusKind;
  armorPen: number;
  // ── Worn armor traits ──
  resist?: DamageType;
  vuln?: DamageType;
  statusGuard: StatusKind[];
  mobilityPenalty: boolean;
}

/** Engine-generated combat action chips for a round (shared so the client can
 *  rebuild them on reload). Kept here (types only) to avoid a server import;
 *  `consumables` is the pre-filtered held-item list from shared/items. */
export function combatActions(
  combat: CombatState,
  consumables: UsableConsumable[],
  burstReady = false,
  /** The PC's carried weapons (personal scale) — enables weapon-switch chips. */
  weapons: string[] = [],
): { label: string; combatAction: CombatAction }[] {
  const verb = combat.scale === "ship" ? "Fire on" : "Attack";
  // On foot, name the drawn weapon in the attack label so the player sees what
  // they're swinging (and can tell it changed after a switch).
  const withWeapon = combat.scale === "personal" && combat.weaponName ? ` with ${combat.weaponName}` : "";
  const actions: { label: string; combatAction: CombatAction }[] = combat.enemies.map((e) => ({
    label: `${verb} ${e.name} (${e.hp}/${e.maxHp})${withWeapon}`,
    combatAction: { type: "attack", enemyId: e.id },
  }));
  const itemChips = consumables.map((u) => ({
    label: `${u.verb} ${u.name} (×${u.count})`,
    combatAction: { type: "item" as const, itemId: u.itemId },
  }));
  if (combat.scale === "ship") {
    actions.push({ label: "Evasive maneuvers (+AC)", combatAction: { type: "cover" } });
    actions.push(...itemChips);
    actions.push({ label: burstReady ? "Burst-drive away" : "Break off and run", combatAction: { type: "flee" } });
    return actions;
  }
  actions.push({ label: "Take aim (+2 next hit)", combatAction: { type: "aim" } });
  actions.push({ label: "Take cover (+2 AC)", combatAction: { type: "cover" } });
  // Weapon switch — draw any OTHER carried weapon (free; it doesn't cost the round).
  for (const w of weapons) {
    if (w === combat.weaponName) continue;
    actions.push({ label: `Draw ${w}`, combatAction: { type: "switch", weaponName: w } });
  }
  actions.push(...itemChips);
  actions.push({ label: "Flee", combatAction: { type: "flee" } });
  return actions;
}

/**
 * System-aware chip dispatcher (HANDOFF_COMBAT_V2_2.md Task C) — the ONE
 * place every caller (combatTurn.ts, the turn route, PlayClient.tsx's
 * on-load rebuild) asks for the PC's combat chips, so a new CombatSystem
 * only needs a case here, never three call-site edits. Dispatches on
 * `combat.system`, NOT through the llm/ CombatSystem registry — this module
 * has no `llm/` import (PlayClient rebuilds chips client-side on reload).
 */
export function combatChipsFor(
  combat: CombatState,
  consumables: UsableConsumable[],
  burstReady = false,
  weapons: string[] = [],
): { label: string; combatAction: CombatAction }[] {
  if (combat.system === "ship2" && combat.ship2) {
    const enemies = combat.enemies.filter((e) => e.hp > 0).map((e) => ({ id: e.id, name: e.name }));
    return ship2Presets(combat.ship2.player, enemies, consumables, burstReady);
  }
  return combatActions(combat, consumables, burstReady, weapons);
}

export interface CrewChipGroup {
  memberId: string;
  memberName: string;
  chips: { label: string; combatAction: CombatAction }[];
}

/** Per-member combat chip GROUPS for standing crew/allies (HANDOFF_COMBAT_V2_1
 *  Task C — squad orders; aim/cover added by HANDOFF_PLAYTEST_POLISH_1.md):
 *  attack a chosen enemy, take aim, take cover, or use one of their own held
 *  consumables. PERSONAL SCALE ONLY: ship crew orders are out of scope this
 *  slice (they become station assignments in COMBAT_V2.md slice 2), so an
 *  un-ordered member there just keeps auto-acting. `membersConsumables` is
 *  pre-filtered per member — same pattern as `combatActions`' own
 *  `consumables` param, keeping this module free of a server import. */
export function crewActionChips(
  combat: CombatState,
  members: { id: string; name: string }[],
  membersConsumables: Record<string, UsableConsumable[]>,
): CrewChipGroup[] {
  if (combat.scale !== "personal") return [];
  return members.map((m) => {
    const chips: { label: string; combatAction: CombatAction }[] = combat.enemies
      .filter((e) => e.hp > 0)
      .map((e) => ({
        label: `Attack ${e.name} (${e.hp}/${e.maxHp})`,
        combatAction: { type: "attack", enemyId: e.id },
      }));
    chips.push({ label: "Take aim (+2 next hit)", combatAction: { type: "aim" } });
    chips.push({ label: "Take cover (+2 AC)", combatAction: { type: "cover" } });
    for (const u of membersConsumables[m.id] ?? []) {
      chips.push({ label: `${u.verb} ${u.name} (×${u.count})`, combatAction: { type: "item", itemId: u.itemId } });
    }
    return { memberId: m.id, memberName: m.name, chips };
  });
}

/**
 * Map a FREE-TYPED action during a live fight to a combat action, so typing can
 * never bypass the engine (the player narrating "I gun them all down" must still
 * resolve a real round). Keyword-parsed; the default is an attack on the named
 * enemy, else the first living one — combat's overwhelming intent.
 */
export function interpretCombatText(
  text: string,
  combat: CombatState,
  consumables: UsableConsumable[],
  weapons: string[] = [],
): CombatAction {
  const t = ` ${text.toLowerCase()} `;
  if (/\b(flee|run|escape|retreat|disengage|break off|bail|burst|withdraw)\b/.test(t)) return { type: "flee" };
  // Spending a consumable needs an ITEM cue, not a bare verb — "use the plasma
  // carbine" is a weapon switch and "patch me through to Korr" is comms, but bare
  // use/heal/patch here used to burn the FIRST held consumable (the unintended-stim
  // misfire class). A held consumable NAMED outright is intent (chip parity);
  // otherwise only item words / self-treatment phrasings fire, and a decline
  // ("save my stim") never spends one.
  if (consumables.length && !USE_NEGATION_RE.test(text)) {
    const namedItem = consumables.find((c) => t.includes(c.name.toLowerCase()));
    if (namedItem) return { type: "item", itemId: namedItem.itemId };
    if (/\b(?:stims?|stimpack|med[\s-]?kit|inject)\b|\b(?:heal|patch)\s+(?:me\b(?!\s+through)|myself|up)/.test(t))
      return { type: "item", itemId: consumables[0].itemId };
  }
  // Draw a different carried weapon ("switch to my knife", "use the plasma carbine").
  // Only when the named weapon isn't the one already drawn AND it isn't paired with a
  // clear attack on a foe (that stays an attack — the weapon just flavors it).
  const namedWeapon = weapons.find((w) => w !== combat.weaponName && t.includes(w.toLowerCase()));
  const namesFoe = combat.enemies.some((e) => e.hp > 0 && t.includes(e.name.toLowerCase()));
  if (namedWeapon && !namesFoe && /\b(draw|switch|swap|pull|equip|grab|ready|use|with|to)\b/.test(t)) {
    return { type: "switch", weaponName: namedWeapon };
  }
  if (/\b(cover|duck|hide|shelter|evasive|evade|dodge|behind)\b/.test(t)) return { type: "cover" };
  if (/\b(aim|steady|line up|line-up|focus|brace|sight)\b/.test(t)) return { type: "aim" };
  const living = combat.enemies.filter((e) => e.hp > 0);
  const named = living.find((e) => t.includes(e.name.toLowerCase()));
  return { type: "attack", enemyId: (named ?? living[0])?.id };
}

const TIER_LEVEL: Record<CombatTier, number> = { T1: 1, T2: 2, T3: 3 };

/** Highest threat tier currently in play. */
export function threatLevel(enemies: CombatEnemy[]): number {
  return enemies.reduce((m, e) => Math.max(m, TIER_LEVEL[e.tier]), 0);
}

/**
 * Escape-by-disparity (COMBAT.md): the more outmatched you are, the easier it is
 * to run — so "flee the pros/the warship" is the reliable play when outclassed,
 * without nerfing enemies. DC rises on repeated attempts.
 */
export function fleeDC(threat: number, playerCombatLevel: number, fleeAttempts: number): number {
  const disparity = Math.max(0, threat - playerCombatLevel);
  return Math.max(5, Math.min(20, 10 + 2 * fleeAttempts - 3 * disparity));
}
