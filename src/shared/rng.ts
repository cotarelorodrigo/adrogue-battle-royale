/** PRNG determinista (mulberry32) para el código compartido: nada de Math.random en src/shared. */
export type Rng = { next(): number };

/** Uniforme en [0, 1). Misma semilla, misma secuencia. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Sorteo ponderado: cada par es [valor, peso]. */
export function pick<T>(rng: Rng, weighted: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of weighted) total += w;
  let r = rng.next() * total;
  for (const [v, w] of weighted) {
    if (r < w) return v;
    r -= w;
  }
  return weighted[weighted.length - 1][0];
}
