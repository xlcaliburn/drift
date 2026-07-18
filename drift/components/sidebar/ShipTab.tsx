"use client";

import type { CampaignState } from "@/shared/schemas";
import { shipIsOwned } from "@/shared/recap";
import { deriveShip2Profile, shipMountSlots, shipSystemSlots } from "@/shared/ship2";
import { Bar } from "./ui";

export function ShipTab({ state }: { state: CampaignState }) {
  const s = state.ship;
  if (!s) return <p className="text-neutral-500">No ship — grounded until you earn a hull of your own.</p>;
  const missiles = s.weapons.find((w) => w.type === "missile")?.ammo ?? 0;
  const owned = shipIsOwned(state);
  // Loadout (HANDOFF_COMBAT_V2_3.md Task D) — the ship2 profile this ship
  // would actually fight with, plus slot accounting. Read-only: the shipyard
  // chips (from the shopping-intent block) are the interaction.
  const profile = deriveShip2Profile(s, []);
  const mountSlots = shipMountSlots(s);
  const systemSlots = shipSystemSlots(s);
  const fittedSystems = [
    s.damageReduction > 0 ? `Hull plating (+${s.damageReduction} DR)` : null,
    s.evasiveAcBonus > 0 ? `Vector thrusters (+${s.evasiveAcBonus} evasive)` : null,
    s.hasShield ? "Shield emitter" : null,
    s.hasPointDefense ? "Point-defense grid" : null,
    s.burstDriveReady ? "Burst drive (armed)" : null,
  ].filter((x): x is string => !!x);
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
          <div>Armor Class {s.ac} (+{s.evasiveAcBonus} evasive) · Damage Reduction {s.damageReduction}</div>
          <div>Shield: {s.shieldReady ? "ready" : "spent"} · Burst: {s.burstDriveReady ? "ready" : "used"}</div>
          <div>Missiles: {missiles}</div>
        </div>
        <div className="mt-2 border-t border-edge pt-2 text-neutral-500">
          <div className="mb-1 flex justify-between text-neutral-400">
            <span>Loadout</span>
            <span>
              {mountSlots.used}/{mountSlots.cap} mounts · {systemSlots.used}/{systemSlots.cap} systems
            </span>
          </div>
          {profile.mounts.map((m) => (
            <div key={m.key}>
              {m.name} — {m.dice}d6≥{m.hitOn}, {m.dmgPerHit} dmg, {m.power}P
              {m.ammoLimited ? ` · ${m.ammo ?? 0} ammo left` : ""}
            </div>
          ))}
          {fittedSystems.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {fittedSystems.map((sys) => (
                <div key={sys}>{sys}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
