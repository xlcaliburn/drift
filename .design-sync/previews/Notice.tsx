import { Button, Notice } from "@drift/ui";

/** Advisory from the creation finalize pass, with its action row. */
export const WarnWithActions = () => (
  <div className="max-w-md">
    <Notice
      tone="warn"
      actions={
        <>
          <Button size="sm">Use “Vale Okonkwo”</Button>
          <Button variant="outline" size="sm">← Edit</Button>
          <Button variant="outline" size="sm">Keep mine</Button>
        </>
      }
    >
      That name reads more corporate-core than lane-born. A canon-flavored
      alternative is suggested below.
    </Notice>
  </div>
);

export const ErrorState = () => (
  <div className="max-w-md">
    <Notice tone="error">Request failed — the lanes are quiet. Try again.</Notice>
  </div>
);

export const Success = () => (
  <div className="max-w-md">
    <Notice tone="success">✓ Submitted — thanks! It gets tidied up automatically for review.</Notice>
  </div>
);
