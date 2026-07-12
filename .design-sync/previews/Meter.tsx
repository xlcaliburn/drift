import { Meter } from "@drift/ui";

/** HP at healthy and critical fill — the tone flips below a third. */
export const Health = () => (
  <div className="w-64 space-y-3 text-sm">
    <div>
      <div className="mb-1 flex justify-between text-neutral-500"><span>HP</span><span>12/14</span></div>
      <Meter value={12} max={14} tone="health" />
    </div>
    <div>
      <div className="mb-1 flex justify-between text-neutral-500"><span>HP</span><span>4/14</span></div>
      <Meter value={4} max={14} tone="health" />
    </div>
  </div>
);

export const ThreatClock = () => (
  <div className="w-64 text-sm">
    <div className="mb-1 flex justify-between"><span className="text-neutral-200">Halvane patrol sweep</span><span className="text-neutral-500">5/6</span></div>
    <Meter value={5} max={6} tone="bad" />
  </div>
);

export const SkillProgress = () => (
  <div className="w-64 space-y-2 text-sm">
    <div className="flex items-center gap-2">
      <span className="w-24 truncate capitalize text-neutral-400">piloting 2</span>
      <Meter value={3} max={5} />
      <span className="w-8 text-right text-neutral-600">3/5</span>
    </div>
    <div className="flex items-center gap-2">
      <span className="w-24 truncate capitalize text-neutral-400">negotiation 1</span>
      <Meter value={1} max={3} />
      <span className="w-8 text-right text-neutral-600">1/3</span>
    </div>
  </div>
);
