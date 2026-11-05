// Las ayudas de planta de los planos (en el marco local del Kit: U a lo largo del frente, V hacia adentro): el
// rectángulo [u0, v0, u1, v1], el polígono regular, el yaw que pone el frente de un mueble (+z del modelo) hacia cada
// lado, `add` y `sub`, las caras de adentro de una planta casi rectangular, y las franjas pintadas contra una pared (el
// zócalo), con los huecos de las puertas de la pared.
import type { Vec2 } from '../geo.ts';
import type { Kit } from './kit.ts';
import type { Look } from './types.ts';

export type Rect = [number, number, number, number];

/** Las cuatro esquinas de [u0, v0, u1, v1], desde (u0, v0). */
export const rect = ([u0, v0, u1, v1]: Rect): Vec2[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

/** Los n vértices del polígono regular de radio r con el medio en c; el primero, sobre +U. */
export const ngon = (c: Vec2, r: number, n: number): Vec2[] =>
  Array.from({ length: n }, (_, k): Vec2 => [c[0] + r * Math.cos((2 * Math.PI * k) / n), c[1] + r * Math.sin((2 * Math.PI * k) / n)]);

/** El yaw de un mueble que mira hacia +V, +U, −V o −U (con yaw MIRA.V, el +x del modelo va hacia +U). */
export const MIRA = { V: 0, U: Math.PI / 2, menosV: Math.PI, menosU: -Math.PI / 2 } as const;

/** p + d·k. */
export const add = (p: Vec2, d: Vec2, k = 1): Vec2 => [p[0] + d[0] * k, p[1] + d[1] * k];
/** a − b. */
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** Las caras de adentro de las paredes de afuera (la planta corrida del Kit) de una planta casi rectangular (un lote se
 *  tuerce a lo sumo 1 cm): lo más adentro de cada lado. La estación, que se tuerce más, tiene las suyas. */
export interface Caras { U0: number; U1: number; V0: number; V1: number }
export function caras(k: Kit): Caras {
  const us = k.inside.map((p) => p[0]).sort((a, b) => a - b), vs = k.inside.map((p) => p[1]).sort((a, b) => a - b);
  return { U0: us[1], U1: us[us.length - 2], V0: vs[1], V1: vs[vs.length - 2] };
}

/** Un hueco de una franja: de s0 a s1 (metros desde su punta `a`) y de y0 a y1. */
export type Hueco = [number, number, number, number];

/** Las puertas de k.openings sobre la pared de `a` a `b` (una cara de adentro o de afuera, marco local), como huecos de
 *  una franja: las que corren paralelas a ella a menos de medio metro (sus puntas van en la cara de afuera, a WALL_OUT
 *  de la de adentro) y la pisan a lo largo. Por geometría: no importa la arista ni de qué lado se la recorra. */
export function puertas(k: Kit, a: Vec2, b: Vec2): Hueco[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), e: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const along = (x: Vec2): number => (x[0] - a[0]) * e[0] + (x[1] - a[1]) * e[1];
  const across = (x: Vec2): number => Math.abs((x[0] - a[0]) * e[1] - (x[1] - a[1]) * e[0]);
  return k.openings.filter((o) => o.kind === 'puerta' && across(o.a) < 0.5 && across(o.c) < 0.5)
    .map((o): Hueco => [Math.min(along(o.a), along(o.c)), Math.max(along(o.a), along(o.c)), o.y0, o.y1])
    .filter(([s0, s1]) => s1 > 0 && s0 < len).sort((p, q) => p[0] - q[0]);
}

/** Una franja pintada contra una pared (un zócalo): de `a` a `b` sobre la cara (marco local), de `t` hacia `n` (hacia el
 *  que la mira) y de y0 a y1, menos los huecos; no frena, y su cara contra la pared no se dibuja (ni la de abajo, si
 *  arranca en el piso). Con `out`, va con el edificio. */
export function franja(k: Kit, a: Vec2, b: Vec2, n: Vec2, y0: number, y1: number, look: Look, huecos: Hueco[] = [],
  o: { t: number; out?: true }): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), e: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], { t } = o;
  const marks = [...new Set([0, len, ...huecos.flatMap(([s0, s1]) => [s0, s1]).filter((s) => s > 0 && s < len)])].sort((p, q) => p - q);
  const looks = { side: look, top: look, ...(y0 > 1e-6 ? { bottom: look } : {}) };
  for (let j = 0; j + 1 < marks.length; j++) {
    const [s0, s1] = [marks[j], marks[j + 1]];
    if (s1 - s0 < 0.02) continue;
    const tapan = huecos.filter(([h0, h1]) => h0 <= s0 + 1e-9 && h1 >= s1 - 1e-9).map(([, , h0, h1]): [number, number] => [h0, h1]).sort((p, q) => p[0] - q[0]);
    let y = y0;
    const pieza = (lo: number, hi: number): void => {
      if (hi - lo < 0.02) return;
      const [p, q] = [add(a, e, s0), add(a, e, s1)];
      // la arista 2 (de q a p, sobre la pared) no se ve
      k.block([add(p, n, t), add(q, n, t), q, p], lo, hi, 'none', 'otro', looks, o.out ? { out: true, hide: [2] } : { hide: [2] });
    };
    for (const [h0, h1] of tapan) {
      pieza(y, Math.min(h0, y1));
      y = Math.max(y, h1);
    }
    pieza(y, y1);
  }
}

/** El zócalo contra las paredes de afuera (las caras de adentro, k.inside), de `h` de alto y `t` de espesor, salvo en
 *  los huecos de las puertas. */
export function zocalo(k: Kit, look: Look, { h, t }: { h: number; t: number }): void {
  const r = k.inside, n = r.length;
  const mid: Vec2 = [r.reduce((s, p) => s + p[0], 0) / n, r.reduce((s, p) => s + p[1], 0) / n];
  for (let i = 0; i < n; i++) {
    const [p, q] = [r[i], r[(i + 1) % n]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    let nrm: Vec2 = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
    if ((mid[0] - p[0]) * nrm[0] + (mid[1] - p[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
    franja(k, p, q, nrm, 0, h, look, puertas(k, p, q), { t });
  }
}
