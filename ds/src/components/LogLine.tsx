import type { ReactNode } from "react";

export interface LogLineProps {
  /** Leading glyph — 🎲 roll, 🎯 attack, 💥 damage, ▲ tick, ⏱ clock, ¢ cost. */
  icon?: ReactNode;
  children: ReactNode;
  /** Rolls, attacks, and damage get the raised panel treatment. */
  highlight?: boolean;
}

/**
 * One mechanical event in the dice log — mono, dense, newest on top.
 *
 * @example
 * <div className="space-y-1 font-mono text-[12px] leading-snug">
 *   <LogLine icon="🎲" highlight>piloting 2d6+3 = 11 vs 9 — success</LogLine>
 *   <LogLine icon="⏱">Halvane patrol clock 3/6</LogLine>
 * </div>
 */
export function LogLine({ icon, children, highlight }: LogLineProps) {
  return (
    <div
      className={
        "rounded px-2 py-1 font-mono text-[12px] leading-snug " +
        (highlight ? "bg-panel text-neutral-300" : "text-neutral-500")
      }
    >
      {icon && <span className="mr-1">{icon}</span>}
      {children}
    </div>
  );
}
