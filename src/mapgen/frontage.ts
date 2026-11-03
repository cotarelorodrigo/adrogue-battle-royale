import { pointInPolygon } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Road } from '../shared/mapdata.ts';
import { bufferLine, offsetLine } from './osm.ts';
import type { FrenteInput } from './frentes-input.ts';

export interface Frontage {
  id: string;
  line: Vec2[]; // línea de edificación de `desde` a `hasta`, recortada en las esquinas
  length: number;
  inward: 1 | -1; // offsetLine(line, inward * d), con d > 0, entra en la manzana
  setback: number; // del eje de la calle a la línea: width/2 + sidewalk
  ext: Vec2[]; // `line` estirada 20 m por cada punta (para los lotes de esquina)
  corners: [Vec2[][], Vec2[][]]; // corredores (calzada + veredas) que recortan la punta de `desde` y la de `hasta`
}

export const vehicular = (r: Road): boolean => r.kind !== 'footway' && r.kind !== 'pedestrian' && r.kind !== 'service';

const EXTEND = 20;
const CORNER_REACH = 40;
const STEP = 0.05;
const TOL = 0.001;
const JOIN_TOL = 0.01;
const COMPASS: Record<FrenteInput['vereda'], Vec2> = { norte: [0, -1], sur: [0, 1], este: [1, 0], oeste: [-1, 0] };

const same = (a: Vec2, b: Vec2): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) < JOIN_TOL;

export function cumulative(pts: Vec2[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** Punto a distancia `s` del inicio (s se acota al rango de la polilínea). */
export function pointAt(pts: Vec2[], cum: number[], s: number): Vec2 {
  const sc = Math.min(Math.max(s, 0), cum[cum.length - 1]);
  let i = 1;
  while (i < pts.length - 1 && cum[i] < sc) i++;
  const len = cum[i] - cum[i - 1] || 1;
  const t = (sc - cum[i - 1]) / len;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
}

/** Sub-polilínea entre `s0` y `s1`; lo que sobra fuera del rango sigue por la tangente de la punta. */
export function slice(pts: Vec2[], s0: number, s1: number): Vec2[] {
  const cum = cumulative(pts);
  const total = cum[cum.length - 1];
  const a = Math.max(s0, 0);
  const b = Math.min(s1, total);
  const out: Vec2[] = [pointAt(pts, cum, a)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > a + 1e-9 && cum[i] < b - 1e-9) out.push(pts[i]);
  out.push(pointAt(pts, cum, b));
  const tangent = (from: Vec2, to: Vec2): Vec2 => {
    const l = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    return [(to[0] - from[0]) / l, (to[1] - from[1]) / l];
  };
  if (s0 < 0) {
    const t = tangent(out[1], out[0]);
    out.unshift([out[0][0] + t[0] * -s0, out[0][1] + t[1] * -s0]);
  }
  if (s1 > total) {
    const n = out.length;
    const t = tangent(out[n - 2], out[n - 1]);
    out.push([out[n - 1][0] + t[0] * (s1 - total), out[n - 1][1] + t[1] * (s1 - total)]);
  }
  return out;
}

/** Une las vías vehiculares de nombre `name` que comparten un extremo en una sola polilínea. */
export function streetChain(roads: Road[], name: string): Vec2[] {
  const pieces = roads.filter((r) => vehicular(r) && r.name === name).map((r) => r.points.slice());
  if (pieces.length === 0) throw new Error(`no hay ninguna calle "${name}"`);
  let chain = pieces.shift()!;
  for (let progress = true; progress && pieces.length > 0; ) {
    progress = false;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const head = chain[0];
      const tail = chain[chain.length - 1];
      if (same(tail, p[0])) chain = [...chain, ...p.slice(1)];
      else if (same(tail, p[p.length - 1])) chain = [...chain, ...p.slice(0, -1).reverse()];
      else if (same(head, p[p.length - 1])) chain = [...p.slice(0, -1), ...chain];
      else if (same(head, p[0])) chain = [...p.slice(1).reverse(), ...chain];
      else continue;
      pieces.splice(i, 1);
      progress = true;
      break;
    }
  }
  if (pieces.length > 0) throw new Error(`la calle "${name}" tiene tramos que no se tocan`);
  return chain;
}

/** Posiciones `s` a lo largo de `chain` donde cruza alguna vía vehicular de nombre `name`. */
function crossings(chain: Vec2[], roads: Road[], name: string): number[] {
  const cum = cumulative(chain);
  const out: number[] = [];
  for (const r of roads) {
    if (!vehicular(r) || r.name !== name) continue;
    for (let j = 1; j < r.points.length; j++) {
      const [c, d] = [r.points[j - 1], r.points[j]];
      for (let i = 1; i < chain.length; i++) {
        const [a, b] = [chain[i - 1], chain[i]];
        const rx = b[0] - a[0];
        const rz = b[1] - a[1];
        const sx = d[0] - c[0];
        const sz = d[1] - c[1];
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
        const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
        if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
        out.push(cum[i - 1] + t * (cum[i] - cum[i - 1]));
      }
    }
  }
  return out;
}

const avgDot = (pts: Vec2[], k: Vec2): number => pts.reduce((s, p) => s + p[0] * k[0] + p[1] * k[1], 0) / pts.length;

/** Corredores de las vías vehiculares (salvo la propia) que cortan el tramo `[s0, s1]` de `line`. */
function cornerBuffers(roads: Road[], own: string, line: Vec2[], cum: number[], s0: number, s1: number): Vec2[][] {
  const samples: Vec2[] = [];
  for (let s = s0; s <= s1; s += STEP) samples.push(pointAt(line, cum, s));
  const out: Vec2[][] = [];
  for (const r of roads) {
    if (!vehicular(r) || r.name === own) continue;
    const poly = bufferLine(r.points, r.width / 2 + r.sidewalk);
    if (samples.some((p) => pointInPolygon(p, poly))) out.push(poly);
  }
  return out;
}

function resolve(roads: Road[], f: Pick<FrenteInput, 'id' | 'calle' | 'desde' | 'hasta' | 'vereda'>): Frontage {
  const chain = streetChain(roads, f.calle);
  const own = roads.find((r) => vehicular(r) && r.name === f.calle)!;
  const cross = (name: string): number[] => {
    const s = crossings(chain, roads, name);
    if (s.length === 0) throw new Error(`"${name}" no cruza "${f.calle}"`);
    return s;
  };
  const sDesde = cross(f.desde);
  const sHasta = cross(f.hasta);
  let best: [number, number] | null = null;
  for (const a of sDesde)
    for (const b of sHasta) {
      const gap = Math.abs(a - b);
      if (gap > 1e-6 && (!best || gap < Math.abs(best[0] - best[1]))) best = [a, b];
    }
  if (!best) throw new Error(`"${f.desde}" y "${f.hasta}" cruzan "${f.calle}" en el mismo punto`);
  const [sA, sB] = best;

  let tramo = slice(chain, Math.min(sA, sB) - EXTEND, Math.max(sA, sB) + EXTEND);
  if (sA > sB) tramo = tramo.reverse();

  const setback = own.width / 2 + own.sidewalk;
  const compass = COMPASS[f.vereda];
  const plus = offsetLine(tramo, setback);
  const minus = offsetLine(tramo, -setback);
  const dPlus = avgDot(plus, compass);
  const dMinus = avgDot(minus, compass);
  if (Math.abs(dPlus - dMinus) < 0.3 * 2 * setback) {
    throw new Error(`la vereda "${f.vereda}" no es clara para esta calle; usá norte o sur`);
  }
  const inward: 1 | -1 = dPlus > dMinus ? 1 : -1;
  const off = inward === 1 ? plus : minus;

  const cum = cumulative(off);
  const total = cum[cum.length - 1];
  const corners0 = cornerBuffers(roads, f.calle, off, cum, 0, Math.min(CORNER_REACH, total));
  const corners1 = cornerBuffers(roads, f.calle, off, cum, Math.max(total - CORNER_REACH, 0), total);
  const inside = (polys: Vec2[][]) => (s: number): boolean => {
    const p = pointAt(off, cum, s);
    return polys.some((poly) => pointInPolygon(p, poly));
  };
  const in0 = inside(corners0);
  const in1 = inside(corners1);

  // Bisección entre dos muestras de distinto signo (`aIn` = estado de `a`) hasta 1 mm; devuelve el lado de afuera.
  const refine = (a: number, b: number, aIn: boolean, isIn: (s: number) => boolean): number => {
    let [lo, hi] = [a, b];
    while (Math.abs(hi - lo) > TOL) {
      const m = (lo + hi) / 2;
      if (isIn(m) === aIn) lo = m;
      else hi = m;
    }
    return aIn ? hi : lo;
  };

  // Sin corredor en una punta (empalme en T desde el otro lado), el frente termina justo en el cruce.
  let c0 = EXTEND;
  let lastIn = -1;
  for (let k = 0; k * STEP <= total; k++) if (in0(k * STEP)) lastIn = k;
  if (corners0.length > 0 && lastIn >= 0) {
    if ((lastIn + 1) * STEP > total) throw new Error('el frente queda entero dentro de la esquina');
    c0 = refine(lastIn * STEP, (lastIn + 1) * STEP, true, in0);
  }
  let c1 = total - EXTEND;
  for (let k = 0; corners1.length > 0 && k * STEP <= total; k++) {
    if (!in1(k * STEP)) continue;
    if (k === 0) throw new Error('el frente queda entero dentro de la esquina');
    c1 = refine((k - 1) * STEP, k * STEP, false, in1);
    break;
  }
  if (c1 - c0 <= TOL) throw new Error('el frente queda entero dentro de la esquina');

  return {
    id: f.id,
    line: slice(off, c0, c1),
    length: c1 - c0,
    inward,
    setback,
    ext: slice(off, c0 - EXTEND, c1 + EXTEND),
    corners: [corners0, corners1],
  };
}

export function resolveFrontage(roads: Road[], f: Pick<FrenteInput, 'id' | 'calle' | 'desde' | 'hasta' | 'vereda'>): Frontage {
  try {
    return resolve(roads, f);
  } catch (e) {
    throw new Error(`frente ${f.id}: ${(e as Error).message}`);
  }
}
