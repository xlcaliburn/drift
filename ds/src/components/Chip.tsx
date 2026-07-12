import type { ReactNode } from "react";

export interface ChipProps {
  children: ReactNode;
  /** Accent-colored trailing value — a skill level, a count. */
  value?: ReactNode;
  /** Present ⇒ renders as a clickable suggestion chip (hover turns amber). */
  onClick?: () => void;
  disabled?: boolean;
}

/**
 * Small pill for skills, gear, and tap-to-use suggestions.
 * Static chips are labels; give it `onClick` and it becomes a
 * suggestion chip like the example-flavor pickers.
 *
 * @example
 * <Chip value={2}>piloting</Chip>
 * <Chip>Mag-pistol (1d6)</Chip>
 * <Chip onClick={() => setMoralCode("people aren't cargo")}>people aren't cargo</Chip>
 */
export function Chip({ children, value, onClick, disabled }: ChipProps) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="rounded-full border border-edge px-2.5 py-1 text-xs text-neutral-400 transition hover:border-accent hover:text-accent disabled:opacity-40"
      >
        {children}
        {value !== undefined && <span className="ml-1 text-accent">{value}</span>}
      </button>
    );
  }
  return (
    <span className="rounded-full border border-edge bg-ink/40 px-2.5 py-1 text-xs text-neutral-200">
      {children}
      {value !== undefined && <span className="ml-1 text-accent">{value}</span>}
    </span>
  );
}
