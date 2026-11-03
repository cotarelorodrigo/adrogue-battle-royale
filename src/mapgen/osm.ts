import { project, ensureCCW } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Park, Road, RoadKind } from '../shared/mapdata.ts';

export const ROAD_SPECS: Record<RoadKind, { width: number; sidewalk: number }> = {
  secondary: { width: 12, sidewalk: 3 },
  tertiary: { width: 10, sidewalk: 3 },
  residential: { width: 8, sidewalk: 3 },
  living_street: { width: 6, sidewalk: 2 },
  service: { width: 4, sidewalk: 0 },
  pedestrian: { width: 6, sidewalk: 0 },
  footway: { width: 2.5, sidewalk: 0 },
};

export interface OsmFeatures {
  roads: Road[];
  railways: Vec2[][];
  platforms: Vec2[][];
  parks: Park[];
  fountains: Vec2[];
}

interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
interface OsmWay { type: 'way'; id: number; nodes: number[]; tags?: Record<string, string> }

const PLATFORM_HALF_WIDTH = 2;

function roadKind(highway: string | undefined): RoadKind | null {
  if (!highway) return null;
  const k = highway === 'primary' ? 'secondary' : highway;
  return k in ROAD_SPECS ? (k as RoadKind) : null;
}

/** Desplaza una polilínea `d` metros a la izquierda (normal por vértice, unión en inglete). */
function offsetLine(pts: Vec2[], d: number): Vec2[] {
  return pts.map((p, i) => {
    const prev = pts[Math.max(i - 1, 0)];
    const next = pts[Math.min(i + 1, pts.length - 1)];
    const norm = (a: Vec2, b: Vec2): Vec2 => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      return [-dz / l, dx / l];
    };
    const n1 = i > 0 ? norm(prev, p) : norm(p, next);
    const n2 = i < pts.length - 1 ? norm(p, next) : n1;
    let mx = n1[0] + n2[0];
    let mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-9) return [p[0] + n1[0] * d, p[1] + n1[1] * d];
    mx /= ml;
    mz /= ml;
    const k = d / Math.max(mx * n1[0] + mz * n1[1], 0.25);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}

function bufferLine(pts: Vec2[], half: number): Vec2[] {
  return ensureCCW([...offsetLine(pts, half), ...offsetLine(pts, -half).reverse()]);
}

export function parseOsm(raw: unknown): OsmFeatures {
  const elements = (raw as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) throw new Error('JSON de OSM inválido: falta el arreglo "elements"');

  const nodes = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  for (const e of elements as (OsmNode | OsmWay)[]) {
    if (e.type === 'node') nodes.set(e.id, e);
    else if (e.type === 'way') ways.push(e);
  }

  const out: OsmFeatures = { roads: [], railways: [], platforms: [], parks: [], fountains: [] };
  for (const n of nodes.values()) {
    if (n.tags?.amenity === 'fountain') out.fountains.push(project(n.lat, n.lon));
  }

  for (const w of ways) {
    const t = w.tags ?? {};
    const closed = w.nodes.length > 1 && w.nodes[0] === w.nodes[w.nodes.length - 1];
    const ids = closed ? w.nodes.slice(0, -1) : w.nodes;
    const pts: Vec2[] = [];
    for (const id of ids) {
      const n = nodes.get(id);
      if (n) pts.push(project(n.lat, n.lon));
    }

    const kind = roadKind(t.highway);
    if (kind) {
      if (pts.length < 2) continue;
      const pointsFull = closed && pts.length === ids.length ? [...pts, pts[0]] : pts;
      out.roads.push({ id: `w${w.id}`, kind, ...(t.name ? { name: t.name } : {}), ...ROAD_SPECS[kind], points: pointsFull });
    } else if (t.railway === 'rail') {
      if (pts.length >= 2) out.railways.push(closed && pts.length === ids.length ? [...pts, pts[0]] : pts);
    } else if (t.railway === 'platform') {
      if (closed) {
        if (pts.length >= 3) out.platforms.push(ensureCCW(pts));
      } else if (pts.length >= 2) {
        out.platforms.push(bufferLine(pts, PLATFORM_HALF_WIDTH));
      }
    } else if (t.leisure === 'park' && closed && pts.length >= 3) {
      out.parks.push({ id: `p${w.id}`, ...(t.name ? { name: t.name } : {}), polygon: ensureCCW(pts) });
    }
  }
  return out;
}
