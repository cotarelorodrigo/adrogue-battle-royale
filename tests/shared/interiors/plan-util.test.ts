// Las ayudas de planta que comparten los planos (H8 de la revisión de la tarea 9): el rectángulo, el polígono regular y
// los yaw de los muebles en el marco local. Y (H5 de la revisión de la tarea 10) `add`, la franja pintada contra una
// pared, los huecos de las puertas de una pared (de k.openings, por geometría) y el zócalo de las paredes de afuera.
import { signedAreaFromAbove } from '../../../src/shared/geo.ts';
import type { Vec2 } from '../../../src/shared/geo.ts';
import type { Kit } from '../../../src/shared/interiors/kit.ts';
import { add, franja, MIRA, ngon, puertas, rect, zocalo } from '../../../src/shared/interiors/plan-util.ts';
import type { Hueco, Rect } from '../../../src/shared/interiors/plan-util.ts';
import type { Block } from '../../../src/shared/interiors/types.ts';
import { LOOKS, testInterior } from './fixture.ts';

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

test('add: p + d·k (k = 1 si no va)', () => {
  expect(add([1, 2], [3, 4], 2)).toEqual([7, 10]);
  expect(add([1, 2], [3, 4])).toEqual([4, 6]);
});

/** El local de prueba (marco local = mundo): la puerta del frente va de x 4,2 a 5,8 y los vidrios a los lados; las caras
 *  de adentro, a WALL_OUT (0,2) de las de afuera. */
const conKit = (f: (k: Kit) => void): Block[] => testInterior({ extra: f }).interior.blocks;
const ZOC = { mat: 'liso', color: '#123456' } as const;
const delZocalo = (bs: Block[]): Block[] => bs.filter((x) => x.side?.color === ZOC.color);
const xs = (x: Block): [number, number] => [Math.min(...x.polygon.map((p) => p[0])), Math.max(...x.polygon.map((p) => p[0]))];

test('puertas: los huecos de las puertas de k.openings sobre la pared de a a b (en metros desde a), por geometría', () => {
  let got: Record<string, Hueco[]> = {};
  conKit((k) => {
    const [a, b, c]: Vec2[] = [[0.2, 0.2], [9.8, 0.2], [0.2, 14.8]];
    got = { adentro: puertas(k, a, b), alReves: puertas(k, b, a), afuera: puertas(k, [0, 0], [10, 0]), costado: puertas(k, a, c) };
  });
  // la puerta, sí; los vidrios del frente, no (no son puertas); del costado, nada
  expect(got.adentro).toHaveLength(1);
  got.adentro[0].forEach((x, j) => expect(x).toBeCloseTo([4.0, 5.6, 0, 2.3][j], 6));
  // al revés, desde (9,8, 0,2): la puerta queda de 9,8 − 5,8 a 9,8 − 4,2
  got.alReves[0].forEach((x, j) => expect(x).toBeCloseTo([4.0, 5.6, 0, 2.3][j], 6));
  got.afuera[0].forEach((x, j) => expect(x).toBeCloseTo([4.2, 5.8, 0, 2.3][j], 6));
  expect(got.costado).toEqual([]);
});

test('franja: los pedazos de a a b menos los huecos (de abajo hasta el hueco y de arriba de él), sin la cara de la pared', () => {
  const bs = delZocalo(conKit((k) => franja(k, [0.2, 0.2], [9.8, 0.2], [0, 1], 0, 1.2, ZOC, [[2, 3, 0.5, 3]], { t: 0.01 })));
  // de 0,2 a 2,2: entero; de 2,2 a 3,2: solo abajo del hueco (0 a 0,5); de 3,2 a 9,8: entero
  expect(bs.map((x) => [...xs(x), x.y0, x.y1].map((v) => +v.toFixed(3)))).toEqual([[0.2, 2.2, 0, 1.2], [2.2, 3.2, 0, 0.5], [3.2, 9.8, 0, 1.2]]);
  for (const x of bs) {
    expect(x.collide).toBe('none');
    expect(x.hide, 'la cara contra la pared no se dibuja').toHaveLength(1);
    expect(Math.max(...x.polygon.map((p) => p[1])) - Math.min(...x.polygon.map((p) => p[1]))).toBeCloseTo(0.01, 9);
  }
  expect(delZocalo(conKit((k) => franja(k, [0.2, 0.2], [9.8, 0.2], [0, 1], 0, 1.2, ZOC, [], { t: 0.01, out: true })))[0].out).toBe(true);
});

test('zocalo: contra las cuatro paredes de afuera, de 0 a h, salvo en el hueco de la puerta (no en los vidrios)', () => {
  const bs = delZocalo(conKit((k) => zocalo(k, ZOC, { h: 0.1, t: 0.008 })));
  for (const x of bs) expect([x.y0, x.y1]).toEqual([0, 0.1]);
  const frente = bs.filter((x) => Math.max(...x.polygon.map((p) => p[1])) < 0.3);
  expect(frente.map((x) => xs(x).map((v) => +v.toFixed(3))).sort((p, q) => p[0] - q[0])).toEqual([[0.2, 4.2], [5.8, 9.8]]);
  expect(bs.length, 'el frente en dos y las otras tres enteras').toBe(5);
  // y no tapa la pared de vidrio de LOOKS (es otro color)
  expect(bs.every((x) => x.side?.color !== LOOKS.pared.color)).toBe(true);
});
