import { areaRect, polygonArea } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Building, Prop, Road } from '../shared/mapdata.ts';
import { heightFor } from './buildings.ts';
import { outwardNormal } from './places.ts';
import { bboxOf, createGrid, polygonDist, segToPolygonDist } from './spatial.ts';
import type { Box } from './spatial.ts';

export const MANTLE_REACH = 2.4;

const LINK_DIST = 1.0;
const AREA_PER_AID = 1500;
const MIN_STREET_EDGE = 3;
const RAY_LEN = 5;
const DUMPSTER_MAX_H = heightFor(1) + 0.05;
const DUMPSTER_LEN = 1.8;
const DUMPSTER_DEPTH = 1.1;
const DUMPSTER_GAP = 0.2;
const LADDER_W = 0.8;
const LADDER_D = 0.6;
const AREA_MARGIN = 1;
const NON_VEHICULAR = new Set(['footway', 'pedestrian', 'service']);

interface Index { buildings: Building[]; grid: { query(box: Box): number[] } }

function indexOf(buildings: Building[]): Index {
  return { buildings, grid: createGrid(buildings.map((b) => bboxOf(b.footprint))) };
}

/** Grupos de edificios cuyos techos se alcanzan entre sí: footprints a ≤ 1 m y |Δh| ≤ MANTLE_REACH. */
export function roofClusters(buildings: Building[]): string[][] {
  return clustersOf(indexOf(buildings));
}

function clustersOf(ix: Index): string[][] {
  const bs = ix.buildings;
  const parent = bs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  bs.forEach((b, i) => {
    const q: Box = bboxOf(b.footprint, LINK_DIST);
    for (const j of ix.grid.query(q)) {
      if (j <= i || Math.abs(bs[j].height - b.height) > MANTLE_REACH + 1e-9) continue;
      if (find(i) === find(j)) continue;
      if (polygonDist(b.footprint, bs[j].footprint) <= LINK_DIST) parent[find(j)] = find(i);
    }
  });
  const groups = new Map<number, number[]>();
  bs.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()].sort((a, b) => a[0] - b[0]).map((g) => g.map((i) => bs[i].id));
}

interface Edge {
  bi: number; // índice del edificio
  i: number;
  len: number;
  mid: Vec2;
  n: Vec2;
  d: Vec2; // tangente unitaria a→b
  street: boolean;
  free?: boolean; // caja del acceso fuera de calzada y de otros edificios (perezoso)
}

interface Aid { prop: Prop; pos: Vec2; box: Vec2[] }

interface Ctx {
  ix: Index;
  roadBoxes: Box[];
  roadGrid: { query(box: Box): number[] };
  vehicular: Road[];
  edges: Map<number, Edge[]>;
}

function edgesOf(ctx: Ctx, bi: number): Edge[] {
  const cached = ctx.edges.get(bi);
  if (cached) return cached;
  const b = ctx.ix.buildings[bi];
  const fp = b.footprint;
  const out: Edge[] = [];
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i];
    const c = fp[(i + 1) % fp.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 1e-6) continue;
    const mid: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const n = outwardNormal(a, c);
    const d: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    let street = len >= MIN_STREET_EDGE;
    if (street) {
      const end: Vec2 = [mid[0] + n[0] * RAY_LEN, mid[1] + n[1] * RAY_LEN];
      const q = bboxOf([mid, end]);
      for (const j of ctx.ix.grid.query(q)) {
        if (j === bi) continue;
        if (segToPolygonDist(mid, end, ctx.ix.buildings[j].footprint) === 0) {
          street = false;
          break;
        }
      }
    }
    out.push({ bi, i, len, mid, n, d, street });
  }
  ctx.edges.set(bi, out);
  return out;
}

function makeAid(b: Building, e: Edge): Aid {
  if (b.height <= DUMPSTER_MAX_H) {
    const k = DUMPSTER_GAP + DUMPSTER_DEPTH / 2;
    const pos: Vec2 = [e.mid[0] + e.n[0] * k, e.mid[1] + e.n[1] * k];
    const hl = DUMPSTER_LEN / 2;
    const hd = DUMPSTER_DEPTH / 2;
    const corner = (s: number, t: number): Vec2 => [pos[0] + e.d[0] * hl * s + e.n[0] * hd * t, pos[1] + e.d[1] * hl * s + e.n[1] * hd * t];
    return {
      prop: { kind: 'dumpster', position: pos, rotation: Math.atan2(-e.d[1], e.d[0]) },
      pos,
      box: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
    };
  }
  const hw = LADDER_W / 2;
  const corner = (s: number, t: number): Vec2 => [e.mid[0] + e.d[0] * hw * s + e.n[0] * LADDER_D * t, e.mid[1] + e.d[1] * hw * s + e.n[1] * LADDER_D * t];
  return {
    prop: { kind: 'ladder', base: e.mid, normal: e.n, topY: b.height, buildingId: b.id },
    pos: e.mid,
    box: [corner(-1, 0), corner(1, 0), corner(1, 1), corner(-1, 1)],
  };
}

function isFree(ctx: Ctx, e: Edge, aid: Aid): boolean {
  if (e.free !== undefined) return e.free;
  const q = bboxOf(aid.box);
  let free = true;
  for (const j of ctx.ix.grid.query(q)) {
    if (j !== e.bi && polygonDist(aid.box, ctx.ix.buildings[j].footprint) === 0) {
      free = false;
      break;
    }
  }
  if (free) {
    for (const k of ctx.roadGrid.query({ minX: q.minX - 0.01, minZ: q.minZ - 0.01, maxX: q.maxX + 0.01, maxZ: q.maxZ + 0.01 })) {
      const r = ctx.vehicular[k];
      for (let s = 0; s + 1 < r.points.length && free; s++)
        if (polygonDist(aid.box, [r.points[s], r.points[s + 1]]) <= r.width / 2) free = false;
      if (!free) break;
    }
  }
  e.free = free;
  return free;
}

/** La ayuda (base y caja) queda a ≥ 1 m del borde del área jugable. */
function inArea(ctx: Ctx, e: Edge): boolean {
  const r = areaRect();
  const aid = makeAid(ctx.ix.buildings[e.bi], e);
  return [aid.pos, ...aid.box].every(([x, z]) => x >= r.minX + AREA_MARGIN && x <= r.maxX - AREA_MARGIN && z >= r.minZ + AREA_MARGIN && z <= r.maxZ - AREA_MARGIN);
}

function bestOf(ctx: Ctx, cands: Edge[], pick: (e: Edge) => number): { edge: Edge; tier: number } | null {
  // tier 0: caja libre; tier 1: cualquier arista a calle. Gana el mayor `pick`, luego arista más larga, luego orden.
  for (const tier of [0, 1]) {
    let best: Edge | null = null;
    let bestScore = -Infinity;
    for (const e of cands) {
      if (!e.street || !inArea(ctx, e)) continue;
      if (tier === 0 && !isFree(ctx, e, makeAid(ctx.ix.buildings[e.bi], e))) continue;
      const score = pick(e);
      if (best === null || score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && e.len > best.len + 1e-9)) {
        best = e;
        bestScore = score;
      }
    }
    if (best) return { edge: best, tier };
  }
  return null;
}

export interface AidStats { clusters: number; dumpsters: number; ladders: number; tier0: number; tier1: number; fallback: number }

/** Como `placeClimbAids`, pero devuelve además cuántos clusters cayeron en cada nivel de preferencia. */
export function placeClimbAidsWithStats(buildings: Building[], roads: Road[]): { props: Prop[]; stats: AidStats } {
  const ix = indexOf(buildings);
  const vehicular = roads.filter((r) => !NON_VEHICULAR.has(r.kind));
  const roadBoxes = vehicular.map((r) => bboxOf(r.points, r.width / 2));
  const ctx: Ctx = { ix, roadBoxes, roadGrid: createGrid(roadBoxes), vehicular, edges: new Map() };
  const idx = new Map(buildings.map((b, i) => [b.id, i]));
  const props: Prop[] = [];
  const stats: AidStats = { clusters: 0, dumpsters: 0, ladders: 0, tier0: 0, tier1: 0, fallback: 0 };

  for (const cluster of clustersOf(ix)) {
    stats.clusters++;
    const members = cluster.map((id) => idx.get(id)!);
    const area = members.reduce((s, i) => s + polygonArea(buildings[i].footprint), 0);
    const count = 1 + Math.floor(area / AREA_PER_AID);
    const placed: Aid[] = [];
    const push = (e: Edge): void => {
      const aid = makeAid(buildings[e.bi], e);
      placed.push(aid);
      props.push(aid.prop);
      stats[aid.prop.kind === 'dumpster' ? 'dumpsters' : 'ladders']++;
    };

    // primer acceso: arista a calle del edificio más bajo
    let lowest = members[0];
    for (const i of members) if (buildings[i].height < buildings[lowest].height - 1e-9) lowest = i;
    const lowEdges = edgesOf(ctx, lowest);
    const first = bestOf(ctx, lowEdges, () => 0);
    if (first) {
      push(first.edge);
      stats[first.tier === 0 ? 'tier0' : 'tier1']++;
    } else {
      let longest: Edge | undefined;
      for (const e of lowEdges) if (inArea(ctx, e) && (!longest || e.len > longest.len + 1e-9)) longest = e;
      if (longest) {
        push(longest);
        stats.fallback++;
      } else {
        // ninguna arista del más bajo sirve (borde del área): otro miembro del cluster
        const other = bestOf(ctx, members.flatMap((i) => edgesOf(ctx, i)), () => 0);
        if (other) {
          push(other.edge);
          stats[other.tier === 0 ? 'tier0' : 'tier1']++;
        }
      }
    }

    // accesos extra: arista a calle más lejana de los ya colocados
    for (let k = 1; k < count; k++) {
      const cands = members.flatMap((i) => edgesOf(ctx, i)).filter((e) => placed.every((a) => Math.hypot(a.pos[0] - e.mid[0], a.pos[1] - e.mid[1]) > 1e-6));
      const far = (e: Edge): number => Math.min(...placed.map((a) => Math.hypot(a.pos[0] - e.mid[0], a.pos[1] - e.mid[1])));
      const pick = bestOf(ctx, cands, far);
      if (!pick) break;
      push(pick.edge);
    }
  }
  return { props, stats };
}

export function placeClimbAids(buildings: Building[], roads: Road[]): Prop[] {
  return placeClimbAidsWithStats(buildings, roads).props;
}
