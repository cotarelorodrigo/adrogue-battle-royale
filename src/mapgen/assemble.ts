import { ORIGIN, areaRect } from '../shared/geo.ts';
import type { Vec2, Vec3 } from '../shared/geo.ts';
import { buildCollisionWorld } from '../shared/collision.ts';
import type { Building, MapData, Place, Prop, Sign } from '../shared/mapdata.ts';
import { parseOsm } from './osm.ts';
import { applyFrentes, lotSigns } from './frentes.ts';
import type { FrentesInput } from './frentes-input.ts';
import { frontEdgesOf, frontIsContra } from './lots.ts';
import { buildBuildings } from './buildings.ts';
import type { GeoJSONFeatureCollection } from './buildings.ts';
import { matchPlaces } from './places.ts';
import type { PlaceInput } from './places-input.ts';
import { placeClimbAidsWithStats } from './climb.ts';
import type { AidStats } from './climb.ts';
import { filterTrees, placeTrees } from './trees.ts';
import { exitPockets } from './pockets.ts';
import type { PocketStats } from './pockets.ts';
import { placeFacades } from './place-facades.ts';
import type { PhotoEdge } from './place-facades.ts';
import { placeProps } from './props.ts';
import { ring, rn, v2 } from './round.ts';
import { SPAWN_RELAXED, findFreeSpot, randomSpawns, seesSign } from './spawns.ts';

const SPAWN_RADIUS = 16;
const SPAWN_CLEARANCE = 2.5;
const NO_FRENTES: FrentesInput = { frentes: [], calzadas: {} };

const roundSign = (s: Sign): Sign => ({ ...s, anchor: v2(s.anchor), normal: v2(s.normal, 3), width: rn(s.width), bottomY: rn(s.bottomY) });

/** `photos`: lo que mapgen usa de data/photo-facades.json (la arista de cada foto, para su fachada). */
export function assembleMap(
  raw: { osm: unknown; buildings: GeoJSONFeatureCollection; places: PlaceInput[]; photos?: PhotoEdge[]; frentes?: FrentesInput },
): { map: MapData; warnings: string[]; stats: AidStats; pockets: PocketStats; report: string[] } {
  const warnings: string[] = [];
  const { roads, railways, platforms, parks, fountains, pois } = parseOsm(raw.osm);
  for (const r of roads) {
    const calzada = r.name === undefined ? undefined : raw.frentes?.calzadas[r.name];
    if (calzada === 'empedrado') r.surface = 'sett';
    else if (calzada === 'asfalto') delete r.surface;
  }
  for (const name of Object.keys(raw.frentes?.calzadas ?? {})) {
    if (!roads.some((r) => r.name === name)) warnings.push(`calle "${name}": OSM no tiene ninguna calle con ese nombre (la calzada no se aplica)`);
  }
  const built = buildBuildings(raw.buildings, roads, parks);
  const fr = applyFrentes(raw.frentes ?? NO_FRENTES, roads, built.buildings, raw.places, pois);
  warnings.push(...fr.warnings);
  const matched = matchPlaces(raw.places, fr.buildings, parks, roads, fr.fixed);
  warnings.push(...matched.warnings);
  const { props: aids, stats, slots } = placeClimbAidsWithStats(matched.buildings, roads, fr.climb);
  // una ayuda en la fachada de un lote va en una punta: su cartel deja libre ese tramo (y el toldo, en el cliente)
  const signs = lotSigns(fr, slots);
  for (const p of matched.places) {
    const lot = fr.fixed.get(p.id);
    if (lot && p.sign) p.sign = signs.byLot.get(lot.buildingId)!;
  }
  if (stats.noAid > 0) warnings.push(`${stats.noAid} cluster(s) de techos sin ayuda de ascenso aunque tienen aristas adentro del área`);
  const bounds = areaRect();
  const trees = placeTrees(roads, matched.buildings, parks, bounds);
  const props = [...aids, ...placeProps(parks, fountains, matched.places, roads)];
  const kept = filterTrees(trees, props, platforms);

  const buildings: Building[] = [];
  for (const b of matched.buildings) {
    const footprint = ring(b.footprint);
    if (footprint.length < 3) { warnings.push(`${b.id}: la planta se degenera al redondear`); continue; }
    const lot = b.front && fr.fronts.get(b.id);
    if (b.front && lot) {
      // las aristas del frente se buscan sobre la planta ya redondeada
      const line = lot.front.map((p) => v2(p));
      const edges = frontEdgesOf(footprint, line);
      const contra = frontIsContra(footprint, edges, line);
      if (edges.length === 0) warnings.push(`${b.id}: el frente no coincide con ninguna arista`);
      const corner = [...new Set(lot.cornerRings.flatMap((c) => { const r = ring(c); return frontEdgesOf(footprint, [...r, r[0]]); }))]
        .filter((e) => !edges.includes(e));
      const slot = slots.get(b.id);
      const ayuda = slot && Object.fromEntries(Object.entries(slot).map(([k, v]) => [k, rn(v)]));
      buildings.push({
        ...b, footprint, height: rn(b.height),
        front: { ...b.front, edges, corner, ...(contra ? { contra: true as const } : {}), ...(ayuda ? { ayuda } : {}) },
      });
      continue;
    }
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
    signs: signs.signs.map(roundSign),
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
      ...(p0.sign ? { sign: roundSign(p0.sign) } : {}),
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
  // fachadas por lugar sobre las plantas y los carteles ya redondeados (los índices de arista son los del archivo)
  warnings.push(...placeFacades(map.buildings, map.places, raw.places, raw.photos ?? []));
  warnings.push(...lotPhotoWarnings(map, raw.photos ?? []));
  map.randomSpawns = randomSpawns(world);
  if (map.randomSpawns.length < 64) warnings.push(`randomSpawns: solo ${map.randomSpawns.length} de 64`);
  return { map, warnings, stats, pockets: holes.stats, report: fr.report };
}

/** Una foto de un lugar con lote no manda sobre el relevamiento: va a la arista del cartel y tiene que caber en el frente. */
function lotPhotoWarnings(map: MapData, photos: PhotoEdge[]): string[] {
  const out: string[] = [];
  for (const ph of photos) {
    const b = map.buildings.find((x) => x.id === map.places.find((p) => p.id === ph.placeId)?.buildingId);
    if (!b?.front) continue;
    if (ph.edgeIndex !== undefined) out.push(`${ph.placeId}: la foto de un lugar con lote va a la arista del cartel (sacale edgeIndex)`);
    if (ph.heightM !== undefined && ph.heightM > b.height + 0.5) out.push(`${ph.placeId}: la foto mide ${ph.heightM} m y el lote ${rn(b.height, 1)} m`);
    if (ph.widthM !== undefined) {
      const len = b.front.edges.reduce((sum, e) => {
        const [a, c] = [b.footprint[e], b.footprint[(e + 1) % b.footprint.length]];
        return sum + Math.hypot(c[0] - a[0], c[1] - a[1]);
      }, 0);
      if (ph.widthM > len + 1) out.push(`${ph.placeId}: la foto mide ${ph.widthM} m de ancho y el frente del lote ${rn(len, 1)} m`);
    }
  }
  return out;
}
