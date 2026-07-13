/**
 * Handle the DeepSeek "inline menu" artifact.
 *
 * DeepSeek sometimes ignores the "choices go only through offer_choices" rule and
 * writes the options as `> **Option**` blockquotes — then keeps generating,
 * role-playing the player's pick and narrating the NEXT beat(s) in the same
 * response (the "said the menu twice / echoed my action" artifact).
 *
 * The offer_choices tool is the real menu and the engine drives what happens next,
 * so we cut the narration at the first blockquote marker — one clean beat — and,
 * rather than throwing the model's intended options away, PARSE them out of that
 * first menu block so the quick-reply buttons still match the beat (instead of
 * falling back to generic thread choices). Pure and deterministic; used server-side
 * on the final narration/choices and client-side on the live stream.
 */
export interface ParsedNarration {
  /** Narration with the inline menu (and any multi-beat overrun) removed. */
  narration: string;
  /** Options the model wrote inline, in order (empty if there was no menu). */
  choices: string[];
}

export function parseInlineMenu(text: string): ParsedNarration {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => /^\s*>\s*\S/.test(l));
  if (idx < 1) return { narration: text, choices: [] }; // no menu, or it starts the text

  const narration = lines.slice(0, idx).join("\n").trimEnd();

  // Collect the FIRST contiguous block of "> …" lines (that's the menu for this
  // beat); the first non-blank, non-blockquote line is the model's overrun and ends it.
  const choices: string[] = [];
  for (let i = idx; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === "") continue;
    const m = l.match(/^>\s*(.+)$/);
    if (!m) break;
    const opt = m[1].replace(/[*_`]+/g, "").trim(); // drop markdown emphasis
    if (opt) choices.push(opt);
  }

  return { narration, choices: choices.slice(0, 4) };
}

/** Narration with any inline menu + overrun removed (see parseInlineMenu). */
export function stripInlineMenu(text: string): string {
  return parseInlineMenu(text).narration;
}
