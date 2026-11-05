// La luz horneada de un interior (§2.4): adentro no pega el sol, cada punto lleva su luz en el color por vértice (o en
// el color de su instancia). Es la luz pareja del lugar (`ambient`), más la de sus lámparas, más la que entra por los
// vidrios y las puertas, menos la oclusión de los rincones (donde una cara se junta con otra). Las lámparas y las
// aberturas no iluminan detrás de una pared, un tabique o una losa (H5); el vidrio deja pasar. Solo dan al cielo los
// vidrios de las paredes de afuera y los huecos del techo (D13: el lucernario, mirando para abajo): un vidrio de adentro
// (la pared de vidrio de un vestíbulo, una mampara) no es una fuente.
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { SKY_LIGHT, SUN_DIR, SUN_LIGHT } from '../../render/sun.ts';
import { pointInPolygon, polygonArea } from '../../../shared/geo.ts';
import type { Vec2, Vec3 } from '../../../shared/geo.ts';
import { WALL_OUT } from '../../../shared/interiors/kit.ts';
import { LEVEL_H, LINTEL_MIN } from '../../../shared/interiors/openings.ts';
import type { Block, Interior } from '../../../shared/interiors/types.ts';

/**
 * La luz de las aberturas va por área (H2b): cada una es una fuente de cielo partida en celdas de a lo sumo CELL m, y
 * cada celda suma su factor de forma desde el punto (el de un disco de su área: A·cos·cos / (π·d² + A)). Lo que deja
 * pasar un vidrio es GLASS_T; una puerta, todo. La suma tiene tope (OPEN_CAP) y se escala por OPEN_GAIN: así, partir
 * una vidriera en paños no cambia la luz, y un salón con muchos paños no queda iluminado entero.
 */
const CELL = 0.5, GLASS_T = 0.8, DOOR_T = 1, OPEN_GAIN = 2, OPEN_CAP = 0.35;
/** Lado (m) de las celdas de un hueco del techo: es grande y está lejos de casi todo, alcanza con celdas más grandes. */
const SKY_CELL = 2;
/** Lo más que suman las aberturas a un punto. */
export const OPENING_MAX = OPEN_GAIN * OPEN_CAP;
/** Oclusión de rincón: lo más que oscurece, cuánto pesa cada cara vecina pegada y hasta dónde se nota (m). */
const AO = 0.35, AO_FACE = 0.6, AO_REACH = 0.9;
/** Una fuente que aporta menos que esto no se mira (ni si se ve); una que aporta menos que FEW se mira por el medio. */
const NEGLIGIBLE = 1e-4, FEW = 0.01;
/** Más lejos que FAR veces su lado mayor, una abertura se toma como un solo disco de su área en el medio (N4). */
const FAR = 2;
/** Lado (m) de la grilla en planta de los que tapan la luz. */
const GRID = 2;
/** Hasta dónde se busca lo que tapa el sol si está casi en el horizonte (m). */
const SUN_REACH = 50;
/** El segmento hasta la fuente se acorta esto (m) en cada punta: un punto sobre una cara no se tapa a sí mismo. */
const TRIM = 0.02;

/** Un prisma (planta en el mundo, alturas, caja en planta) que tapa la luz o hace rincón. `turn` es el sentido de la
 *  planta si es convexa (1 o −1), o 0 si no lo es. */
interface Prism { poly: Vec2[]; y0: number; y1: number; minX: number; maxX: number; minZ: number; maxZ: number; turn: number; stamp: number }
/** Un pedazo de una abertura: su centro y su área. */
interface Cell { at: Vec3; area: number }
/** Una abertura como fuente: sus celdas (centro y área), su normal, 3 puntos para ver si se la ve (y el del medio
 *  solo), y la abertura entera como una sola celda (`disc`) con su lado mayor, para verla de lejos. Las de las paredes
 *  alumbran a los dos lados (`twoSided`: su normal es horizontal); un hueco del techo, solo hacia donde mira su normal
 *  (abajo). */
interface Source { k: number; normal: Vec3; twoSided: boolean; cells: Cell[]; samples: Vec3[]; middle: Vec3[]; disc: Cell[]; size: number }
interface Grid { x0: number; z0: number; nx: number; nz: number; cells: Prism[][] }
/** `sun`: lo que le tapa el sol a lo de afuera: lo macizo del interior salvo las losas (van en `slabs`) y las cajas de
 *  los muebles (MODEL_BOX es gruesa: una mesa de picnic haría la sombra de un cajón), y `sunTop`, su punto más alto. */
interface Prepared { sources: Source[]; blockers: Grid; slabs: Prism[]; occluders: Prism[]; sun: Grid; sunTop: number; query: { n: number } }

/** El sentido de una planta convexa (1 o −1, el signo del giro en cada vértice), o 0 si no es convexa. */
function convexTurn(poly: Vec2[]): number {
  let turn = 0;
  for (let k = 0; k < poly.length; k++) {
    const [p, q, r] = [poly[k], poly[(k + 1) % poly.length], poly[(k + 2) % poly.length]];
    const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
    if (Math.abs(cross) < 1e-9) continue;
    if (turn === 0) turn = Math.sign(cross);
    else if (Math.sign(cross) !== turn) return 0;
  }
  return turn;
}

/** (Se exportan `prism`, `crosses`, `crossesConvex` y `hitsBox` para los tests.) */
export const prism = (poly: Vec2[], y0: number, y1: number): Prism => {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return { poly, y0, y1, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), turn: convexTurn(poly), stamp: -1 };
};

/** Una abertura rectangular vertical: medio en planta `mid`, a lo largo de `e`, de `width` m y de y0 a y1. */
function source(mid: Vec2, e: Vec2, width: number, y0: number, y1: number, k: number): Source {
  const nw = Math.max(1, Math.ceil(width / CELL - 1e-9)), nh = Math.max(1, Math.ceil((y1 - y0) / CELL - 1e-9));
  const [cw, ch] = [width / nw, (y1 - y0) / nh];
  const at = (s: number, y: number): Vec3 => [mid[0] + e[0] * s, y, mid[1] + e[1] * s];
  const cells: Source['cells'] = [];
  for (let a = 0; a < nw; a++) for (let b = 0; b < nh; b++) cells.push({ at: at(-width / 2 + (a + 0.5) * cw, y0 + (b + 0.5) * ch), area: cw * ch });
  const ym = (y0 + y1) / 2;
  const centre = at(0, ym);
  return { k, normal: [-e[1], 0, e[0]], twoSided: true, cells, samples: [at(-0.3 * width, ym), centre, at(0.3 * width, ym)], middle: [centre],
    disc: [{ at: centre, area: width * (y1 - y0) }], size: Math.max(width, y1 - y0) };
}

/** Un hueco del techo (D13) como fuente horizontal a la altura `y`, mirando para abajo: sus celdas son los pedazos del
 *  hueco en una grilla de SKY_CELL m; deja pasar GLASS_T si lo tapa un lucernario, o todo si está abierto. */
function skySource(hole: Vec2[], y: number, k: number): Source {
  const xs = hole.map((p) => p[0]), zs = hole.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const ring: polygonClipping.Polygon = [[...hole, hole[0]].map((p): [number, number] => [p[0], p[1]])];
  const cells: Cell[] = [];
  const [nx, nz] = [Math.max(1, Math.ceil((x1 - x0) / SKY_CELL - 1e-9)), Math.max(1, Math.ceil((z1 - z0) / SKY_CELL - 1e-9))];
  const [cw, cd] = [(x1 - x0) / nx, (z1 - z0) / nz];
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const [ax, az] = [x0 + a * cw, z0 + b * cd];
      const cell: [number, number][] = [[ax, az], [ax + cw, az], [ax + cw, az + cd], [ax, az + cd], [ax, az]];
      for (const pg of polygonClipping.intersection(ring, [cell])) {
        const r = pg[0].slice(0, -1).map((p): Vec2 => [p[0], p[1]]);
        const area = polygonArea(r);
        if (area < 1e-4) continue;
        const c = r.reduce<Vec2>((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length], [0, 0]);
        cells.push({ at: [c[0], y, c[1]], area });
      }
    }
  }
  const total = cells.reduce((s, c) => s + c.area, 0);
  const centre: Vec3 = [cells.reduce((s, c) => s + c.at[0] * c.area, 0) / total, y, cells.reduce((s, c) => s + c.at[2] * c.area, 0) / total];
  // las muestras de la visibilidad, en el marco del propio hueco (H5 de la tarea 7: uno angosto y girado no se sale): el
  // medio y, a lo largo de su arista más larga, a un 30 % del largo del hueco hacia cada punta; la que cae afuera, al medio
  let e: Vec2 = [1, 0], best = 0;
  hole.forEach((p, j) => {
    const q = hole[(j + 1) % hole.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l > best) [best, e] = [l, [(q[0] - p[0]) / l, (q[1] - p[1]) / l]];
  });
  const along = hole.map((p) => (p[0] - centre[0]) * e[0] + (p[1] - centre[2]) * e[1]);
  const span = 0.3 * (Math.max(...along) - Math.min(...along));
  const samples = [-span, 0, span].map((d): Vec3 => {
    const p: Vec3 = [centre[0] + e[0] * d, y, centre[2] + e[1] * d];
    return d === 0 || pointInPolygon([p[0], p[2]], hole) ? p : centre;
  });
  return { k, normal: [0, -1, 0], twoSided: false, cells, samples, middle: [centre], disc: [{ at: centre, area: total }], size: Math.max(x1 - x0, z1 - z0) };
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

/** ¿El vidrio está en una pared de afuera? Su medio en planta queda a menos de WALL_OUT de una arista de la planta (el de
 *  una abertura, a la mitad). Uno de adentro no da al cielo: la luz de la vidriera ya lo atraviesa, y contarlo como
 *  fuente la sumaría dos veces (tarea 6). */
function outerGlass(i: Interior, b: Block): boolean {
  const n = b.polygon.length;
  const c: Vec2 = [b.polygon.reduce((s, p) => s + p[0], 0) / n, b.polygon.reduce((s, p) => s + p[1], 0) / n];
  return i.footprint.some((a, k) => {
    const q = i.footprint[(k + 1) % i.footprint.length];
    const [dx, dz] = [q[0] - a[0], q[1] - a[1]];
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dz) / l2));
    return Math.hypot(c[0] - a[0] - dx * t, c[1] - a[1] - dz * t) < WALL_OUT;
  });
}

const cache = new WeakMap<Interior, Prepared>();
function prepare(i: Interior): Prepared {
  let p = cache.get(i);
  if (p) return p;
  // los huecos del techo, a la altura del techo (el tope de las losas: el bloque cerrado o el techo); los tapa un
  // lucernario si alguna de sus franjas de vidrio cae adentro
  const roof = Math.max(0, ...i.blocks.filter((b) => b.role === 'losa').map((b) => b.y1));
  const skyGlass = i.blocks.filter((b) => b.sky && b.role === 'vidrio');
  const covered = (h: Vec2[]): boolean => skyGlass.some((b) => pointInPolygon(b.polygon.reduce<Vec2>((s, q) => [s[0] + q[0] / b.polygon.length, s[1] + q[1] / b.polygon.length], [0, 0]), h));
  p = {
    sources: [
      ...i.blocks.filter((b) => b.role === 'vidrio' && !b.sky && outerGlass(i, b)).map((b) => glassSource(b.polygon, b.y0, b.y1)),
      // el hueco de la puerta, como una lámina sobre la cara de afuera
      ...i.doors.map((d) => source(d.at, [-d.normal[1], d.normal[0]], d.width, d.level * LEVEL_H, d.level * LEVEL_H + LINTEL_MIN, DOOR_T)),
      ...i.roofHoles.map((h) => skySource(h, roof, covered(h) ? GLASS_T : DOOR_T)),
    ],
    // las paredes y los tabiques van en la grilla; las losas, que ocupan toda la planta (estarían en todas las celdas), aparte
    blockers: gridOf(i.blocks.filter((b) => b.role === 'pared' || b.role === 'tabique').map((b) => prism(b.polygon, b.y0, b.y1))),
    slabs: i.blocks.filter((b) => b.role === 'losa').map((b) => prism(b.polygon, b.y0, b.y1)),
    occluders: i.blocks.filter((b) => b.role !== 'vidrio' && b.role !== 'baranda').map((b) => prism(b.polygon, b.y0, b.y1)),
    // lo que le tapa el sol a lo de afuera: lo macizo del interior y los edificios vecinos (Interior.shade)
    sun: gridOf([...i.blocks.filter((b) => b.collide === 'solid' && b.role !== 'losa' && b.role !== 'mueble').map((b) => prism(b.polygon, b.y0, b.y1)),
      ...(i.shade ?? []).map((s) => prism(s.polygon, 0, s.height))]),
    sunTop: Math.max(0, ...i.blocks.filter((b) => b.collide === 'solid' && b.role !== 'mueble').map((b) => b.y1), ...(i.shade ?? []).map((s) => s.height)),
    query: { n: 0 },
  };
  cache.set(i, p);
  return p;
}

/** ¿El segmento a → b (ya acortado) pasa por adentro del prisma? En planta se parte por los cruces con sus aristas;
 *  en cada tramo adentro se mira si la altura del segmento se mete entre y0 e y1. */
export function crosses(q: Prism, a: Vec3, b: Vec3): boolean {
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

/** `crosses` para un prisma convexo, sin armar tramos (N4): el tramo del segmento que queda adentro en planta sale de
 *  recortarlo contra cada arista (Cyrus-Beck), y en ese tramo se mira la altura. Lo que roza el borde no tapa. */
export function crossesConvex(q: Prism, a: Vec3, b: Vec3): boolean {
  const EPS = 1e-3;
  const dx = b[0] - a[0], dz = b[2] - a[2];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < q.poly.length; k++) {
    const p = q.poly[k], r = q.poly[(k + 1) % q.poly.length];
    // la normal de afuera de la arista; adentro, (x − p)·n < 0
    const nx = (r[1] - p[1]) * q.turn, nz = (r[0] - p[0]) * -q.turn;
    const num = (p[0] - a[0]) * nx + (p[1] - a[2]) * nz, den = dx * nx + dz * nz;
    if (Math.abs(den) < 1e-15) {
      if (num <= 1e-12) return false; // paralelo y afuera (o sobre la arista)
      continue;
    }
    if (den > 0) t1 = Math.min(t1, num / den);
    else t0 = Math.max(t0, num / den);
    if (t1 - t0 < 1e-9) return false;
  }
  const [ya, yb] = [a[1] + (b[1] - a[1]) * t0, a[1] + (b[1] - a[1]) * t1];
  return Math.max(ya, yb) > q.y0 + EPS && Math.min(ya, yb) < q.y1 - EPS;
}

/** ¿El segmento a → b toca la caja del prisma (con un margen)? Es el filtro grueso de `crosses` (N4): lo que no toca
 *  la caja no puede pasar por adentro del prisma, y casi nada la toca. Método de las losas (slabs), eje por eje. */
export function hitsBox(q: Prism, a: Vec3, b: Vec3): boolean {
  const M = 1e-4;
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const [lo, hi] = k === 0 ? [q.minX, q.maxX] : k === 1 ? [q.y0, q.y1] : [q.minZ, q.maxZ];
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) {
      if (a[k] < lo - M || a[k] > hi + M) return false;
      continue;
    }
    const u = (lo - M - a[k]) / d, v = (hi + M - a[k]) / d;
    t0 = Math.max(t0, Math.min(u, v));
    t1 = Math.min(t1, Math.max(u, v));
    if (t0 > t1) return false;
  }
  return true;
}

/** ¿El prisma `q` tapa el segmento a → b? Primero su caja contra la del segmento (`box`: lx, hx, ly, hy, lz, hz), después
 *  la caja contra el segmento y, si la toca, el prisma. */
const hits = (q: Prism, a: Vec3, b: Vec3, box: number[]): boolean =>
  !(box[1] < q.minX || box[0] > q.maxX || box[5] < q.minZ || box[4] > q.maxZ || box[3] <= q.y0 + 1e-3 || box[2] >= q.y1 - 1e-3) &&
  hitsBox(q, a, b) && (q.turn !== 0 ? crossesConvex(q, a, b) : crosses(q, a, b));

/** ¿Algo tapa el camino de p a c? Las losas se miran todas; lo de la grilla `g` (las paredes y los tabiques, o lo que
 *  tapa el sol), en las celdas que cruza el segmento (DDA). */
function blocked(pr: Prepared, p: Vec3, c: Vec3, g: Grid = pr.blockers): boolean {
  if (g.nx === 0 && pr.slabs.length === 0) return false;
  const len = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
  if (len < 2 * TRIM) return false;
  const k0 = TRIM / len, k1 = 1 - TRIM / len;
  const a: Vec3 = [p[0] + (c[0] - p[0]) * k0, p[1] + (c[1] - p[1]) * k0, p[2] + (c[2] - p[2]) * k0];
  const b: Vec3 = [p[0] + (c[0] - p[0]) * k1, p[1] + (c[1] - p[1]) * k1, p[2] + (c[2] - p[2]) * k1];
  const box = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[2], b[2])];
  for (const q of pr.slabs) if (hits(q, a, b, box)) return true;
  if (g.nx === 0) return false;
  const stamp = ++pr.query.n;
  // DDA en unidades de grilla
  const x = (a[0] - g.x0) / GRID, z = (a[2] - g.z0) / GRID;
  const ex = (b[0] - g.x0) / GRID, ez = (b[2] - g.z0) / GRID;
  let ix = Math.floor(x), iz = Math.floor(z);
  const jx = Math.floor(ex), jz = Math.floor(ez);
  const dx = ex - x, dz = ez - z;
  const sx = Math.sign(dx), sz = Math.sign(dz);
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity, tdz = sz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tx = sx > 0 ? (ix + 1 - x) * tdx : sx < 0 ? (x - ix) * tdx : Infinity;
  let tz = sz > 0 ? (iz + 1 - z) * tdz : sz < 0 ? (z - iz) * tdz : Infinity;
  for (;;) {
    if (ix >= 0 && ix < g.nx && iz >= 0 && iz < g.nz) {
      for (const q of g.cells[ix + iz * g.nx]) {
        if (q.stamp === stamp) continue;
        q.stamp = stamp;
        if (hits(q, a, b, box)) return true;
      }
    }
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
  const [dx, dy, dz] = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return l < 1e-6 ? 1 : 0.5 + 0.5 * ((dx * n[0] + dy * n[1] + dz * n[2]) / l);
}

/** ¿El prisma se levanta delante de la cara (normal `n`, en `p`)? Una pared vecina en el mismo plano no. */
function rises(q: Prism, p: Vec3, n: Vec3): boolean {
  const h = Math.max(...q.poly.map((v) => (v[0] - p[0]) * n[0] + (v[1] - p[2]) * n[2]));
  return h + Math.max((q.y0 - p[1]) * n[1], (q.y1 - p[1]) * n[1]) > 0.01;
}

/** El factor de forma de una abertura desde `p` (cara de normal `n`): la suma de sus celdas; de lejos (más de FAR veces
 *  su lado mayor), la de un solo disco con toda su área en el medio (N4). */
function formFactor(s: Source, p: Vec3, n: Vec3): number {
  const m = s.disc[0].at;
  const [mx, my, mz] = [m[0] - p[0], m[1] - p[1], m[2] - p[2]];
  const cells = mx * mx + my * my + mz * mz > (FAR * s.size) ** 2 ? s.disc : s.cells;
  let f = 0;
  for (const c of cells) {
    const [dx, dy, dz] = [c.at[0] - p[0], c.at[1] - p[1], c.at[2] - p[2]];
    const d2 = dx * dx + dy * dy + dz * dz;
    const l = Math.sqrt(d2);
    if (l < 1e-6) continue;
    const along = (dx * s.normal[0] + dy * s.normal[1] + dz * s.normal[2]) / l;
    // la luz sale de la celda hacia el punto (−d): de un hueco del techo, solo hacia donde mira su normal
    const cosS = s.twoSided ? Math.abs(along) : Math.max(0, -along);
    const face = 0.5 + 0.5 * ((dx * n[0] + dy * n[1] + dz * n[2]) / l); // facing(p, c.at, n), sin volver a medir
    f += (c.area * face * cosS) / (Math.PI * d2 + c.area);
  }
  return f;
}

/** Un color de la escena por su intensidad, lineal, canal por canal. */
const rgb = (hex: number, k: number): Vec3 => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};
const SUN_K = rgb(SUN_LIGHT.color, SUN_LIGHT.intensity), SKY_K = rgb(SKY_LIGHT.sky, SKY_LIGHT.intensity), GROUND_K = rgb(SKY_LIGHT.ground, SKY_LIGHT.intensity);
const luminance = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** La luz al aire libre en una cara de normal `n` (unitaria), canal por canal (lineal): la que le da la escena a un
 *  Lambert (el sol por el coseno y el cielo de la HemisphereLight, sobre π), con el tono cálido del sol y el azulado
 *  del cielo; `sun` false, a la sombra (solo el cielo). Va en vez de la horneada en lo que el interior tiene afuera
 *  (outdoors): así una terraza o un patio se ven como lo de alrededor, con la exposición de la calle. */
export function outdoorRGB(n: Vec3, sun = true): Vec3 {
  const k = sun ? Math.max(0, n[0] * SUN_DIR.x + n[1] * SUN_DIR.y + n[2] * SUN_DIR.z) : 0;
  const w = 0.5 * n[1] + 0.5;
  return [0, 1, 2].map((c) => (SUN_K[c] * k + GROUND_K[c] + (SKY_K[c] - GROUND_K[c]) * w) / Math.PI) as Vec3;
}

/** Lo mismo en luminancia. */
export const outdoorLight = (n: Vec3, sun = true): number => luminance(outdoorRGB(n, sun));

/** outdoorRGB en el punto `p`, con la sombra de lo macizo del propio interior y de los edificios vecinos
 *  (Interior.shade): sin el sol si algo se lo tapa (hacia SUN_DIR, hasta pasar lo más alto). La de los muebles no está. */
export function outdoorRGBAt(i: Interior, p: Vec3, n: Vec3): Vec3 {
  if (n[0] * SUN_DIR.x + n[1] * SUN_DIR.y + n[2] * SUN_DIR.z <= 0) return outdoorRGB(n);
  const pr = prepare(i);
  const reach = SUN_DIR.y > 0.05 ? Math.max(0, pr.sunTop - p[1]) / SUN_DIR.y + 0.1 : SUN_REACH;
  const c: Vec3 = [p[0] + SUN_DIR.x * reach, p[1] + SUN_DIR.y * reach, p[2] + SUN_DIR.z * reach];
  return outdoorRGB(n, !blocked(pr, p, c, pr.sun));
}

/** Lo mismo en luminancia. */
export const outdoorLightAt = (i: Interior, p: Vec3, n: Vec3): number => luminance(outdoorRGBAt(i, p, n));

/** ¿El punto está al aire libre? Fuera de la planta (un patio, la vereda) o, con terraza, sobre el techo. */
export function outdoors(i: Interior, p: Vec3): boolean {
  if (!pointInPolygon([p[0], p[2]], i.footprint)) return true;
  if (!i.terrace) return false;
  const roof = i.floors.find((f) => f.level === i.publicFloors);
  return roof !== undefined && p[1] >= roof.y - 0.01;
}

/** La luz (de 0 a 1) en el punto `p` de una cara de normal `n` (unitaria). */
export function lightAt(i: Interior, p: Vec3, n: Vec3): number {
  const pr = prepare(i);
  let light = i.ambient;
  for (const l of i.lamps) {
    if (l.down && p[1] > l.at[1]) continue; // la de un panel embutido no le llega a su cielorraso
    const d = Math.hypot(l.at[0] - p[0], l.at[1] - p[1], l.at[2] - p[2]);
    if (d < l.radius && !blocked(pr, p, l.at)) light += l.power * (1 - d / l.radius) ** 2 * facing(p, l.at, n);
  }
  // de la que más aporta a la que menos; pasado el tope, las que faltan no cambian nada
  const lit = pr.sources.map((s) => ({ s, f: s.k * formFactor(s, p, n) })).filter((x) => x.f >= NEGLIGIBLE).sort((x, y) => y.f - x.f);
  let sky = 0;
  for (const { s, f } of lit) {
    if (sky >= OPEN_CAP) break;
    // de lejos (lo que aporta poco) alcanza con el medio; de cerca, las tres muestras ven los marcos
    const samples = f < FEW ? s.middle : s.samples;
    let seen = 0;
    for (const c of samples) if (!blocked(pr, p, c)) seen++;
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
