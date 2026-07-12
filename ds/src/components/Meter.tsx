export type MeterTone = "accent" | "good" | "bad" | "health";

export interface MeterProps {
  value: number;
  max: number;
  /**
   * `health` picks the color from the fill: good above a third, bad below —
   * how HP bars behave in play. `bad` is for threat clocks, `accent` for
   * skill progress.
   */
  tone?: MeterTone;
}

const FILL: Record<Exclude<MeterTone, "health">, string> = {
  accent: "bg-accent",
  good: "bg-good",
  bad: "bg-bad",
};

/**
 * Thin progress bar on an ink track — HP, skill ticks, threat clocks.
 *
 * @example
 * <Meter value={hp} max={maxHp} tone="health" />
 * <Meter value={clock.current} max={clock.max} tone="bad" />
 * <Meter value={ticks} max={tickMax(level)} />
 */
export function Meter({ value, max, tone = "accent" }: MeterProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = tone === "health" ? (max > 0 && value / max < 0.34 ? "bg-bad" : "bg-good") : FILL[tone];
  return (
    <div className="h-1.5 w-full rounded bg-ink">
      <div className={`h-full rounded ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
