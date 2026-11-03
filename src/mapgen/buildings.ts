import { areaRect, distPointSegment, ensureCCW, hash01, pointInPolygon, polygonArea, project } from '../shared/geo.ts';
import polygonClipping from 'polygon-clipping';
import type { Vec2 } from '../shared/geo.ts';
import type { Building, OutskirtBuilding, Road } from '../shared/mapdata.ts';

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Polygon'; coordinates: number[][][] };
    properties?: Record<string, unknown>;
  }[];
}

export const COMMERCIAL_STREETS: readonly string[] = [
  'Esteban Adrogué', 'Avenida Espora', 'Bartolomé Mitre', 'Francisco Seguí',
  'Diagonal Almirante Brown', 'Samuel Miguel Spiro', 'Avenida Amenedo', 'Plaza Esteban Adrogué',
];
export const FLOOR_H = 3.2;
export const PARAPET = 0.6;
export const heightFor = (floors: number): number => floors * FLOOR_H + PARAPET;

const MIN_AREA = 12;
const SIMPLIFY_M = 0.3;
const CORRIDOR_M = 25;
const APARTMENT_MIN_AREA = 400;
const TINTS = ['#f4f1ea', '#ece4d3', '#e6d9b8', '#ddc9a0', '#d8d4cc', '#c9c5bc', '#efe6d8', '#e2d3c0'];

function simplifyPath(pts: Vec2[], eps: number): Vec2[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  let idx = -1;
  let max = eps;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distPointSegment(pts[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (idx < 0) return [a, b];
  return [...simplifyPath(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplifyPath(pts.slice(idx), eps)];
}

/** Douglas-Peucker sobre un anillo abierto: parte en el vértice más lejano al primero. */
function simplifyRing(ring: Vec2[], eps: number): Vec2[] {
  let far = 0;
  let max = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > max) { max = d; far = i; }
  }
  if (far === 0) return ring;
  const first = simplifyPath(ring.slice(0, far + 1), eps);
  const second = simplifyPath([...ring.slice(far), ring[0]], eps);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function centroid(poly: Vec2[]): Vec2 {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const c = x1 * z2 - x2 * z1;
    a += c; cx += (x1 + x2) * c; cz += (z1 + z2) * c;
  }
  if (Math.abs(a) < 1e-9) return poly[0];
  return [cx / (3 * a), cz / (3 * a)];
}

interface Cand { footprint: Vec2[]; area: number; c: Vec2; bbox: [number, number, number, number] }

function bboxOf(p: Vec2[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}

const NO_CLIP_KINDS: readonly string[] = ['footway', 'pedestrian', 'service'];
const JOINT_SIDES = 12;

type Poly = [number, number][][];
interface Corridor { poly: Poly; bbox: [number, number, number, number] }

/** Calzada de cada vía vehicular: un rectángulo por tramo más un polígono en cada vértice (juntas y extremos). */
function corridorsOf(roads: Road[]): Corridor[] {
  const out: Corridor[] = [];
  const add = (ring: Vec2[]) => out.push({ poly: [[...ring, ring[0]]], bbox: bboxOf(ring) });
  for (const r of roads) {
    if (NO_CLIP_KINDS.includes(r.kind)) continue;
    const h = r.width / 2;
    if (!(h > 0)) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [a, b] = [r.points[i], r.points[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const nx = (-(b[1] - a[1]) / len) * h;
      const nz = ((b[0] - a[0]) / len) * h;
      add([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]]);
    }
    for (const [x, z] of r.points) {
      const ring: Vec2[] = [];
      for (let k = 0; k < JOINT_SIDES; k++) {
        const t = (2 * Math.PI * k) / JOINT_SIDES;
        ring.push([x + h * Math.cos(t), z + h * Math.sin(t)]);
      }
      add(ring);
    }
  }
  return out;
}

/** Fracción (0..1) del área de `small` cubierta por `big`, con grilla de 1 m. */
function overlapFraction(small: Cand, big: Cand): number {
  const x0 = Math.max(small.bbox[0], big.bbox[0]);
  const z0 = Math.max(small.bbox[1], big.bbox[1]);
  const x1 = Math.min(small.bbox[2], big.bbox[2]);
  const z1 = Math.min(small.bbox[3], big.bbox[3]);
  if (x0 >= x1 || z0 >= z1) return 0;
  let total = 0, both = 0;
  for (let x = small.bbox[0] + 0.5; x < small.bbox[2]; x += 1) {
    for (let z = small.bbox[1] + 0.5; z < small.bbox[3]; z += 1) {
      if (!pointInPolygon([x, z], small.footprint)) continue;
      total++;
      if (x > x0 && x < x1 && z > z0 && z < z1 && pointInPolygon([x, z], big.footprint)) both++;
    }
  }
  return total === 0 ? 0 : both / total;
}

export function buildBuildings(
  fc: GeoJSONFeatureCollection,
  roads: Road[],
): { buildings: Building[]; outskirts: OutskirtBuilding[] } {
  const rect = areaRect();

  // calzadas (grilla espacial para recortar solo contra las cercanas)
  const CELL = 50;
  const grid = new Map<string, Corridor[]>();
  for (const c of corridorsOf(roads)) {
    for (let i = Math.floor(c.bbox[0] / CELL); i <= Math.floor(c.bbox[2] / CELL); i++)
      for (let j = Math.floor(c.bbox[1] / CELL); j <= Math.floor(c.bbox[3] / CELL); j++) {
        const k = `${i},${j}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(c);
      }
  }
  const nearby = (bb: [number, number, number, number]): Corridor[] => {
    const set = new Set<Corridor>();
    for (let i = Math.floor(bb[0] / CELL); i <= Math.floor(bb[2] / CELL); i++)
      for (let j = Math.floor(bb[1] / CELL); j <= Math.floor(bb[3] / CELL); j++)
        for (const c of grid.get(`${i},${j}`) ?? [])
          if (c.bbox[0] < bb[2] && c.bbox[2] > bb[0] && c.bbox[1] < bb[3] && c.bbox[3] > bb[1]) set.add(c);
    return [...set];
  };

  // 1-3'. proyectar, CCW, simplificar, recortar calzada (cada pedazo repite 1 y 2), área mínima
  const toCand = (ring: Vec2[]): Cand | null => {
    if (ring.length < 3) return null;
    const footprint = ensureCCW(simplifyRing(ring, SIMPLIFY_M));
    if (footprint.length < 3) return null;
    const area = polygonArea(footprint);
    if (area < MIN_AREA) return null;
    return { footprint, area, c: centroid(footprint), bbox: bboxOf(footprint) };
  };
  let cands: Cand[] = [];
  for (const f of fc.features) {
    let ring: Vec2[] = f.geometry.coordinates[0].map(([lon, lat]) => project(lat, lon));
    const l = ring.length - 1;
    if (l > 0 && ring[0][0] === ring[l][0] && ring[0][1] === ring[l][1]) ring = ring.slice(0, -1);
    const whole = toCand(ring);
    if (!whole) continue;
    const near = nearby(whole.bbox);
    if (near.length === 0) { cands.push(whole); continue; }
    const subject: Poly = [[...whole.footprint, whole.footprint[0]]];
    const pieces = polygonClipping.difference(subject, ...near.map((c) => c.poly));
    for (const piece of pieces) {
      const outer = piece[0].slice(0, -1) as Vec2[]; // se descartan los huecos
      const cand = toCand(outer);
      if (cand) cands.push(cand);
    }
  }

  // 4. superposición: de mayor a menor, se descarta el que queda cubierto > 50 % por uno ya aceptado
  const bySize = [...cands].sort((a, b) => b.area - a.area || a.c[1] - b.c[1] || a.c[0] - b.c[0]);
  const kept: Cand[] = [];
  for (const c of bySize) {
    let drop = false;
    for (const k of kept) {
      if (k.bbox[0] >= c.bbox[2] || k.bbox[2] <= c.bbox[0] || k.bbox[1] >= c.bbox[3] || k.bbox[3] <= c.bbox[1]) continue;
      if (overlapFraction(c, k) > 0.5) { drop = true; break; }
    }
    if (!drop) kept.push(c);
  }
  const keptSet = new Set(kept);
  cands = cands.filter((c) => keptSet.has(c)); // conserva el orden de entrada

  // 5. fuera del área estricta → outskirts
  const inside: Cand[] = [];
  const outskirts: OutskirtBuilding[] = [];
  for (const c of cands) {
    const [x, z] = c.c;
    if (x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ) inside.push(c);
    else outskirts.push({ footprint: c.footprint, height: heightFor(hash01(`o${x.toFixed(1)},${z.toFixed(1)}`) < 0.5 ? 1 : 2) });
  }

  // 6. ids por z (redondeado) y x
  inside.sort((a, b) => Math.round(a.c[1]) - Math.round(b.c[1]) || a.c[0] - b.c[0]);

  // 7-8. clasificación
  const corridor: [Vec2, Vec2][] = [];
  for (const r of roads) {
    if (!r.name || !COMMERCIAL_STREETS.includes(r.name)) continue;
    for (let i = 0; i < r.points.length - 1; i++) corridor.push([r.points[i], r.points[i + 1]]);
  }
  const buildings: Building[] = inside.map((c, i) => {
    const id = `b${String(i + 1).padStart(4, '0')}`;
    const inCorridor = corridor.some(([a, b]) => distPointSegment(c.c, a, b) <= CORRIDOR_M);
    const h = hash01(id);
    let kind: Building['kind'];
    let floors: number;
    if (inCorridor && c.area >= APARTMENT_MIN_AREA) {
      kind = 'apartments';
      floors = 4 + Math.floor(hash01(id + 'f') * 5);
    } else if (inCorridor) {
      kind = 'shop';
      floors = h < 0.5 ? 1 : h < 0.8 ? 2 : 3;
    } else {
      kind = 'house';
      floors = h < 0.65 ? 1 : 2;
    }
    return {
      id, footprint: c.footprint, height: heightFor(floors), floors, kind,
      wall: hash01(id + 'w') < 0.18 ? 'brick' : 'plaster',
      tint: TINTS[Math.floor(hash01(id + 't') * TINTS.length)],
    };
  });
  return { buildings, outskirts };
}
