# @drift/ui

DRIFT's design system — the dark space-opera visual language of the game client,
extracted into a reusable component library. Every component here was lifted from
real screens (`drift/components/*`, `drift/app/*`), so building with it produces
UI indistinguishable from the game.

## Tokens

Defined once in [`src/preset.ts`](src/preset.ts) as a Tailwind preset:

| Token | Value | Role |
|---|---|---|
| `ink` | `#0b0e14` | page background |
| `panel` | `#141922` | raised surfaces |
| `edge` | `#232b38` | borders, dividers |
| `accent` | `#e8a33d` | brand amber — primary actions, active states |
| `good` | `#5fb37a` | health, success |
| `bad` | `#d9584a` | damage, errors, threat |

Body text is `#dfe4ee` on `ink`, 17px base, system sans; `font-mono` for dice
math and metadata. Dark only (`color-scheme: dark`).

## Usage

```tsx
import { Button, Panel, Meter, SectionLabel } from "@drift/ui";
import "@drift/ui/styles.css";

<div className="drift-root min-h-screen">
  <Panel tone="faint" padding="lg">
    <SectionLabel>Hull</SectionLabel>
    <Meter value={9} max={14} tone="health" />
    <Button variant="primary" size="lg">Enter the lanes →</Button>
  </Panel>
</div>
```

Wrap every screen in `.drift-root` — it carries the background, text color,
and type scale the components assume.

The Next app can share the tokens by adding the preset to its Tailwind config:

```ts
// drift/tailwind.config.ts
import driftPreset from "../ds/src/preset";
export default { presets: [driftPreset], content: [...] };
```

## Components

`Button` `Panel` `ChoiceCard` `Meter` `StatBox` `Chip` `Badge` `Tabs` `Field`
`TextInput` `TextArea` `Select` `Modal` `ChatBubble` `LogLine` `SectionLabel`
`Stepper` `Notice` `KeyValueRow` `AppHeader`

Each component's doc comment carries a usage example taken from the screen it
was extracted from.

## Styling idiom

Tailwind utilities over the token palette. The compiled `dist/styles.css`
contains every class the components use **plus** the curated layout vocabulary
in [`src/vocabulary.ts`](src/vocabulary.ts) — if you're composing against the
compiled stylesheet (no Tailwind build of your own), stick to that vocabulary.

## Build

```
npm install
npm run build   # tsup (JS + d.ts) + tailwindcss CLI (dist/styles.css)
```
