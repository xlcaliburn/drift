/**
 * Random source, injected into every engine function so tests can seed dice.
 * `int(min, max)` is inclusive on both ends.
 */
export interface RNG {
  int(min: number, max: number): number;
}

/** Deterministic RNG (mulberry32). Same seed -> same sequence. */
export function seededRng(seed: number): RNG {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int(min: number, max: number) {
      return min + Math.floor(next() * (max - min + 1));
    },
  };
}

/** Non-deterministic RNG for real play. */
export const liveRng: RNG = {
  int(min: number, max: number) {
    return min + Math.floor(Math.random() * (max - min + 1));
  },
};

/** RNG that returns a fixed queue of d20/die values, then falls back. Test aid. */
export function scriptedRng(values: number[], fallback = 10): RNG {
  let i = 0;
  return {
    int() {
      return i < values.length ? values[i++] : fallback;
    },
  };
}
