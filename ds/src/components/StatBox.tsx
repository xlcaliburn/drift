import type { ReactNode } from "react";

export interface StatBoxProps {
  /** Tiny uppercase caption — "HP", "AC", "REF". */
  label: ReactNode;
  value: ReactNode;
}

/**
 * Recessed cell showing one vital or attribute. Compose in a grid:
 * four across for vitals, six across for attributes.
 *
 * @example
 * <div className="grid grid-cols-4 gap-2 text-center">
 *   <StatBox label="HP" value="12/14" />
 *   <StatBox label="AC" value={15} />
 *   <StatBox label="Credits" value="¢220" />
 *   <StatBox label="Stims" value={2} />
 * </div>
 */
export function StatBox({ label, value }: StatBoxProps) {
  return (
    <div className="rounded-md border border-edge/60 bg-ink/40 px-2 py-2 text-center">
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
      <div className="text-sm font-semibold text-neutral-100">{value}</div>
    </div>
  );
}
