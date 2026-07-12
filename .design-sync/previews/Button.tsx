import { Button } from "@drift/ui";

/** The five voices side by side — primary is the one amber CTA per view. */
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary">Bring them to life →</Button>
    <Button variant="outline">⚡ Quick create</Button>
    <Button variant="ghost">← back</Button>
    <Button variant="success" size="sm">Approve</Button>
    <Button variant="danger" size="sm">Decline</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="sm">Suggest ⟳</Button>
    <Button size="md">Act</Button>
    <Button size="lg">Enter the lanes →</Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button disabled>Sending…</Button>
    <Button variant="outline" disabled>⚡ Quick create</Button>
  </div>
);
