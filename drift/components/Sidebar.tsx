"use client";

import { useState } from "react";
import type { CampaignState } from "@/shared/schemas";
import { tickMax } from "@/engine/progression";
import { shipIsOwned } from "@/shared/recap";

type Tab = "sheet" | "ship" | "clocks";

export default function Sidebar({ state }: { state: CampaignState }) {
  const [tab, setTab] = useState<Tab>("sheet");

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-edge bg-panel/40 md:flex">
      <div className="flex border-b border-edge text-sm">
        {(["sheet", "ship", "clocks"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "flex-1 py-2.5 uppercase tracking-wide " +
              (tab === t ? "border-b-2 border-accent text-accent" : "text-neutral-500")
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-3 text-[13px]">
        {tab === "sheet" && <SheetTab state={state} />}
        {tab === "ship" && <ShipTab state={state} />}
        {tab === "clocks" && <ClocksTab state={state} />}
      </div>
    </aside>
  );
}

function Bar({ value, max, tone = "bg-accent" }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded bg-ink">
      <div className={`h-full rounded ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SheetTab({ state }: { state: CampaignState }) {
  return (
    <div className="space-y-4">
      {state.characters.map((c) => (
        <div key={c.id} className="rounded border border-edge p-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-neutral-100">{c.name}</span>
            <span className="text-neutral-500">
              {c.kind === "pc" ? "PC" : `loyalty ${c.loyalty}/5`}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-14 text-neutral-500">HP {c.hp}/{c.maxHp}</span>
            <Bar value={c.hp} max={c.maxHp} tone={c.hp / c.maxHp < 0.34 ? "bg-bad" : "bg-good"} />
          </div>
          <div className="mt-1 text-neutral-500">
            AC {c.ac}
            {c.credits !== undefined && ` · ¢${c.credits}`}
            {c.fragile && <span className="text-bad"> · FRAGILE</span>}
          </div>
          {c.kind === "pc" && (
            <div className="mt-2 space-y-1">
              {c.skills
                .filter((s) => s.level > 0 || s.ticks > 0)
                .map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="w-24 truncate capitalize text-neutral-400">
                      {s.name} {s.level}
                    </span>
                    <Bar value={s.ticks} max={tickMax(s.level)} />
                    <span className="w-8 text-right text-neutral-600">
                      {s.ticks}/{tickMax(s.level)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ShipTab({ state }: { state: CampaignState }) {
  const s = state.ship;
  if (!s) return <p className="text-neutral-500">No ship — grounded until you earn a hull of your own.</p>;
  const missiles = s.weapons.find((w) => w.type === "missile")?.ammo ?? 0;
  const owned = shipIsOwned(state);
  return (
    <div className="space-y-3">
      <div className="rounded border border-edge p-2">
        <div className="flex justify-between">
          <span className="font-semibold text-neutral-100">{s.name}</span>
          <span className="text-neutral-500">{s.shipClass}</span>
        </div>
        <div
          className={
            "mt-1 inline-block rounded px-1.5 py-0.5 text-xs " +
            (owned ? "bg-good/20 text-good" : "bg-edge text-neutral-400")
          }
        >
          {owned ? "Owned" : "On loan — not yet yours"}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="w-16 text-neutral-500">HP {s.hp}/{s.maxHp}</span>
          <Bar value={s.hp} max={s.maxHp} tone={s.hp / s.maxHp < 0.34 ? "bg-bad" : "bg-good"} />
        </div>
        <div className="mt-2 space-y-1 text-neutral-400">
          <div>AC {s.ac} (+{s.evasiveAcBonus} evasive) · DR {s.damageReduction}</div>
          <div>Shield: {s.shieldReady ? "ready" : "spent"} · Burst: {s.burstDriveReady ? "ready" : "used"}</div>
          <div>Missiles: {missiles}</div>
        </div>
        <div className="mt-2 border-t border-edge pt-2 text-neutral-500">
          {s.weapons.map((w) => (
            <div key={w.name}>
              {w.name} — {w.type} {w.damage}
              {w.count ? ` ×${w.count}` : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClocksTab({ state }: { state: CampaignState }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 uppercase tracking-wide text-neutral-500">Clocks</h3>
        <div className="space-y-2">
          {state.clocks.map((c) => (
            <div key={c.id} className="rounded border border-edge p-2">
              <div className="flex justify-between">
                <span className="text-neutral-200">{c.name}</span>
                <span className="text-neutral-500">{c.current}/{c.max}</span>
              </div>
              <div className="mt-1">
                <Bar value={c.current} max={c.max} tone="bg-bad" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 uppercase tracking-wide text-neutral-500">Faction rep</h3>
        <div className="space-y-1">
          {state.factionRep.map((r) => {
            const f = state.factions.find((x) => x.id === r.factionId);
            return (
              <div key={r.factionId} className="flex justify-between text-neutral-400">
                <span className="truncate">{f?.name ?? r.factionId}</span>
                <span className={r.rep >= 0 ? "text-good" : "text-bad"}>
                  {r.rep >= 0 ? `+${r.rep}` : r.rep}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
