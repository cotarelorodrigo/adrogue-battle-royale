// La luz horneada de un interior (§2.4): adentro no pega el sol, cada punto lleva su luz en el color por vértice (o en
// el color de su instancia). Es la luz pareja del lugar (`ambient`), más la de sus lámparas, más la que entra por los
// vidrios y las puertas, menos la oclusión de los rincones (donde una cara se junta con otra). Las lámparas y las
// aberturas no iluminan detrás de una pared, un tabique o una losa (H5); el vidrio deja pasar.
import { pointInPolygon } from '../../../shared/geo.ts';
import type { Vec2, Vec3 } from '../../../shared/geo.ts';
import { LEVEL_H, LINTEL_MIN } from '../../../shared/interiors/openings.ts';
import type { Interior } from '../../../shared/interiors/types.ts';

/**
 * La luz de las aberturas va por área (H2b): cada una es una fuente de cielo partida en celdas de a lo sumo CELL m, y
 * cada celda suma su factor de forma desde el punto (el de un disco de su área: A·cos·cos / (π·d² + A)). Lo que deja
 * pasar un vidrio es GLASS_T; una puerta, todo. La suma tiene tope (OPEN_CAP) y se escala por OPEN_GAIN: así, partir
 * una vidriera en paños no cambia la luz, y un salón con muchos paños no queda iluminado entero.
 */
const CELL = 0.5, GLASS_T = 0.8, DOOR_T = 1, OPEN_GAIN = 2, OPEN_CAP = 0.35;
/** Lo más que suman las aberturas a un punto. */
export const OPENING_MAX = OPEN_GAIN * OPEN_CAP;
/** Oclusión de rincón: lo más que oscurece, cuánto pesa cada cara vecina pegada y hasta dónde se nota (m). */
const AO = 0.35, AO_FACE = 0.6, AO_REACH = 0.9;
/** Una fuente que aporta menos que esto no se mira (ni si se ve); una que aporta menos que FEW se mira por el medio. */
const NEGLIGIBLE = 1e-4, FEW = 0.01;
/** Lado (m) de la grilla en planta de los que tapan la luz. */
const GRID = 2;
/** El segmento hasta la fuente se acorta esto (m) en cada punta: un punto sobre una cara no se tapa a sí mismo. */
const TRIM = 0.02;

/** Un prisma (planta en el mundo, alturas, caja en planta) que tapa la luz o hace rincón. */
interface Prism { poly: Vec2[]; y0: number; y1: number; minX: number; maxX: number; minZ: number; maxZ: number; stamp: number }
/** Una abertura como fuente: sus celdas (centro y área), su normal en planta, 3 puntos para ver si se la ve y su caja. */
interface Source { k: number; normal: Vec2; cells: { at: Vec3; area: number }[]; samples: Vec3[] }
interface Grid { x0: number; z0: number; nx: number; nz: number; cells: Prism[][] }
interface Prepared { sources: Source[]; blockers: Grid; occluders: Prism[]; query: { n: number } }

const prism = (poly: Vec2[], y0: number, y1: number): Prism => {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return { poly, y0, y1, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), stamp: -1 };
};

/** Una abertura rectangular vertical: medio en planta `mid`, a lo largo de `e`, de `width` m y de y0 a y1. */
function source(mid: Vec2, e: Vec2, width: number, y0: number, y1: number, k: number): Source {
  const nw = Math.max(1, Math.ceil(width / CELL - 1e-9)), nh = Math.max(1, Math.ceil((y1 - y0) / CELL - 1e-9));
  const [cw, ch] = [width / nw, (y1 - y0) / nh];
  const at = (s: number, y: number): Vec3 => [mid[0] + e[0] * s, y, mid[1] + e[1] * s];
  const cells: Source['cells'] = [];
  for (let a = 0; a < nw; a++) for (let b = 0; b < nh; b++) cells.push({ at: at(-width / 2 + (a + 0.5) * cw, y0 + (b + 0.5) * ch), area: cw * ch });
  const ym = (y0 + y1) / 2;
  return { k, normal: [-e[1], e[0]], cells, samples: [at(-0.3 * width, ym), at(0, ym), at(0.3 * width, ym)] };
}

/** Un vidrio: el paño va a lo largo de su arista más larga, por el medio del bloque. */
function glassSource(poly: Vec2[], y0: number, y1: number): Source {
  let best = 0, len = 0;
  poly.forEach((p, k) => {
    const q = poly[(k + 1) % poly.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l > len) [best, len] = [k, l];
  });
  const [p, q] = [poly[best], poly[(best + 1) % poly.length]];
  const e: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  const c = poly.reduce<Vec2>((s, v) => [s[0] + v[0] / poly.length, s[1] + v[1] / poly.length], [0, 0]);
  return source(c, e, len, y0, y1, GLASS_T);
}

function gridOf(prisms: Prism[]): Grid {
  if (prisms.length === 0) return { x0: 0, z0: 0, nx: 0, nz: 0, cells: [] };
  const x0 = Math.min(...prisms.map((q) => q.minX)), z0 = Math.min(...prisms.map((q) => q.minZ));
  const nx = Math.max(1, Math.ceil((Math.max(...prisms.map((q) => q.maxX)) - x0) / GRID + 1e-9));
  const nz = Math.max(1, Math.ceil((Math.max(...prisms.map((q) => q.maxZ)) - z0) / GRID + 1e-9));
  const cells: Prism[][] = Array.from({ length: nx * nz }, () => []);
  const clampX = (v: number): number => Math.min(nx - 1, Math.max(0, Math.floor((v - x0) / GRID)));
  const clampZ = (v: number): number => Math.min(nz - 1, Math.max(0, Math.floor((v - z0) / GRID)));
  for (const q of prisms) {
    for (let ix = clampX(q.minX - 1e-3); ix <= clampX(q.maxX + 1e-3); ix++) {
      for (let iz = clampZ(q.minZ - 1e-3); iz <= clampZ(q.maxZ + 1e-3); iz++) cells[ix + iz * nx].push(q);
    }
  }
  return { x0, z0, nx, nz, cells };
}

const cache = new WeakMap<Interior, Prepared>();
function prepare(i: Interior): Prepared {
  let p = cache.get(i);
  if (p) return p;
  p = {
    sources: [
      ...i.blocks.filter((b) => b.role === 'vidrio').map((b) => glassSource(b.polygon, b.y0, b.y1)),
      // el hueco de la puerta, como una lámina sobre la cara de afuera
      ...i.doors.map((d) => source(d.at, [-d.normal[1], d.normal[0]], d.width, d.level * LEVEL_H, d.level * LEVEL_H + LINTEL_MIN, DOOR_T)),
    ],
    blockers: gridOf(i.blocks.filter((b) => b.role === 'pared' || b.role === 'tabique' || b.role === 'losa').map((b) => prism(b.polygon, b.y0, b.y1))),
    occluders: i.blocks.filter((b) => b.role !== 'vidrio' && b.role !== 'baranda').map((b) => prism(b.polygon, b.y0, b.y1)),
    query: { n: 0 },
  };
  cache.set(i, p);
  return p;
}

/** ¿El segmento a → b (ya acortado) pasa por adentro del prisma? En planta se parte por los cruces con sus aristas;
 *  en cada tramo adentro se mira si la altura del segmento se mete entre y0 e y1. */
function crosses(q: Prism, a: Vec3, b: Vec3): boolean {
  const EPS = 1e-3;
  const [dx, dz] = [b[0] - a[0], b[2] - a[2]];
  const yAt = (t: number): number => a[1] + (b[1] - a[1]) * t;
  const overlaps = (ta: number, tb: number): boolean => {
    const [lo, hi] = [Math.min(yAt(ta), yAt(tb)), Math.max(yAt(ta), yAt(tb))];
    return hi > q.y0 + EPS && lo < q.y1 - EPS;
  };
  if (Math.hypot(dx, dz) < 1e-6) return pointInPolygon([a[0], a[2]], q.poly) && overlaps(0, 1);
  const ts = [0, 1];
  for (let k = 0; k < q.poly.length; k++) {
    const [p, r] = [q.poly[k], q.poly[(k + 1) % q.poly.length]];
    const [ex, ez] = [r[0] - p[0], r[1] - p[1]];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - a[0]) * ez - (p[1] - a[2]) * ex) / den;
    const u = ((p[0] - a[0]) * dz - (p[1] - a[2]) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  for (let k = 0; k + 1 < ts.length; k++) {
    const [ta, tb] = [ts[k], ts[k + 1]];
    if (tb - ta < 1e-9) continue;
    const tm = (ta + tb) / 2;
    if (pointInPolygon([a[0] + dx * tm, a[2] + dz * tm], q.poly) && overlaps(ta, tb)) return true;
  }
  return false;
}

/** ¿Algo de `g` tapa el camino de p a c? Se recorren las celdas de la grilla que cruza el segmento (DDA). */
function blocked(pr: Prepared, p: Vec3, c: Vec3): boolean {
  const g = pr.blockers;
  if (g.nx === 0) return false;
  const len = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
  if (len < 2 * TRIM) return false;
  const k0 = TRIM / len, k1 = 1 - TRIM / len;
  const a: Vec3 = [p[0] + (c[0] - p[0]) * k0, p[1] + (c[1] - p[1]) * k0, p[2] + (c[2] - p[2]) * k0];
  const b: Vec3 = [p[0] + (c[0] - p[0]) * k1, p[1] + (c[1] - p[1]) * k1, p[2] + (c[2] - p[2]) * k1];
  const stamp = ++pr.query.n;
  // la caja del segmento: lo que no la toca (en planta o en altura) no hace falta mirarlo de cerca
  const [lx, hx, ly, hy, lz, hz] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[2], b[2])];
  const test = (cell: Prism[]): boolean => cell.some((q) => {
    if (q.stamp === stamp) return false;
    q.stamp = stamp;
    if (hx < q.minX || lx > q.maxX || hz < q.minZ || lz > q.maxZ || hy <= q.y0 + 1e-3 || ly >= q.y1 - 1e-3) return false;
    return crosses(q, a, b);
  });
  // DDA en unidades de grilla
  const [x, z] = [(a[0] - g.x0) / GRID, (a[2] - g.z0) / GRID];
  const [ex, ez] = [(b[0] - g.x0) / GRID, (b[2] - g.z0) / GRID];
  let [ix, iz] = [Math.floor(x), Math.floor(z)];
  const [jx, jz] = [Math.floor(ex), Math.floor(ez)];
  const [dx, dz] = [ex - x, ez - z];
  const [sx, sz] = [Math.sign(dx), Math.sign(dz)];
  const [tdx, tdz] = [sx !== 0 ? Math.abs(1 / dx) : Infinity, sz !== 0 ? Math.abs(1 / dz) : Infinity];
  let tx = sx > 0 ? (ix + 1 - x) * tdx : sx < 0 ? (x - ix) * tdx : Infinity;
  let tz = sz > 0 ? (iz + 1 - z) * tdz : sz < 0 ? (z - iz) * tdz : Infinity;
  for (;;) {
    if (ix >= 0 && ix < g.nx && iz >= 0 && iz < g.nz && test(g.cells[ix + iz * g.nx])) return true;
    if ((ix === jx && iz === jz) || Math.min(tx, tz) > 1) return false;
    if (tx < tz) {
      ix += sx;
      tx += tdx;
    } else {
      iz += sz;
      tz += tdz;
    }
  }
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

/** El factor de forma de una abertura desde `p` (cara de normal `n`): la suma de sus celdas. */
function formFactor(s: Source, p: Vec3, n: Vec3): number {
  let f = 0;
  for (const c of s.cells) {
    const d: Vec3 = [c.at[0] - p[0], c.at[1] - p[1], c.at[2] - p[2]];
    const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const l = Math.sqrt(d2);
    if (l < 1e-6) continue;
    const cosS = Math.abs((d[0] * s.normal[0] + d[2] * s.normal[1]) / l);
    f += (c.area * facing(p, c.at, n) * cosS) / (Math.PI * d2 + c.area);
  }
  return f;
}

/** La luz (de 0 a 1) en el punto `p` de una cara de normal `n` (unitaria). */
export function lightAt(i: Interior, p: Vec3, n: Vec3): number {
  const pr = prepare(i);
  let light = i.ambient;
  for (const l of i.lamps) {
    const d = Math.hypot(l.at[0] - p[0], l.at[1] - p[1], l.at[2] - p[2]);
    if (d < l.radius && !blocked(pr, p, l.at)) light += l.power * (1 - d / l.radius) ** 2 * facing(p, l.at, n);
  }
  // de la que más aporta a la que menos; pasado el tope, las que faltan no cambian nada
  const lit = pr.sources.map((s) => ({ s, f: s.k * formFactor(s, p, n) })).filter((x) => x.f >= NEGLIGIBLE).sort((x, y) => y.f - x.f);
  let sky = 0;
  for (const { s, f } of lit) {
    if (sky >= OPEN_CAP) break;
    // de lejos (lo que aporta poco) alcanza con el medio; de cerca, las tres muestras ven los marcos
    const samples = f < FEW ? [s.samples[1]] : s.samples;
    const seen = samples.filter((c) => !blocked(pr, p, c)).length;
    sky += (f * seen) / samples.length;
  }
  light += OPEN_GAIN * Math.min(OPEN_CAP, sky);
  let open = 1;
  for (const q of pr.occluders) {
    if (far(q, p, AO_REACH) || !rises(q, p, n)) continue;
    const c = closest(q, p);
    const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
    if (d < AO_REACH) open *= 1 - AO_FACE * (1 - d / AO_REACH);
  }
  return Math.min(1, Math.max(0, light - AO * (1 - open)));
}
