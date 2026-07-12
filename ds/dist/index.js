// src/components/DriftRoot.tsx
import { jsx } from "react/jsx-runtime";
function DriftRoot({ className, ...rest }) {
  return /* @__PURE__ */ jsx("div", { className: `drift-root${className ? ` ${className}` : ""}`, ...rest });
}

// src/components/Button.tsx
import { jsx as jsx2 } from "react/jsx-runtime";
var VARIANT = {
  primary: "rounded-lg bg-accent font-semibold text-ink disabled:opacity-40",
  outline: "rounded-lg border border-edge text-neutral-200 transition hover:border-accent hover:text-accent disabled:opacity-40",
  ghost: "text-neutral-500 transition hover:text-neutral-300 disabled:opacity-40",
  success: "rounded-md bg-good/20 font-semibold text-good transition hover:bg-good/30 disabled:opacity-40",
  danger: "rounded-md bg-bad/20 font-semibold text-bad transition hover:bg-bad/30 disabled:opacity-40"
};
var SIZE = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-[15px]",
  lg: "px-6 py-3 text-base"
};
function Button({ variant = "primary", size = "md", className, ...rest }) {
  return /* @__PURE__ */ jsx2(
    "button",
    {
      className: `${VARIANT[variant]} ${SIZE[size]}${className ? ` ${className}` : ""}`,
      ...rest
    }
  );
}

// src/components/Panel.tsx
import { jsx as jsx3 } from "react/jsx-runtime";
var TONE = {
  solid: "rounded-lg border border-edge bg-panel",
  faint: "rounded-lg border border-edge bg-panel/50",
  inset: "rounded-md border border-edge/60 bg-ink/40"
};
var PAD = {
  none: "",
  sm: "p-2",
  md: "p-4",
  lg: "p-5"
};
function Panel({ tone = "faint", padding = "md", className, ...rest }) {
  return /* @__PURE__ */ jsx3("div", { className: `${TONE[tone]} ${PAD[padding]}${className ? ` ${className}` : ""}`, ...rest });
}

// src/components/ChoiceCard.tsx
import { jsx as jsx4, jsxs } from "react/jsx-runtime";
function ChoiceCard({ title, description, meta, children, selected, disabled, onSelect }) {
  return /* @__PURE__ */ jsxs(
    "button",
    {
      type: "button",
      onClick: onSelect,
      disabled,
      className: "block w-full rounded-lg border p-4 text-left transition disabled:opacity-40 " + (selected ? "border-accent bg-panel" : "border-edge hover:border-neutral-600"),
      children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-baseline justify-between gap-2", children: [
          /* @__PURE__ */ jsx4("span", { className: "font-semibold text-neutral-100", children: title }),
          meta && /* @__PURE__ */ jsx4("span", { className: "text-xs italic text-neutral-500", children: meta })
        ] }),
        description && /* @__PURE__ */ jsx4("p", { className: "mt-1 text-sm text-neutral-400", children: description }),
        children
      ]
    }
  );
}

// src/components/Meter.tsx
import { jsx as jsx5 } from "react/jsx-runtime";
var FILL = {
  accent: "bg-accent",
  good: "bg-good",
  bad: "bg-bad"
};
function Meter({ value, max, tone = "accent" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0;
  const fill = tone === "health" ? max > 0 && value / max < 0.34 ? "bg-bad" : "bg-good" : FILL[tone];
  return /* @__PURE__ */ jsx5("div", { className: "h-1.5 w-full rounded bg-ink", children: /* @__PURE__ */ jsx5("div", { className: `h-full rounded ${fill}`, style: { width: `${pct}%` } }) });
}

// src/components/StatBox.tsx
import { jsx as jsx6, jsxs as jsxs2 } from "react/jsx-runtime";
function StatBox({ label, value }) {
  return /* @__PURE__ */ jsxs2("div", { className: "rounded-md border border-edge/60 bg-ink/40 px-2 py-2 text-center", children: [
    /* @__PURE__ */ jsx6("div", { className: "text-[10px] uppercase text-neutral-500", children: label }),
    /* @__PURE__ */ jsx6("div", { className: "text-sm font-semibold text-neutral-100", children: value })
  ] });
}

// src/components/Chip.tsx
import { jsx as jsx7, jsxs as jsxs3 } from "react/jsx-runtime";
function Chip({ children, value, onClick, disabled }) {
  if (onClick) {
    return /* @__PURE__ */ jsxs3(
      "button",
      {
        type: "button",
        onClick,
        disabled,
        className: "rounded-full border border-edge px-2.5 py-1 text-xs text-neutral-400 transition hover:border-accent hover:text-accent disabled:opacity-40",
        children: [
          children,
          value !== void 0 && /* @__PURE__ */ jsx7("span", { className: "ml-1 text-accent", children: value })
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs3("span", { className: "rounded-full border border-edge bg-ink/40 px-2.5 py-1 text-xs text-neutral-200", children: [
    children,
    value !== void 0 && /* @__PURE__ */ jsx7("span", { className: "ml-1 text-accent", children: value })
  ] });
}

// src/components/Badge.tsx
import { jsx as jsx8 } from "react/jsx-runtime";
var TONE2 = {
  accent: "border-accent/60 text-accent",
  good: "border-good/60 text-good",
  bad: "border-bad/60 text-bad",
  neutral: "border-edge text-neutral-400"
};
function Badge({ children, tone = "neutral" }) {
  return /* @__PURE__ */ jsx8("span", { className: `rounded-full border px-2 py-0.5 text-xs ${TONE2[tone]}`, children });
}

// src/components/Tabs.tsx
import { jsx as jsx9 } from "react/jsx-runtime";
function Tabs({ items, active, onChange }) {
  return /* @__PURE__ */ jsx9("div", { className: "flex border-b border-edge text-sm", children: items.map((t) => /* @__PURE__ */ jsx9(
    "button",
    {
      type: "button",
      onClick: () => onChange(t.id),
      className: "flex-1 py-2.5 uppercase tracking-wide " + (active === t.id ? "border-b-2 border-accent text-accent" : "text-neutral-500"),
      children: t.label
    },
    t.id
  )) });
}

// src/components/Field.tsx
import { jsx as jsx10, jsxs as jsxs4 } from "react/jsx-runtime";
function Field({ label, hint, children }) {
  return /* @__PURE__ */ jsxs4("div", { className: "mb-4", children: [
    /* @__PURE__ */ jsx10("label", { className: "mb-1.5 block text-sm text-neutral-400", children: label }),
    children,
    hint && /* @__PURE__ */ jsx10("p", { className: "mt-2 text-xs text-neutral-500", children: hint })
  ] });
}

// src/components/inputs.tsx
import { jsx as jsx11 } from "react/jsx-runtime";
var INPUT = "w-full rounded-md border border-edge bg-ink px-3 py-2 text-[15px] outline-none focus:border-accent";
function TextInput({ className, ...rest }) {
  return /* @__PURE__ */ jsx11("input", { className: `${INPUT}${className ? ` ${className}` : ""}`, ...rest });
}
function TextArea({ className, ...rest }) {
  return /* @__PURE__ */ jsx11(
    "textarea",
    {
      className: `w-full resize-none rounded-lg border border-edge bg-ink px-3 py-2 text-[15px] outline-none focus:border-accent${className ? ` ${className}` : ""}`,
      ...rest
    }
  );
}
function Select({ className, ...rest }) {
  return /* @__PURE__ */ jsx11("select", { className: `${INPUT}${className ? ` ${className}` : ""}`, ...rest });
}

// src/components/Modal.tsx
import { jsx as jsx12, jsxs as jsxs5 } from "react/jsx-runtime";
function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return /* @__PURE__ */ jsx12("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4", onClick: onClose, children: /* @__PURE__ */ jsxs5(
    "div",
    {
      className: "w-full max-w-md rounded-xl border border-edge bg-panel p-5",
      onClick: (e) => e.stopPropagation(),
      children: [
        title && /* @__PURE__ */ jsx12("h3", { className: "text-lg font-semibold text-neutral-100", children: title }),
        children
      ]
    }
  ) });
}

// src/components/ChatBubble.tsx
import { jsx as jsx13 } from "react/jsx-runtime";
function ChatBubble({ role, children }) {
  if (role === "recap") {
    return /* @__PURE__ */ jsx13("div", { className: "whitespace-pre-wrap rounded-lg border border-edge bg-panel/60 px-4 py-3 text-[15px] leading-relaxed text-neutral-300", children });
  }
  return /* @__PURE__ */ jsx13("div", { className: role === "player" ? "text-right" : "", children: /* @__PURE__ */ jsx13(
    "div",
    {
      className: "inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 " + (role === "player" ? "bg-edge text-[16px] text-neutral-50" : role === "dm" ? "bg-panel text-[17px] leading-relaxed text-neutral-100" : "text-sm italic text-neutral-500"),
      children
    }
  ) });
}

// src/components/LogLine.tsx
import { jsx as jsx14, jsxs as jsxs6 } from "react/jsx-runtime";
function LogLine({ icon, children, highlight }) {
  return /* @__PURE__ */ jsxs6(
    "div",
    {
      className: "rounded px-2 py-1 font-mono text-[12px] leading-snug " + (highlight ? "bg-panel text-neutral-300" : "text-neutral-500"),
      children: [
        icon && /* @__PURE__ */ jsx14("span", { className: "mr-1", children: icon }),
        children
      ]
    }
  );
}

// src/components/SectionLabel.tsx
import { jsx as jsx15 } from "react/jsx-runtime";
function SectionLabel({ children, wide }) {
  return /* @__PURE__ */ jsx15(
    "div",
    {
      className: "mb-1.5 text-xs uppercase text-neutral-500 " + (wide ? "tracking-widest" : "tracking-wide"),
      children
    }
  );
}

// src/components/Stepper.tsx
import { jsx as jsx16, jsxs as jsxs7 } from "react/jsx-runtime";
function Stepper({ steps, current }) {
  return /* @__PURE__ */ jsx16("div", { className: "flex flex-wrap items-center gap-2 text-xs text-neutral-500", children: steps.map((s, i) => /* @__PURE__ */ jsxs7("div", { className: "flex items-center gap-2", children: [
    /* @__PURE__ */ jsx16("span", { className: i === current ? "font-semibold text-accent" : i < current ? "text-good" : "", children: s }),
    i < steps.length - 1 && /* @__PURE__ */ jsx16("span", { className: "text-edge", children: "\u2192" })
  ] }, s)) });
}

// src/components/Notice.tsx
import { jsx as jsx17, jsxs as jsxs8 } from "react/jsx-runtime";
var TONE3 = {
  warn: { box: "border-accent/40 bg-accent/5", text: "text-accent" },
  error: { box: "border-bad/40 bg-bad/5", text: "text-bad" },
  success: { box: "border-good/40 bg-good/5", text: "text-good" }
};
function Notice({ tone = "warn", children, actions }) {
  const t = TONE3[tone];
  return /* @__PURE__ */ jsxs8("div", { className: `rounded-lg border p-3 text-sm ${t.box}`, children: [
    /* @__PURE__ */ jsx17("p", { className: t.text, children }),
    actions && /* @__PURE__ */ jsx17("div", { className: "mt-2 flex flex-wrap gap-2", children: actions })
  ] });
}

// src/components/KeyValueRow.tsx
import { jsx as jsx18, jsxs as jsxs9 } from "react/jsx-runtime";
function KeyValueRow({ label, value }) {
  return /* @__PURE__ */ jsxs9("div", { className: "flex justify-between gap-4 border-b border-edge/50 py-1 last:border-0", children: [
    /* @__PURE__ */ jsx18("span", { className: "text-neutral-500", children: label }),
    /* @__PURE__ */ jsx18("span", { className: "text-right text-neutral-200", children: value })
  ] });
}

// src/components/AppHeader.tsx
import { jsx as jsx19, jsxs as jsxs10 } from "react/jsx-runtime";
function AppHeader({ brand, center, right }) {
  return /* @__PURE__ */ jsxs10("header", { className: "flex items-center justify-between border-b border-edge px-5 py-3", children: [
    /* @__PURE__ */ jsx19("span", { className: "text-lg font-bold text-accent", children: brand }),
    center && /* @__PURE__ */ jsx19("span", { className: "text-sm text-neutral-400", children: center }),
    /* @__PURE__ */ jsx19("div", { className: "flex items-center gap-3", children: right })
  ] });
}

// src/vocabulary.ts
var layoutVocabulary = [
  // Flex & grid
  "flex",
  "inline-flex",
  "flex-col",
  "flex-row",
  "flex-wrap",
  "flex-1",
  "flex-none",
  "items-center",
  "items-start",
  "items-end",
  "items-baseline",
  "items-stretch",
  "justify-between",
  "justify-center",
  "justify-start",
  "justify-end",
  "grid",
  "grid-cols-1",
  "grid-cols-2",
  "grid-cols-3",
  "grid-cols-4",
  "grid-cols-6",
  "sm:grid-cols-2",
  "sm:grid-cols-3",
  "sm:grid-cols-6",
  "md:grid-cols-2",
  "md:grid-cols-3",
  "shrink-0",
  "grow",
  "self-start",
  "self-center",
  "self-end",
  // Gaps & stacks
  "gap-1",
  "gap-1.5",
  "gap-2",
  "gap-3",
  "gap-4",
  "gap-5",
  "gap-6",
  "gap-8",
  "space-y-1",
  "space-y-2",
  "space-y-3",
  "space-y-4",
  "space-y-5",
  "space-x-2",
  "space-x-3",
  // Padding & margin
  "p-1",
  "p-2",
  "p-3",
  "p-4",
  "p-5",
  "p-6",
  "p-8",
  "px-2",
  "px-3",
  "px-4",
  "px-5",
  "px-6",
  "py-1",
  "py-2",
  "py-3",
  "py-4",
  "py-6",
  "py-10",
  "py-16",
  "m-0",
  "mx-auto",
  "mt-1",
  "mt-2",
  "mt-3",
  "mt-4",
  "mt-5",
  "mt-6",
  "mt-8",
  "mt-10",
  "mt-0.5",
  "mb-0.5",
  "mb-1",
  "mb-2",
  "mb-3",
  "mb-4",
  "mb-5",
  "mb-6",
  "mb-8",
  "ml-2",
  "mr-2",
  // Sizing
  "w-full",
  "w-auto",
  "w-8",
  "w-14",
  "w-16",
  "w-24",
  "w-32",
  "w-48",
  "w-64",
  "w-72",
  "w-80",
  "h-full",
  "h-screen",
  "min-h-0",
  "min-h-screen",
  "min-w-0",
  "max-w-xs",
  "max-w-sm",
  "max-w-md",
  "max-w-lg",
  "max-w-xl",
  "max-w-2xl",
  "max-w-3xl",
  "max-w-4xl",
  // Typography
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  "text-2xl",
  "text-3xl",
  "text-4xl",
  "font-mono",
  "font-normal",
  "font-medium",
  "font-semibold",
  "font-bold",
  "uppercase",
  "capitalize",
  "italic",
  "tracking-wide",
  "tracking-widest",
  "tracking-tight",
  "leading-snug",
  "leading-relaxed",
  "text-left",
  "text-center",
  "text-right",
  "truncate",
  "whitespace-pre-wrap",
  "break-words",
  // Theme colors (text / bg / border, with the translucency steps the app uses)
  "text-accent",
  "text-good",
  "text-bad",
  "text-ink",
  "text-accent/70",
  "text-accent/80",
  "text-neutral-100",
  "text-neutral-200",
  "text-neutral-300",
  "text-neutral-400",
  "text-neutral-500",
  "text-neutral-600",
  "text-neutral-50",
  "bg-ink",
  "bg-panel",
  "bg-edge",
  "bg-accent",
  "bg-good",
  "bg-bad",
  "bg-ink/40",
  "bg-ink/80",
  "bg-panel/40",
  "bg-panel/50",
  "bg-panel/60",
  "bg-accent/5",
  "bg-accent/10",
  "bg-accent/20",
  "bg-good/20",
  "bg-good/30",
  "bg-bad/20",
  "bg-bad/30",
  "border",
  "border-b",
  "border-t",
  "border-l",
  "border-r",
  "border-b-2",
  "border-edge",
  "border-edge/50",
  "border-edge/60",
  "border-accent",
  "border-accent/40",
  "border-accent/60",
  "border-good",
  "border-good/60",
  "border-bad",
  "border-bad/60",
  "border-neutral-600",
  "divide-y",
  "divide-edge",
  // Radius & effects
  "rounded",
  "rounded-md",
  "rounded-lg",
  "rounded-xl",
  "rounded-2xl",
  "rounded-full",
  "opacity-40",
  "opacity-60",
  "transition",
  "hover:border-accent",
  "hover:text-accent",
  "hover:text-neutral-300",
  "hover:text-neutral-200",
  "hover:border-neutral-600",
  "hover:bg-accent/20",
  "hover:border-good",
  "hover:text-good",
  "disabled:opacity-40",
  "cursor-pointer",
  // Overflow & position
  "overflow-y-auto",
  "overflow-hidden",
  "overflow-x-auto",
  "relative",
  "absolute",
  "fixed",
  "inset-0",
  "z-10",
  "z-50",
  "sticky",
  "top-0",
  "hidden",
  "block",
  "inline-block",
  "md:flex",
  "lg:flex",
  "md:hidden",
  "lg:hidden"
];
export {
  AppHeader,
  Badge,
  Button,
  ChatBubble,
  Chip,
  ChoiceCard,
  DriftRoot,
  Field,
  KeyValueRow,
  LogLine,
  Meter,
  Modal,
  Notice,
  Panel,
  SectionLabel,
  Select,
  StatBox,
  Stepper,
  Tabs,
  TextArea,
  TextInput,
  layoutVocabulary
};
