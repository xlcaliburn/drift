# design-sync notes — DRIFT (@drift/ui)

- The DS lives at `ds/` (not repo root). Converter runs from repo root: `--node-modules ds/node_modules --entry ./ds/dist/index.js`. Build the package first: `npm run build --prefix ds` (tsup + tailwind CLI).
- This repo uses an npm `allowScripts` policy — esbuild's postinstall is blocked until added to `allowScripts` in the consuming `package.json` (done in both `ds/package.json` and `.ds-sync/package.json`; a future esbuild version bump needs a new entry).
- The render harness counts any preview cell whose text starts with "⚠" as a caught in-cell error (`[RENDER_ERRORS]`, `bad` flag). Don't start authored preview copy with ⚠ — the app itself uses that glyph, but preview content must avoid leading it.
- Component grouping comes from frontmatter-only doc stubs in `.design-sync/docs-stubs/` via `cfg.docsDir` — groups: Foundation, Actions, Forms, Display, Navigation, Feedback, Play. Adding a component ⇒ add a stub or it lands in "general".
- `DriftRoot` is both a real DS export (the root canvas wrapper) and `cfg.provider` (`className: "p-4"`) so every preview renders on the ink background.
- `layoutVocabulary` is a data export (safelist for the compiled Tailwind CSS), excluded via `componentSrcMap: null`. The three inputs (`TextInput`/`TextArea`/`Select`) share `src/components/inputs.tsx` and are pinned in `componentSrcMap`.

- Modal's preview wraps the component in a `position: relative` + `transform: translateZ(0)` container (height 460) — the transform makes it the containing block for the fixed overlay so the card can capture it. Without it the dialog clips at the top regardless of `viewport`.
- Before authoring/altering previews, run the class audit (pattern in this run: scan `className="…"` tokens in `.design-sync/previews/*.tsx` against `ds/dist/styles.css`) — classes outside `ds/src/vocabulary.ts` + component usage silently no-op. Fix by adding to `vocabulary.ts`, then `npm run build --prefix ds`.

## Known render warns

(none yet — all warns so far were pre-authoring floor/thin states, superseded by authored previews)

## Re-sync risks

- Faction names and in-world copy in authored previews come from `drift/content/briefs.ts` as of 2026-07-12 — if the game's factions are renamed, previews still render but read stale.
- The app (`drift/`) does not yet consume `@drift/ui` or its Tailwind preset — if the game's look drifts from `ds/src/preset.ts` tokens, the synced DS silently diverges from the real UI.
- Chromium for the render check is pinned by the playwright install in `.ds-sync/` (chromium-1228); a fresh machine needs `npx playwright install chromium` there.
