import { AppHeader, Button } from "@drift/ui";

/** The play screen's top bar. */
export const PlayHeader = () => (
  <div className="w-full min-w-0">
    <AppHeader
      brand="DRIFT"
      center="Red Ledger · Meridian Dock"
      right={<Button variant="outline" size="sm">💡 Request</Button>}
    />
  </div>
);

export const WithStatus = () => (
  <div className="w-full min-w-0">
    <AppHeader
      brand="DRIFT"
      center="Red Ledger · The Wreckyard"
      right={
        <>
          <span className="text-sm text-bad">narration disabled</span>
          <Button variant="outline" size="sm">💡 Request</Button>
        </>
      }
    />
  </div>
);
