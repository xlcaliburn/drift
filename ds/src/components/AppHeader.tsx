import type { ReactNode } from "react";

export interface AppHeaderProps {
  /** Bold amber wordmark — "DRIFT". */
  brand: ReactNode;
  /** Muted context line — campaign · location. */
  center?: ReactNode;
  /** Right-aligned controls. */
  right?: ReactNode;
}

/**
 * Top bar of a play screen.
 *
 * @example
 * <AppHeader
 *   brand="DRIFT"
 *   center="Red Ledger · Meridian Dock"
 *   right={<Button variant="outline" size="sm">💡 Request</Button>}
 * />
 */
export function AppHeader({ brand, center, right }: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-edge px-5 py-3">
      <span className="text-lg font-bold text-accent">{brand}</span>
      {center && <span className="text-sm text-neutral-400">{center}</span>}
      <div className="flex items-center gap-3">{right}</div>
    </header>
  );
}
