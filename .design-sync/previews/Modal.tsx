import { Button, Modal, TextArea } from "@drift/ui";

/**
 * The feature-request dialog, open. The transform wrapper contains the
 * fixed-position overlay so the card can capture it.
 */
export const RequestFeature = () => (
  <div className="w-full" style={{ position: "relative", height: 460, transform: "translateZ(0)" }}>
    <Modal open onClose={() => {}} title="Request a feature">
    <p className="mt-1 text-sm text-neutral-400">
      Broken, unbalanced, or missing something? Describe it in your own words — it
      gets tidied up automatically for review.
    </p>
    <div className="mt-3">
      <TextArea rows={4} placeholder="e.g. let me rename my ship / the dock fees feel too punishing early on" />
    </div>
    <div className="mt-3 flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm">Cancel</Button>
      <Button size="sm">Submit</Button>
    </div>
    </Modal>
  </div>
);
