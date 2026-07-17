import type { CampaignState, Character, WorldEvent } from "@/shared/schemas";
import {
  runSceneEnd,
  liveRng,
  type RNG,
  type CombatTarget,
  type EngineEvent,
} from "@/engine";
import type { SpawnSpec, ShipSpawnSpec } from "@/engine/combatEngine";
import type { CombatState, CombatAction, CombatOutcome } from "@/shared/combat";
import { useItem, resolveDeathSave } from "./runtimeHeal";
import { recruitCrew } from "./runtimeCrew";
import {
  rollCheck,
  resolveAttack,
  spawnEncounter,
  startCombat,
  startShipCombat,
  resolveCombatRound,
} from "./runtimeCombat";
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
  updateNpcRelation,
  bodyMod,
  respec,
  setAppearance,
} from "./runtimeNarrative";
import { freshSceneCard, type SceneCard, type NpcRelations } from "@/shared/scene";
import type { Fact } from "@/shared/facts";
import { inTutorial, TUTORIAL_CHOICE_COUNT } from "@/shared/tutorial";
import type { DownedAction, DeathOutcome } from "@/shared/death";

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
  /** Monotonic id source for spawned enemies. Public so runtimeCombat can bump it. */
  enemyCounter = 0;
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

  /** Other players' character names — registerNpc's dossier-name guard reads it. */
  protectedNames?: Set<string>;

  /** FACTS LEDGER (CONTINUITY v2) — durable standing facts. Passed BY REFERENCE
   *  from the session (like sceneCard) and mutated IN PLACE by the facts handler,
   *  so the route's session slice sees the updates without extra plumbing. */
  facts: Fact[];

  constructor(
    state: CampaignState,
    rng: RNG = liveRng,
    opts?: {
      tickedThisScene?: Set<string>;
      sceneCard?: SceneCard;
      npcRelations?: NpcRelations;
      /** Other players' character names — registerNpc refuses these (cameos ride
       *  dossiers, never a local npc-gen fork). */
      protectedNames?: Set<string>;
      /** The session's facts ledger — mutated in place (CONTINUITY v2). */
      facts?: Fact[];
    },
  ) {
    this.state = state;
    this.rng = rng;
    this.tickedThisScene = opts?.tickedThisScene ?? new Set();
    this.sceneCard = opts?.sceneCard ?? freshSceneCard();
    this.npcRelations = opts?.npcRelations ?? {};
    this.protectedNames = opts?.protectedNames;
    this.facts = opts?.facts ?? [];
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

  execute(name: string, input: Record<string, unknown>): unknown {
    switch (name) {
      case "roll_check":
        return rollCheck(this, input);
      case "resolve_attack":
        return resolveAttack(this, input);
      case "spawn_encounter":
        return spawnEncounter(this, input);
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

  // ── Combat + checks — runtimeCombat.ts. rollCheck/resolveAttack/spawnEncounter
  //    are dispatched by execute() as free fns; startCombat/startShipCombat/
  //    resolveCombatRound keep delegating methods for their external callers. ──

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

  /** Hire a trusted, present NPC onto the crew (runtimeCrew.recruitCrew — CREW.md). */
  recruitCrew(npcId: string): { line?: string; error?: string } {
    return recruitCrew(this, npcId);
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

  // ── Downed / item use — runtimeHeal.ts ──────────────────────────────────────

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

  /** Start a personal (on-foot) fight (runtimeCombat.startCombat). */
  startCombat(specs: SpawnSpec[], surprise: "player" | "enemy" | "none") {
    return startCombat(this, specs, surprise);
  }

  /** Start a ship-scale fight (runtimeCombat.startShipCombat). */
  startShipCombat(specs: ShipSpawnSpec[], surprise: "player" | "enemy" | "none") {
    return startShipCombat(this, specs, surprise);
  }

  /** Resolve one round — dispatch by scale (runtimeCombat.resolveCombatRound). */
  resolveCombatRound(
    combat: CombatState,
    action: CombatAction,
  ): { combat: CombatState; lines: string[]; outcome: CombatOutcome; loot: number } {
    return resolveCombatRound(this, combat, action);
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
