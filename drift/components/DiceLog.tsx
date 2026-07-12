"use client";

import type { EngineEvent } from "@/engine/events";

const ICONS: Record<string, string> = {
  roll: "🎲",
  attack: "🎯",
  damage: "💥",
  tick: "▲",
  clock: "⏱",
  resource: "◆",
  cost: "¢",
  rep: "🏴",
  note: "•",
};

export default function DiceLog({ log }: { log: EngineEvent[] }) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l border-edge bg-ink lg:flex">
      <div className="border-b border-edge px-3 py-2.5 text-xs uppercase tracking-widest text-neutral-500">
        Dice log
      </div>
      <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-2 font-mono text-[12px] leading-snug">
        {log.length === 0 && <div className="text-neutral-600">No rolls yet.</div>}
        {log
          .slice()
          .reverse()
          .map((e, i) => (
            <div
              key={i}
              className={
                "rounded px-2 py-1 " +
                (e.type === "roll" || e.type === "attack" || e.type === "damage"
                  ? "bg-panel text-neutral-300"
                  : "text-neutral-500")
              }
            >
              <span className="mr-1">{ICONS[e.type] ?? "•"}</span>
              {e.breakdown}
            </div>
          ))}
      </div>
    </aside>
  );
}
