/**
 * Incremental extractor for the `narration` field of a streamed JSON turn.
 *
 * JSON mode would normally kill live streaming (you can't render half an
 * object). This state machine watches the raw token stream for
 * `"narration"` … `:` … `"` and then emits the string's characters —
 * unescaping as it goes — until the closing quote, so the player still sees
 * the prose type out while the rest of the JSON streams silently.
 */
export class NarrationExtractor {
  private pre = ""; // buffer while hunting for the narration key + opening quote
  private inside = false;
  private done = false;
  private esc = false;
  private uni = ""; // pending \uXXXX hex digits ("" = not in a unicode escape)

  /** Feed a raw delta; returns the narration text it contained (often ""). */
  feed(delta: string): string {
    if (this.done) return "";
    let out = "";
    for (const ch of delta) {
      if (!this.inside) {
        this.pre += ch;
        // Opening quote of the value after a "narration" key?
        const m = this.pre.match(/"narration"\s*:\s*"$/);
        if (m) {
          this.inside = true;
          this.pre = "";
        }
        continue;
      }
      // Inside the narration string value.
      if (this.uni !== "" || (this.esc && ch === "u")) {
        // Collect \uXXXX (the 'u' itself, then 4 hex chars).
        this.uni += ch;
        this.esc = false;
        if (this.uni.length === 5) {
          const code = parseInt(this.uni.slice(1), 16);
          if (!Number.isNaN(code)) out += String.fromCharCode(code);
          this.uni = "";
        }
        continue;
      }
      if (this.esc) {
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", b: "", f: "" };
        out += map[ch] ?? ch;
        this.esc = false;
        continue;
      }
      if (ch === "\\") {
        this.esc = true;
        continue;
      }
      if (ch === '"') {
        this.done = true; // narration value closed; ignore the rest of the JSON
        break;
      }
      out += ch;
    }
    return out;
  }
}
