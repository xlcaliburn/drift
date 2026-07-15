"use client";

import type { CampaignState } from "@/shared/schemas";
import { Bar } from "./ui";

export function ClocksTab({ state }: { state: CampaignState }) {
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
          {(() => {
            // Only surface factions the player has actually encountered: their own
            // faction (which carries a starting `standing`) and any faction whose
            // rep has moved off its neutral default through play.
            const encountered = state.factionRep.filter((r) => r.standing !== undefined || r.rep !== 0);
            if (encountered.length === 0) {
              return <p className="text-neutral-600">No factions encountered yet.</p>;
            }
            return encountered.map((r) => {
              const f = state.factions.find((x) => x.id === r.factionId);
              return (
                <div key={r.factionId} className="flex justify-between text-neutral-400">
                  <span className="truncate">{f?.name ?? r.factionId}</span>
                  <span className={r.rep >= 0 ? "text-good" : "text-bad"}>
                    {r.rep >= 0 ? `+${r.rep}` : r.rep}
                  </span>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}
