import type { HTMLAttributes } from "react";

export type PanelTone = "solid" | "faint" | "inset";
export type PanelPadding = "none" | "sm" | "md" | "lg";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `solid` — opaque card (modals, chat bubbles' surface).
   * `faint` — translucent card, the default reading surface.
   * `inset` — recessed well on ink, for stats and cells inside other panels.
   */
  tone?: PanelTone;
  padding?: PanelPadding;
}

const TONE: Record<PanelTone, string> = {
  solid: "rounded-lg border border-edge bg-panel",
  faint: "rounded-lg border border-edge bg-panel/50",
  inset: "rounded-md border border-edge/60 bg-ink/40",
};

const PAD: Record<PanelPadding, string> = {
  none: "",
  sm: "p-2",
  md: "p-4",
  lg: "p-5",
};

/**
 * Raised surface — the basic card every sheet, brief, and recap sits on.
 *
 * @example
 * <Panel tone="faint" padding="lg">
 *   <SectionLabel>Attributes</SectionLabel>
 *   ...
 * </Panel>
 */
export function Panel({ tone = "faint", padding = "md", className, ...rest }: PanelProps) {
  return (
    <div className={`${TONE[tone]} ${PAD[padding]}${className ? ` ${className}` : ""}`} {...rest} />
  );
}
