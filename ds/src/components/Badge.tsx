import type { ReactNode } from "react";

export type BadgeTone = "accent" | "good" | "bad" | "neutral";

export interface BadgeProps {
  children: ReactNode;
  /** `accent` = pending/attention, `good` = approved/done, `bad` = declined/threat. */
  tone?: BadgeTone;
}

const TONE: Record<BadgeTone, string> = {
  accent: "border-accent/60 text-accent",
  good: "border-good/60 text-good",
  bad: "border-bad/60 text-bad",
  neutral: "border-edge text-neutral-400",
};

/**
 * Status pill — outlined, tone-colored, lowercase by convention.
 *
 * @example
 * <Badge tone="accent">pending</Badge>
 * <Badge tone="good">approved</Badge>
 * <Badge tone="bad">declined</Badge>
 */
export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE[tone]}`}>{children}</span>;
}
