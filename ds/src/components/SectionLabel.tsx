import type { ReactNode } from "react";

export interface SectionLabelProps {
  children: ReactNode;
  /** Widest tracking — for pane headers like the dice log's. */
  wide?: boolean;
}

/**
 * Tiny uppercase heading that labels every group of content.
 *
 * @example
 * <SectionLabel>Attributes</SectionLabel>
 * <SectionLabel wide>Dice log</SectionLabel>
 */
export function SectionLabel({ children, wide }: SectionLabelProps) {
  return (
    <div
      className={
        "mb-1.5 text-xs uppercase text-neutral-500 " + (wide ? "tracking-widest" : "tracking-wide")
      }
    >
      {children}
    </div>
  );
}
