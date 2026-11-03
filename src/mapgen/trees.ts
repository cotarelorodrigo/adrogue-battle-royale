import { distPointSegment, hash01, pointInPolygon, polygonArea } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Bounds, Building, Park, Prop, Road, Tree } from '../shared/mapdata.ts';
import { bboxOf, createGrid, distToRing } from './spatial.ts';

const SPACING = 9;
const JITTER = 2;
const SIDEWALK_FRAC = 0.7;
const CORNER_CLEAR = 8;
const FOOTPRINT_CLEAR = 1.5;
const PARK_MIN_DIST = 7;
const PARK_ROAD_CLEAR = 2;
const PARK_TRIES_PER_CELL = 20;
const NON_VEHICULAR = new Set(['footway', 'pedestrian', 'service']);

const cmKey = (p: Vec2): string => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;

function cornersOf(roads: Road[]): Vec2[] {
  const uses = new Map<string, { p: Vec2; roads: Set<string> }>();
  const out = new Map<string, Vec2>();
  for (const r of roads) {
    r.points.forEach((p, i) => {
      const k = cmKey(p);
      const u = uses.get(k) ?? { p, roads: new Set<string>() };
      u.roads.add(r.id);
      uses.set(k, u);
      if (i === 0 || i === r.points.length - 1) out.set(k, p);
    });
  }
  for (const [k, u] of uses) if (u.roads.size >= 2) out.set(k, u.p);
  return [...out.values()];
}

function makeTree(p: Vec2): Tree {
  const k = `tree:${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  return { position: p, variant: Math.min(2, Math.floor(hash01(`${k}:v`) * 3)) as 0 | 1 | 2, scale: 0.85 + hash01(`${k}:s`) * 0.35 };
}

export function placeTrees(roads: Road[], buildings: Building[], parks: Park[], bounds: Bounds): Tree[] {
  const bBoxes = buildings.map((b) => bboxOf(b.footprint, FOOTPRINT_CLEAR));
  const bGrid = createGrid(bBoxes);
  const nearFootprint = (p: Vec2): boolean => {
    for (const j of bGrid.query({ minX: p[0], maxX: p[0], minZ: p[1], maxZ: p[1] }))
      if (distToRing(p, buildings[j].footprint) <= FOOTPRINT_CLEAR) return true;
    return false;
  };
  const vehicular = roads.filter((r) => !NON_VEHICULAR.has(r.kind));
  const vGrid = createGrid(vehicular.map((r) => bboxOf(r.points, r.width / 2)));
  const inCarriageway = (p: Vec2, except?: Road): boolean => {
    for (const k of vGrid.query({ minX: p[0], maxX: p[0], minZ: p[1], maxZ: p[1] })) {
      const r = vehicular[k];
      if (r === except) continue;
      for (let i = 0; i + 1 < r.points.length; i++) if (distPointSegment(p, r.points[i], r.points[i + 1]) <= r.width / 2) return true;
    }
    return false;
  };
  const inBounds = (p: Vec2): boolean => p[0] >= bounds.minX && p[0] <= bounds.maxX && p[1] >= bounds.minZ && p[1] <= bounds.maxZ;
  const corners = cornersOf(roads);
  const cGrid = createGrid(corners.map((c) => bboxOf([c], CORNER_CLEAR)));
  const nearCorner = (p: Vec2): boolean => {
    for (const j of cGrid.query({ minX: p[0], maxX: p[0], minZ: p[1], maxZ: p[1] }))
      if (Math.hypot(p[0] - corners[j][0], p[1] - corners[j][1]) < CORNER_CLEAR) return true;
    return false;
  };

  const trees: Tree[] = [];

  // veredas
  for (const r of roads) {
    if (r.sidewalk <= 0 || r.points.length < 2) continue;
    const off = r.width / 2 + r.sidewalk * SIDEWALK_FRAC;
    const lens: number[] = [];
    let total = 0;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const l = Math.hypot(r.points[i + 1][0] - r.points[i][0], r.points[i + 1][1] - r.points[i][1]);
      lens.push(l);
      total += l;
    }
    for (const side of [1, -1]) {
      for (let k = 0; ; k++) {
        const s = SPACING * k + SPACING / 2 + (hash01(`${r.id}:${side}:${k}`) * 2 - 1) * JITTER;
        if (s > total) break;
        if (s < 0) continue;
        let seg = 0;
        let acc = 0;
        while (seg < lens.length - 1 && acc + lens[seg] < s) acc += lens[seg++];
        if (lens[seg] === 0) continue;
        const a = r.points[seg];
        const b = r.points[seg + 1];
        const t = (s - acc) / lens[seg];
        const dx = (b[0] - a[0]) / lens[seg];
        const dz = (b[1] - a[1]) / lens[seg];
        const p: Vec2 = [a[0] + (b[0] - a[0]) * t - dz * off * side, a[1] + (b[1] - a[1]) * t + dx * off * side];
        if (!inBounds(p) || nearCorner(p) || nearFootprint(p) || inCarriageway(p, r)) continue;
        trees.push(makeTree(p));
      }
    }
  }

  // plazas: Poisson-disc por lanzamiento de dardos determinista
  const rGrid = createGrid(roads.map((r) => bboxOf(r.points, PARK_ROAD_CLEAR)));
  for (const park of parks) {
    const bb = bboxOf(park.polygon);
    const tries = Math.min(5000, Math.ceil((polygonArea(park.polygon) / (PARK_MIN_DIST * PARK_MIN_DIST)) * PARK_TRIES_PER_CELL));
    const accepted: Vec2[] = [];
    const cells = new Map<string, Vec2[]>();
    const cellOf = (v: number): number => Math.floor(v / PARK_MIN_DIST);
    for (let i = 0; i < tries; i++) {
      const p: Vec2 = [
        bb.minX + hash01(`${park.id}:x:${i}`) * (bb.maxX - bb.minX),
        bb.minZ + hash01(`${park.id}:z:${i}`) * (bb.maxZ - bb.minZ),
      ];
      if (!pointInPolygon(p, park.polygon) || !inBounds(p) || nearFootprint(p)) continue;
      let ok = true;
      for (const j of rGrid.query({ minX: p[0], maxX: p[0], minZ: p[1], maxZ: p[1] })) {
        const pts = roads[j].points;
        for (let s = 0; s + 1 < pts.length; s++) if (distPointSegment(p, pts[s], pts[s + 1]) < PARK_ROAD_CLEAR) ok = false;
      }
      if (!ok) continue;
      const ci = cellOf(p[0]);
      const cj = cellOf(p[1]);
      for (let di = -1; di <= 1 && ok; di++)
        for (let dj = -1; dj <= 1 && ok; dj++)
          for (const q of cells.get(`${ci + di},${cj + dj}`) ?? []) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < PARK_MIN_DIST) ok = false;
      if (!ok) continue;
      accepted.push(p);
      const key = `${ci},${cj}`;
      cells.set(key, [...(cells.get(key) ?? []), p]);
    }
    for (const p of accepted) trees.push(makeTree(p));
  }
  return trees;
}

/** Saca los árboles que pisan fuentes, monumentos, bancos, volquetes, escaleras o andenes (placeTrees no ve los props). */
export function filterTrees(trees: Tree[], props: Prop[], platforms: Vec2[][]): Tree[] {
  const circles: { p: Vec2; r: number }[] = [];
  for (const pr of props) {
    if (pr.kind === 'fountain') circles.push({ p: pr.position, r: pr.radius + 2 });
    else if (pr.kind === 'monument') circles.push({ p: pr.position, r: 4.5 });
    else if (pr.kind === 'dumpster' || pr.kind === 'bench') circles.push({ p: pr.position, r: 1.5 });
    else circles.push({ p: pr.base, r: 1.5 });
  }
  return trees.filter((t) => {
    if (circles.some((c) => Math.hypot(t.position[0] - c.p[0], t.position[1] - c.p[1]) < c.r)) return false;
    return !platforms.some((pl) => pointInPolygon(t.position, pl) || distToRing(t.position, pl) < 0.5);
  });
}
