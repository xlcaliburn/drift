import type { ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  /** Called on backdrop click. */
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}

/**
 * Centered dialog over a dimmed ink backdrop. Clicking the backdrop closes;
 * clicks inside the panel don't propagate.
 *
 * @example
 * <Modal open={show} onClose={() => setShow(false)} title="Request a feature">
 *   <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
 *   <div className="mt-3 flex justify-end gap-2">
 *     <Button variant="ghost" size="sm" onClick={() => setShow(false)}>Cancel</Button>
 *     <Button size="sm" onClick={submit}>Submit</Button>
 *   </div>
 * </Modal>
 */
export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-edge bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h3 className="text-lg font-semibold text-neutral-100">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
