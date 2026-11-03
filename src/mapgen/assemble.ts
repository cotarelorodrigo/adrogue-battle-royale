import { ORIGIN, areaRect } from '../shared/geo.ts';
import type { Vec2, Vec3 } from '../shared/geo.ts';
import { buildCollisionWorld } from '../shared/collision.ts';
import type { Building, MapData, Place, Prop } from '../shared/mapdata.ts';
import { parseOsm } from './osm.ts';
import { buildBuildings } from './buildings.ts';
import type { GeoJSONFeatureCollection } from './buildings.ts';
import { matchPlaces } from './places.ts';
import type { PlaceInput } from './places-input.ts';
import { placeClimbAidsWithStats } from './climb.ts';
import type { AidStats } from './climb.ts';
import { filterTrees, placeTrees } from './trees.ts';
import { exitPockets } from './pockets.ts';
import type { PocketStats } from './pockets.ts';
import { placeProps } from './props.ts';
import { ring, rn, v2 } from './round.ts';
import { SPAWN_RELAXED, findFreeSpot, randomSpawns, seesSign } from './spawns.ts';

const SPAWN_RADIUS = 16;
const SPAWN_CLEARANCE = 2.5;

export function assembleMap(
  raw: { osm: unknown; buildings: GeoJSONFeatureCollection; places: PlaceInput[] },
): { map: MapData; warnings: string[]; stats: AidStats; pockets: PocketStats } {
  const warnings: string[] = [];
  const { roads, railways, platforms, parks, fountains } = parseOsm(raw.osm);
  const built = buildBuildings(raw.buildings, roads, parks);
  const matched = matchPlaces(raw.places, built.buildings, parks, roads);
  warnings.push(...matched.warnings);
  const { props: aids, stats } = placeClimbAidsWithStats(matched.buildings, roads);
  if (stats.noAid > 0) warnings.push(`${stats.noAid} cluster(s) de techos sin ayuda de ascenso aunque tienen aristas adentro del área`);
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

  // huecos de suelo sin salida: escalera adentro o relleno (antes de los spawns, que usan el mundo final)
  const holes = exitPockets(map);
  warnings.push(...holes.warnings);

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
    const accept = sign ? (v: Vec3): boolean => seesSign(world, sign, v) : undefined;
    let spawn = findFreeSpot(world, near, SPAWN_RADIUS, SPAWN_CLEARANCE, accept);
    if (!spawn && accept) {
      spawn = findFreeSpot(world, near, SPAWN_RADIUS, SPAWN_CLEARANCE);
      if (spawn) warnings.push(`${SPAWN_RELAXED} ${p.id}: punto de aparición sin línea de vista de frente al cartel`);
    }
    if (!spawn) {
      spawn = findFreeSpot(world, near, SPAWN_RADIUS, 1);
      if (spawn) warnings.push(`${SPAWN_RELAXED} ${p.id}: punto de aparición con solo 1 m libre`);
    }
    if (!spawn) warnings.push(`${p.id}: sin punto libre cerca de ${near.map((n) => rn(n, 1)).join(', ')}`);
    return { ...p, spawn: spawn ?? [rn(near[0]), 0, rn(near[1])] };
  });
  map.randomSpawns = randomSpawns(world);
  if (map.randomSpawns.length < 64) warnings.push(`randomSpawns: solo ${map.randomSpawns.length} de 64`);
  return { map, warnings, stats, pockets: holes.stats };
}
