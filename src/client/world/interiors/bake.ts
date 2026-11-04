// La luz horneada de un interior (§2.4): adentro no pega el sol, cada punto lleva su luz en el color por vértice (o en
// el color de su instancia). Es la luz pareja del lugar (`ambient`), más la de sus lámparas, más la que entra por los
// vidrios y las puertas (más cerca, más), menos la oclusión de los rincones (donde una cara se junta con otra).
import { pointInPolygon } from '../../../shared/geo.ts';
import type { Vec2, Vec3 } from '../../../shared/geo.ts';
import { LEVEL_H, LINTEL_MIN } from '../../../shared/interiors/openings.ts';
import type { Interior } from '../../../shared/interiors/types.ts';

/** Lo que entra por un vidrio y por una puerta pegados al punto, y la distancia (m) a la que cae a la mitad. Varias
 *  aberturas se suman sin pasar de 1 (cada una aclara lo que dejaron oscuro las otras). */
const WINDOW = 0.45, DOOR = 0.35, OPENING_HALF = 2.5;
/** Oclusión de rincón: lo más que oscurece, cuánto pesa cada cara vecina pegada y hasta dónde se nota (m). */
const AO = 0.35, AO_FACE = 0.6, AO_REACH = 0.9;

/** Un prisma como fuente u oclusor: planta (mundo), alturas y caja en planta. */
interface Prism { poly: Vec2[]; y0: number; y1: number; minX: number; maxX: number; minZ: number; maxZ: number }
interface Prepared { glass: Prism[]; doors: Prism[]; occluders: Prism[] }

const prism = (poly: Vec2[], y0: number, y1: number): Prism => {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return { poly, y0, y1, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
};

const cache = new WeakMap<Interior, Prepared>();
function prepare(i: Interior): Prepared {
  let p = cache.get(i);
  if (p) return p;
  p = {
    glass: i.blocks.filter((b) => b.role === 'vidrio').map((b) => prism(b.polygon, b.y0, b.y1)),
    // el hueco de la puerta, como una lámina sobre la cara de afuera
    doors: i.doors.map((d) => {
      const t: Vec2 = [-d.normal[1] * (d.width / 2), d.normal[0] * (d.width / 2)];
      const y0 = d.level * LEVEL_H;
      return prism([[d.at[0] - t[0], d.at[1] - t[1]], [d.at[0] + t[0], d.at[1] + t[1]]], y0, y0 + LINTEL_MIN);
    }),
    occluders: i.blocks.filter((b) => b.role !== 'vidrio' && b.role !== 'baranda').map((b) => prism(b.polygon, b.y0, b.y1)),
  };
  cache.set(i, p);
  return p;
}

/** El punto del prisma más cercano a `p`. */
function closest(q: Prism, p: Vec3): Vec3 {
  const y = Math.min(q.y1, Math.max(q.y0, p[1]));
  const xz: Vec2 = [p[0], p[2]];
  if (q.poly.length >= 3 && pointInPolygon(xz, q.poly)) return [p[0], y, p[2]];
  let best: Vec2 = q.poly[0], bd = Infinity;
  for (let k = 0; k < q.poly.length; k++) {
    const a = q.poly[k], b = q.poly[(k + 1) % q.poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((xz[0] - a[0]) * dx + (xz[1] - a[1]) * dz) / l2));
    const c: Vec2 = [a[0] + dx * t, a[1] + dz * t];
    const d = (c[0] - xz[0]) ** 2 + (c[1] - xz[1]) ** 2;
    if (d < bd) [best, bd] = [c, d];
  }
  return [best[0], y, best[1]];
}

/** Lejos de la caja en planta más que `r`: no hace falta mirarlo. */
const far = (q: Prism, p: Vec3, r: number): boolean =>
  p[0] < q.minX - r || p[0] > q.maxX + r || p[2] < q.minZ - r || p[2] > q.maxZ + r || p[1] < q.y0 - r || p[1] > q.y1 + r;

/** Lo que la luz que viene de `c` le llega a una cara de normal `n` en `p`: de frente, toda; de canto, la mitad. */
function facing(p: Vec3, c: Vec3, n: Vec3): number {
  const d: Vec3 = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
  const l = Math.hypot(...d);
  return l < 1e-6 ? 1 : 0.5 + 0.5 * ((d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) / l);
}

/** ¿El prisma se levanta delante de la cara (normal `n`, en `p`)? Una pared vecina en el mismo plano no. */
function rises(q: Prism, p: Vec3, n: Vec3): boolean {
  const h = Math.max(...q.poly.map((v) => (v[0] - p[0]) * n[0] + (v[1] - p[2]) * n[2]));
  return h + Math.max((q.y0 - p[1]) * n[1], (q.y1 - p[1]) * n[1]) > 0.01;
}

/** La luz (de 0 a 1) en el punto `p` de una cara de normal `n` (unitaria). */
export function lightAt(i: Interior, p: Vec3, n: Vec3): number {
  const { glass, doors, occluders } = prepare(i);
  let light = i.ambient;
  for (const l of i.lamps) {
    const d = Math.hypot(l.at[0] - p[0], l.at[1] - p[1], l.at[2] - p[2]);
    if (d < l.radius) light += l.power * (1 - d / l.radius) ** 2 * facing(p, l.at, n);
  }
  let dark = 1;
  for (const [list, k] of [[glass, WINDOW], [doors, DOOR]] as const) {
    for (const q of list) {
      const c = closest(q, p);
      const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
      dark *= 1 - (k * facing(p, c, n)) / (1 + (d / OPENING_HALF) ** 2);
    }
  }
  light += 1 - dark;
  let open = 1;
  for (const q of occluders) {
    if (far(q, p, AO_REACH) || !rises(q, p, n)) continue;
    const c = closest(q, p);
    const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
    if (d < AO_REACH) open *= 1 - AO_FACE * (1 - d / AO_REACH);
  }
  return Math.min(1, Math.max(0, light - AO * (1 - open)));
}
