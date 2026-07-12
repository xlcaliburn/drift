import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const INPUT =
  "w-full rounded-md border border-edge bg-ink px-3 py-2 text-[15px] outline-none focus:border-accent";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {}

/**
 * Single-line text input on ink; the border turns amber on focus.
 *
 * @example
 * <TextInput placeholder="e.g. Silas Corr" value={name} onChange={(e) => setName(e.target.value)} />
 */
export function TextInput({ className, ...rest }: TextInputProps) {
  return <input className={`${INPUT}${className ? ` ${className}` : ""}`} {...rest} />;
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

/**
 * Multi-line input — feedback forms, the action composer.
 *
 * @example
 * <TextArea rows={4} placeholder="…or write your own action" value={text} onChange={(e) => setText(e.target.value)} />
 */
export function TextArea({ className, ...rest }: TextAreaProps) {
  return (
    <textarea
      className={`w-full resize-none rounded-lg border border-edge bg-ink px-3 py-2 text-[15px] outline-none focus:border-accent${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

/**
 * Native select styled to match TextInput.
 *
 * @example
 * <Select value={target} onChange={(e) => setTarget(e.target.value)}>
 *   <option value="piloting">piloting</option>
 *   <option value="gunnery">gunnery</option>
 * </Select>
 */
export function Select({ className, ...rest }: SelectProps) {
  return <select className={`${INPUT}${className ? ` ${className}` : ""}`} {...rest} />;
}
