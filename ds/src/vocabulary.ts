/**
 * Layout vocabulary — utility classes compiled into dist/styles.css even
 * though no component uses them directly. Anyone composing screens from
 * @drift/ui (including design tools that only receive the compiled CSS)
 * can rely on every class listed here. Tailwind's scanner picks these
 * strings up because this file is in the build's `content` globs.
 *
 * Keep this list curated: it is the complete glue vocabulary for building
 * layouts around the components. Adding a class here is how you make a new
 * utility available to consumers of the compiled stylesheet.
 */
export const layoutVocabulary: string[] = [
  // Flex & grid
  "flex", "inline-flex", "flex-col", "flex-row", "flex-wrap", "flex-1", "flex-none",
  "items-center", "items-start", "items-end", "items-baseline", "items-stretch",
  "justify-between", "justify-center", "justify-start", "justify-end",
  "grid", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-6",
  "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-6", "md:grid-cols-2", "md:grid-cols-3",
  "shrink-0", "grow", "self-start", "self-center", "self-end",

  // Gaps & stacks
  "gap-1", "gap-1.5", "gap-2", "gap-3", "gap-4", "gap-5", "gap-6", "gap-8",
  "space-y-1", "space-y-2", "space-y-3", "space-y-4", "space-y-5", "space-x-2", "space-x-3",

  // Padding & margin
  "p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-8",
  "px-2", "px-3", "px-4", "px-5", "px-6", "py-1", "py-2", "py-3", "py-4", "py-6", "py-10", "py-16",
  "m-0", "mx-auto", "mt-1", "mt-2", "mt-3", "mt-4", "mt-5", "mt-6", "mt-8", "mt-10",
  "mt-0.5", "mb-0.5", "mb-1", "mb-2", "mb-3", "mb-4", "mb-5", "mb-6", "mb-8", "ml-2", "mr-2",

  // Sizing
  "w-full", "w-auto", "w-8", "w-14", "w-16", "w-24", "w-32", "w-48", "w-64", "w-72", "w-80",
  "h-full", "h-screen", "min-h-0", "min-h-screen", "min-w-0",
  "max-w-xs", "max-w-sm", "max-w-md", "max-w-lg", "max-w-xl", "max-w-2xl", "max-w-3xl", "max-w-4xl",

  // Typography
  "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl",
  "font-mono", "font-normal", "font-medium", "font-semibold", "font-bold",
  "uppercase", "capitalize", "italic", "tracking-wide", "tracking-widest", "tracking-tight",
  "leading-snug", "leading-relaxed", "text-left", "text-center", "text-right",
  "truncate", "whitespace-pre-wrap", "break-words",

  // Theme colors (text / bg / border, with the translucency steps the app uses)
  "text-accent", "text-good", "text-bad", "text-ink",
  "text-accent/70", "text-accent/80",
  "text-neutral-100", "text-neutral-200", "text-neutral-300", "text-neutral-400",
  "text-neutral-500", "text-neutral-600", "text-neutral-50",
  "bg-ink", "bg-panel", "bg-edge", "bg-accent", "bg-good", "bg-bad",
  "bg-ink/40", "bg-ink/80", "bg-panel/40", "bg-panel/50", "bg-panel/60",
  "bg-accent/5", "bg-accent/10", "bg-accent/20", "bg-good/20", "bg-good/30", "bg-bad/20", "bg-bad/30",
  "border", "border-b", "border-t", "border-l", "border-r", "border-b-2",
  "border-edge", "border-edge/50", "border-edge/60", "border-accent", "border-accent/40",
  "border-accent/60", "border-good", "border-good/60", "border-bad", "border-bad/60",
  "border-neutral-600", "divide-y", "divide-edge",

  // Radius & effects
  "rounded", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-full",
  "opacity-40", "opacity-60", "transition",
  "hover:border-accent", "hover:text-accent", "hover:text-neutral-300", "hover:text-neutral-200",
  "hover:border-neutral-600", "hover:bg-accent/20", "hover:border-good", "hover:text-good",
  "disabled:opacity-40", "cursor-pointer",

  // Overflow & position
  "overflow-y-auto", "overflow-hidden", "overflow-x-auto",
  "relative", "absolute", "fixed", "inset-0", "z-10", "z-50", "sticky", "top-0",
  "hidden", "block", "inline-block", "md:flex", "lg:flex", "md:hidden", "lg:hidden",
];
