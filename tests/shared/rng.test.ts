import { createRng, pick } from '../../src/shared/rng.ts';

describe('rng', () => {
  it('misma semilla, misma secuencia; semillas distintas, secuencias distintas', () => {
    const seq = (s: number) => { const r = createRng(s); return Array.from({ length: 8 }, () => r.next()); };
    expect(seq(1)).toEqual(seq(1));
    expect(seq(1)).not.toEqual(seq(2));
    for (const v of seq(1)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('pick respeta los pesos', () => {
    const r = createRng(7);
    let a = 0;
    for (let i = 0; i < 10000; i++) if (pick(r, [['a', 1], ['b', 3]] as const) === 'a') a++;
    expect(Math.abs(a / 100 - 25)).toBeLessThan(2);
  });
});
