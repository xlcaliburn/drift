"use client";

import type { CampaignState } from "@/shared/schemas";
import type { CombatState } from "@/shared/combat";
import { dispositionLabel, type NpcRelations, type SceneCard } from "@/shared/scene";
import { slotsUsed, maxSlotsFor } from "@/shared/items";
import { Bar, SheetSection, condition } from "./ui";
import { ReSyncButton } from "./ReSyncButton";

/** MAIN tab — the most immediate info: HP/condition, weapons + ammo, inventory,
 *  ship survival state, and where you are / what's live. */
export function StatusTab({
  state,
  combat,
  npcRelations,
  sceneCard,
  onDetails,
  onRefresh,
}: {
  state: CampaignState;
  combat: CombatState | null;
  npcRelations: NpcRelations;
  sceneCard: SceneCard | null;
  onDetails: () => void;
  onRefresh?: () => void;
}) {
  const loc = state.locations.find((l) => l.id === state.campaign.currentLocationId);
  const active = state.threads.filter((t) => t.status === "active");
  return (
    <div className="space-y-4">
      {combat?.active && (
        <div className="rounded border border-bad/50 bg-bad/5 p-2">
          <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-bad">
            <span>⚔ In combat</span>
            <span className="text-neutral-500">Round {combat.round}</span>
          </div>
          <div className="space-y-1">
            {combat.enemies.map((e) => (
              <div key={e.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-neutral-200">{e.name}</span>
                  <span className="tabular-nums text-[11px] text-neutral-500">
                    {e.hp}/{e.maxHp}
                    {e.shieldReady && <span className="text-accent"> ⛨</span>}
                  </span>
                </div>
                <Bar value={e.hp} max={e.maxHp} tone="bg-bad" height="h-1" />
              </div>
            ))}
          </div>
          {/* Own hull, visible during a ship fight (full ship card is in More details). */}
          {combat.scale === "ship" && state.ship && (
            <div className="mt-2 border-t border-bad/30 pt-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] text-neutral-200">{state.ship.name} (you)</span>
                <span className="tabular-nums text-[11px] text-neutral-500">
                  {state.ship.hp}/{state.ship.maxHp}
                  {state.ship.shieldReady && <span className="text-accent"> ⛨</span>}
                </span>
              </div>
              <Bar value={state.ship.hp} max={state.ship.maxHp} tone="bg-good" height="h-1" />
            </div>
          )}
        </div>
      )}
      {state.characters.map((c) => {
        const cond = condition(c.injuries);
        const weapons = c.gear.filter((g) => g.damage);
        const inventory = c.gear.filter((g) => !g.damage);
        return (
          <div key={c.id} className="rounded border border-edge p-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-100">{c.name}</span>
              <span className="text-neutral-500">{c.kind === "pc" ? "You" : `loyalty ${c.loyalty}/5`}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="w-14 text-neutral-500">HP {c.hp}/{c.maxHp}</span>
              <Bar value={c.hp} max={c.maxHp} tone={c.hp / c.maxHp < 0.34 ? "bg-bad" : "bg-good"} />
            </div>
            <div className="mt-1 text-neutral-500">
              <span
                className="cursor-help underline decoration-dotted decoration-neutral-700 underline-offset-2"
                title="How hard you are to hit — an attack roll must meet or beat it to land (10 + Reflex + armor)."
              >
                Armor Class
              </span>{" "}
              {c.ac}
              {c.credits !== undefined && ` · ¢${c.credits}`}
              {c.fragile && <span className="text-bad"> · FRAGILE</span>}
              {cond && <span className={`font-semibold ${cond.className}`}> · {cond.text}</span>}
            </div>

            {/* Bleeding Out — the death-save track while Downed (COMBAT.md). Pips
                fill as the engine rolls: three ● stabilise, three ✕ is death. */}
            {c.deathSaves && (c.injuries ?? []).some((i) => i.name === "Downed") && (
              <div className="mt-1 flex items-center gap-3 text-[12px]" title="Death saves — 3 successes stabilise you, 3 failures is death.">
                <span className="text-good">
                  saves {"●".repeat(Math.min(3, c.deathSaves.successes))}
                  <span className="text-neutral-700">{"○".repeat(Math.max(0, 3 - c.deathSaves.successes))}</span>
                </span>
                <span className="text-bad">
                  fails {"✕".repeat(Math.min(3, c.deathSaves.failures))}
                  <span className="text-neutral-700">{"○".repeat(Math.max(0, 3 - c.deathSaves.failures))}</span>
                </span>
              </div>
            )}

            {(weapons.length > 0 || inventory.length > 0 || c.stims > 0) && (
              <SheetSection label={`Equipment · ${slotsUsed(c)}/${maxSlotsFor(c)} slots`}>
                <div className="space-y-0.5">
                  {weapons.map((g, i) => {
                    const dry = g.rounds === 0;
                    return (
                      <div key={`w${i}`} className="flex justify-between gap-2 text-[12px]" title={g.detail}>
                        <span className="text-neutral-200">{g.name}</span>
                        <span className="tabular-nums text-neutral-500">
                          {g.damage}
                          {typeof g.rounds === "number" && (
                            <span className={dry ? "text-bad" : "text-neutral-600"}>
                              {" · "}
                              {dry ? "no ammo" : `${g.rounds} rds`}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                  {inventory.map((g, i) => (
                    <div key={`i${i}`} className="flex justify-between gap-2 text-[12px]" title={g.detail}>
                      <span className="text-neutral-200">
                        {g.name}
                        {g.qty && g.qty > 1 ? <span className="text-neutral-500"> ×{g.qty}</span> : null}
                      </span>
                      {g.acBonus ? <span className="tabular-nums text-neutral-600">+{g.acBonus} AC</span> : null}
                    </div>
                  ))}
                  {c.stims > 0 && (
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span className="text-neutral-200">Stim ×{c.stims}</span>
                      <span className="tabular-nums text-neutral-600">heal 1d6+2</span>
                    </div>
                  )}
                </div>
              </SheetSection>
            )}

            {c.kind === "pc" && (
              <button
                onClick={onDetails}
                className="mt-2 w-full rounded border border-edge py-1 text-[11px] uppercase tracking-wide text-neutral-400 transition hover:border-accent hover:text-accent"
              >
                More details
              </button>
            )}
          </div>
        );
      })}


      <div className="rounded border border-edge p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">Here &amp; now</span>
          <ReSyncButton campaignId={state.campaign.id} onSynced={onRefresh} />
        </div>
        {/* Whereabouts: the free-text place (a ship, the black) if set — always current
            within the scene, since a move to a new place now opens a new scene — else
            the accurate fixed station. */}
        <div className="text-neutral-200">{sceneCard?.place ?? loc?.name ?? "Unknown"}</div>
        {sceneCard?.place && loc?.name && !sceneCard.place.includes(loc.name) && (
          <div className="text-[11px] text-neutral-600">near {loc.name}</div>
        )}

        {/* The live scene: what's happening, who's here, what's been established. */}
        {sceneCard?.situation && (
          <p className="mt-1 text-[12px] italic leading-snug text-neutral-300">{sceneCard.situation}</p>
        )}
        {sceneCard?.dangers && sceneCard.dangers.length > 0 && (
          <div className="mt-1.5 rounded border border-bad/40 bg-bad/5 px-2 py-1">
            {sceneCard.dangers.map((d, i) => (
              <div key={i} className="text-[12px] font-medium text-bad">
                ⚠ {d}
              </div>
            ))}
          </div>
        )}
        {/* Who's in the scene right now — each folds in what you know of them
            (relationship + standing), so someone you just spoke with shows live
            with your read on them the instant the turn returns. */}
        {(() => {
          const present = sceneCard
            ? sceneCard.presentNpcIds
                .map((id) => state.npcs.find((n) => n.id === id))
                .filter((n): n is CampaignState["npcs"][number] => !!n)
            : [];
          if (present.length === 0) return null;
          const dispTone = (d: number) => (d > 0 ? "text-good" : d < 0 ? "text-bad" : "text-neutral-500");
          return (
            <div className="mt-1.5 space-y-1">
              {present.map((npc) => {
                const rel = npcRelations[npc.id];
                return (
                  <div
                    key={npc.id}
                    className="rounded border border-edge bg-ink/40 px-1.5 py-1"
                    title={npc.role ?? undefined}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] text-neutral-200">
                        {npc.name}
                        <span className="text-[11px] text-accent/70"> · immediate</span>
                      </span>
                      {rel && (
                        <span className={"shrink-0 text-[11px] " + dispTone(rel.disposition)}>
                          {dispositionLabel(rel.disposition)}
                        </span>
                      )}
                    </div>
                    {rel?.relationship && (
                      <div className="text-[11px] text-neutral-500">{rel.relationship}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Also nearby: known contacts on the same station who aren't in the scene
            — a compact awareness line so they're not out of sight, out of mind. */}
        {(() => {
          const presentIds = new Set(sceneCard?.presentNpcIds ?? []);
          const here = state.campaign.currentLocationId;
          const nearby = state.npcs
            .filter((n) => npcRelations[n.id] && n.locationId === here && !presentIds.has(n.id))
            .slice(0, 5);
          if (nearby.length === 0) return null;
          return (
            <div className="mt-1.5 border-t border-edge/60 pt-1.5 text-[11px] text-neutral-500">
              <span className="text-neutral-600">Also nearby:</span>{" "}
              {nearby.map((npc, i) => {
                const rel = npcRelations[npc.id];
                const tone = rel && rel.disposition > 0 ? "text-good" : rel && rel.disposition < 0 ? "text-bad" : "text-neutral-400";
                return (
                  <span key={npc.id}>
                    {i > 0 && ", "}
                    <span className="text-neutral-300">{npc.name}</span>
                    {rel && <span className={tone}> ({dispositionLabel(rel.disposition)})</span>}
                  </span>
                );
              })}
            </div>
          );
        })()}
        {sceneCard && sceneCard.beats.length > 0 && (
          <div className="mt-1.5 border-t border-edge/60 pt-1.5">
            <div className="text-[10px] uppercase tracking-wide text-neutral-600">Established</div>
            {sceneCard.beats.map((b, i) => (
              <div key={i} className="mt-0.5 text-[12px] text-neutral-400">
                • {b}
              </div>
            ))}
          </div>
        )}

        {/* The current objective only — the full thread list lives in More details. */}
        {active.length > 0 && (
          <div className="mt-1.5 border-t border-edge/60 pt-1.5 text-[12px] text-neutral-400">
            <span className="text-neutral-600">Now:</span> {active[0].title}
          </div>
        )}
      </div>

    </div>
  );
}
