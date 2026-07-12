import { DriftRoot, Panel, SectionLabel, Meter, Button } from "@drift/ui";

/**
 * The root canvas — every screen starts here. It supplies the ink
 * background, body text color, and 17px type scale.
 */
export const Canvas = () => (
  <DriftRoot className="max-w-md rounded-lg p-6">
    <h2 className="text-2xl font-bold text-accent">DRIFT</h2>
    <p className="mt-1 text-sm text-neutral-400">
      A brutal space-opera TTRPG. The engine rolls the dice; the narrator tells the story.
    </p>
    <div className="mt-4">
      <Panel tone="faint" padding="md">
        <SectionLabel>Hull</SectionLabel>
        <Meter value={9} max={14} tone="health" />
      </Panel>
    </div>
    <div className="mt-4">
      <Button size="lg">Enter the lanes →</Button>
    </div>
  </DriftRoot>
);
