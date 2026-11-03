import { applyHomography, computeHomography } from '../../src/shared/homography.ts';
import type { Vec2 } from '../../src/shared/geo.ts';

type Quad = [Vec2, Vec2, Vec2, Vec2];
const unit: Quad = [[0, 0], [1, 0], [1, 1], [0, 1]];
const src: Quad = [[12, 30], [210, 8], [190, 150], [20, 170]];
const dst: Quad = [[0, 0], [100, 0], [100, 60], [0, 60]];

describe('homografía', () => {
  test('mapea las 4 esquinas exactamente', () => {
    const h = computeHomography(src, dst);
    src.forEach((p, i) => expect(applyHomography(h, p)).toBeCloseTo2D(dst[i], 6));
  });
  test('identidad', () => expect(applyHomography(computeHomography(unit, unit), [0.3, 0.7])).toBeCloseTo2D([0.3, 0.7], 9));
  test('la inversa deshace la ida', () => {
    const f = computeHomography(src, dst), g = computeHomography(dst, src);
    expect(applyHomography(g, applyHomography(f, [100, 80]))).toBeCloseTo2D([100, 80], 6);
  });
  test('cuadrilátero degenerado (puntos colineales) falla', () => {
    expect(() => computeHomography([[0, 0], [1, 1], [2, 2], [3, 3]], unit)).toThrow();
  });
});
