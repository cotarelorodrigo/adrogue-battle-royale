// Las juntas de las caras de costado de un interior (T11c, ítem 4): lo que tapa cada cara, cuánto se mete en lo opaco que
// la corta o se le apoya (JOINT) y sus pedazos: cada cara en la grilla de su horneado y, en las aristas de cada pedazo,
// los vértices de las otras caras de su plano que caen en ellas, así ningún vértice de una queda en medio de una arista
// de otra (sin juntas en T). Lo usa build.ts.
import { pointInPolygon, signedAreaFromAbove } from '../../../shared/geo.ts';
import type { Vec2, Vec3 } from '../../../shared/geo.ts';
import type { Block, Interior, Look } from '../../../shared/interiors/types.ts';
import { cutRect, marked } from '../wall-kit.ts';
import type { FlatMesh, Rect } from '../wall-kit.ts';

/** Lo que una cara de costado se mete (m) en lo opaco que la corta o la tapa (una losa, un techo, un dintel, un tabique):
 *  la junta queda detrás de la cara de enfrente y no se abre en el rasterizado (T5 M1, T9 H5). */
const JOINT = 0.015;
const EPS = 1e-6;

const unit = (x: number, z: number): Vec2 => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

/** Un bloque opaco tapa lo que se le pega: todo lo dibujado que no es vidrio (ni la caja invisible de un mueble). */
const opaque = (b: Block): boolean => {
  const l = b.side ?? b.top ?? b.bottom;
  return b.role !== 'mueble' && l !== undefined && l.mat !== 'vidrio';
};

/** Lo tapado de la cara de la arista p → q de un bloque (de y0 a y1): las caras de los opacos pegadas a ella (en la
 *  misma recta, recorridas al revés), como rectángulos en metros desde p. Cada uno se achica JOINT de los lados que caen
 *  adentro de la cara: la cara se mete detrás de lo que la tapa. */
function covered(p: Vec2, q: Vec2, y0: number, y1: number, others: Block[]): Rect[] {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const e = unit(q[0] - p[0], q[1] - p[1]);
  const across = (r: Vec2): number => (r[0] - p[0]) * e[1] - (r[1] - p[1]) * e[0];
  const along = (r: Vec2): number => (r[0] - p[0]) * e[0] + (r[1] - p[1]) * e[1];
  const out: Rect[] = [];
  for (const o of others) {
    const [lo, hi] = [Math.max(y0, o.y0), Math.min(y1, o.y1)];
    if (hi - lo < EPS) continue;
    o.polygon.forEach((r, k) => {
      const s = o.polygon[(k + 1) % o.polygon.length];
      if (Math.abs(across(r)) > 1e-4 || Math.abs(across(s)) > 1e-4 || along(s) >= along(r)) return;
      const [s0, s1] = [Math.max(0, along(s)), Math.min(len, along(r))];
      if (s1 - s0 <= EPS) return;
      const shrink = (v: number, edge: number, d: number): number => (Math.abs(v - edge) < EPS ? v : v + d);
      const h = { s0: shrink(s0, 0, JOINT), s1: shrink(s1, len, -JOINT), y0: shrink(lo, y0, JOINT), y1: shrink(hi, y1, -JOINT) };
      if (h.s1 - h.s0 > EPS && h.y1 - h.y0 > EPS) out.push(h);
    });
  }
  return out;
}

/** Cuánto se estira hacia abajo y hacia arriba la cara de la arista p → q (normal `n`, afuera) de `b`: JOINT si su borde
 *  da contra un opaco que empieza (o termina) a esa altura, de cualquiera de los dos lados de la cara: una losa sobre un
 *  tabique, un tabique del primer piso en su losa, el último escalón contra el borde del descanso. */
function stretch(b: Block, p: Vec2, q: Vec2, n: Vec3, others: Block[]): [number, number] {
  // unos puntos a lo largo de la cara, 2 cm de cada lado: con que uno caiga bajo (o sobre) el opaco, se estira toda
  const ms = [0.02, 0.25, 0.5, 0.75, 0.98].flatMap((f) => [-0.02, 0.02].map((o): Vec2 => [p[0] + (q[0] - p[0]) * f + n[0] * o, p[1] + (q[1] - p[1]) * f + n[2] * o]));
  const on = (y: number, top: boolean): boolean => others.some((o) => Math.abs((top ? o.y0 : o.y1) - y) < 1e-4 && ms.some((m) => pointInPolygon(m, o.polygon)));
  return [on(b.y0, false) ? JOINT : 0, on(b.y1, true) ? JOINT : 0];
}

/** Las caras de costado de un mismo plano (la misma normal, a menos de 2·10⁻³ rad, y a menos de 5 mm), juntas. */
class Planes<T extends { normal: Vec3; d: number }> {
  readonly all: T[][] = [];
  add(f: T): void {
    const same = this.all.find((g) => 1 - (g[0].normal[0] * f.normal[0] + g[0].normal[2] * f.normal[2]) < 2e-6 && Math.abs(g[0].d - f.d) < 0.005);
    if (same) same.push(f);
    else this.all.push([f]);
  }
}

/** Una cara de costado de un bloque: su arista (p, dirección e, normal afuera), t0 = p · e, lo que se dibuja de ella
 *  (rectángulos en t, a lo largo de la recta, y en alto) y sus pedazos (`pieces`, en (t, y)). */
export interface SideFace { look: Look; p: Vec2; e: Vec2; t0: number; normal: Vec3; d: number; rects: Rect[]; pieces: FlatMesh[] }

/** De a a b en partes iguales de a lo sumo `step` (el horneado; sin paso, entero). */
const even = (a: number, b: number, step: number): number[] => {
  const n = Number.isFinite(step) ? Math.max(1, Math.ceil((b - a) / step - 1e-9)) : 1;
  return Array.from({ length: n + 1 }, (_, k) => (k === n ? b : a + ((b - a) * k) / n));
};

/** Un rectángulo en su grilla del horneado: las rectas a lo largo (`s`) y en alto (`y`), sus puntas incluidas. */
interface Grid { r: Rect; s: number[]; y: number[] }

/** Los pedazos de los rectángulos de un grupo de un plano (los que se tocan), cada uno en su grilla: cada celda con los
 *  vértices de las grillas de los otros que caen en sus aristas (M2 de la revisión de la T11c, también adentro: antes,
 *  todas en las rectas de todo el grupo). En una arista compartida, cada lado tiene así los mismos vértices: los de
 *  todas las grillas que caen en ella. */
function groupPieces(grids: readonly Grid[]): FlatMesh[][] {
  // a 0,1 mm, la misma recta: `covered` deja a veces una tira de 2·10⁻⁵ m entre dos pedazos (las dos rectas de sus lados
  // son, para el rasterizado, una)
  const TOL = 1e-4;
  const has = (xs: readonly number[], v: number): boolean => xs.some((x) => Math.abs(x - v) < TOL);
  return grids.map((g) => {
    // las grillas de los otros que llegan a tocar esta
    const others = grids.filter((o) => o !== g && o.r.s0 <= g.r.s1 + TOL && g.r.s0 <= o.r.s1 + TOL && o.r.y0 <= g.r.y1 + TOL && g.r.y0 <= o.r.y1 + TOL);
    // en la recta horizontal y (o la vertical s), los vértices de los otros
    const along = (y: number): number[] => others.filter((o) => has(o.y, y)).flatMap((o) => o.s);
    const high = (s: number): number[] => others.filter((o) => has(o.s, s)).flatMap((o) => o.y);
    const out: FlatMesh[] = [];
    for (let a = 0; a + 1 < g.s.length; a++) {
      for (let c = 0; c + 1 < g.y.length; c++) {
        const cell: Rect = { s0: g.s[a], s1: g.s[a + 1], y0: g.y[c], y1: g.y[c + 1] };
        out.push(marked(cell, { bottom: along(cell.y0), top: along(cell.y1), left: high(cell.s0), right: high(cell.s1) }));
      }
    }
    return out;
  });
}

/** Las caras de costado de los bloques (ni `out` ni sin `side`) de todo el interior (las dos partes: un muro del patio
 *  sigue en el plano de una pared del local): sin lo que les tapan otros opacos, metidas JOINT en lo que las corta o se
 *  les apoya, y en pedazos de a lo sumo `bakeStep` (lo que brilla y el vidrio, enteros) sin juntas en T con las otras
 *  caras de su plano. */
export function sideFaces(i: Interior, bakeStep: number): Map<Block, SideFace[]> {
  const boxOf = (b: Block): [number, number, number, number] => {
    const xs = b.polygon.map((p) => p[0]), zs = b.polygon.map((p) => p[1]);
    return [Math.min(...xs) - 1e-3, Math.max(...xs) + 1e-3, Math.min(...zs) - 1e-3, Math.max(...zs) + 1e-3];
  };
  const occluders = i.blocks.filter(opaque).map((b) => ({ b, box: boxOf(b) }));
  const planes = new Planes<SideFace>();
  const out = new Map<Block, SideFace[]>();
  for (const b of i.blocks) {
    if (b.out || !b.side) continue;
    // las caras van hacia afuera de la planta antihoraria; `hide` cuenta las aristas del polígono guardado
    const flipped = signedAreaFromAbove(b.polygon) < 0;
    const poly = flipped ? [...b.polygon].reverse() : b.polygon, n = poly.length;
    const hidden = new Set(b.hide ?? []);
    const [x0, x1, z0, z1] = boxOf(b);
    const near = occluders.filter(({ b: o, box: [ox0, ox1, oz0, oz1] }) => o !== b && ox0 <= x1 && ox1 >= x0 && oz0 <= z1 && oz1 >= z0).map((o) => o.b);
    const faces: SideFace[] = [];
    for (let k = 0; k < n; k++) {
      if (hidden.has(flipped ? (2 * n - 2 - k) % n : k)) continue;
      const [p, q] = [poly[k], poly[(k + 1) % poly.length]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < EPS) continue;
      const e = unit(q[0] - p[0], q[1] - p[1]);
      const normal: Vec3 = [-e[1], 0, e[0]];
      const [down, up] = opaque(b) ? stretch(b, p, q, normal, near) : [0, 0];
      // en la recta de la cara, t = (x, z) · e: las caras de un mismo plano comparten las marcas de t
      const t0 = p[0] * e[0] + p[1] * e[1];
      const rects = cutRect({ s0: 0, s1: len, y0: b.y0 - down, y1: b.y1 + up }, covered(p, q, b.y0, b.y1, near)).solid
        .map((r): Rect => ({ ...r, s0: r.s0 + t0, s1: r.s1 + t0 }));
      // el vidrio va entero, sin las marcas de nadie: una junta abierta en un vidrio deja ver lo mismo que el vidrio
      const f: SideFace = { look: b.side, p, e, t0, normal, d: p[0] * normal[0] + p[1] * normal[2], rects, pieces: rects.map((r) => marked(r, {})) };
      if (b.side.mat !== 'vidrio') planes.add(f);
      faces.push(f);
    }
    out.set(b, faces);
  }
  // en cada plano, las caras que se tocan (o se pisan) van en un grupo: sus pedazos, sin juntas en T entre ellos
  for (const faces of planes.all) {
    const root = faces.map((_, k) => k);
    const find = (k: number): number => (root[k] === k ? k : (root[k] = find(root[k])));
    const touch = (a: Rect, b: Rect): boolean => a.s0 <= b.s1 + 1e-6 && b.s0 <= a.s1 + 1e-6 && a.y0 <= b.y1 + 1e-6 && b.y0 <= a.y1 + 1e-6;
    for (let a = 0; a < faces.length; a++) {
      for (let c = a + 1; c < faces.length; c++) {
        if (find(a) !== find(c) && faces[a].rects.some((r) => faces[c].rects.some((q) => touch(r, q)))) root[find(a)] = find(c);
      }
    }
    const groups = new Map<number, SideFace[]>();
    faces.forEach((f, k) => groups.set(find(k), [...(groups.get(find(k)) ?? []), f]));
    for (const g of groups.values()) {
      // cada rectángulo en la grilla de su horneado (lo que brilla no se hornea: entero; el vidrio ni entra)
      const owners = g.flatMap((f) => f.rects.map(() => f));
      const grids = g.flatMap((f) => f.rects.map((r): Grid => {
        const step = f.look.mat === 'luz' ? Infinity : bakeStep;
        return { r, s: even(r.s0, r.s1, step), y: even(r.y0, r.y1, step) };
      }));
      for (const f of g) f.pieces = [];
      groupPieces(grids).forEach((ps, k) => owners[k].pieces.push(...ps));
    }
  }
  return out;
}
