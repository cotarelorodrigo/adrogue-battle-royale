import { AREA, ORIGIN, areaRect, ensureCCW, hash01, project, signedAreaFromAbove, unproject } from '../../src/shared/geo.ts';
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
