import type { ReactNode } from "react";

export type ChatRole = "player" | "dm" | "system" | "recap";

export interface ChatBubbleProps {
  /**
   * `player` — right-aligned on edge. `dm` — narrator prose on panel.
   * `system` — small italic notices. `recap` — full-width bordered digest.
   */
  role: ChatRole;
  children: ReactNode;
}

/**
 * One message in the play transcript. Stack in a `space-y-5` column.
 *
 * @example
 * <div className="space-y-5">
 *   <ChatBubble role="recap">{openingRecap}</ChatBubble>
 *   <ChatBubble role="dm">The dock lights gutter as you slip the clamps…</ChatBubble>
 *   <ChatBubble role="player">I cut thrust and drift past the checkpoint.</ChatBubble>
 *   <ChatBubble role="system">— scene ended · checklist applied —</ChatBubble>
 * </div>
 */
export function ChatBubble({ role, children }: ChatBubbleProps) {
  if (role === "recap") {
    return (
      <div className="whitespace-pre-wrap rounded-lg border border-edge bg-panel/60 px-4 py-3 text-[15px] leading-relaxed text-neutral-300">
        {children}
      </div>
    );
  }
  return (
    <div className={role === "player" ? "text-right" : ""}>
      <div
        className={
          "inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 " +
          (role === "player"
            ? "bg-edge text-[16px] text-neutral-50"
            : role === "dm"
              ? "bg-panel text-[17px] leading-relaxed text-neutral-100"
              : "text-sm italic text-neutral-500")
        }
      >
        {children}
      </div>
    </div>
  );
}
