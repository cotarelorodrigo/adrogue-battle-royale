import * as THREE from 'three';
import type { Vec2 } from '../../shared/geo.ts';
import type { Building, Opening } from '../../shared/mapdata.ts';
import { cellRect, groundCells, upperCell } from './front-atlas.ts';
import type { FrontCell } from './front-atlas.ts';
import { BAY_W, cutRect, edgeHoles, FLOOR_H, newBuilder, quad, tintColor, toGeometry } from './wall-kit.ts';
import type { Builder, Rect } from './wall-kit.ts';

/** Toldo sobre la puerta y la vidriera: cae de `topY` (en la pared) a `bottomY` a `depth` m; `inset` m de margen por lado. */
export const AWNING = { topY: 2.3, bottomY: 2.0, depth: 1.0, inset: 0.2 } as const;

/** Un pedazo de la arista `i` de `fp`, recorrido de `a` a `b` en el sentido de la corrida; `n` es la normal hacia afuera. */
interface Piece { i: number; a: Vec2; b: Vec2; len: number; n: Vec2; s0: number; rev: boolean }
interface Run { pieces: Piece[]; length: number }

function makeRun(fp: Vec2[], edges: { i: number; rev: boolean }[]): Run {
  const pieces: Piece[] = [];
  let s = 0;
  for (const { i, rev } of edges) {
    const p = fp[i], q = fp[(i + 1) % fp.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-6) continue;
    // la normal sale del sentido de fp (antihorario): el de la corrida puede ser el inverso
    pieces.push({ i, a: rev ? q : p, b: rev ? p : q, len, n: [-(q[1] - p[1]) / len, (q[0] - p[0]) / len], s0: s, rev });
    s += len;
  }
  return { pieces, length: s };
}

/** Cantidad de bahías de una corrida de `len` m. */
const bays = (len: number): number => Math.max(1, Math.round(len / BAY_W));

/** u dentro de la celda `r` para la posición `s` de la bahía `bay`: crece a lo largo de fp (se lee de izquierda a derecha). */
function uAt(r: { u0: number; u1: number }, p: Piece, s: number, bay: number, bw: number): number {
  const t = (s - bay * bw) / bw;
  return p.rev ? r.u1 - t * (r.u1 - r.u0) : r.u0 + t * (r.u1 - r.u0);
}

/** Recorre la corrida bahía por bahía (de ancho L/n) y la parte en los pedazos de arista que cruza, entre `lo` y `hi`. */
function eachSpan(run: Run, lo: number, hi: number, cb: (p: Piece, sa: number, sb: number, bay: number, bw: number) => void): number {
  const n = bays(run.length);
  const bw = run.length / n;
  for (let k = 0; k < n; k++) {
    for (const p of run.pieces) {
      const sa = Math.max(k * bw, p.s0, lo), sb = Math.min((k + 1) * bw, p.s0 + p.len, hi);
      if (sb - sa > 1e-6) cb(p, sa, sb, k, bw);
    }
  }
  return n;
}

const at = (p: Piece, s: number): Vec2 => {
  const t = (s - p.s0) / p.len;
  return [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t];
};

/** Cuadrilátero con la normal pedida: si el orden dado la daría al revés, se invierte (así no importa el sentido de la corrida). */
function face(b: Builder, vs: [number, number, number][], uvs: [number, number][], n: [number, number, number], c: THREE.Color): void {
  const e1 = new THREE.Vector3(vs[1][0] - vs[0][0], vs[1][1] - vs[0][1], vs[1][2] - vs[0][2]);
  const e2 = new THREE.Vector3(vs[2][0] - vs[0][0], vs[2][1] - vs[0][1], vs[2][2] - vs[0][2]);
  if (e1.cross(e2).dot(new THREE.Vector3(...n)) >= 0) quad(b, vs, uvs, n, c);
  else quad(b, [vs[0], vs[3], vs[2], vs[1]], [uvs[0], uvs[3], uvs[2], uvs[1]], n, c);
}

/**
 * Pared de un frente (y de su esquina) con los módulos del atlas: una cara por bahía y por pedazo de arista.
 * `fp`: la planta antihoraria que usa `extrudeBuilding`; `edgeOf`: índice guardado → índice en `fp`. No dibuja nada
 * adentro de `openings`: lo recortado va a `tapa()` (si viene), con las mismas uv.
 */
export function frontGeometry(bd: Building, fp: Vec2[], edgeOf: (e: number) => number, openings: readonly Opening[] = [],
  tapa?: () => Builder): THREE.BufferGeometry {
  const b = newBuilder(true);
  const f = bd.front;
  if (!f) return toGeometry(b);
  const ladrillo = f.ladrillo === true;
  const floors = Math.max(1, bd.floors);
  const tint = tintColor(bd.tint);
  const groundColor = f.colorPB ? tintColor(f.colorPB) : tint;
  const { door, rest } = groundCells(f.pb, ladrillo);
  const upper = upperCell(f.arriba, ladrillo);
  const bandCell = upperCell('ciego', ladrillo);

  // Corrida principal: las aristas en orden (desde → hasta). Cada una se recorre en el sentido guardado, o al revés si
  // `contra`; fp puede estar dado vuelta respecto de lo guardado, y la normal sale siempre del sentido de fp.
  const main = f.edges.map(edgeOf);
  const rev = (fp !== bd.footprint) !== (f.contra === true);
  const mainRun = makeRun(fp, main.map((i) => ({ i, rev })));

  // Corridas de esquina: grupos de aristas contiguas (con vuelta por el índice 0).
  const mainSet = new Set(main);
  const corner = [...new Set(f.corner.map(edgeOf))].filter((i) => !mainSet.has(i)).sort((x, y) => x - y);
  const groups: number[][] = [];
  for (const i of corner) {
    const last = groups[groups.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i); else groups.push([i]);
  }
  if (groups.length > 1 && groups[0][0] === 0 && groups[groups.length - 1].at(-1) === fp.length - 1) {
    groups[0].unshift(...groups.pop()!);
  }
  const cornerRuns = groups.map((g) => makeRun(fp, g.map((i) => ({ i, rev: false }))));

  const height = bd.height;
  const bandY = floors * FLOOR_H;
  const rows: { y0: number; y1: number; groundRow: boolean }[] = [{ y0: 0, y1: Math.min(FLOOR_H, height), groundRow: true }];
  for (let r = 1; r < floors && r * FLOOR_H < height - 1e-6; r++) rows.push({ y0: r * FLOOR_H, y1: Math.min((r + 1) * FLOOR_H, height), groundRow: false });
  const band = height - bandY > 1e-6 ? { y0: bandY, y1: height, groundRow: false } : null;

  // los huecos de cada pedazo, en metros de su corrida
  const holes = edgeHoles(bd.footprint, fp, edgeOf, openings);
  const holesOf = (p: Piece): Rect[] => (holes.get(p.i) ?? []).map((h) => (p.rev
    ? { ...h, s0: p.s0 + p.len - h.s1, s1: p.s0 + p.len - h.s0 }
    : { ...h, s0: p.s0 + h.s0, s1: p.s0 + h.s1 }));

  const wall = (run: Run, isMain: boolean): void => {
    const doorBay = !isMain ? -1
      : f.puerta === 'inicio' ? 0
        : f.puerta === 'fin' ? bays(run.length) - 1
          : Math.floor((bays(run.length) - 1) / 2);
    for (const row of [...rows, ...(band ? [band] : [])]) {
      const isBand = row === band;
      eachSpan(run, 0, run.length, (p, sa, sb, bay, bw) => {
        const cell: FrontCell = row.groundRow ? (bay === doorBay ? door : rest) : isBand ? bandCell : upper;
        const r = cellRect(cell);
        const v = (y: number): number => r.v0 + ((r.v1 - r.v0) * (y - row.y0)) / FLOOR_H; // alturas parciales (banda, edificio bajo): se recorta
        const piece = (to: Builder, q: Rect): void => {
          const ua = uAt(r, p, q.s0, bay, bw), ub = uAt(r, p, q.s1, bay, bw);
          const [pa, pb] = [at(p, q.s0), at(p, q.s1)];
          face(to, [[pa[0], q.y0, pa[1]], [pb[0], q.y0, pb[1]], [pb[0], q.y1, pb[1]], [pa[0], q.y1, pa[1]]],
            [[ua, v(q.y0)], [ub, v(q.y0)], [ub, v(q.y1)], [ua, v(q.y1)]], [p.n[0], 0, p.n[1]], row.groundRow ? groundColor : tint);
        };
        const { solid, cut } = cutRect({ s0: sa, s1: sb, y0: row.y0, y1: row.y1 }, holesOf(p));
        for (const q of solid) piece(b, q);
        if (tapa) for (const q of cut) piece(tapa(), q);
      });
    }
  };
  wall(mainRun, true);
  for (const run of cornerRuns) wall(run, false);

  // el toldo deja libre el tramo de la ayuda de ascenso que haya en una punta (si no, `inset`)
  const awningLo = f.ayuda?.inicio ?? AWNING.inset;
  const awningHi = mainRun.length - (f.ayuda?.fin ?? AWNING.inset);
  if (f.toldo && awningHi > awningLo) {
    const r = cellRect(f.toldo.rayas ? 'toldo-rayas' : 'toldo');
    const color = tintColor(f.toldo.color);
    const { topY, bottomY, depth } = AWNING;
    const h = topY - bottomY;
    const norm = Math.hypot(h, depth);
    eachSpan(mainRun, awningLo, awningHi, (p, sa, sb, bay, bw) => {
      const ua = uAt(r, p, sa, bay, bw), ub = uAt(r, p, sb, bay, bw);
      const [pa, pb] = [at(p, sa), at(p, sb)];
      const vs: [number, number, number][] = [
        [pa[0], topY, pa[1]], [pb[0], topY, pb[1]],
        [pb[0] + p.n[0] * depth, bottomY, pb[1] + p.n[1] * depth], [pa[0] + p.n[0] * depth, bottomY, pa[1] + p.n[1] * depth],
      ];
      const uvs: [number, number][] = [[ua, r.v1], [ub, r.v1], [ub, r.v0], [ua, r.v0]];
      const up: [number, number, number] = [(p.n[0] * h) / norm, depth / norm, (p.n[1] * h) / norm];
      face(b, vs, uvs, up, color);
      face(b, vs, uvs, [-up[0], -up[1], -up[2]], color); // por abajo también se ve
    });
  }
  return toGeometry(b);
}
