import { hash01, pointInPolygon, polygonArea } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Park, Place, Prop, Road } from '../shared/mapdata.ts';
import { bboxOf, distToRing } from './spatial.ts';

const BENCH_AREA = 400;
const BENCH_OFFSET = 1.5;
const BENCH_MIN_SEP = 4;
const FOUNTAIN_RADIUS = 2.5;

const MONUMENT_STYLE: Record<string, 'equestrian' | 'statue' | 'column'> = {
  'escultura-general-san-martin': 'statue',
  'monumento-a-san-martin': 'equestrian',
  'monumento-al-almirante-guillermo-brown': 'column',
  'monumento-a-esteban-adrogue': 'statue',
};

/** Rotación sobre +Y (convención three.js): el eje local +x apunta a (cos θ, −sin θ) en (x, z). */
const rotationFor = (dx: number, dz: number): number => Math.atan2(-dz, dx);

interface Seg { a: Vec2; b: Vec2; len: number }

/** Tramos de senderos `footway` que tocan la plaza, recortados a los que quedan dentro (por punto medio). */
function innerSegments(park: Park, roads: Road[]): Seg[] {
  const out: Seg[] = [];
  for (const r of roads) {
    if (r.kind !== 'footway' || !r.points.some((p) => pointInPolygon(p, park.polygon))) continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1e-6 && pointInPolygon([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], park.polygon)) out.push({ a, b, len });
    }
  }
  return out;
}

function benchesAlongPaths(park: Park, segs: Seg[], count: number): Prop[] {
  const total = segs.reduce((s, g) => s + g.len, 0);
  const out: Prop[] = [];
  for (let i = 0; i < count; i++) {
    let s = ((i + 0.5) / count) * total;
    let g = segs[0];
    for (const c of segs) {
      g = c;
      if (s <= c.len) break;
      s -= c.len;
    }
    const t = Math.min(1, s / g.len);
    const dx = (g.b[0] - g.a[0]) / g.len;
    const dz = (g.b[1] - g.a[1]) / g.len;
    const c: Vec2 = [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t];
    const first = hash01(`${park.id}:bench:${i}`) < 0.5 ? 1 : -1;
    for (const side of [first, -first]) {
      const pos: Vec2 = [c[0] - dz * BENCH_OFFSET * side, c[1] + dx * BENCH_OFFSET * side];
      if (pointInPolygon(pos, park.polygon)) {
        out.push({ kind: 'bench', position: pos, rotation: rotationFor(dx, dz) });
        break;
      }
    }
  }
  return out;
}

function benchesScattered(park: Park, count: number): Prop[] {
  const bb = bboxOf(park.polygon);
  const out: Prop[] = [];
  const placed: Vec2[] = [];
  const tries = count * 60;
  for (let i = 0; i < tries && placed.length < count; i++) {
    const p: Vec2 = [
      bb.minX + hash01(`${park.id}:bx:${i}`) * (bb.maxX - bb.minX),
      bb.minZ + hash01(`${park.id}:bz:${i}`) * (bb.maxZ - bb.minZ),
    ];
    if (!pointInPolygon(p, park.polygon) || distToRing(p, park.polygon) < BENCH_OFFSET) continue;
    if (placed.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < BENCH_MIN_SEP)) continue;
    placed.push(p);
    out.push({ kind: 'bench', position: p, rotation: hash01(`${park.id}:br:${i}`) * Math.PI });
  }
  return out;
}

export function placeProps(parks: Park[], fountains: Vec2[], places: Omit<Place, 'spawn'>[], roads: Road[]): Prop[] {
  const props: Prop[] = [];
  for (const park of parks) {
    const count = Math.floor(polygonArea(park.polygon) / BENCH_AREA);
    if (count === 0) continue;
    const segs = innerSegments(park, roads);
    props.push(...(segs.length > 0 ? benchesAlongPaths(park, segs, count) : benchesScattered(park, count)));
  }
  for (const position of fountains) props.push({ kind: 'fountain', position, radius: FOUNTAIN_RADIUS });
  for (const p of places) {
    if (p.type !== 'monument') continue;
    props.push({ kind: 'monument', placeId: p.id, position: p.position, style: MONUMENT_STYLE[p.id] ?? 'statue' });
  }
  return props;
}
