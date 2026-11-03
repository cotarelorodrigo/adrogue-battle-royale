import { AREA, ORIGIN, areaRect, ensureCCW, hash01, hashIndex, project, signedAreaFromAbove, unproject } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';

test('el área mide ~1502 m × ~872 m', () => {
  const r = areaRect();
  expect(Math.abs(r.maxX - r.minX - 1502)).toBeLessThan(4);
  expect(Math.abs(r.maxZ - r.minZ - 872)).toBeLessThan(4);
});
test('origen en 0,0 y norte es −z', () => {
  expect(project(ORIGIN.lat, ORIGIN.lon)).toEqual([0, 0]);
  expect(project(AREA.north, ORIGIN.lon)[1]).toBeLessThan(0);
});
test('la estación queda en ≈(−327, 41)', () => {
  const [x, z] = project(-34.797811, -58.394237);
  expect(Math.abs(x + 327)).toBeLessThan(3); expect(Math.abs(z - 41)).toBeLessThan(3);
});
test('ida y vuelta', () => { const p = unproject(project(-34.8, -58.39)); expect(p.lat).toBeCloseTo(-34.8, 9); expect(p.lon).toBeCloseTo(-58.39, 9); });
test('orientación vista desde arriba', () => {
  const sq: Vec2[] = [[0,0],[10,0],[10,-10],[0,-10]]; // E y luego N: antihorario visto desde arriba
  expect(signedAreaFromAbove(sq)).toBeCloseTo(100);
  expect(signedAreaFromAbove(ensureCCW([...sq].reverse()))).toBeGreaterThan(0);
});
test('hash01 es determinista y está en [0,1)', () => { expect(hash01('b0001')).toBe(hash01('b0001')); expect(hash01('x')).toBeLessThan(1); });

test('hashIndex: en [0, 1) y sin correlación entre índices consecutivos (sirve para x, y de un punto)', () => {
  const n = 20_000;
  const xs = Array.from({ length: n }, (_, i) => hashIndex(2 * i));
  const ys = Array.from({ length: n }, (_, i) => hashIndex(2 * i + 1));
  for (const v of [...xs, ...ys]) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(xs), my = mean(ys);
  expect(mx).toBeCloseTo(0.5, 1);
  const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  expect(Math.abs(cov / (1 / 12))).toBeLessThan(0.03); // correlación de Pearson (varianza de U(0,1) = 1/12)
  expect(hashIndex(7)).toBe(hashIndex(7));
});
