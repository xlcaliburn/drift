/**
 * Best-effort repair of TRUNCATED model JSON (output cap hit mid-object). Walks
 * the text once tracking string/escape state and the open bracket stack, cuts
 * back to the last position where a complete VALUE ended, strips any dangling
 * `"key":` / trailing comma, and closes the remaining stack. Returns null when
 * no usable prefix exists.
 *
 * Born from two live incidents of the same pattern (a model's JSON cut by the
 * token cap, then persisted raw): scene summaries stored as `{\n "summary": "…`
 * text (CONTINUITY.md bug — one of those stubs embedded a wrong PC name into
 * canon), and a $0.28 nightly-audit report reduced to a 500-char stub.
 */
export function repairTruncatedJson(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const s = raw.slice(start);
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastSafe = -1; // index in s AFTER which a complete value has just ended
  const stackAt: string[][] = []; // bracket stack snapshot at each safe point
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') {
        inStr = false;
        lastSafe = i;
        stackAt[i] = [...stack];
      }
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      stack.pop();
      lastSafe = i;
      stackAt[i] = [...stack];
    } else if (/[0-9truefalsn]/.test(c) && /[\s,\]}]/.test(s[i + 1] ?? " ")) {
      // a number/true/false/null ends here (next char is a delimiter/end)
      lastSafe = i;
      stackAt[i] = [...stack];
    }
  }
  if (lastSafe < 0) return null;
  const base = s.slice(0, lastSafe + 1);
  const open = stackAt[lastSafe] ?? [];
  const closers = [...open].reverse().map((b) => (b === "{" ? "}" : "]")).join("");
  // Try progressively harder trims: as-is → drop a dangling `"key":` → drop a
  // dangling lone `"key"` (cut before its colon) → drop a trailing comma.
  const trims = [
    (c: string) => c,
    (c: string) => c.replace(/,\s*"(?:[^"\\]|\\.)*"\s*:\s*$/, ""),
    (c: string) => c.replace(/,\s*"(?:[^"\\]|\\.)*"\s*$/, ""),
  ];
  for (const trim of trims) {
    const candidate = trim(base).replace(/,\s*$/, "") + closers;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      /* next trim */
    }
  }
  return null;
}

/** Strip markdown code fences a model wrapped around JSON despite the contract. */
export function stripCodeFences(raw: string): string {
  return raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
}
