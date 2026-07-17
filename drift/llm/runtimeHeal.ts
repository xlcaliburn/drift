import type { CampaignState, Character } from "@/shared/schemas";
import type { RNG } from "@/engine";
import { rollDamage } from "@/engine/dice";
import { catalogItem, itemCount, resolveGearItemId } from "@/shared/items";
import { inTutorial } from "@/shared/tutorial";
import {
  freshDeathSaves,
  advanceSaves,
  readDeathSave,
  trackOutcome,
  saveTrackLabel,
  type DownedAction,
  type DeathOutcome,
} from "@/shared/death";

/**
 * Healing, Bleeding-Out death saves, and out-of-combat item use — the HP/injury
 * side of TurnRuntime, split out of engineBridge.ts as free functions over a
 * narrow surface (just the mutable `state` + the `rng`). The class keeps thin
 * delegating methods (useItem, resolveDeathSave) for its public API; its combat
 * rounds call `applyHeal`/`consumeItem` here directly. Pure engine logic — no
 * model, fully unit-tested via the existing TurnRuntime tests.
 */
export interface HealRT {
  state: CampaignState;
  rng: RNG;
}

const charOf = (rt: HealRT, id: string): Character | undefined => rt.state.characters.find((c) => c.id === id);
const pcOf = (rt: HealRT): Character | undefined => rt.state.characters.find((c) => c.kind === "pc");

/** Heal a character, clamped to maxHp. Any heal that brings them above 0 HP
 *  clears Downed — you're back on your feet (bloodied, but up). Returns new HP. */
export function applyHeal(rt: HealRT, characterId: string, amount: number): number {
  const c = charOf(rt, characterId);
  if (!c) return 0;
  const hp = Math.min(c.maxHp, c.hp + Math.max(0, amount));
  const injuries = hp > 0 ? (c.injuries ?? []).filter((i) => i.name !== "Downed") : c.injuries;
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((x) => (x.id === characterId ? { ...x, hp, injuries } : x)),
  };
  return hp;
}

/** Remove a named injury (e.g. medkit stabilising a Downed ally). */
export function clearInjury(rt: HealRT, characterId: string, name: string) {
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((x) =>
      x.id === characterId ? { ...x, injuries: (x.injuries ?? []).filter((i) => i.name !== name) } : x,
    ),
  };
}

/** Clear the Downed state, bring the PC up to at least `hp`, and drop the
 *  death-save track — the shared tail of stabilise / rally / self-rescue. */
export function reviveDowned(rt: HealRT, characterId: string, hp: number) {
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((x) =>
      x.id === characterId
        ? { ...x, hp: Math.max(hp, x.hp), injuries: (x.injuries ?? []).filter((i) => i.name !== "Downed"), deathSaves: undefined }
        : x,
    ),
  };
}

/**
 * Resolve ONE turn of Bleeding Out (COMBAT.md). The Downed player picks a
 * desperate act; the engine rolls the death save (or spends a stim) and reports
 * where the track now stands. Reaching for a held stim/medkit is the self-
 * rescue; "hold on" is a raw save; "cover" steadies the hand (+2 edge); "help"
 * a raw save that, on success, is the ally reaching them. A hostile or an active
 * hazard in the scene tacks on a failure — the pressure that makes bleeding out
 * lethal. Returns engine lines + the outcome (continue / stabilized / dead).
 */
export function resolveDeathSave(
  rt: HealRT,
  action: DownedAction,
  ctx: { hostilePresent?: boolean; hazardPresent?: boolean } = {},
): { lines: string[]; outcome: DeathOutcome | "recovered" } {
  const pc = pcOf(rt);
  if (!pc) return { lines: [], outcome: "continue" };
  const lines: string[] = [];

  // Self-rescue: a held stim/medkit clears the whole thing (D&D's "a potion
  // brings you back up"). The engine heals + clears Downed + drops the track.
  if (action.kind === "item") {
    const itemId = action.itemId ?? "stim";
    const item = catalogItem(itemId);
    if (item && itemCount(pc, itemId) > 0 && item.effect?.kind === "heal") {
      const before = pc.hp;
      consumeItem(rt, pc.id, itemId);
      const rolled = rollDamage(item.effect.dice ?? "1d6+2", rt.rng);
      reviveDowned(rt, pc.id, Math.max(1, rolled));
      const after = pcOf(rt)?.hp ?? 1;
      lines.push(`🩹 ${item.name} — you jam it home. +${after - before} HP; back on your feet.`);
      return { lines, outcome: "recovered" };
    }
    lines.push("You grope for a stim — nothing in reach. You steady yourself instead.");
    action = { kind: "hold" };
  }

  const track = pc.deathSaves ?? freshDeathSaves();
  const d20 = rt.rng.int(1, 20);
  const edge = action.kind === "cover" ? 2 : 0;
  const read = readDeathSave(d20, edge);

  // Nat-20 rally: back up at 1 HP (the fight, if any, already ended when you
  // dropped — you scramble up as it resolves).
  if (read.kind === "rally") {
    reviveDowned(rt, pc.id, 1);
    lines.push(`🎲 Death save: d20(20) — a surge of adrenaline. You claw back to 1 HP.`);
    return { lines, outcome: "recovered" };
  }

  let next = advanceSaves(track, { successes: read.successes, failures: read.failures });
  // Pressure: a hostile looming over you (or a live hazard) is a failure a turn —
  // the D&D "an attack on a downed creature is an automatic failure".
  const pressured = Boolean(ctx.hostilePresent || ctx.hazardPresent);
  if (pressured) next = advanceSaves(next, { failures: 1 });

  const nat1 = d20 === 1;
  const crawl = action.kind === "cover" ? " (crawling for cover)" : "";
  lines.push(
    `🎲 Death save${crawl}: d20(${d20})${edge ? ` +${edge}` : ""} vs DC ${10 - edge} → ${read.kind === "success" ? "hold" : nat1 ? "critical fail (×2)" : "fail"}` +
      (pressured ? " · +1 fail (enemy over you)" : ""),
  );

  const inTut = inTutorial(rt.state);
  const outcome = trackOutcome(next, { inTutorial: inTut });
  // Persist the track (or clear it on a terminal outcome; revive handled below).
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((x) => (x.id === pc.id ? { ...x, deathSaves: next } : x)),
  };

  if (outcome === "stabilized") {
    reviveDowned(rt, pc.id, 1); // black out, patched to 1 HP
    lines.push(`✚ Stabilised (${saveTrackLabel(next)}) — you hold on. The dark eases; you're alive, barely.`);
    return { lines, outcome: "stabilized" };
  }
  if (outcome === "dead") {
    rt.state = {
      ...rt.state,
      characters: rt.state.characters.map((x) =>
        x.id === pc.id
          ? { ...x, hp: 0, deathSaves: undefined, injuries: [...(x.injuries ?? []).filter((i) => i.name !== "Downed"), { name: "Dead", effect: "bled out" }] }
          : x,
      ),
    };
    lines.push(`☠ Bled out (${saveTrackLabel(next)}) — no more saves. This character's story ends.`);
    return { lines, outcome: "dead" };
  }
  lines.push(`   ${saveTrackLabel(next)}`);
  return { lines, outcome: "continue" };
}

/**
 * Spend one of a catalog consumable: decrement a gear stack (`itemId`/`qty`),
 * or fall back to the legacy `stims` counter (ITEMS.md IT-5). Returns whether
 * anything was consumed. The catalog effect is applied by the caller.
 */
export function consumeItem(rt: HealRT, characterId: string, itemId: string): boolean {
  const c = charOf(rt, characterId);
  if (!c) return false;
  const gear = [...c.gear];
  // Resolve by the SAME rule itemCount uses (explicit id or legacy name match),
  // so a medkit counted as held is always the medkit spent — never a heal that
  // reports a stock it can't decrement.
  const idx = gear.findIndex((g) => resolveGearItemId(g) === itemId && (g.qty ?? 1) > 0);
  if (idx >= 0) {
    const q = (gear[idx].qty ?? 1) - 1;
    if (q <= 0) gear.splice(idx, 1);
    else gear[idx] = { ...gear[idx], qty: q };
    rt.state = {
      ...rt.state,
      characters: rt.state.characters.map((x) => (x.id === characterId ? { ...x, gear } : x)),
    };
    return true;
  }
  if (itemId === "stim" && c.stims > 0) {
    rt.state = {
      ...rt.state,
      characters: rt.state.characters.map((x) => (x.id === characterId ? { ...x, stims: x.stims - 1 } : x)),
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
export function useItem(rt: HealRT, itemId: string, characterId?: string): { line?: string; error?: string } {
  const c = characterId ? charOf(rt, characterId) : pcOf(rt);
  if (!c) return { error: "no character" };
  const item = catalogItem(itemId);
  if (!item) return { error: `unknown item: ${itemId}` };
  if (itemCount(c, itemId) <= 0) return { error: `no ${item.name} left` };
  const eff = item.effect;
  let line = `${item.name} used.`;

  if (eff?.kind === "heal") {
    // Full health → REFUSE and don't consume. Born from the live Sparrow turn:
    // the model volunteered `useItem: stim` on an unrelated clicked choice and
    // the engine printed "🩹 Stim: +0 HP — 18→18", burning the stim for nothing.
    if (c.hp >= c.maxHp) return { error: `${c.name} is already at full health — the ${item.name} isn't spent` };
    const healed = rollDamage(eff.dice ?? "1d6+2", rt.rng);
    const before = c.hp;
    const after = applyHeal(rt, c.id, healed);
    if (eff.clearsDowned && after > 0) clearInjury(rt, c.id, "Downed");
    line = `🩹 ${item.name}: +${after - before} HP — ${before}→${after}.`;
  } else if (eff?.kind === "healShip" && rt.state.ship) {
    const s = rt.state.ship;
    const healed = rollDamage(eff.dice ?? "1d6+2", rt.rng);
    const after = Math.min(s.maxHp, s.hp + healed);
    rt.state = { ...rt.state, ship: { ...s, hp: after } };
    line = `🔧 ${item.name}: +${after - s.hp} hull — ${s.hp}→${after}.`;
  } else if (eff?.kind === "reloadMissiles" && rt.state.ship) {
    const s = rt.state.ship;
    const add = eff.amount ?? 2;
    const weapons = s.weapons.map((w) => (w.type === "missile" ? { ...w, ammo: (w.ammo ?? 0) + add } : w));
    rt.state = { ...rt.state, ship: { ...s, weapons } };
    line = `🚀 ${item.name}: +${add} missiles.`;
  } else if (eff?.kind === "restoreShield" && rt.state.ship) {
    rt.state = { ...rt.state, ship: { ...rt.state.ship, shieldReady: true } };
    line = `⛨ ${item.name} — shields restored.`;
  }

  consumeItem(rt, c.id, itemId);
  return { line };
}
