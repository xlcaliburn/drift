import type { PlanHandler } from "./types";

/**
 * Item flows the engine owns end-to-end. `trade` = consumable use + shop buy/sell;
 * every failure is surfaced (a narrated deal/heal that didn't happen must not pass
 * silently). `gearItems` = narrative pickups/losses becoming real gear entries.
 */
export const trade: PlanHandler = (plan, { runtime, pc, emit, toolCalls }) => {
  if (plan.useItem && pc) {
    toolCalls.push("use_item");
    const res = runtime.useItem(plan.useItem.itemId, pc.id) as { line?: string; error?: string };
    if (res.line) emit([res.line]);
    // Failed use (e.g. the model thinks they hold an item they don't) must be
    // VISIBLE — otherwise the narration claims a heal that never happened.
    else if (res.error) emit([`⚠ Can't use item: ${res.error}`]);
  }
  // Shop transactions (ITEMS.md slice E) — the engine owns the whole exchange:
  // shelf check, rep-adjusted price, credits, pack space.
  if (plan.purchase && pc) {
    toolCalls.push("buy_item");
    const res = runtime.buyItem(plan.purchase.itemId, plan.purchase.qty ?? 1);
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ No sale: ${res.error}`]);
  }
  if (plan.sell && pc) {
    toolCalls.push("sell_item");
    const res = runtime.sellItem(plan.sell.name);
    if (res.line) emit([res.line]);
    else if (res.error) emit([`⚠ No sale: ${res.error}`]);
  }
};

/** Narrative item pickups/losses → real gear entries (persist in state/context). */
export const gearItems: PlanHandler = (plan, { runtime, emit, toolCalls }) => {
  if (!plan.items?.length) return;
  for (const it of plan.items.slice(0, 4)) {
    toolCalls.push("gear_change");
    const line = runtime.applyGearChange(it.name, it.action ?? "gain", it.note ?? undefined);
    if (line) emit([line]);
  }
};
