export interface StepperProps {
  steps: string[];
  /** Zero-based index of the current step. */
  current: number;
}

/**
 * Breadcrumb-style progress line for multi-step flows: done steps go green,
 * the current step is bold amber, the rest stay muted.
 *
 * @example
 * <Stepper steps={["The world", "Your faction", "Who you are", "Review"]} current={1} />
 */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span className={i === current ? "font-semibold text-accent" : i < current ? "text-good" : ""}>
            {s}
          </span>
          {i < steps.length - 1 && <span className="text-edge">→</span>}
        </div>
      ))}
    </div>
  );
}
