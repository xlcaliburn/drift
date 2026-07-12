import type { ReactNode } from "react";

export interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
}

/**
 * One line of a summary sheet — muted key left, value right, hairline rule
 * between rows (the last row drops its rule automatically).
 *
 * @example
 * <div className="space-y-2 text-sm">
 *   <KeyValueRow label="Name" value="Silas Corr" />
 *   <KeyValueRow label="Faction" value="Halvane Combine" />
 *   <KeyValueRow label="Ambition" value="own your hull outright" />
 * </div>
 */
export function KeyValueRow({ label, value }: KeyValueRowProps) {
  return (
    <div className="flex justify-between gap-4 border-b border-edge/50 py-1 last:border-0">
      <span className="text-neutral-500">{label}</span>
      <span className="text-right text-neutral-200">{value}</span>
    </div>
  );
}
