/**
 * Rough per-model pricing (USD per million tokens) for budget accounting.
 * These are ESTIMATES for capping playtest spend, not billing-grade numbers —
 * update when providers change list prices. Unknown models fall back to
 * Sonnet-class rates (conservative: over-counts rather than under-counts).
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface Rates {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Longest-prefix-matched against the resolved model id. */
const PRICING: Record<string, Rates> = {
  "deepseek-v4-flash": { in: 0.14, out: 0.28, cacheRead: 0.0028, cacheWrite: 0.14 },
  "deepseek-v4-pro": { in: 0.435, out: 0.87, cacheRead: 0.003625, cacheWrite: 0.435 },
  // Legacy ids — deprecated by DeepSeek on 2026/07/24, kept for in-flight accounting.
  "deepseek-chat": { in: 0.27, out: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
  "deepseek-reasoner": { in: 0.55, out: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-sonnet-5": { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // Opus 4.5+ list price (the old 4.1-era $15/$75 over-counted budgets 3×).
  "claude-opus": { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

const FALLBACK: Rates = PRICING["claude-sonnet-5"];

function ratesFor(model: string): Rates {
  let best: Rates | undefined;
  let bestLen = 0;
  for (const [prefix, rates] of Object.entries(PRICING)) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = rates;
      bestLen = prefix.length;
    }
  }
  return best ?? FALLBACK;
}

/** Estimated cost of one turn in USD. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const r = ratesFor(model);
  const perM = 1 / 1_000_000;
  return (
    usage.inputTokens * r.in * perM +
    usage.outputTokens * r.out * perM +
    usage.cacheReadTokens * r.cacheRead * perM +
    usage.cacheWriteTokens * r.cacheWrite * perM
  );
}

/** Total tokens in a usage record (for the token-count budget). */
export function totalTokens(usage: TokenUsage): number {
  return (
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  );
}
