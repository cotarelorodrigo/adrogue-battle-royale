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

/** Los rectángulos `rs` partidos en cada marca de `ss` (a lo largo) y de `ys` (en alto) que les cae adentro. Si todas
 *  las caras de un plano se parten con las mismas marcas (las puntas de todos sus rectángulos), ningún vértice de una
 *  queda en medio de una arista de otra: sin juntas en T, que el rasterizado deja abiertas como puntos o una línea de
 *  lo que hay detrás (T5 M1, T9 H5 y la T11c). */
export function lattice(rs: readonly Rect[], ss: readonly number[], ys: readonly number[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rs) {
    const [cs, rows] = [splits(ss, r.s0, r.s1), splits(ys, r.y0, r.y1)];
    for (let a = 0; a + 1 < cs.length; a++) for (let c = 0; c + 1 < rows.length; c++) out.push({ s0: cs[a], s1: cs[a + 1], y0: rows[c], y1: rows[c + 1] });
  }
  return out;
}

/** Las marcas de los rectángulos `rs`: sus puntas a lo largo (`s`) y en alto (`y`). */
export const marksOf = (rs: readonly Rect[]): { s: number[]; y: number[] } => ({ s: rs.flatMap((r) => [r.s0, r.s1]), y: rs.flatMap((r) => [r.y0, r.y1]) });

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

const tintCache = new Map<string, THREE.Color>();
export function tintColor(tint: string): THREE.Color {
  let c = tintCache.get(tint);
  if (!c) { c = new THREE.Color().setStyle(tint); tintCache.set(tint, c); }
  return c;
}
