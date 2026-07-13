/**
 * Cut a narration at the first inline choice menu.
 *
 * DeepSeek sometimes ignores the "choices go only through offer_choices" rule and
 * writes the options as `> **Option**` blockquotes — then keeps generating,
 * role-playing the player's pick and narrating the NEXT beat(s) in the same
 * response (the "said the menu twice / echoed my action" artifact). The
 * offer_choices tool is the real menu and the engine drives what happens next, so
 * everything from the first blockquote marker on is discarded, leaving one clean
 * beat. Pure and deterministic — used server-side on the final narration and
 * client-side on the live stream, so the artifact never reaches the player.
 */
export function stripInlineMenu(text: string): string {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => /^\s*>\s*\S/.test(l));
  if (idx < 1) return text; // no menu, or it starts the text — leave as-is
  return lines.slice(0, idx).join("\n").trimEnd();
}
