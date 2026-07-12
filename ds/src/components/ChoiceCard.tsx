import type { ReactNode } from "react";

export interface ChoiceCardProps {
  /** Bold headline of the option. */
  title: ReactNode;
  /** Supporting copy under the title. */
  description?: ReactNode;
  /** Small right-aligned annotation on the title row (tagline, kind, cost). */
  meta?: ReactNode;
  /** Extra content below the description (e.g. an accent playstyle line). */
  children?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

/**
 * Selectable option card — factions, backgrounds, signature examples.
 * Amber border + panel fill when selected; hover lifts the border otherwise.
 *
 * @example
 * <ChoiceCard
 *   title="Halvane Combine"
 *   meta="freight is law"
 *   description="The biggest carrier in the lanes. Steady pay, short leash."
 *   selected={factionId === "halvane"}
 *   onSelect={() => setFactionId("halvane")}
 * />
 */
export function ChoiceCard({ title, description, meta, children, selected, disabled, onSelect }: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={
        "block w-full rounded-lg border p-4 text-left transition disabled:opacity-40 " +
        (selected ? "border-accent bg-panel" : "border-edge hover:border-neutral-600")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-neutral-100">{title}</span>
        {meta && <span className="text-xs italic text-neutral-500">{meta}</span>}
      </div>
      {description && <p className="mt-1 text-sm text-neutral-400">{description}</p>}
      {children}
    </button>
  );
}
