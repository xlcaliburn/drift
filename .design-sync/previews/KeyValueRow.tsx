import { KeyValueRow, Panel } from "@drift/ui";

/** The pre-creation review sheet. */
export const ReviewSheet = () => (
  <div className="max-w-md">
    <Panel tone="faint" padding="lg">
      <div className="space-y-2 text-sm">
        <KeyValueRow label="Name" value="Silas Corr" />
        <KeyValueRow label="Faction" value="The Sable Chain" />
        <KeyValueRow label="Background" value="Dock rat" />
        <KeyValueRow label="Focus" value="piloting" />
        <KeyValueRow label="Won't cross" value="people aren't cargo" />
        <KeyValueRow label="Signature" value="Deadhand — +2 piloting" />
      </div>
    </Panel>
  </div>
);
