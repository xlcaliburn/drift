# Building with @drift/ui (DRIFT design system)

DRIFT is a dark-only space-opera TTRPG interface: near-black blue canvas, amber accents, dense readable prose. There is no light theme.

## Root wrapper — required

Wrap every screen in `<DriftRoot>` (exported from the library). It applies the ink background, `#dfe4ee` body text, the 17px type scale, and the system font stack. Outside it, components sit on a white page with wrong text colors.

```jsx
<DriftRoot className="min-h-screen">
  <AppHeader brand="DRIFT" center="Red Ledger · Meridian Dock" />
  ...
</DriftRoot>
```

## Styling idiom: Tailwind utilities over the DRIFT palette

Style layout glue with Tailwind utility classes. The compiled stylesheet contains ONLY the classes the components use plus a curated vocabulary — arbitrary Tailwind classes beyond it will silently do nothing. Stick to this palette and scale:

- **Theme colors** (use these, not raw hex or generic Tailwind colors): `ink` #0b0e14 page background, `panel` #141922 raised surfaces, `edge` #232b38 borders, `accent` #e8a33d amber (primary actions, active states), `good` #5fb37a, `bad` #d9584a. As `bg-ink bg-panel bg-edge bg-accent`, `text-accent text-good text-bad`, `border-edge border-accent`; translucency steps that exist: `bg-panel/40 bg-panel/50 bg-panel/60 bg-ink/40 bg-ink/80 bg-accent/5 bg-accent/10 bg-accent/20 bg-good/20 bg-good/30 bg-bad/20 bg-bad/30`, `border-edge/50 border-edge/60 border-accent/40 border-accent/60 border-good/60 border-bad/60`, `text-accent/70 text-accent/80`.
- **Body/muted text**: `text-neutral-100` headings → `text-neutral-500` labels/captions → `text-neutral-600` faintest. Uppercase micro-labels: `text-xs uppercase tracking-wide text-neutral-500`.
- **Layout**: `flex`, `grid grid-cols-2/3/4/6`, `gap-1.5/2/3/4`, `space-y-1…5`, `p-2…8`, `px/py` steps, `mx-auto max-w-xs…4xl`, `w-8/14/16/24/32/48/64/72/80`, `min-h-screen h-screen min-h-0 min-w-0`.
- **Shape**: `rounded` (bars), `rounded-md` (inputs, cells), `rounded-lg` (cards, buttons), `rounded-xl` (modals), `rounded-2xl` (chat bubbles), `rounded-full` (chips, badges).
- **Type**: `text-xs/sm/base/lg/xl/2xl/3xl/4xl`, `font-semibold/bold`, `font-mono` for dice math and metadata, `italic` for system whispers, `leading-relaxed` for narrator prose, `whitespace-pre-wrap` for multi-line game text.
- Scrolling panes get `scrollbar-thin overflow-y-auto`.

## Composition conventions

- One amber `<Button variant="primary">` per view; secondary actions are `outline`, quiet ones `ghost`. Approve/decline pairs use `success`/`danger` at `size="sm"`.
- Content sits on `<Panel>` (`faint` default, `solid` for modals/menus, `inset` for cells inside panels). Label groups with `<SectionLabel>`.
- HP and progress are `<Meter>` (`tone="health"` auto-flips red below a third; threat clocks are `tone="bad"`).
- Game transcript = `<ChatBubble role="dm|player|system|recap">` stacked in `space-y-5`; mechanical events = `<LogLine>` stacks in `font-mono` panes.
- Selections (factions, backgrounds, options) are `<ChoiceCard>` grids, not radio buttons or dropdowns.

## Where the truth lives

Read `styles.css` (imports `_ds_bundle.css` — every compiled utility is visible there) before inventing a class; read each component's `.prompt.md` and `.d.ts` for its API. Component docs carry real usage examples from the game's own screens.

## Idiomatic screen fragment

```jsx
<DriftRoot className="min-h-screen">
  <main className="mx-auto max-w-2xl px-6 py-10">
    <h1 className="text-3xl font-bold text-accent">DRIFT</h1>
    <p className="mt-1 text-sm text-neutral-400">A brutal space-opera TTRPG.</p>
    <div className="mt-6">
      <Panel tone="faint" padding="lg">
        <SectionLabel>Hull</SectionLabel>
        <Meter value={9} max={14} tone="health" />
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip value={3}>piloting</Chip>
          <Chip>Mag-pistol (1d6)</Chip>
        </div>
      </Panel>
    </div>
    <div className="mt-6 flex items-center justify-between">
      <Button variant="ghost" size="sm">← back</Button>
      <Button variant="primary" size="lg">Enter the lanes →</Button>
    </div>
  </main>
</DriftRoot>
```
