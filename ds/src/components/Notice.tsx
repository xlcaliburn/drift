import type { ReactNode } from "react";

export type NoticeTone = "warn" | "error" | "success";

export interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  /** Action row rendered under the message (small buttons). */
  actions?: ReactNode;
}

const TONE: Record<NoticeTone, { box: string; text: string }> = {
  warn: { box: "border-accent/40 bg-accent/5", text: "text-accent" },
  error: { box: "border-bad/40 bg-bad/5", text: "text-bad" },
  success: { box: "border-good/40 bg-good/5", text: "text-good" },
};

/**
 * Inline callout — advisory notes from the finalize pass, failures, confirmations.
 *
 * @example
 * <Notice
 *   tone="warn"
 *   actions={<>
 *     <Button size="sm">Use “Vale Okonkwo”</Button>
 *     <Button variant="outline" size="sm">Keep mine</Button>
 *   </>}
 * >
 *   ⚠ That name reads more corporate-core than lane-born.
 * </Notice>
 */
export function Notice({ tone = "warn", children, actions }: NoticeProps) {
  const t = TONE[tone];
  return (
    <div className={`rounded-lg border p-3 text-sm ${t.box}`}>
      <p className={t.text}>{children}</p>
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
