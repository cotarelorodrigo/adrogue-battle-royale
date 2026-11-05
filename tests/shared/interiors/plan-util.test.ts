// Las ayudas de planta que comparten los planos (H8 de la revisión de la tarea 9): el rectángulo, el polígono regular y
// los yaw de los muebles en el marco local.
import { signedAreaFromAbove } from '../../../src/shared/geo.ts';
import { MIRA, ngon, rect } from '../../../src/shared/interiors/plan-util.ts';
import type { Rect } from '../../../src/shared/interiors/plan-util.ts';

test('rect: las cuatro esquinas de [u0, v0, u1, v1], en orden, desde (u0, v0)', () => {
  const r: Rect = [1, 2, 4, 6];
  expect(rect(r)).toEqual([[1, 2], [4, 2], [4, 6], [1, 6]]);
  expect(Math.abs(signedAreaFromAbove(rect(r)))).toBeCloseTo(12, 9);
});

test('ngon: n puntos a r del medio, el primero sobre +U', () => {
  const p = ngon([3, -1], 0.5, 6);
  expect(p).toHaveLength(6);
  expect(p[0][0]).toBeCloseTo(3.5, 9);
  expect(p[0][1]).toBeCloseTo(-1, 9);
  for (const q of p) expect(Math.hypot(q[0] - 3, q[1] + 1)).toBeCloseTo(0.5, 9);
});

test('MIRA: el yaw que pone el frente de un mueble (+z) hacia V, U, −V y −U', () => {
  expect(MIRA).toEqual({ V: 0, U: Math.PI / 2, menosV: Math.PI, menosU: -Math.PI / 2 });
});
