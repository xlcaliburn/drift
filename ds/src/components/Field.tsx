import type { ReactNode } from "react";

export interface FieldProps {
  label: ReactNode;
  /** Muted helper line under the control. */
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * Labeled form row — wraps any control with the standard muted label.
 *
 * @example
 * <Field label="Name" hint="A name the lanes would use.">
 *   <TextInput value={name} onChange={(e) => setName(e.target.value)} />
 * </Field>
 */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm text-neutral-400">{label}</label>
      {children}
      {hint && <p className="mt-2 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
