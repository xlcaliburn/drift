import type { HTMLAttributes } from "react";

export interface DriftRootProps extends HTMLAttributes<HTMLDivElement> {}

/**
 * Root canvas — wrap every screen in this. It applies the ink background,
 * body text color, 17px type scale, and the system font stack that every
 * other component assumes. Nothing renders correctly outside it.
 *
 * @example
 * <DriftRoot className="min-h-screen">
 *   <AppHeader brand="DRIFT" />
 *   ...
 * </DriftRoot>
 */
export function DriftRoot({ className, ...rest }: DriftRootProps) {
  return <div className={`drift-root${className ? ` ${className}` : ""}`} {...rest} />;
}
