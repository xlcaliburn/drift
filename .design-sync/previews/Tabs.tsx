import { Tabs } from "@drift/ui";

/** The sidebar's pane switcher — active tab underlined in amber. */
export const SidebarTabs = () => (
  <div className="w-80 border border-edge bg-panel/40">
    <Tabs
      items={[
        { id: "sheet", label: "sheet" },
        { id: "ship", label: "ship" },
        { id: "clocks", label: "clocks" },
      ]}
      active="sheet"
      onChange={() => {}}
    />
    <div className="p-3 text-sm text-neutral-400">Sheet contents…</div>
  </div>
);

export const SecondActive = () => (
  <div className="w-80 border border-edge bg-panel/40">
    <Tabs
      items={[
        { id: "sheet", label: "sheet" },
        { id: "ship", label: "ship" },
        { id: "clocks", label: "clocks" },
      ]}
      active="ship"
      onChange={() => {}}
    />
    <div className="p-3 text-sm text-neutral-400">Ship contents…</div>
  </div>
);
