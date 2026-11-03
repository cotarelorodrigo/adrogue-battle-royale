import { ORIGIN, areaRect, pointInPolygon } from '../shared/geo.ts';
import type { Vec2, Vec3 } from '../shared/geo.ts';
import { buildCollisionWorld } from '../shared/collision.ts';
import type { Building, MapData, Place, Prop, Tree } from '../shared/mapdata.ts';
import { parseOsm } from './osm.ts';
import { buildBuildings } from './buildings.ts';
import type { GeoJSONFeatureCollection } from './buildings.ts';
import { matchPlaces } from './places.ts';
import type { PlaceInput } from './places-input.ts';
import { placeClimbAidsWithStats } from './climb.ts';
import type { AidStats } from './climb.ts';
import { placeTrees } from './trees.ts';
import { placeProps } from './props.ts';
import { distToRing } from './spatial.ts';
import { findFreeSpot, randomSpawns } from './spawns.ts';

const EYE_Y = 1.6;
const SIGN_CLEAR = 0.3;
const SPAWN_RADIUS = 16;
const SPAWN_CLEARANCE = 2.5;

const rn = (n: number, d = 2): number => { const f = 10 ** d; return Math.round(n * f) / f; };
const v2 = (p: Vec2, d = 2): Vec2 => [rn(p[0], d), rn(p[1], d)];
/** Redondea y quita vértices consecutivos repetidos (también el último igual al primero). */
function ring(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts.map((q) => v2(q))) {
    const l = out[out.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
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

export function assembleMap(
  raw: { osm: unknown; buildings: GeoJSONFeatureCollection; places: PlaceInput[] },
): { map: MapData; warnings: string[]; stats: AidStats } {
  const warnings: string[] = [];
  const { roads, railways, platforms, parks, fountains } = parseOsm(raw.osm);
  const built = buildBuildings(raw.buildings, roads, parks);
  const matched = matchPlaces(raw.places, built.buildings, parks, roads);
  warnings.push(...matched.warnings);
  const { props: aids, stats } = placeClimbAidsWithStats(matched.buildings, roads);
  const bounds = areaRect();
  const trees = placeTrees(roads, matched.buildings, parks, bounds);
  const props = [...aids, ...placeProps(parks, fountains, matched.places, roads)];
  const kept = filterTrees(trees, props, platforms);

  const buildings: Building[] = [];
  for (const b of matched.buildings) {
    const footprint = ring(b.footprint);
    if (footprint.length < 3) { warnings.push(`${b.id}: la planta se degenera al redondear`); continue; }
    buildings.push({ ...b, footprint, height: rn(b.height) });
  }
  const outskirts = built.outskirts.flatMap((o) => {
    const footprint = ring(o.footprint);
    return footprint.length < 3 ? [] : [{ footprint, height: rn(o.height) }];
  });

  const map: MapData = {
    version: 1,
    origin: { ...ORIGIN },
    bounds: { minX: rn(bounds.minX), maxX: rn(bounds.maxX), minZ: rn(bounds.minZ), maxZ: rn(bounds.maxZ) },
    buildings,
    outskirts,
    roads: roads.map((r) => ({ ...r, width: rn(r.width), sidewalk: rn(r.sidewalk), points: r.points.map((p) => v2(p)) })),
    railways: railways.map((l) => l.map((p) => v2(p))),
    platforms: platforms.map(ring),
    parks: parks.map((k) => ({ ...k, polygon: ring(k.polygon) })),
    places: [],
    props: props.map((p): Prop => {
      switch (p.kind) {
        case 'ladder': return { ...p, base: v2(p.base), normal: v2(p.normal, 3), topY: rn(p.topY) };
        case 'dumpster': case 'bench': return { ...p, position: v2(p.position), rotation: rn(p.rotation, 3) };
        case 'fountain': return { ...p, position: v2(p.position), radius: rn(p.radius) };
        case 'monument': return { ...p, position: v2(p.position) };
      }
    }),
    trees: kept.map((t) => ({ ...t, position: v2(t.position), scale: rn(t.scale) })),
    randomSpawns: [],
  };

  const world = buildCollisionWorld(map);
  map.places = matched.places.map((p0): Place => {
    const p: Omit<Place, 'spawn'> = {
      ...p0,
      position: v2(p0.position),
      ...(p0.sign ? { sign: { ...p0.sign, anchor: v2(p0.sign.anchor), normal: v2(p0.sign.normal, 3), width: rn(p0.sign.width), bottomY: rn(p0.sign.bottomY) } } : {}),
    };
    let near: Vec2 | null = null;
    if (p.sign) near = [p.sign.anchor[0] + p.sign.normal[0] * 7, p.sign.anchor[1] + p.sign.normal[1] * 7];
    else if (p.type === 'plaza' || p.type === 'monument') near = [p.position[0], p.position[1] + 10];
    if (!near) { warnings.push(`${p.id}: no se pudo ubicar el punto de aparición`); near = p.position; }
    const sign = p.sign;
    const seesSign = sign
      ? (s: Vec3): boolean => {
          // de frente al cartel: a ≤ 60° de la normal (de lo contrario se lo ve de canto, pegado a la fachada)
          const off: Vec2 = [s[0] - sign.anchor[0], s[2] - sign.anchor[1]];
          if (off[0] * sign.normal[0] + off[1] * sign.normal[1] < 0.5 * Math.hypot(off[0], off[1])) return false;
          const eye: Vec3 = [s[0], EYE_Y, s[2]];
          const target: Vec3 = [sign.anchor[0], sign.bottomY + 0.45, sign.anchor[1]];
          const dir: Vec3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
          const dist = Math.hypot(dir[0], dir[1], dir[2]);
          const hit = world.raycast(eye, dir, dist);
          return !hit || hit.dist >= dist - SIGN_CLEAR;
        }
      : undefined;
    let spawn = findFreeSpot(world, near, SPAWN_RADIUS, SPAWN_CLEARANCE, seesSign);
    if (!spawn && seesSign) {
      spawn = findFreeSpot(world, near, SPAWN_RADIUS, SPAWN_CLEARANCE);
      if (spawn) warnings.push(`${p.id}: punto de aparición sin línea de vista de frente al cartel`);
    }
    if (!spawn) {
      spawn = findFreeSpot(world, near, SPAWN_RADIUS, 1);
      if (spawn) warnings.push(`${p.id}: punto de aparición con solo 1 m libre`);
    }
    if (!spawn) warnings.push(`${p.id}: sin punto libre cerca de ${near.map((n) => rn(n, 1)).join(', ')}`);
    return { ...p, spawn: spawn ?? [rn(near[0]), 0, rn(near[1])] };
  });
  map.randomSpawns = randomSpawns(world);
  if (map.randomSpawns.length < 64) warnings.push(`randomSpawns: solo ${map.randomSpawns.length} de 64`);
  return { map, warnings, stats };
}
