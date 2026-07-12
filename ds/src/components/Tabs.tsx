export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  /** id of the active tab. */
  active: string;
  onChange: (id: string) => void;
}

/**
 * Full-width uppercase tab strip — the sidebar's sheet/ship/clocks switcher.
 * Active tab gets an amber underline.
 *
 * @example
 * <Tabs
 *   items={[{ id: "sheet", label: "sheet" }, { id: "ship", label: "ship" }, { id: "clocks", label: "clocks" }]}
 *   active={tab}
 *   onChange={setTab}
 * />
 */
export function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div className="flex border-b border-edge text-sm">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={
            "flex-1 py-2.5 uppercase tracking-wide " +
            (active === t.id ? "border-b-2 border-accent text-accent" : "text-neutral-500")
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
