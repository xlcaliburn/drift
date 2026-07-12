import { Badge } from "@drift/ui";

/** Request-queue statuses. */
export const Statuses = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge tone="accent">pending</Badge>
    <Badge tone="good">approved</Badge>
    <Badge tone="good">done</Badge>
    <Badge tone="bad">declined</Badge>
    <Badge tone="neutral">archived</Badge>
  </div>
);

export const InContext = () => (
  <div className="flex max-w-md items-start justify-between gap-3 rounded-lg border border-edge bg-panel/50 p-4">
    <div>
      <div className="font-semibold text-neutral-100">Let me rename my ship</div>
      <div className="mt-0.5 text-xs text-neutral-500">Silas Corr · quality-of-life</div>
    </div>
    <Badge tone="accent">pending</Badge>
  </div>
);
