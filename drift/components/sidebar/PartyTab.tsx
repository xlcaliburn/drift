"use client";

import type { CampaignState } from "@/shared/schemas";
import { Bar, SheetSection, condition } from "./ui";

/** Party tab (HANDOFF_PLAYTEST_POLISH_1.md decision 6) — the full detail on
 *  every OTHER standing member: crew and the prologue's temporary ally.
 *  Reuses the same Bar/condition primitives the sidebar rail does; adds what
 *  the compact rail card leaves out (skills, the full gear list). */
export function PartyTab({ state }: { state: CampaignState }) {
  const party = state.characters.filter((c) => c.kind !== "pc");
  if (party.length === 0) {
    return <p className="text-neutral-500">Traveling solo — no crew or allies right now.</p>;
  }
  return (
    <div className="space-y-3">
      {party.map((c) => {
        const cond = condition(c.injuries);
        const weapons = c.gear.filter((g) => g.damage);
        const inventory = c.gear.filter((g) => !g.damage);
        return (
          <SheetSection key={c.id} label={c.name}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-neutral-400">
                {c.temporary
                  ? "escort — riding along"
                  : c.crewRole
                    ? `${c.crewTier ?? "T1"} ${c.crewRole}`
                    : "party member"}
              </span>
              {c.kind === "party" && !c.temporary && (
                <span
                  className="cursor-help text-neutral-500"
                  title={`Loyalty ${c.loyalty ?? 0}/5 — unpaid tendays erode it; at 0 they may walk.`}
                >
                  <span className="text-accent">{"●".repeat(c.loyalty ?? 0)}</span>
                  <span className="text-neutral-700">{"○".repeat(Math.max(0, 5 - (c.loyalty ?? 0)))}</span>
                </span>
              )}
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-14 text-neutral-500">HP {c.hp}/{c.maxHp}</span>
              <Bar value={c.hp} max={c.maxHp} tone={c.hp / c.maxHp < 0.34 ? "bg-bad" : "bg-good"} />
            </div>
            <div className="mt-1 text-neutral-500">
              Armor Class {c.ac}
              {c.wage && !c.temporary ? ` · ¢${c.wage}/tenday` : ""}
              {c.fragile && <span className="text-bad"> · FRAGILE</span>}
              {cond && <span className={`font-semibold ${cond.className}`}> · {cond.text}</span>}
            </div>

            {c.skills.length > 0 && (
              <div className="mt-1.5 text-[12px] text-neutral-400">
                {c.skills.map((s, i) => (
                  <span key={s.name}>
                    {i > 0 && " · "}
                    {s.name} Lv{s.level}
                  </span>
                ))}
              </div>
            )}

            {(weapons.length > 0 || inventory.length > 0) && (
              <div className="mt-1.5 space-y-0.5">
                {weapons.map((g, i) => (
                  <div key={`w${i}`} className="flex justify-between gap-2 text-[12px]" title={g.detail}>
                    <span className="text-neutral-200">
                      {g.name}
                      {g.qty && g.qty > 1 ? <span className="text-neutral-500"> ×{g.qty}</span> : null}
                    </span>
                    <span className="tabular-nums text-neutral-500">{g.damage}</span>
                  </div>
                ))}
                {inventory.map((g, i) => (
                  <div key={`i${i}`} className="flex justify-between gap-2 text-[12px]" title={g.detail}>
                    <span className="text-neutral-200">
                      {g.name}
                      {g.qty && g.qty > 1 ? <span className="text-neutral-500"> ×{g.qty}</span> : null}
                    </span>
                    {g.acBonus ? <span className="tabular-nums text-neutral-600">+{g.acBonus} AC</span> : null}
                  </div>
                ))}
              </div>
            )}
          </SheetSection>
        );
      })}
    </div>
  );
}
