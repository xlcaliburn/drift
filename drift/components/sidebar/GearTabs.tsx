"use client";

import type { CampaignState } from "@/shared/schemas";
import { allItems, itemCount, describeEffect } from "@/shared/items";
import { SheetSection } from "./ui";

/** Equipment tab — weapons and armor, with the numbers that matter. */
export function EquipmentDetail({ character: c }: { character: CampaignState["characters"][number] }) {
  const weapons = c.gear.filter((g) => g.damage);
  const armor = c.gear.filter((g) => !g.damage && g.acBonus);
  return (
    <>
      <SheetSection label="Weapons">
        {weapons.length === 0 && <p className="text-neutral-500">Unarmed.</p>}
        <div className="space-y-2">
          {weapons.map((g, i) => (
            <div key={i} className="rounded border border-edge/60 bg-ink/40 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-neutral-100">
                  {g.name}
                  {g.qty && g.qty > 1 ? <span className="font-normal text-neutral-500"> ×{g.qty}</span> : null}
                </span>
                <span className="tabular-nums text-neutral-400">{g.damage} dmg</span>
              </div>
              <div className="mt-0.5 text-[12px] text-neutral-500">
                {typeof g.rounds === "number"
                  ? g.rounds === 0
                    ? "Out of ammo"
                    : `${g.rounds} rounds left`
                  : "No ammo tracking"}
                {g.detail ? ` · ${g.detail}` : ""}
              </div>
            </div>
          ))}
        </div>
      </SheetSection>
      <SheetSection label="Armor">
        {armor.length === 0 && <p className="text-neutral-500">No armor — AC is reflexes alone.</p>}
        <div className="space-y-2">
          {armor.map((g, i) => (
            <div key={i} className="rounded border border-edge/60 bg-ink/40 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-neutral-100">{g.name}</span>
                <span className="tabular-nums text-good">+{g.acBonus} AC</span>
              </div>
              {g.detail && <div className="mt-0.5 text-[12px] text-neutral-500">{g.detail}</div>}
            </div>
          ))}
        </div>
      </SheetSection>
    </>
  );
}

/** Items tab — consumables (with counts + what they do) and carried tools. */
export function ItemsDetail({ character: c }: { character: CampaignState["characters"][number] }) {
  // Catalog consumables the character holds (incl. the legacy stims counter).
  const consumables = allItems()
    .filter((it) => it.type === "consumable")
    .map((it) => ({ it, n: itemCount(c, it.id) }))
    .filter((x) => x.n > 0);
  // Everything else they carry: tools/flavor gear (no damage, no AC, no catalog).
  const tools = c.gear.filter((g) => !g.damage && !g.acBonus && !g.itemId);
  return (
    <>
      <SheetSection label="Consumables">
        {consumables.length === 0 && <p className="text-neutral-500">None — docks and looting restock these.</p>}
        <div className="space-y-2">
          {consumables.map(({ it, n }) => (
            <div key={it.id} className="rounded border border-edge/60 bg-ink/40 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-neutral-100">
                  {it.name} <span className="text-neutral-500">×{n}</span>
                </span>
                <span className="text-[11px] uppercase tracking-wide text-neutral-600">
                  {it.combat ? "usable in combat" : "out of combat"}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-neutral-400">{describeEffect(it)}</div>
            </div>
          ))}
        </div>
      </SheetSection>
      <SheetSection label="Tools & possessions">
        {tools.length === 0 && <p className="text-neutral-500">Nothing beyond the essentials.</p>}
        <div className="space-y-2">
          {tools.map((g, i) => (
            <div key={i} className="rounded border border-edge/60 bg-ink/40 p-2">
              <span className="font-semibold text-neutral-100">
                {g.name}
                {g.qty && g.qty > 1 ? <span className="text-neutral-500"> ×{g.qty}</span> : null}
              </span>
              {g.detail && <div className="mt-0.5 text-[12px] text-neutral-500">{g.detail}</div>}
            </div>
          ))}
        </div>
      </SheetSection>
    </>
  );
}
