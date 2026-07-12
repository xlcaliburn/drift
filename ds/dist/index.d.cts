import * as react from 'react';
import { HTMLAttributes, ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, InputHTMLAttributes } from 'react';

interface DriftRootProps extends HTMLAttributes<HTMLDivElement> {
}
/**
 * Root canvas — wrap every screen in this. It applies the ink background,
 * body text color, 17px type scale, and the system font stack that every
 * other component assumes. Nothing renders correctly outside it.
 *
 * @example
 * <DriftRoot className="min-h-screen">
 *   <AppHeader brand="DRIFT" />
 *   ...
 * </DriftRoot>
 */
declare function DriftRoot({ className, ...rest }: DriftRootProps): react.JSX.Element;

type ButtonVariant = "primary" | "outline" | "ghost" | "success" | "danger";
type ButtonSize = "sm" | "md" | "lg";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual weight. `primary` is the amber call-to-action; one per view. */
    variant?: ButtonVariant;
    size?: ButtonSize;
}
/**
 * Action button in DRIFT's five voices.
 *
 * @example
 * <Button variant="primary" size="lg">Enter the lanes →</Button>
 * <Button variant="outline">⚡ Quick create</Button>
 * <Button variant="ghost" size="sm">← back</Button>
 * <Button variant="success" size="sm">Approve</Button>
 * <Button variant="danger" size="sm">Decline</Button>
 */
declare function Button({ variant, size, className, ...rest }: ButtonProps): react.JSX.Element;

type PanelTone = "solid" | "faint" | "inset";
type PanelPadding = "none" | "sm" | "md" | "lg";
interface PanelProps extends HTMLAttributes<HTMLDivElement> {
    /**
     * `solid` — opaque card (modals, chat bubbles' surface).
     * `faint` — translucent card, the default reading surface.
     * `inset` — recessed well on ink, for stats and cells inside other panels.
     */
    tone?: PanelTone;
    padding?: PanelPadding;
}
/**
 * Raised surface — the basic card every sheet, brief, and recap sits on.
 *
 * @example
 * <Panel tone="faint" padding="lg">
 *   <SectionLabel>Attributes</SectionLabel>
 *   ...
 * </Panel>
 */
declare function Panel({ tone, padding, className, ...rest }: PanelProps): react.JSX.Element;

interface ChoiceCardProps {
    /** Bold headline of the option. */
    title: ReactNode;
    /** Supporting copy under the title. */
    description?: ReactNode;
    /** Small right-aligned annotation on the title row (tagline, kind, cost). */
    meta?: ReactNode;
    /** Extra content below the description (e.g. an accent playstyle line). */
    children?: ReactNode;
    selected?: boolean;
    disabled?: boolean;
    onSelect?: () => void;
}
/**
 * Selectable option card — factions, backgrounds, signature examples.
 * Amber border + panel fill when selected; hover lifts the border otherwise.
 *
 * @example
 * <ChoiceCard
 *   title="Halvane Combine"
 *   meta="freight is law"
 *   description="The biggest carrier in the lanes. Steady pay, short leash."
 *   selected={factionId === "halvane"}
 *   onSelect={() => setFactionId("halvane")}
 * />
 */
declare function ChoiceCard({ title, description, meta, children, selected, disabled, onSelect }: ChoiceCardProps): react.JSX.Element;

type MeterTone = "accent" | "good" | "bad" | "health";
interface MeterProps {
    value: number;
    max: number;
    /**
     * `health` picks the color from the fill: good above a third, bad below —
     * how HP bars behave in play. `bad` is for threat clocks, `accent` for
     * skill progress.
     */
    tone?: MeterTone;
}
/**
 * Thin progress bar on an ink track — HP, skill ticks, threat clocks.
 *
 * @example
 * <Meter value={hp} max={maxHp} tone="health" />
 * <Meter value={clock.current} max={clock.max} tone="bad" />
 * <Meter value={ticks} max={tickMax(level)} />
 */
declare function Meter({ value, max, tone }: MeterProps): react.JSX.Element;

interface StatBoxProps {
    /** Tiny uppercase caption — "HP", "AC", "REF". */
    label: ReactNode;
    value: ReactNode;
}
/**
 * Recessed cell showing one vital or attribute. Compose in a grid:
 * four across for vitals, six across for attributes.
 *
 * @example
 * <div className="grid grid-cols-4 gap-2 text-center">
 *   <StatBox label="HP" value="12/14" />
 *   <StatBox label="AC" value={15} />
 *   <StatBox label="Credits" value="¢220" />
 *   <StatBox label="Stims" value={2} />
 * </div>
 */
declare function StatBox({ label, value }: StatBoxProps): react.JSX.Element;

interface ChipProps {
    children: ReactNode;
    /** Accent-colored trailing value — a skill level, a count. */
    value?: ReactNode;
    /** Present ⇒ renders as a clickable suggestion chip (hover turns amber). */
    onClick?: () => void;
    disabled?: boolean;
}
/**
 * Small pill for skills, gear, and tap-to-use suggestions.
 * Static chips are labels; give it `onClick` and it becomes a
 * suggestion chip like the example-flavor pickers.
 *
 * @example
 * <Chip value={2}>piloting</Chip>
 * <Chip>Mag-pistol (1d6)</Chip>
 * <Chip onClick={() => setMoralCode("people aren't cargo")}>people aren't cargo</Chip>
 */
declare function Chip({ children, value, onClick, disabled }: ChipProps): react.JSX.Element;

type BadgeTone = "accent" | "good" | "bad" | "neutral";
interface BadgeProps {
    children: ReactNode;
    /** `accent` = pending/attention, `good` = approved/done, `bad` = declined/threat. */
    tone?: BadgeTone;
}
/**
 * Status pill — outlined, tone-colored, lowercase by convention.
 *
 * @example
 * <Badge tone="accent">pending</Badge>
 * <Badge tone="good">approved</Badge>
 * <Badge tone="bad">declined</Badge>
 */
declare function Badge({ children, tone }: BadgeProps): react.JSX.Element;

interface TabItem {
    id: string;
    label: string;
}
interface TabsProps {
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
declare function Tabs({ items, active, onChange }: TabsProps): react.JSX.Element;

interface FieldProps {
    label: ReactNode;
    /** Muted helper line under the control. */
    hint?: ReactNode;
    children: ReactNode;
}
/**
 * Labeled form row — wraps any control with the standard muted label.
 *
 * @example
 * <Field label="Name" hint="A name the lanes would use.">
 *   <TextInput value={name} onChange={(e) => setName(e.target.value)} />
 * </Field>
 */
declare function Field({ label, hint, children }: FieldProps): react.JSX.Element;

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
}
/**
 * Single-line text input on ink; the border turns amber on focus.
 *
 * @example
 * <TextInput placeholder="e.g. Silas Corr" value={name} onChange={(e) => setName(e.target.value)} />
 */
declare function TextInput({ className, ...rest }: TextInputProps): react.JSX.Element;
interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
}
/**
 * Multi-line input — feedback forms, the action composer.
 *
 * @example
 * <TextArea rows={4} placeholder="…or write your own action" value={text} onChange={(e) => setText(e.target.value)} />
 */
declare function TextArea({ className, ...rest }: TextAreaProps): react.JSX.Element;
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
}
/**
 * Native select styled to match TextInput.
 *
 * @example
 * <Select value={target} onChange={(e) => setTarget(e.target.value)}>
 *   <option value="piloting">piloting</option>
 *   <option value="gunnery">gunnery</option>
 * </Select>
 */
declare function Select({ className, ...rest }: SelectProps): react.JSX.Element;

interface ModalProps {
    open: boolean;
    /** Called on backdrop click. */
    onClose: () => void;
    title?: ReactNode;
    children: ReactNode;
}
/**
 * Centered dialog over a dimmed ink backdrop. Clicking the backdrop closes;
 * clicks inside the panel don't propagate.
 *
 * @example
 * <Modal open={show} onClose={() => setShow(false)} title="Request a feature">
 *   <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
 *   <div className="mt-3 flex justify-end gap-2">
 *     <Button variant="ghost" size="sm" onClick={() => setShow(false)}>Cancel</Button>
 *     <Button size="sm" onClick={submit}>Submit</Button>
 *   </div>
 * </Modal>
 */
declare function Modal({ open, onClose, title, children }: ModalProps): react.JSX.Element | null;

type ChatRole = "player" | "dm" | "system" | "recap";
interface ChatBubbleProps {
    /**
     * `player` — right-aligned on edge. `dm` — narrator prose on panel.
     * `system` — small italic notices. `recap` — full-width bordered digest.
     */
    role: ChatRole;
    children: ReactNode;
}
/**
 * One message in the play transcript. Stack in a `space-y-5` column.
 *
 * @example
 * <div className="space-y-5">
 *   <ChatBubble role="recap">{openingRecap}</ChatBubble>
 *   <ChatBubble role="dm">The dock lights gutter as you slip the clamps…</ChatBubble>
 *   <ChatBubble role="player">I cut thrust and drift past the checkpoint.</ChatBubble>
 *   <ChatBubble role="system">— scene ended · checklist applied —</ChatBubble>
 * </div>
 */
declare function ChatBubble({ role, children }: ChatBubbleProps): react.JSX.Element;

interface LogLineProps {
    /** Leading glyph — 🎲 roll, 🎯 attack, 💥 damage, ▲ tick, ⏱ clock, ¢ cost. */
    icon?: ReactNode;
    children: ReactNode;
    /** Rolls, attacks, and damage get the raised panel treatment. */
    highlight?: boolean;
}
/**
 * One mechanical event in the dice log — mono, dense, newest on top.
 *
 * @example
 * <div className="space-y-1 font-mono text-[12px] leading-snug">
 *   <LogLine icon="🎲" highlight>piloting 2d6+3 = 11 vs 9 — success</LogLine>
 *   <LogLine icon="⏱">Halvane patrol clock 3/6</LogLine>
 * </div>
 */
declare function LogLine({ icon, children, highlight }: LogLineProps): react.JSX.Element;

interface SectionLabelProps {
    children: ReactNode;
    /** Widest tracking — for pane headers like the dice log's. */
    wide?: boolean;
}
/**
 * Tiny uppercase heading that labels every group of content.
 *
 * @example
 * <SectionLabel>Attributes</SectionLabel>
 * <SectionLabel wide>Dice log</SectionLabel>
 */
declare function SectionLabel({ children, wide }: SectionLabelProps): react.JSX.Element;

interface StepperProps {
    steps: string[];
    /** Zero-based index of the current step. */
    current: number;
}
/**
 * Breadcrumb-style progress line for multi-step flows: done steps go green,
 * the current step is bold amber, the rest stay muted.
 *
 * @example
 * <Stepper steps={["The world", "Your faction", "Who you are", "Review"]} current={1} />
 */
declare function Stepper({ steps, current }: StepperProps): react.JSX.Element;

type NoticeTone = "warn" | "error" | "success";
interface NoticeProps {
    tone?: NoticeTone;
    children: ReactNode;
    /** Action row rendered under the message (small buttons). */
    actions?: ReactNode;
}
/**
 * Inline callout — advisory notes from the finalize pass, failures, confirmations.
 *
 * @example
 * <Notice
 *   tone="warn"
 *   actions={<>
 *     <Button size="sm">Use “Vale Okonkwo”</Button>
 *     <Button variant="outline" size="sm">Keep mine</Button>
 *   </>}
 * >
 *   ⚠ That name reads more corporate-core than lane-born.
 * </Notice>
 */
declare function Notice({ tone, children, actions }: NoticeProps): react.JSX.Element;

interface KeyValueRowProps {
    label: ReactNode;
    value: ReactNode;
}
/**
 * One line of a summary sheet — muted key left, value right, hairline rule
 * between rows (the last row drops its rule automatically).
 *
 * @example
 * <div className="space-y-2 text-sm">
 *   <KeyValueRow label="Name" value="Silas Corr" />
 *   <KeyValueRow label="Faction" value="Halvane Combine" />
 *   <KeyValueRow label="Ambition" value="own your hull outright" />
 * </div>
 */
declare function KeyValueRow({ label, value }: KeyValueRowProps): react.JSX.Element;

interface AppHeaderProps {
    /** Bold amber wordmark — "DRIFT". */
    brand: ReactNode;
    /** Muted context line — campaign · location. */
    center?: ReactNode;
    /** Right-aligned controls. */
    right?: ReactNode;
}
/**
 * Top bar of a play screen.
 *
 * @example
 * <AppHeader
 *   brand="DRIFT"
 *   center="Red Ledger · Meridian Dock"
 *   right={<Button variant="outline" size="sm">💡 Request</Button>}
 * />
 */
declare function AppHeader({ brand, center, right }: AppHeaderProps): react.JSX.Element;

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
declare const layoutVocabulary: string[];

export { AppHeader, type AppHeaderProps, Badge, type BadgeProps, type BadgeTone, Button, type ButtonProps, type ButtonSize, type ButtonVariant, ChatBubble, type ChatBubbleProps, type ChatRole, Chip, type ChipProps, ChoiceCard, type ChoiceCardProps, DriftRoot, type DriftRootProps, Field, type FieldProps, KeyValueRow, type KeyValueRowProps, LogLine, type LogLineProps, Meter, type MeterProps, type MeterTone, Modal, type ModalProps, Notice, type NoticeProps, type NoticeTone, Panel, type PanelPadding, type PanelProps, type PanelTone, SectionLabel, type SectionLabelProps, Select, type SelectProps, StatBox, type StatBoxProps, Stepper, type StepperProps, type TabItem, Tabs, type TabsProps, TextArea, type TextAreaProps, TextInput, type TextInputProps, layoutVocabulary };
