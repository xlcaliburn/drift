import { SectionLabel, Chip } from "@drift/ui";

export const Default = () => (
  <div className="max-w-sm">
    <SectionLabel>Attributes</SectionLabel>
    <p className="text-sm text-neutral-200">Six scores, −1 to +3.</p>
  </div>
);

/** Widest tracking — pane headers like the dice log's. */
export const Wide = () => (
  <div className="max-w-sm">
    <SectionLabel wide>Dice log</SectionLabel>
    <p className="text-sm text-neutral-200">Every roll, on the record.</p>
  </div>
);

export const LabelingAGroup = () => (
  <div className="max-w-sm">
    <SectionLabel>Skills</SectionLabel>
    <div className="flex flex-wrap gap-1.5">
      <Chip value={3}>piloting</Chip>
      <Chip value={2}>gunnery</Chip>
      <Chip value={1}>streetwise</Chip>
    </div>
  </div>
);
