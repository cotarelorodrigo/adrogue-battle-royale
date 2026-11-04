// Huecos de suelo sin salida: patios o rendijas cerrados por edificios (o por el borde del área) a los que se cae
// caminando desde un techo y de los que no se puede salir: las paredes miden 3,8 m o más y el mantle llega a 2,4 m.
// Se busca el suelo pisable con un flood fill sobre el mundo de colisiones; cada componente que no se une con la
// principal es un hueco. Cada hueco recibe una escalera adentro, sobre una pared cuyo techo es accesible desde la
// calle; si ninguna pared del hueco admite una, el hueco se rellena con un sólido al ras del techo vecino más bajo.
import polygonClipping from 'polygon-clipping';
import { buildCollisionWorld, collisionPrisms, DUMPSTER, roofEdgeY } from '../shared/collision.ts';
import type { CollisionMap, CollisionWorld } from '../shared/collision.ts';
import { ensureCCW, pointInPolygon, polygonArea } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Building, MapData, Prop } from '../shared/mapdata.ts';
import { PLAYER } from '../shared/player.ts';
import { roofClusters } from './climb.ts';
import { outwardNormal } from './places.ts';
import { ring, rn, v2 } from './round.ts';
import { bboxOf, createGrid, distToRing, polygonDist } from './spatial.ts';
import type { Box } from './spatial.ts';
import { filterTrees } from './trees.ts';

const R = PLAYER.radius;
/** Lado de la celda de la grilla gruesa (m). */
export const GROUND_CELL = 0.5;
/** La grilla fina divide cada celda gruesa en FINE × FINE (2,5 cm): sigue los pasos angostos que la gruesa corta. */
const FINE = 20;
const FSTEP = GROUND_CELL / FINE;
/** El análisis usa el radio del jugador menos SLACK: así una rendija donde el jugador entra justo (0,70–0,75 m) es
 *  una franja de al menos 2·SLACK, que la grilla fina recorre sin cortarla. A cambio, un paso de 0,65–0,70 m (donde
 *  el jugador no entra) cuenta como abierto y una rendija cerrada de ese ancho cuenta como hueco (se rellena). */
const SLACK = 0.025;
const RA = R - SLACK;
/** Un sólido de hasta esta altura (andén, volquete, banco, fuente) se trepa desde el suelo y se cruza por arriba. */
const LOW_MAX = PLAYER.mantleReach;
/** Tope de nodos finos por recorrido: más que esto es una zona enorme, no un patio (se la da por conectada). */
const MAX_FINE_NODES = 2_000_000;
/** Semillas a lo largo de las paredes, para encontrar rendijas sin ningún centro de celda gruesa adentro. */
const SEED_STEP = 0.25;
/** Una región de centros sin ningún centro de celda gruesa es más angosta que la diagonal de la celda (0,71 m); en
 *  metros de suelo, menos que 2·RA + 0,71. Una semilla con 1,4 m libres por delante no está en una de esas. */
const OPEN = 1.4;

// Escalera (mismas medidas que climb.ts / collision.ts) y su uso por el controlador.
const LADDER_HALF_W = 0.4;
const LADDER_DEPTH = 0.6;
/** Donde se para el jugador para agarrarla: a esta distancia de la pared, dentro del volumen de la escalera. */
const LADDER_FOOT = 0.45;
/** Arriba, el controlador lo deja a esta distancia de la pared, sobre el techo (MANTLE_PUSH de player.ts). */
const LADDER_TOP_PUSH = 0.6;
const LADDER_SAMPLE = 0.25;
/** Las ayudas quedan a ≥ 1 m del borde del área (como en climb.ts). */
const AREA_MARGIN = 1;
/** El relleno queda 1 cm por debajo del techo vecino más bajo: sin z-fighting donde se tocan. */
const FILL_DROP = 0.01;
const FILL_MIN_AREA = 0.01;
const MAX_ROUNDS = 3;

/** 0: no entra el jugador; 1: parado en el suelo; 2: parado arriba de un sólido bajo (≤ LOW_MAX). */
export type Standing = 0 | 1 | 2;

/** ¿Dónde queda el jugador (disco de radio r) con los pies en (x, z)? El centro tiene que caer dentro de bounds − radio
 *  del jugador (como en el controlador); en el suelo, el disco no toca ningún sólido (todos miden ≥ 0,5 m: si nada se
 *  superpone por encima de 5 cm, el apoyo es el suelo); arriba de un sólido bajo, no toca ninguno más alto. */
export function standingAt(world: CollisionWorld, x: number, z: number, r: number = R): Standing {
  const b = world.bounds;
  if (x < b.minX + R || x > b.maxX - R || z < b.minZ + R || z > b.maxZ - R) return 0;
  if (!world.overlaps(x, z, r, 0.05, PLAYER.height)) return 1;
  return world.overlaps(x, z, r, LOW_MAX, LOW_MAX + PLAYER.height) ? 0 : 2;
}

export interface GroundRegion {
  /** Puntos de la grilla fina (2,5 cm) donde puede estar el centro del jugador, en orden de recorrido. */
  points: Vec2[];
  /** Área aproximada (m²) de esos puntos. */
  area: number;
}

export interface GroundAnalysis {
  /** Grilla gruesa: origen, tamaño y componente de cada celda (−1 bloqueada, 0 principal, k = hueco k − 1). */
  x0: number; z0: number; nx: number; nz: number;
  label: Int32Array;
  /** Componentes que no llegan a la principal (la de más celdas gruesas). */
  pockets: GroundRegion[];
  /** Componente del punto (x, z): 0 principal, k = hueco k − 1, −1 si no se puede parar ahí o no se sabe. */
  regionOf(x: number, z: number): number;
}

const NEIGHBOURS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Flood fill del suelo pisable dentro del área:
 * 1. Grilla gruesa de GROUND_CELL: una celda es pisable si se puede parar en su centro, y dos vecinas (4-conexas) se
 *    unen si también se puede parar en el punto medio (o si una tiene medio paso de aire de sobra).
 * 2. Cada componente que no es la principal se recorre en la grilla fina desde sus celdas: un paso angosto que la
 *    gruesa partió la une con la principal o con otra componente.
 * 3. Semillas al lado de cada pared de `solids` (plantas de los sólidos): una rendija sin centros de celda gruesa
 *    adentro aparece por ahí y se recorre igual.
 * Lo que queda separado de la principal son los huecos.
 */
export function analyzeGround(world: CollisionWorld, solids: Vec2[][]): GroundAnalysis {
  const b = world.bounds;
  const x0 = b.minX + R, z0 = b.minZ + R;
  const nx = Math.floor((b.maxX - R - x0) / GROUND_CELL) + 1;
  const nz = Math.floor((b.maxZ - R - z0) / GROUND_CELL) + 1;
  const n = nx * nz;
  const stand = (x: number, z: number): Standing => standingAt(world, x, z, RA);

  // 1. grilla gruesa. `clear`: nada a menos de RA + medio paso, así el punto medio hacia una vecina es pisable.
  const kind = new Uint8Array(n);
  const clear = new Uint8Array(n);
  const half = GROUND_CELL / 2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * GROUND_CELL, z = z0 + j * GROUND_CELL, k = j * nx + i;
    if (!world.overlaps(x, z, RA + half, 0.05, PLAYER.height)) {
      kind[k] = 1;
      clear[k] = 1;
    } else {
      kind[k] = stand(x, z);
    }
  }
  const parent = new Int32Array(n);
  for (let k = 0; k < n; k++) parent[k] = k;
  const find = (k: number): number => {
    while (parent[k] !== k) k = parent[k] = parent[parent[k]];
    return k;
  };
  const join = (a: number, c: number): void => {
    const ra = find(a), rc = find(c);
    if (ra !== rc) parent[Math.max(ra, rc)] = Math.min(ra, rc);
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!kind[k]) continue;
    const x = x0 + i * GROUND_CELL, z = z0 + j * GROUND_CELL;
    if (i + 1 < nx && kind[k + 1] && (clear[k] || clear[k + 1] || stand(x + half, z))) join(k, k + 1);
    if (j + 1 < nz && kind[k + nx] && (clear[k] || clear[k + nx] || stand(x, z + half))) join(k, k + nx);
  }
  const size = new Map<number, number>();
  for (let k = 0; k < n; k++) if (kind[k]) size.set(find(k), (size.get(find(k)) ?? 0) + 1);
  let main = -1;
  for (const [root, s] of size) if (main < 0 || s > size.get(main)! || (s === size.get(main)! && root < main)) main = root;
  const members = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    if (!kind[k]) continue;
    const r = find(k);
    if (r === main) continue;
    const m = members.get(r);
    if (m) m.push(k);
    else members.set(r, [k]);
  }

  // 2-3. grilla fina. owner: nodo fino → 0 (principal) o k (hueco k − 1). resolved: raíz gruesa → idem.
  const fnx = (nx - 1) * FINE + 1, fnz = (nz - 1) * FINE + 1;
  const fx = (fi: number): number => x0 + fi * FSTEP;
  const fz = (fj: number): number => z0 + fj * FSTEP;
  const owner = new Map<number, number>();
  const resolved = new Map<number, number>();
  resolved.set(main, 0);
  const pockets: GroundRegion[] = [];
  const coarseKey = (k: number): number => {
    const i = k % nx, j = (k - i) / nx;
    return j * FINE * fnx + i * FINE;
  };

  /** A ≤ medio paso de un centro `clear`: pisable sin preguntarle al mundo. */
  const NEAR2 = (FINE / 2) ** 2;
  const nearClear = (a: number, c: number): boolean => {
    const ci = Math.round(a / FINE), cj = Math.round(c / FINE);
    return clear[cj * nx + ci] === 1 && (a - ci * FINE) ** 2 + (c - cj * FINE) ** 2 <= NEAR2;
  };
  /** Recorre desde `starts` (nodos finos pisables) y las celdas de `roots`, y le asigna dueño a todo lo que alcanza. */
  const fill = (starts: number[], roots: number[]): void => {
    const seen = new Set<number>();
    const queue: number[] = [];
    const touched = new Set<number>(roots);
    const push = (key: number): void => {
      if (!seen.has(key)) { seen.add(key); queue.push(key); }
    };
    for (const r of roots) for (const k of members.get(r)!) push(coarseKey(k));
    for (const s of starts) push(s);
    let found = -1; // dueño ya conocido al que se llegó
    for (let h = 0; h < queue.length && found < 0; h++) {
      const key = queue[h];
      const prev = owner.get(key);
      if (prev !== undefined) { found = prev; break; }
      const fi = key % fnx, fj = (key - fi) / fnx;
      if (fi % FINE === 0 && fj % FINE === 0) {
        const k = (fj / FINE) * nx + fi / FINE;
        if (kind[k]) {
          const r = find(k);
          const res = resolved.get(r);
          if (res !== undefined) { found = res; break; }
          if (!touched.has(r)) {
            touched.add(r);
            for (const c of members.get(r)!) push(coarseKey(c));
          }
        }
      }
      if (seen.size > MAX_FINE_NODES) { found = 0; break; }
      for (const [di, dj] of NEIGHBOURS) {
        const a = fi + di, c = fj + dj;
        if (a < 0 || c < 0 || a >= fnx || c >= fnz) continue;
        const nk = c * fnx + a;
        if (seen.has(nk)) continue;
        seen.add(nk);
        if (nearClear(a, c) || stand(fx(a), fz(c))) queue.push(nk);
      }
    }
    if (found < 0) {
      pockets.push({ points: queue.map((key) => [fx(key % fnx), fz(Math.floor(key / fnx))]), area: queue.length * FSTEP * FSTEP });
      found = pockets.length;
    }
    for (const key of queue) if (!owner.has(key)) owner.set(key, found);
    for (const r of touched) resolved.set(r, found);
  };

  for (const root of [...members.keys()].sort((p, q) => p - q)) if (!resolved.has(root)) fill([], [root]);

  /** Componente gruesa del centro más cercano, si se llega en línea recta (centro y punto medio pisables). */
  const coarseOf = (x: number, z: number): number => {
    const i = Math.round((x - x0) / GROUND_CELL), j = Math.round((z - z0) / GROUND_CELL);
    if (i < 0 || j < 0 || i >= nx || j >= nz || !kind[j * nx + i]) return -1;
    const cx = x0 + i * GROUND_CELL, cz = z0 + j * GROUND_CELL;
    if (!stand((x + cx) / 2, (z + cz) / 2)) return -1;
    return resolved.get(find(j * nx + i)) ?? -1;
  };
  /** Nodo fino pisable más cercano a (x, z) (en un vecindario de 5 × 5), o −1. */
  const fineNear = (x: number, z: number): number => {
    const ci = Math.round((x - x0) / FSTEP), cj = Math.round((z - z0) / FSTEP);
    let best = -1, bestD = Infinity;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const a = ci + di, c = cj + dj;
      if (a < 0 || c < 0 || a >= fnx || c >= fnz) continue;
      const d = (fx(a) - x) ** 2 + (fz(c) - z) ** 2;
      if (d < bestD && stand(fx(a), fz(c))) { bestD = d; best = c * fnx + a; }
    }
    return best;
  };

  for (const poly of solids) {
    const fp = ensureCCW(poly);
    for (let e = 0; e < fp.length; e++) {
      const a = fp[e], c = fp[(e + 1) % fp.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 1e-6) continue;
      const d: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
      const nn = outwardNormal(a, c);
      const off = RA + FSTEP / 2;
      for (let s = SEED_STEP / 2; s < len; s += SEED_STEP) {
        const x = a[0] + d[0] * s + nn[0] * off, z = a[1] + d[1] * s + nn[1] * off;
        // con OPEN m libres por delante, la región tiene centros de celda gruesa: ya la vio la pasada 1
        if (!world.overlaps(x + nn[0] * OPEN / 2, z + nn[1] * OPEN / 2, OPEN / 2, 0.05, LOW_MAX + PLAYER.height)) continue;
        if (!stand(x, z) || coarseOf(x, z) >= 0) continue;
        const key = fineNear(x, z);
        if (key >= 0 && !owner.has(key)) fill([key], []);
      }
    }
  }

  // Solo cuentan los huecos donde entra el jugador de verdad (radio R, no RA): el resto queda como −1.
  const remap = new Map<number, number>([[0, 0]]);
  const kept: GroundRegion[] = [];
  pockets.forEach((p, i) => {
    if (habitable(world, p.points)) { kept.push(p); remap.set(i + 1, kept.length); } else remap.set(i + 1, -1);
  });
  const label = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) if (kind[k]) label[k] = remap.get(resolved.get(find(k)) ?? -1) ?? -1;
  const regionOf = (x: number, z: number): number => {
    if (!stand(x, z)) return -1;
    const key = fineNear(x, z);
    const o = key < 0 ? undefined : owner.get(key);
    return remap.get(o ?? coarseOf(x, z)) ?? -1;
  };
  return { x0, z0, nx, nz, label, pockets: kept, regionOf };
}

/** Radio máximo (± 0,5 mm) del disco que entra parado en (x, z), hasta R + 1 cm. */
function clearance(world: CollisionWorld, x: number, z: number): number {
  let lo = 0, hi = R + 0.01;
  if (standingAt(world, x, z, hi)) return hi;
  for (let k = 0; k < 10; k++) {
    const m = (lo + hi) / 2;
    if (standingAt(world, x, z, m)) lo = m; else hi = m;
  }
  return lo;
}

/** ¿Entra el jugador (radio R) en algún punto de la región? Primero los nodos; si ninguno, sube por la holgura desde
 *  los tres mejores (la rendija puede ser más angosta que la grilla fina). */
function habitable(world: CollisionWorld, points: Vec2[]): boolean {
  if (points.some(([x, z]) => standingAt(world, x, z) !== 0)) return true;
  const best = points.map((p) => ({ p, c: clearance(world, p[0], p[1]) })).sort((a, b) => b.c - a.c).slice(0, 3);
  for (const s of best) {
    let [x, z] = s.p;
    let c = s.c;
    for (const step of [0.01, 0.005, 0.0025, 0.001]) {
      for (let moved = true, k = 0; moved && k < 50; k++) {
        moved = false;
        for (let a = 0; a < 8; a++) {
          const nx = x + step * Math.cos((a * Math.PI) / 4), nz = z + step * Math.sin((a * Math.PI) / 4);
          const nc = clearance(world, nx, nz);
          if (nc > c + 1e-6) { x = nx; z = nz; c = nc; moved = true; }
        }
      }
    }
    if (c >= R) return true;
  }
  return false;
}

const isParapet = (tag: string | undefined): boolean => tag?.startsWith('parapet:') === true;

/** Plantas de los sólidos del mapa, para sembrar `analyzeGround`. Los pretiles quedan adentro de la planta de su
 *  edificio, arriba del techo: no suman semillas en el suelo. */
export function solidOutlines(map: CollisionMap): Vec2[][] {
  return collisionPrisms(map).prisms.filter((p) => !isParapet(p.tag)).map((p) => p.polygon);
}

export interface PocketStats {
  /** Huecos encontrados en la primera pasada. */
  pockets: number;
  /** Escaleras agregadas adentro de un hueco. */
  ladders: number;
  /** Huecos rellenados (cada uno puede ser más de un sólido). */
  filled: number;
}

type Ladder = Extract<Prop, { kind: 'ladder' }>;

interface Ctx {
  map: MapData;
  world: CollisionWorld;
  g: GroundAnalysis;
  grid: { query(box: Box): number[] };
  accessible: Set<string>;
}

const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** Edificios cuyo techo se alcanza desde la calle: su cluster tiene una escalera o un volquete al que se llega desde la
 *  componente principal del suelo. */
function accessibleBuildings(map: MapData, g: GroundAnalysis, grid: Ctx['grid']): Set<string> {
  const clusterOf = new Map<string, number>();
  roofClusters(map.buildings).forEach((c, i) => c.forEach((id) => clusterOf.set(id, i)));
  const ok = new Set<number>();
  for (const p of map.props) {
    if (p.kind === 'ladder') {
      const nn = unit(p.normal);
      if (g.regionOf(p.base[0] + nn[0] * LADDER_FOOT, p.base[1] + nn[1] * LADDER_FOOT) === 0) ok.add(clusterOf.get(p.buildingId)!);
    } else if (p.kind === 'dumpster') {
      // perpendicular al eje largo (+x local = (cos θ, −sin θ)); se trepa desde el lado libre
      const perp: Vec2 = [Math.sin(p.rotation), Math.cos(p.rotation)];
      const reach = DUMPSTER.depth / 2 + R + 0.05;
      if (![1, -1].some((s) => g.regionOf(p.position[0] + perp[0] * s * reach, p.position[1] + perp[1] * s * reach) === 0)) continue;
      for (const j of grid.query(bboxOf([p.position], DUMPSTER.length))) {
        const b = map.buildings[j];
        if (roofEdgeY(b) > DUMPSTER.height + PLAYER.mantleReach + 1e-6) continue; // desde arriba, al tope del pretil
        if (pointInPolygon(p.position, b.footprint) || distToRing(p.position, b.footprint) > DUMPSTER.depth / 2 + 0.3) continue;
        ok.add(clusterOf.get(b.id)!);
      }
    }
  }
  return new Set(map.buildings.filter((b) => ok.has(clusterOf.get(b.id)!)).map((b) => b.id));
}

/** ¿El hueco ya tiene salida? Una escalera a un techo accesible al alcance desde algún punto, o un volquete adentro
 *  desde el que se trepa a un techo accesible. */
function hasExit(ctx: Ctx, p: GroundRegion): boolean {
  const { map, world } = ctx;
  const byBase = new Map<string, Ladder>();
  for (const pr of map.props) if (pr.kind === 'ladder') byBase.set(`${pr.base[0]},${pr.base[1]}`, pr);
  for (const [x, z] of p.points) {
    const where = standingAt(world, x, z); // con el radio de verdad: ahí se para el jugador
    if (where === 0) continue;
    const v = world.ladderAt(x, z, R, 0);
    if (v && where === 1) {
      const l = byBase.get(`${v.base[0]},${v.base[1]}`);
      if (l && ctx.accessible.has(l.buildingId)) return true;
    }
    if (where === 2) {
      const top = world.supportHeight(x, z, R, LOW_MAX);
      for (const j of ctx.grid.query(bboxOf([[x, z]], LADDER_TOP_PUSH + R))) {
        const b = map.buildings[j];
        if (roofEdgeY(b) <= top + PLAYER.mantleReach + 1e-6 && ctx.accessible.has(b.id) && distToRing([x, z], b.footprint) <= LADDER_TOP_PUSH) return true;
      }
    }
  }
  return false;
}

function inArea(map: MapData, pts: Vec2[]): boolean {
  const b = map.bounds;
  return pts.every(([x, z]) => x >= b.minX + AREA_MARGIN && x <= b.maxX - AREA_MARGIN && z >= b.minZ + AREA_MARGIN && z <= b.maxZ - AREA_MARGIN);
}

/** Escalera adentro del hueco `pi`, sobre la pared de un edificio de techo accesible (el más bajo; en él, la arista más
 *  larga; en ella, lo más cerca del medio), con el mismo formato que las de climb.ts. Null si no entra en ninguna. */
function pocketLadder(ctx: Ctx, pi: number): Ladder | null {
  const { map, world, g } = ctx;
  const p = g.pockets[pi];
  const bd = map.bounds;
  const near = ctx.grid.query(bboxOf(p.points, 1)).filter((j) => ctx.accessible.has(map.buildings[j].id));
  near.sort((a, c) => map.buildings[a].height - map.buildings[c].height || a - c);
  for (const bi of near) {
    const b = map.buildings[bi];
    const fp = b.footprint;
    const edges = fp.map((a, i) => {
      const c = fp[(i + 1) % fp.length];
      return { i, a, c, len: Math.hypot(c[0] - a[0], c[1] - a[1]) };
    }).filter((e) => e.len >= 2 * LADDER_HALF_W + 0.1).sort((e, f) => f.len - e.len || e.i - f.i);
    for (const e of edges) {
      const d: Vec2 = [(e.c[0] - e.a[0]) / e.len, (e.c[1] - e.a[1]) / e.len];
      const nn = outwardNormal(e.a, e.c);
      const mid = e.len / 2;
      const span = mid - LADDER_HALF_W - 0.05;
      for (let k = 0; k * LADDER_SAMPLE <= span; k++) {
        for (const s of k === 0 ? [mid] : [mid - k * LADDER_SAMPLE, mid + k * LADDER_SAMPLE]) {
          const base = v2([e.a[0] + d[0] * s, e.a[1] + d[1] * s]);
          const at = (t: number, w: number): Vec2 => [base[0] + d[0] * t + nn[0] * w, base[1] + d[1] * t + nn[1] * w];
          const foot = at(0, LADDER_FOOT);
          if (g.regionOf(foot[0], foot[1]) !== pi + 1 || standingAt(world, foot[0], foot[1]) !== 1) continue;
          const box: Vec2[] = [at(-LADDER_HALF_W, 0), at(LADDER_HALF_W, 0), at(LADDER_HALF_W, LADDER_DEPTH), at(-LADDER_HALF_W, LADDER_DEPTH)];
          if (!inArea(map, [base, ...box])) continue;
          // la caja no se mete en otro edificio ni en otro sólido
          if (ctx.grid.query(bboxOf(box)).some((j) => j !== bi && polygonDist(box, map.buildings[j].footprint) === 0)) continue;
          const probes = [at(-LADDER_HALF_W, 0.05), at(LADDER_HALF_W, 0.05), box[2], box[3]];
          if (probes.some(([x, z]) => world.overlaps(x, z, 0.01, 0.05, PLAYER.height))) continue;
          // arriba (la escalera llega al tope del pretil y de ahí se cae al techo): parado sobre el techo, con lugar
          // para el cuerpo y sin tocar el pretil
          const top = at(0, -LADDER_TOP_PUSH);
          if (top[0] < bd.minX + R || top[0] > bd.maxX - R || top[1] < bd.minZ + R || top[1] > bd.maxZ - R) continue;
          if (world.overlaps(top[0], top[1], R, b.height, b.height + PLAYER.height)) continue;
          if (world.supportHeight(top[0], top[1], R, b.height) < b.height - 1e-9) continue;
          return { kind: 'ladder', base, normal: v2(nn, 3), topY: rn(roofEdgeY(b)), buildingId: b.id };
        }
      }
    }
  }
  return null;
}

type Poly = [number, number][][];
const closed = (fp: Vec2[]): Poly => [[...fp, fp[0]].map(([x, z]): [number, number] => [x, z])];

/** Parte un polígono con huecos en piezas sin huecos, cortando por una vertical que pasa por el primer hueco. */
function withoutHoles(poly: Poly, depth = 0): Poly[] {
  if (poly.length === 1 || depth > 8) return [[poly[0]]];
  const xs = poly[1].map((p) => p[0]);
  const cut = (Math.min(...xs) + Math.max(...xs)) / 2;
  const ox = poly[0].map((p) => p[0]), oz = poly[0].map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...ox) - 1, Math.max(...ox) + 1, Math.min(...oz) - 1, Math.max(...oz) + 1];
  const left: Poly = [[[x0, z0], [cut, z0], [cut, z1], [x0, z1], [x0, z0]]];
  const right: Poly = [[[cut, z0], [x1, z0], [x1, z1], [cut, z1], [cut, z0]]];
  return [left, right].flatMap((half) => polygonClipping.intersection(poly, half).flatMap((q) => withoutHoles(q, depth + 1)));
}

/** Sólidos que rellenan el hueco `pi`: lo que barre el jugador adentro del hueco, menos los edificios, dentro del área.
 *  Altura: la del edificio vecino más bajo menos FILL_DROP. Null si el hueco toca algo que no es un edificio (un árbol,
 *  un prop, una escalera: el relleno lo taparía). */
function pocketFill(ctx: Ctx, pi: number): Building[] | null {
  const { map, g } = ctx;
  const p = g.pockets[pi];
  const b = map.bounds;
  const pad = R + 0.02;
  // una caja por celda gruesa: la de los puntos del hueco que caen en ella, agrandada por el radio
  const cells = new Map<string, Box>();
  for (const [x, z] of p.points) {
    const key = `${Math.floor((x - g.x0) / GROUND_CELL)},${Math.floor((z - g.z0) / GROUND_CELL)}`;
    const c = cells.get(key);
    if (!c) cells.set(key, { minX: x, minZ: z, maxX: x, maxZ: z });
    else { c.minX = Math.min(c.minX, x); c.minZ = Math.min(c.minZ, z); c.maxX = Math.max(c.maxX, x); c.maxZ = Math.max(c.maxZ, z); }
  }
  const boxes: Vec2[][] = [...cells.values()].map((c) => {
    const [x0, z0] = [Math.max(b.minX, c.minX - pad), Math.max(b.minZ, c.minZ - pad)];
    const [x1, z1] = [Math.min(b.maxX, c.maxX + pad), Math.min(b.maxZ, c.maxZ + pad)];
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  });
  const ids = new Set(map.buildings.map((bd) => bd.id));
  const reach = bboxOf(boxes.flat());
  const { prisms, ladders } = collisionPrisms(map);
  // una escalera (de otro cluster) cuyo pie cae en el hueco quedaría enterrada en el relleno
  const ladderBoxes = ladders.map((l) => {
    const nn = unit(l.normal), d: Vec2 = [nn[1], -nn[0]];
    const at = (t: number, w: number): Vec2 => [l.base[0] + d[0] * t + nn[0] * w, l.base[1] + d[1] * t + nn[1] * w];
    return [at(-LADDER_HALF_W, 0), at(LADDER_HALF_W, 0), at(LADDER_HALF_W, LADDER_DEPTH), at(-LADDER_HALF_W, LADDER_DEPTH)];
  });
  // los pretiles son de los edificios (quedan arriba de su techo)
  for (const polygon of [...prisms.filter((o) => !ids.has(o.tag ?? '') && !isParapet(o.tag)).map((o) => o.polygon), ...ladderBoxes]) {
    const ob = bboxOf(polygon);
    if (ob.minX > reach.maxX || ob.maxX < reach.minX || ob.minZ > reach.maxZ || ob.maxZ < reach.minZ) continue;
    if (boxes.some((bx) => polygonDist(bx, polygon) === 0)) return null;
  }
  const near = ctx.grid.query(reach);
  // vecino más bajo: edificios a ≤ R + 5 cm de algún punto del hueco
  const step = Math.max(1, Math.floor(p.points.length / 4000));
  let low: Building | null = null;
  for (const j of near) {
    const bd = map.buildings[j];
    if (low && bd.height >= low.height) continue;
    for (let k = 0; k < p.points.length; k += step) {
      if (distToRing(p.points[k], bd.footprint) <= R + 0.05) { low = bd; break; }
    }
  }
  if (!low) return null;
  const union = polygonClipping.union(closed(boxes[0]), ...boxes.slice(1).map(closed));
  const pieces = near.length ? polygonClipping.difference(union, ...near.map((j) => closed(map.buildings[j].footprint))) : union;
  const out: Building[] = [];
  for (const piece of pieces.flatMap((q) => withoutHoles(q))) {
    const fp = ring(ensureCCW(piece[0].slice(0, -1) as Vec2[]));
    if (fp.length < 3 || polygonArea(fp) < FILL_MIN_AREA) continue;
    out.push({ id: '', footprint: fp, height: rn(low.height - FILL_DROP), floors: low.floors, kind: 'house', wall: low.wall, tint: low.tint, fill: true });
  }
  return out.length ? out : null;
}

/**
 * Busca los huecos del suelo y le da una salida a cada uno: primero una escalera adentro; si no entra en ninguna pared,
 * lo rellena. Modifica `map` (props, buildings y trees: saca los árboles al pie de una escalera nueva, como
 * filterTrees). Repite el análisis hasta que no quedan huecos sin salida (o MAX_ROUNDS); lo que quede va en warnings.
 */
export function exitPockets(map: MapData): { stats: PocketStats; warnings: string[] } {
  const stats: PocketStats = { pockets: 0, ladders: 0, filled: 0 };
  const warnings: string[] = [];
  let fills = 0;
  for (let round = 0; ; round++) {
    const world = buildCollisionWorld(map);
    const g = analyzeGround(world, solidOutlines(map));
    const grid = createGrid(map.buildings.map((bd) => bboxOf(bd.footprint)));
    const ctx: Ctx = { map, world, g, grid, accessible: accessibleBuildings(map, g, grid) };
    const pending = g.pockets.map((_, i) => i).filter((i) => !hasExit(ctx, g.pockets[i]));
    if (round === 0) stats.pockets = g.pockets.length;
    if (pending.length === 0) break;
    if (round === MAX_ROUNDS - 1) {
      for (const i of pending) {
        const [x, z] = g.pockets[i].points[0];
        warnings.push(`hueco sin salida en ${rn(x, 1)}, ${rn(z, 1)} (${rn(g.pockets[i].area, 2)} m²)`);
      }
      break;
    }
    for (const i of pending) {
      const ladder = pocketLadder(ctx, i);
      if (ladder) {
        map.props.push(ladder);
        stats.ladders++;
        continue;
      }
      const solids = pocketFill(ctx, i);
      if (!solids) continue; // queda para la vuelta siguiente (y, si sigue, va a warnings)
      for (const s of solids) map.buildings.push({ ...s, id: `r${String(++fills).padStart(4, '0')}` });
      stats.filled++;
    }
    map.trees = filterTrees(map.trees, map.props, map.platforms);
  }
  return { stats, warnings };
}
