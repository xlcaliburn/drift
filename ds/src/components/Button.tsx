import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "success" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. `primary` is the amber call-to-action; one per view. */
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "rounded-lg bg-accent font-semibold text-ink disabled:opacity-40",
  outline:
    "rounded-lg border border-edge text-neutral-200 transition hover:border-accent hover:text-accent disabled:opacity-40",
  ghost: "text-neutral-500 transition hover:text-neutral-300 disabled:opacity-40",
  success: "rounded-md bg-good/20 font-semibold text-good transition hover:bg-good/30 disabled:opacity-40",
  danger: "rounded-md bg-bad/20 font-semibold text-bad transition hover:bg-bad/30 disabled:opacity-40",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-[15px]",
  lg: "px-6 py-3 text-base",
};

/**
 * Action button in DRIFT's five voices.
 *
 * @example
 * <Button variant="primary" size="lg">Enter the lanes →</Button>
 * <Button variant="outline">⚡ Quick create</Button>
 * <Button variant="ghost" size="sm">← back</Button>
 * <Button variant="success" size="sm">Approve</Button>
 * <Button variant="danger" size="sm">Decline</Button>
 */
export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={`${VARIANT[variant]} ${SIZE[size]}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}
