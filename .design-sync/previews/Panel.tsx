import { Panel, SectionLabel, Meter } from "@drift/ui";

/** The three surfaces at their working depths. */
export const Tones = () => (
  <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
    <Panel tone="solid" padding="md">
      <div className="font-semibold text-neutral-100">Solid</div>
      <p className="mt-1 text-sm text-neutral-400">Opaque — modals, bubbles.</p>
    </Panel>
    <Panel tone="faint" padding="md">
      <div className="font-semibold text-neutral-100">Faint</div>
      <p className="mt-1 text-sm text-neutral-400">The default reading surface.</p>
    </Panel>
    <Panel tone="inset" padding="md">
      <div className="font-semibold text-neutral-100">Inset</div>
      <p className="mt-1 text-sm text-neutral-400">Recessed wells inside panels.</p>
    </Panel>
  </div>
);

export const ClockCard = () => (
  <div className="max-w-xs">
    <Panel tone="solid" padding="sm">
      <div className="flex justify-between text-sm">
        <span className="text-neutral-200">Hollow Crown interest</span>
        <span className="text-neutral-500">4/6</span>
      </div>
      <div className="mt-1">
        <Meter value={4} max={6} tone="bad" />
      </div>
    </Panel>
  </div>
);

export const SheetSection = () => (
  <div className="max-w-md">
    <Panel tone="faint" padding="lg">
      <SectionLabel>The line you won't cross</SectionLabel>
      <p className="text-sm text-neutral-200">People aren't cargo.</p>
      <p className="mt-3 text-xs text-neutral-500">
        Starting with The Sable Chain. No ship yet — mobility is earned in play.
      </p>
    </Panel>
  </div>
);
