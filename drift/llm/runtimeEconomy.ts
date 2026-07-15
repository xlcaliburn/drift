import type { CampaignState, Character } from "@/shared/schemas";
import type { RNG, EngineEvent } from "@/engine";
import type { SceneCard } from "@/shared/scene";
import { economy } from "@/content";
import { catalogItem, itemCount, allItems, slotsUsed, maxSlotsFor, resolveGearItemId } from "@/shared/items";
import { repPriceFactor, localRep, SELL_RATE, marketTierFor } from "@/engine/market";
import { gearValue, patronHelp, PATRON_STIM_FLOOR } from "@/shared/netWorth";

/**
 * The economy side of TurnRuntime, split out of engineBridge.ts as free functions
 * over a narrow surface. Covers money (payout/offers/resource adjust), gear writes
 * (setGear/gains/losses/swaps), shops (buy/sell), and dock services (repair, the
 * patron safety net, the debt loop). The class keeps thin delegating methods for
 * its public/execute-dispatched API; internal helpers (setGear, currentPlace,
 * bestArmor) live here fully. Pure engine logic — the runtime is the only mutator.
 */
export interface EconRT {
  state: CampaignState;
  rng: RNG;
  events: EngineEvent[];
  sceneCard: SceneCard;
  /** True once the engine rolled loot this turn (gates gear gains). */
  lootedThisTurn: boolean;
  /** True once a job/quest concluded this turn (gates gear gains + disposition). */
  questCompletedThisTurn: boolean;
  markQuestCompleted(): void;
}

const pcOf = (rt: EconRT): Character | undefined => rt.state.characters.find((c) => c.kind === "pc");
const charOf = (rt: EconRT, id: string): Character | undefined => rt.state.characters.find((c) => c.id === id);
const isShipTarget = (rt: EconRT, id: string): boolean =>
  !!rt.state.ship && (id === rt.state.ship.id || id === "ship" || id === "lark");

/** A weapon/armor-shaped NAME — real gear that stays gated to a legit loot/quest
 *  source even when it doesn't match the catalog, so the model can't hand out a
 *  free "rocket launcher"; inert flavor props fall through and are always allowed. */
export function looksLikeGear(norm: string): boolean {
  return /\b(rifle|pistol|gun|launcher|cannon|blaster|carbine|shotgun|revolver|sidearm|sword|blade|knife|baton|axe|spear|armou?r|vest|plate|carapace|shield|grenade|explosive|rocket|missile|ammo|rounds?|magazine|mag|scope|silencer|holster)\b/i.test(
    norm,
  );
}

/** Best armor bonus in a gear list — worn AC is the single best piece, never a
 *  stack of vests (ITEMS.md slice W). */
export function bestArmor(gear: Character["gear"]): number {
  return Math.max(0, ...gear.map((g) => g.acBonus ?? (g.itemId ? catalogItem(g.itemId)?.acBonus ?? 0 : 0)));
}

/** A negotiation-shaded figure inside a tier's band, or null for an unknown tier
 *  (ECONOMY.md — engine-owned negotiation figures). */
export function quoteOffer(rt: EconRT, tier: "T0" | "T1" | "T2" | "T3", mood?: "high" | "low"): number | null {
  const band = economy.jobPayouts[tier];
  if (!Array.isArray(band)) return null;
  const [lo, hi] = band as [number, number];
  const mid = Math.round((lo + hi) / 2);
  return rt.rng.int(mood === "high" ? mid : lo, mood === "low" ? mid : hi);
}

export function awardPayout(rt: EconRT, input: Record<string, unknown>) {
  const tier = String(input.tier) as "T0" | "T1" | "T2" | "T3";
  const band = economy.jobPayouts[tier];
  if (!Array.isArray(band)) return { error: `unknown payout tier ${input.tier}` };
  const pc = pcOf(rt);
  if (!pc) return { error: "no player character" };
  // A payout means a job/quest concluded — unlock disposition movement this turn.
  rt.markQuestCompleted();
  const mood = input.mood === "high" ? "high" : input.mood === "low" ? "low" : undefined;
  const amount = quoteOffer(rt, tier, mood)!; // band validated above → non-null
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((c) =>
      c.id === pc.id ? { ...c, credits: (c.credits ?? 0) + amount } : c,
    ),
  };
  const reason = input.reason ? ` — ${String(input.reason)}` : "";
  rt.events.push({
    type: "resource",
    breakdown: `Payment: +¢${amount} (${tier}${reason})`,
    field: "credits",
    delta: amount,
  });
  return { amount, tier };
}

export function adjustResource(rt: EconRT, input: Record<string, unknown>) {
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

  if (isShipTarget(rt, targetId)) {
    const s = rt.state.ship!;
    if (field === "hp") {
      const hp = Math.max(0, Math.min(s.maxHp, s.hp + delta));
      rt.state = { ...rt.state, ship: { ...s, hp } };
      rt.events.push({ type: "resource", breakdown: `${s.name} HP ${s.hp}→${hp}`, field, delta });
      return { field, value: hp };
    }
    if (field === "missiles") {
      const pod = s.weapons.find((w) => w.type === "missile");
      const val = Math.max(0, (pod?.ammo ?? 0) + delta);
      rt.state = {
        ...rt.state,
        ship: { ...s, weapons: s.weapons.map((w) => (w.type === "missile" ? { ...w, ammo: val } : w)) },
      };
      rt.events.push({ type: "resource", breakdown: `${s.name} missiles → ${val}`, field, delta });
      return { field, value: val };
    }
  }

  const c = charOf(rt, targetId);
  if (!c) return { error: `unknown target ${targetId}` };
  let value: number;
  const patch: Partial<Character> = {};
  if (field === "hp") value = (patch.hp = Math.max(0, Math.min(c.maxHp, c.hp + delta)));
  else if (field === "credits") value = (patch.credits = (c.credits ?? 0) + delta);
  else if (field === "stims") value = (patch.stims = Math.max(0, c.stims + delta));
  else if (field === "loyalty") value = (patch.loyalty = Math.max(0, Math.min(5, (c.loyalty ?? 0) + delta)));
  else return { error: `unsupported field ${field}` };

  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((x) => (x.id === c.id ? { ...x, ...patch } : x)),
  };
  rt.events.push({ type: "resource", breakdown: `${c.name} ${field} → ${value}`, field, delta });
  return { field, value };
}

/** Write a character's gear; when the change touched armor, AC is recomputed
 *  (10 + reflex + best piece) so a bought vest actually protects. */
export function setGear(rt: EconRT, characterId: string, gear: Character["gear"], armorChanged: boolean) {
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((c) => {
      if (c.id !== characterId) return c;
      const ac = armorChanged ? 10 + (c.attributes?.reflex ?? 0) + bestArmor(gear) : c.ac;
      return { ...c, gear, ac };
    }),
  };
}

/** Where the player is right now — the scene's free-text place, else the fixed
 *  location name — for stamping onto an acquired item's description. */
export function currentPlace(rt: EconRT): string {
  const place = rt.sceneCard.place?.trim();
  if (place) return place;
  const loc = rt.state.locations.find((l) => l.id === rt.state.campaign.currentLocationId);
  return loc?.name ?? "the lanes";
}

/** An acquisition description: how it was got + WHEN (the in-game tenday). */
export function acquiredDetail(rt: EconRT, how: string): string {
  const t = rt.state.campaign.tendaysElapsed ?? 0;
  return `${how} · tenday ${t}`;
}

/** A flavor scene item the analyst/narrator grants (a keepsake, a note). Only
 *  non-catalog, non-gear-shaped props that fit the pack; real gear is engine-owned. */
export function grantSceneItem(rt: EconRT, name: string, note?: string): string | null {
  const pc = pcOf(rt);
  const trimmed = name.trim();
  if (!pc || !trimmed) return null;
  const norm = trimmed.toLowerCase().replace(/^(a|an|the)\s+/, "");
  if (resolveGearItemId({ name: trimmed }) || looksLikeGear(norm)) return null; // engine owns real gear
  if (pc.gear.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) return null; // already carried
  const gear = [...pc.gear, { name: trimmed, detail: acquiredDetail(rt, note?.trim() || `picked up at ${currentPlace(rt)}`) }];
  if (slotsUsed({ ...pc, gear }) > maxSlotsFor(pc)) return null; // no room — drop silently (background)
  setGear(rt, pc.id, gear, false);
  return `🎒 ${trimmed}`;
}

/**
 * Narrative item pickup/loss (a looted facemask, a confiscated pistol): the
 * model proposes, the engine writes it into the PC's GEAR so it persists.
 * Gains dedupe by name; losses only remove non-catalog gear. Returns a line or null.
 */
export function applyGearChange(rt: EconRT, name: string, action: "gain" | "lose", note?: string): string | null {
  const pc = pcOf(rt);
  if (!pc) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  // A gained item that IS a catalog item (a looted "medkit") must become the
  // MECHANICAL item — with itemId — or useItem's possession check will fail.
  const norm = trimmed.toLowerCase().replace(/^(a|an|the)\s+/, "");
  const cat =
    action === "gain"
      ? allItems().find((it) => it.name.toLowerCase() === norm || it.id.toLowerCase() === norm)
      : undefined;
  // GEAR gains are engine-authored: real WEAPONS/ARMOR may only be handed over on a
  // turn with a legit source (a scavenge/loot roll or a quest reward). CONSUMABLES
  // (a stim, a medkit) pass freely as NPC gifts. FLAVOR props are always allowed.
  const isConsumableGift = !!cat && !cat.damage && !cat.acBonus;
  if (
    action === "gain" &&
    !isConsumableGift &&
    (cat || looksLikeGear(norm)) &&
    !rt.lootedThisTurn &&
    !rt.questCompletedThisTurn
  ) {
    return null;
  }
  const existing = pc.gear.find((g) =>
    cat ? g.itemId === cat.id : g.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (action === "gain") {
    let gear: Character["gear"];
    let label: string;
    const gainDetail = acquiredDetail(rt, note?.trim() || `acquired at ${currentPlace(rt)}`);
    if (cat) {
      // Catalog item: stack it. The entry carries the catalog's damage/AC.
      gear = existing
        ? pc.gear.map((g) => (g === existing ? { ...g, qty: (g.qty ?? 1) + 1 } : g))
        : [
            ...pc.gear,
            {
              name: cat.name,
              itemId: cat.id,
              qty: 1,
              detail: gainDetail,
              ...(cat.damage ? { damage: cat.damage } : {}),
              ...(cat.acBonus ? { acBonus: cat.acBonus } : {}),
            },
          ];
      const n = (existing?.qty ?? 0) + 1;
      label = `${cat.name}${n > 1 ? ` (×${n})` : ""}`;
    } else {
      if (existing) return null; // flavor item already carried — nothing to do
      gear = [...pc.gear, { name: trimmed, detail: gainDetail }];
      label = trimmed;
    }
    // Inventory capacity (ITEMS.md slice B): a gain that doesn't fit is PARKED as a
    // pending pickup so next turn can offer swap chips. A growing stack always fits.
    const cap = maxSlotsFor(pc);
    if (!existing && slotsUsed({ ...pc, gear }) > cap) {
      rt.sceneCard.pendingPickup = { name: cat?.name ?? trimmed, itemId: cat?.id, note: note?.trim() || undefined };
      return `🎒 Pack full (${slotsUsed(pc)}/${cap} slots) — ${label} won't fit. Drop something to take it.`;
    }
    setGear(rt, pc.id, gear, Boolean(cat?.acBonus));
    return `🎒 Gained: ${label}`;
  }
  if (!existing) return null;
  // Losing catalog gear decrements the stack; flavor gear is removed whole.
  const gear =
    existing.itemId && (existing.qty ?? 1) > 1
      ? pc.gear.map((g) => (g === existing ? { ...g, qty: (g.qty ?? 1) - 1 } : g))
      : pc.gear.filter((g) => g !== existing);
  const hadArmor = Boolean(
    existing.acBonus ?? (existing.itemId ? catalogItem(existing.itemId)?.acBonus : 0),
  );
  setGear(rt, pc.id, gear, hadArmor);
  return `🎒 Lost: ${existing.name}`;
}

/**
 * Resolve a full-pack SWAP (ITEMS.md slice B): drop the named carried item to
 * make room, then take the parked pending pickup. Recomputes AC if either piece
 * was armor. Returns the visible line (or an error if the drop/pending is gone).
 */
export function resolveSwap(rt: EconRT, dropName: string): { line?: string; error?: string } {
  const pc = pcOf(rt);
  const pending = rt.sceneCard.pendingPickup;
  if (!pc || !pending) return { error: "nothing to swap" };
  const norm = dropName.trim().toLowerCase().replace(/^(a|an|the)\s+/, "");
  const dropped = pc.gear.find((g) => g.name.toLowerCase() === norm) ?? pc.gear.find((g) => g.name.toLowerCase().includes(norm));
  if (!dropped) return { error: `not carrying "${dropName.trim()}"` };

  // Drop one (a stack decrements; flavor/last goes whole), then append the pending.
  let gear =
    dropped.itemId && (dropped.qty ?? 1) > 1
      ? pc.gear.map((g) => (g === dropped ? { ...g, qty: (g.qty ?? 1) - 1 } : g))
      : pc.gear.filter((g) => g !== dropped);
  const cat = pending.itemId ? catalogItem(pending.itemId) : undefined;
  gear = [
    ...gear,
    cat
      ? { name: cat.name, itemId: cat.id, qty: 1, ...(cat.damage ? { damage: cat.damage } : {}), ...(cat.acBonus ? { acBonus: cat.acBonus } : {}) }
      : { name: pending.name, ...(pending.note ? { detail: pending.note } : {}) },
  ];
  const armorTouched =
    Boolean(dropped.acBonus ?? (dropped.itemId ? catalogItem(dropped.itemId)?.acBonus : 0)) || Boolean(cat?.acBonus);
  setGear(rt, pc.id, gear, armorTouched);
  rt.sceneCard.pendingPickup = undefined;
  return { line: `🎒 Dropped ${dropped.name}, took ${pending.name}.` };
}

/** Walk away from a parked pending pickup — leave it behind for good. */
export function declineSwap(rt: EconRT): { line?: string } {
  const pending = rt.sceneCard.pendingPickup;
  rt.sceneCard.pendingPickup = undefined;
  return pending ? { line: `🎒 Left ${pending.name} behind.` } : {};
}

/** Buy from the local market. Validates the shelf, price (catalog ±20% by local
 *  rep), credits, and pack space; returns an error string for a VISIBLE ⚠ line. */
export function buyItem(rt: EconRT, itemId: string, qty = 1): { line?: string; error?: string } {
  const pc = pcOf(rt);
  if (!pc) return { error: "no character" };
  const n = Math.max(1, Math.min(5, Math.floor(qty)));
  const loc = rt.state.locations.find((l) => l.id === rt.state.campaign.currentLocationId);
  const tier = marketTierFor(loc);
  if (!loc || !tier) return { error: "no market here" };
  // Resolve leniently (cheap models emit a name or near-id); gate by the market's
  // TIER, not the rotated "featured" subset. Consumables sell at any market.
  const wantId = catalogItem(itemId) ? itemId : resolveGearItemId({ name: itemId }) ?? itemId;
  const cat = catalogItem(wantId);
  if (!cat) return { error: `no such item "${itemId}"` };
  const order = { T1: 1, T2: 2, T3: 3 } as const;
  if (cat.type !== "consumable" && !(cat.marketTier && order[cat.marketTier] <= order[tier])) {
    return { error: `${cat.name} is above what this market carries` };
  }
  const rep = localRep(loc, rt.state.factions, rt.state.factionRep);
  const price = Math.round(cat.price * repPriceFactor(rep)) * n;
  if ((pc.credits ?? 0) < price) return { error: `can't afford it (¢${price}, holding ¢${pc.credits ?? 0})` };
  const existing = pc.gear.find((g) => g.itemId === cat.id);
  const gear = existing
    ? pc.gear.map((g) => (g === existing ? { ...g, qty: (g.qty ?? 1) + n } : g))
    : [
        ...pc.gear,
        {
          name: cat.name,
          itemId: cat.id,
          qty: n,
          detail: acquiredDetail(rt, `bought at ${loc.name}`),
          ...(cat.damage ? { damage: cat.damage } : {}),
          ...(cat.acBonus ? { acBonus: cat.acBonus } : {}),
        },
      ];
  const cap = maxSlotsFor(pc);
  if (slotsUsed({ ...pc, gear }) > cap) {
    return { error: `pack full (${slotsUsed(pc)}/${cap} slots) — drop something first` };
  }
  setGear(rt, pc.id, gear, Boolean(cat.acBonus));
  const after = (pc.credits ?? 0) - price;
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((c) => (c.id === pc.id ? { ...c, credits: after } : c)),
  };
  const line = `🛒 Bought ${cat.name}${n > 1 ? ` ×${n}` : ""} — ¢${price}. ¢${after} left.`;
  rt.events.push({ type: "note", breakdown: line });
  return { line };
}

/** Sell carried gear at the flat 40% rate (catalog price, else the netWorth
 *  heuristic). Decrements a stack by one; flavor gear goes whole. */
export function sellItem(rt: EconRT, name: string): { line?: string; error?: string } {
  const pc = pcOf(rt);
  if (!pc) return { error: "no character" };
  const norm = name.trim().toLowerCase().replace(/^(a|an|the)\s+/, "");
  const existing =
    pc.gear.find((g) => g.name.toLowerCase() === norm) ??
    pc.gear.find((g) => g.itemId && g.itemId.toLowerCase() === norm) ??
    pc.gear.find((g) => g.name.toLowerCase().includes(norm));
  if (!existing) return { error: `not carrying "${name.trim()}"` };
  const unitValue = existing.itemId
    ? catalogItem(existing.itemId)?.price ?? 0
    : gearValue({ ...existing, qty: 1 });
  const paid = Math.max(1, Math.round(unitValue * SELL_RATE));
  const gear =
    existing.itemId && (existing.qty ?? 1) > 1
      ? pc.gear.map((g) => (g === existing ? { ...g, qty: (g.qty ?? 1) - 1 } : g))
      : pc.gear.filter((g) => g !== existing);
  const hadArmor = Boolean(
    existing.acBonus ?? (existing.itemId ? catalogItem(existing.itemId)?.acBonus : 0),
  );
  setGear(rt, pc.id, gear, hadArmor);
  const after = (pcOf(rt)?.credits ?? 0) + paid;
  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((c) => (c.id === pc.id ? { ...c, credits: after } : c)),
  };
  const line = `💰 Sold ${existing.name} — +¢${paid}. ¢${after} total.`;
  rt.events.push({ type: "note", breakdown: line });
  return { line };
}

/**
 * Dock hull repair (ECONOMY E-3): patch the hull at ¢12/HP. NEVER refused for lack
 * of funds — the balance goes NEGATIVE (the dock extends credit) and the Dock debt
 * thread + payoff loop kicks in (syncDockDebt). `hpWanted` caps a partial patch.
 */
export function repairShip(rt: EconRT, hpWanted?: number): { line?: string; error?: string } {
  const s = rt.state.ship;
  if (!s) return { error: "no ship to repair" };
  const loc = rt.state.locations.find((l) => l.id === rt.state.campaign.currentLocationId);
  if (!marketTierFor(loc)) return { error: "no dock with services here" };
  const deficit = s.maxHp - s.hp;
  if (deficit <= 0) return { error: "the hull is already fully patched" };
  const hp = hpWanted ? Math.max(1, Math.min(Math.floor(hpWanted), deficit)) : deficit;
  const cost = hp * economy.constants.repairCostPerHp;
  const pc = pcOf(rt);
  const before = pc?.credits ?? 0;
  const after = before - cost;
  rt.state = {
    ...rt.state,
    ship: { ...s, hp: s.hp + hp },
    characters: rt.state.characters.map((c) => (c.id === pc?.id ? { ...c, credits: after } : c)),
  };
  rt.events.push({ type: "cost", breakdown: `Dock repair: +${hp} hull, -¢${cost}`, amount: -cost });
  syncDockDebt(rt);
  const tail = after < 0 ? ` The dock runs a tab — you're ¢${-after} in the hole.` : ` ¢${after} left.`;
  return { line: `🔧 Hull patched +${hp} (${s.hp}→${s.hp + hp}) — ¢${cost}.${tail}` };
}

/**
 * The faction PATRON's free safety net (STARTER.md) — keeps a struggling rookie
 * afloat: rest to full HP, repair the hull, top stims to a floor, and float a
 * small credit stipend when broke. Gated to net worth still in the T1 band AND
 * the patron being PRESENT; it cuts off once the player is established.
 */
export function restWithPatron(rt: EconRT): { line?: string; error?: string } {
  const pc = pcOf(rt);
  if (!pc) return { error: "no character" };
  // `present` is the ONLY thing that makes the patron "here" — matching just the
  // current STATION was the reported bug (a station covers the whole map, so the
  // free-rest chip and this action fired everywhere on it, for a patron the story
  // may never have introduced). `patronHelp` is the single source of truth shared
  // with the chip + prompt, so all three agree on what "here" means.
  const { patron, present, underCap } = patronHelp(rt.state, rt.sceneCard.presentNpcIds);
  if (!patron) return { error: "you have no patron to fall back on" };
  if (!present) return { error: `${patron.name} isn't here right now` };
  if (!underCap) {
    return { error: `you're on your feet now — ${patron.name}'s free help is for those still scraping by` };
  }
  const CREDIT_FLOOR = 40;
  const CREDIT_STIPEND = 120;
  const parts: string[] = [];

  // Rest to full HP (and clear Downed) — free.
  if (pc.hp < pc.maxHp) parts.push(`patched up (+${pc.maxHp - pc.hp} HP)`);
  // Top stims up to the floor.
  const haveStims = itemCount(pc, "stim");
  const addStims = Math.max(0, PATRON_STIM_FLOOR - haveStims);
  if (addStims) parts.push(`+${addStims} stim${addStims > 1 ? "s" : ""}`);
  // A small stipend when genuinely broke.
  const broke = (pc.credits ?? 0) < CREDIT_FLOOR;
  if (broke) parts.push(`spotted you ¢${CREDIT_STIPEND - (pc.credits ?? 0)}`);

  rt.state = {
    ...rt.state,
    characters: rt.state.characters.map((c) =>
      c.id === pc.id
        ? {
            ...c,
            hp: c.maxHp,
            injuries: (c.injuries ?? []).filter((i) => i.name !== "Downed"),
            deathSaves: undefined,
            stims: (c.stims ?? 0) + addStims,
            credits: broke ? CREDIT_STIPEND : c.credits,
          }
        : c,
    ),
  };

  // Free hull repair too.
  const s = rt.state.ship;
  if (s && s.hp < s.maxHp) {
    parts.push(`hull mended (+${s.maxHp - s.hp})`);
    rt.state = { ...rt.state, ship: { ...s, hp: s.maxHp } };
  }

  if (!parts.length) return { line: `🛟 ${patron.name} looks you over — you're already squared away.` };
  rt.events.push({ type: "note", breakdown: `${patron.name} helped: ${parts.join(", ")}` });
  return { line: `🛟 ${patron.name} sets you right — ${parts.join(", ")}. Get back out there.` };
}

/**
 * Reconcile the "Dock debt" thread with the wallet (ECONOMY E-3). A negative
 * balance ensures the thread; clearing the balance resolves it. Idempotent via a
 * stable id — call it after any money move.
 */
export function syncDockDebt(rt: EconRT) {
  const credits = pcOf(rt)?.credits ?? 0;
  const id = "th-dock-debt";
  const existing = rt.state.threads.find((t) => t.id === id);
  if (credits < 0) {
    const body = `You owe the dock ¢${-credits}. Any job's pay comes off the debt first — take a quick run to clear it.`;
    if (!existing) {
      rt.state = {
        ...rt.state,
        threads: [
          ...rt.state.threads,
          { id, campaignId: rt.state.campaign.id, title: "Dock debt", body, status: "active", entityRefs: [] },
        ],
      };
    } else if (existing.status !== "active" || existing.body !== body) {
      rt.state = {
        ...rt.state,
        threads: rt.state.threads.map((t) => (t.id === id ? { ...t, body, status: "active" } : t)),
      };
    }
  } else if (existing && existing.status === "active") {
    rt.state = {
      ...rt.state,
      threads: rt.state.threads.map((t) =>
        t.id === id ? { ...t, status: "resolved", body: "Square with the dock — debt cleared." } : t,
      ),
    };
  }
}
