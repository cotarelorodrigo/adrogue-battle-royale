// Piezas comunes de las paredes (geometry.ts, fronts.ts, front-atlas.ts): hoja sin imports locales, para no hacer ciclos.
import * as THREE from 'three';
import type { Vec2 } from '../../shared/geo.ts';
import type { Opening } from '../../shared/mapdata.ts';

/** Alto de un piso (copia de mapgen/buildings.ts; el cliente no importa mapgen). */
export const FLOOR_H = 3.2;
/** Ancho de un módulo de fachada en metros. */
export const BAY_W = 3.0;

export interface Builder {
  pos: number[]; nor: number[]; uv: number[]; col: number[] | null; idx: number[];
}
export const newBuilder = (withColor: boolean): Builder => ({ pos: [], nor: [], uv: [], col: withColor ? [] : null, idx: [] });

export function toGeometry(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (b.col) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.idx);
  return g;
}

export function vert(b: Builder, p: [number, number, number], n: [number, number, number], uv: [number, number], c?: THREE.Color): number {
  b.pos.push(...p); b.nor.push(...n); b.uv.push(...uv);
  if (b.col) b.col.push(c!.r, c!.g, c!.b);
  return b.pos.length / 3 - 1;
}

/** Cuadrilátero a,b,c,d (en ese orden alrededor) con winding antihorario visto desde el lado de `n`. */
export function quad(b: Builder, vs: [number, number, number][], uvs: [number, number][], n: [number, number, number], c?: THREE.Color): void {
  const i = vs.map((p, k) => vert(b, p, n, uvs[k], c));
  b.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
}

/** Las esquinas de un polígono plano (un paño de un interior) antihorarias vistas desde `n`, su frente: al revés si su
 *  giro mira para el otro lado. */
export function facing(corners: [number, number, number][], n: [number, number, number]): [number, number, number][] {
  const [a, b, c] = corners;
  const [ux, uy, uz, vx, vy, vz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  return dot >= 0 ? corners : [...corners].reverse();
}

/** Un rectángulo sobre una cara: `s` a lo largo de ella (m) e `y` de alto. */
export interface Rect { s0: number; s1: number; y0: number; y1: number }

/** `r` partido por los huecos `holes`: lo que queda (`solid`) y lo que se saca (`cut`, cada hueco adentro de `r`), en
 *  rectángulos. Se parte en columnas por las puntas de los huecos; dos columnas seguidas con los mismos tramos se
 *  juntan. */
export function cutRect(r: Rect, holes: readonly Rect[]): { solid: Rect[]; cut: Rect[] } {
  const hs = holes
    .map((h) => ({ s0: Math.max(r.s0, h.s0), s1: Math.min(r.s1, h.s1), y0: Math.max(r.y0, h.y0), y1: Math.min(r.y1, h.y1) }))
    .filter((h) => h.s1 - h.s0 > 1e-9 && h.y1 - h.y0 > 1e-9);
  if (hs.length === 0) return { solid: [r], cut: [] };
  const marks = [...new Set([r.s0, r.s1, ...hs.flatMap((h) => [h.s0, h.s1])])].sort((a, b) => a - b);
  const out = { solid: [] as Rect[], cut: [] as Rect[] };
  const running = new Map<string, Rect & { kind: 'solid' | 'cut' }>();
  const flush = (key: string, s: number): void => {
    const x = running.get(key)!;
    if (s - x.s0 > 1e-9) out[x.kind].push({ s0: x.s0, s1: s, y0: x.y0, y1: x.y1 });
    running.delete(key);
  };
  for (let j = 0; j + 1 < marks.length; j++) {
    const [sa, sb] = [marks[j], marks[j + 1]];
    // los tramos de alto tapados en esta columna, unidos
    const over = hs.filter((h) => h.s0 <= sa + 1e-9 && h.s1 >= sb - 1e-9).map((h) => [h.y0, h.y1] as const).sort((a, b) => a[0] - b[0]);
    const spans: { y0: number; y1: number; kind: 'solid' | 'cut' }[] = [];
    let y = r.y0;
    for (const [lo, hi] of over) {
      if (hi <= y) continue;
      if (lo > y) spans.push({ y0: y, y1: lo, kind: 'solid' });
      const top = spans.at(-1);
      if (top?.kind === 'cut' && Math.abs(top.y1 - Math.max(lo, y)) < 1e-9) top.y1 = hi;
      else spans.push({ y0: Math.max(lo, y), y1: hi, kind: 'cut' });
      y = hi;
    }
    if (r.y1 > y) spans.push({ y0: y, y1: r.y1, kind: 'solid' });
    const keys = new Set(spans.map((p) => `${p.kind}:${p.y0}:${p.y1}`));
    for (const key of [...running.keys()]) if (!keys.has(key)) flush(key, sa);
    for (const p of spans) {
      const key = `${p.kind}:${p.y0}:${p.y1}`;
      if (!running.has(key)) running.set(key, { s0: sa, s1: sa, ...p });
    }
  }
  for (const key of [...running.keys()]) flush(key, r.s1);
  return out;
}

/** Las marcas de `ms` que caen adentro de (a, b), ordenadas y sin repetir, con a y b en las puntas. */
function splits(ms: readonly number[], a: number, b: number): number[] {
  const inside = ms.filter((m) => m > a + 1e-6 && m < b - 1e-6).sort((x, y) => x - y);
  return [a, ...inside.filter((m, k) => k === 0 || m - inside[k - 1] > 1e-6), b];
}

/** Un polígono convexo antihorario con puntos en línea en sus aristas (un rectángulo con marcas), en n − 2 triángulos
 *  con área y sin vértices nuevos: le recorta de a una punta saliente, la del triángulo más parejo (el de más área por
 *  el cuadrado de su perímetro). La diagonal que deja une dos puntos que no están en una misma arista, así que no pasa
 *  por ningún otro punto del borde: no deja juntas en T. */
export function convexTris(ring: readonly (readonly [number, number])[]): [number, number, number][] {
  const left = ring.map((_, k) => k), out: [number, number, number][] = [];
  const area = (a: number, b: number, c: number): number =>
    ((ring[b][0] - ring[a][0]) * (ring[c][1] - ring[a][1]) - (ring[c][0] - ring[a][0]) * (ring[b][1] - ring[a][1])) / 2;
  const d = (a: number, b: number): number => Math.hypot(ring[b][0] - ring[a][0], ring[b][1] - ring[a][1]);
  while (left.length > 3) {
    let best = -1, score = -Infinity;
    for (let k = 0; k < left.length; k++) {
      const [a, b, c] = [left[(k + left.length - 1) % left.length], left[k], left[(k + 1) % left.length]];
      const A = area(a, b, c);
      if (A <= 1e-9) continue;
      const q = A / (d(a, b) + d(b, c) + d(c, a)) ** 2;
      if (q > score) [best, score] = [k, q];
    }
    if (best < 0) break;
    const n = left.length;
    out.push([left[(best + n - 1) % n], left[best], left[(best + 1) % n]]);
    left.splice(best, 1);
  }
  // lo que quede (3 puntos, o un resto chato por redondeo), en abanico
  for (let k = 1; k + 1 < left.length; k++) out.push([left[0], left[k], left[k + 1]]);
  return out;
}

/** Un pedazo plano en (s, y): sus puntos y sus triángulos (índices, antihorarios en (s, y)). */
export interface FlatMesh { pts: [number, number][]; tris: [number, number, number][] }

/** Las marcas de cada arista de un pedazo: a lo largo, abajo (`bottom`) y arriba (`top`); en alto, a la izquierda (s0,
 *  `left`) y a la derecha (s1, `right`). */
export interface EdgeMarks { bottom?: readonly number[]; top?: readonly number[]; left?: readonly number[]; right?: readonly number[] }

/** El rectángulo `r` con las marcas de `m` que le caen adentro como vértices de su borde: sin juntas en T con los
 *  pedazos de al lado (que tienen sus puntas en esas marcas; una junta en T el rasterizado la deja abierta, como puntos
 *  o una línea de lo que hay detrás: T5 M1, T9 H5 y la T11c) y sin partirlo en la grilla de todas (M2 de la revisión de
 *  la T11c). Con marcas en un solo sentido, un cierre entre las dos aristas de ese sentido; en los dos, el polígono de su
 *  borde (`convexTris`). En los dos casos, sin vértices adentro: n − 2 triángulos para n puntos del borde. */
export function marked(r: Rect, m: EdgeMarks): FlatMesh {
  const [bottom, top] = [splits(m.bottom ?? [], r.s0, r.s1), splits(m.top ?? [], r.s0, r.s1)];
  const [left, right] = [splits(m.left ?? [], r.y0, r.y1), splits(m.right ?? [], r.y0, r.y1)];
  const along = bottom.length > 2 || top.length > 2, high = left.length > 2 || right.length > 2;
  if (along && high) {
    // el borde antihorario: abajo de izquierda a derecha, la derecha para arriba, arriba de vuelta y la izquierda
    const ring: [number, number][] = [
      ...bottom.map((s): [number, number] => [s, r.y0]),
      ...right.slice(1).map((y): [number, number] => [r.s1, y]),
      ...top.slice(0, -1).reverse().map((s): [number, number] => [s, r.y1]),
      ...left.slice(1, -1).reverse().map((y): [number, number] => [r.s0, y]),
    ];
    return { pts: ring, tris: convexTris(ring) };
  }
  // el cierre entre dos cadenas paralelas, `a` y `b`, de una punta a la otra (`t`: su avance), con (a, b, a⁺) antihorario
  const zip = (a: [number, number][], b: [number, number][], t: (p: [number, number]) => number): FlatMesh => {
    const pts = [...a, ...b], tris: [number, number, number][] = [];
    let [i, j] = [0, 0];
    while (i + 1 < a.length || j + 1 < b.length) {
      if (j + 1 >= b.length || (i + 1 < a.length && t(a[i + 1]) <= t(b[j + 1]))) tris.push([i, a.length + j, ++i]);
      else tris.push([i, a.length + j, a.length + ++j]);
    }
    return { pts, tris };
  };
  if (high) return zip(left.map((y): [number, number] => [r.s0, y]), right.map((y): [number, number] => [r.s1, y]), (p) => p[1]);
  return zip(top.map((s): [number, number] => [s, r.y1]), bottom.map((s): [number, number] => [s, r.y0]), (p) => p[0]);
}

/** Pone el pedazo `m` en `b`: cada punto (s, y) en `at(s, y)` con `uv(s, y)`, normal `n` y color `c`; los triángulos, de
 *  frente hacia `n` (dados vuelta si la corrida va al revés). */
export function flatMesh(b: Builder, m: FlatMesh, at: (s: number, y: number) => [number, number, number],
  uv: (s: number, y: number) => [number, number], n: [number, number, number], c?: THREE.Color): void {
  const first = b.pos.length / 3;
  const ps = m.pts.map(([s, y]) => at(s, y));
  for (let k = 0; k < ps.length; k++) vert(b, ps[k], n, uv(m.pts[k][0], m.pts[k][1]), c);
  // el sentido de la corrida: (s, y) antihorario, ¿de frente hacia n?
  const [o, u, v] = [at(0, 0), at(1, 0), at(0, 1)];
  const [ux, uy, uz, vx, vy, vz] = [u[0] - o[0], u[1] - o[1], u[2] - o[2], v[0] - o[0], v[1] - o[1], v[2] - o[2]];
  const front = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] >= 0;
  for (const [a, bb, cc] of m.tris) b.idx.push(first + a, first + (front ? bb : cc), first + (front ? cc : bb));
}

/** Los huecos de `openings` por arista de `fp` (la planta antihoraria que dibuja; `edgeOf`: arista guardada → de fp),
 *  con `s` en metros desde fp[i]. Si fp es la planta guardada dada vuelta, cada arista se recorre al revés. */
export function edgeHoles(stored: Vec2[], fp: Vec2[], edgeOf: (e: number) => number, openings: readonly Opening[]): Map<number, Rect[]> {
  const out = new Map<number, Rect[]>();
  for (const o of openings) {
    const i = edgeOf(o.edge);
    const [a, c] = [fp[i], fp[(i + 1) % fp.length]];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const [s0, s1] = fp === stored ? [o.s0, o.s1] : [len - o.s1, len - o.s0];
    out.set(i, [...(out.get(i) ?? []), { s0, s1, y0: o.y0, y1: o.y1 }]);
  }
  return out;
}

/** La media de public/textures/revoque_diff.jpg (lineal, canal por canal), medida (tests/client/aspecto.test.ts, M7 de
 *  la T11c): la de lo que lleva la foto cruda (el material `parapet`). */
export const REVOQUE_MEDIA: readonly [number, number, number] = [0.676, 0.649, 0.630];

const tintCache = new Map<string, THREE.Color>();
export function tintColor(tint: string): THREE.Color {
  let c = tintCache.get(tint);
  if (!c) { c = new THREE.Color().setStyle(tint); tintCache.set(tint, c); }
  return c;
}

/**
 * Los blancos de los frentes relevados (I3 de la T11c). La pared de un lote es su textura por el tinte, y la textura tiene
 * media < 1: la foto cruda del revoque (REVOQUE_MEDIA, ~0,65) o la pintura del atlas (PINTURA_MEDIA, ~0,79). En un color
 * medio no se nota, pero un blanco por 0,65 se ve gris: el #f4f4f1 de La Veneciana daba 114 de luma a la sombra.
 *  - Desde `desde` de luminancia lineal del tinte, el color va dividido por la media de su textura (el albedo queda en
 *    el color relevado) y por `k`, del todo en `hasta`. En el medio, de a poco: dos blancos parecidos no saltan.
 *  - `k` > 1 a propósito: el hemisferio de afuera trae del suelo un marrón oscuro (#80705a) y no el rebote de la calle
 *    al sol, que en una pared a la sombra suma ~20 % (informe de la T11c). En un color medio eso no se ve, pero sin él un
 *    blanco a la sombra da gris medio, y el blanco es lo que el ojo toma de referencia. Con 1,25: ~211 de frente al sol,
 *    ~148 a la sombra.
 *  - Los colores de abajo de `desde` (casi todos los relevados) quedan como estaban.
 */
export const BLANCO = { desde: 0.78, hasta: 0.86, k: 1.25 } as const;

/** El color de la pared de un frente relevado con una textura de media `media`: el tinte, o el blanco compensado. */
export function surveyedColor(hex: string, media: readonly [number, number, number]): THREE.Color {
  const c = tintColor(hex);
  const w = Math.min(1, Math.max(0, (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b - BLANCO.desde) / (BLANCO.hasta - BLANCO.desde)));
  if (w === 0) return c;
  const f = (x: number, m: number): number => x * (1 + w * (BLANCO.k / m - 1));
  return new THREE.Color(f(c.r, media[0]), f(c.g, media[1]), f(c.b, media[2]));
}
