import { readFileSync } from 'node:fs';
import { assembleMap, filterTrees } from '../../src/mapgen/assemble.ts';
import { findFreeSpot, randomSpawns } from '../../src/mapgen/spawns.ts';
import { loadPlaces } from '../../src/mapgen/places-input.ts';
import { roofClusters } from '../../src/mapgen/climb.ts';
import { buildCollisionWorld } from '../../src/shared/collision.ts';
import { distPointSegment, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { MapData, Prop, Tree } from '../../src/shared/mapdata.ts';

function loadRaw() {
  return {
    osm: JSON.parse(readFileSync('data/raw/osm.json', 'utf8')) as unknown,
    buildings: JSON.parse(readFileSync('data/raw/ms-buildings.geojson', 'utf8')),
    places: loadPlaces(),
  };
}

function roadPointsInsideBuildings(map: MapData): string[] {
  const bad: string[] = [];
  for (const r of map.roads) {
    if (['footway', 'pedestrian', 'service'].includes(r.kind)) continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i], b = r.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let k = 0; k <= n; k++) {
        const p: Vec2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const bd = map.buildings.find((q) => pointInPolygon(p, q.footprint));
        if (bd) bad.push(`${r.id}@${p[0].toFixed(1)},${p[1].toFixed(1)} en ${bd.id}`);
      }
    }
  }
  return bad;
}

function hasAccess(clusterIds: string[], props: Prop[]): boolean {
  const ids = new Set(clusterIds);
  return props.some((p) => p.kind === 'ladder' && ids.has(p.buildingId)) || props.some((p) => {
    if (p.kind !== 'dumpster') return false;
    return map.buildings.some((b) => ids.has(b.id) && b.footprint.some((v, i) =>
      distPointSegment(p.position, v, b.footprint[(i + 1) % b.footprint.length]) <= 1.5));
  });
}

const { map, warnings } = assembleMap(loadRaw());
const world = buildCollisionWorld(map);

describe('assembleMap sobre datos reales', () => {
  test('sin warnings salvo relajaciones del punto de aparición', () => expect(warnings.filter((w) => !w.includes('punto de aparición'))).toEqual([]));
  test('cantidades razonables', () => {
    expect(map.buildings.length).toBeGreaterThan(1000); expect(map.buildings.length).toBeLessThan(1300);
    expect(map.places).toHaveLength(38); expect(map.parks.length).toBeGreaterThanOrEqual(12);
    expect(map.trees.length).toBeGreaterThan(1000);
    expect(map.randomSpawns).toHaveLength(64);
  });
  test('todo lugar no-plaza/no-monumento tiene edificio y cartel', () => map.places.filter((p) => !['plaza', 'monument'].includes(p.type))
    .forEach((p) => { expect(p.buildingId, p.id).toBeDefined(); expect(p.sign, p.id).toBeDefined(); }));
  test('todos los spawns libres y dentro del área', () => [...map.places.map((p) => p.spawn), ...map.randomSpawns].forEach((s) => {
    expect(world.overlaps(s[0], s[2], 0.35, s[1] + 0.05, s[1] + 1.8)).toBe(false);
    expect(s[0]).toBeGreaterThan(map.bounds.minX); expect(s[0]).toBeLessThan(map.bounds.maxX);
    expect(s[2]).toBeGreaterThan(map.bounds.minZ); expect(s[2]).toBeLessThan(map.bounds.maxZ);
  }));
  test('cada spawn de lugar tiene 2,5 m libres, o figura en warnings', () => map.places.forEach((p) => {
    const s = p.spawn;
    if (!world.overlaps(s[0], s[2], 0.35 + 2.5, 0.05, 1.8)) return;
    expect(warnings.some((w) => w.startsWith(`${p.id}:`)), p.id).toBe(true);
  }));
  test('cada lugar con cartel ve el cartel desde su spawn, o figura en warnings', () => map.places.forEach((p) => {
    if (!p.sign) return;
    const eye: [number, number, number] = [p.spawn[0], 1.6, p.spawn[2]];
    const t: [number, number, number] = [p.sign.anchor[0], p.sign.bottomY + 0.45, p.sign.anchor[1]];
    const dir: [number, number, number] = [t[0] - eye[0], t[1] - eye[1], t[2] - eye[2]];
    const dist = Math.hypot(...dir);
    const hit = world.raycast(eye, dir, dist);
    const off: Vec2 = [p.spawn[0] - p.sign.anchor[0], p.spawn[2] - p.sign.anchor[1]];
    const front = off[0] * p.sign.normal[0] + off[1] * p.sign.normal[1] >= 0.5 * Math.hypot(off[0], off[1]);
    if (front && (!hit || hit.dist >= dist - 0.3)) return;
    expect(warnings.some((w) => w.startsWith(`${p.id}:`)), p.id).toBe(true);
  }));
  test('ninguna ayuda de ascenso queda a menos de 1 m del borde', () => map.props.forEach((pr) => {
    const q = pr.kind === 'ladder' ? pr.base : pr.kind === 'dumpster' ? pr.position : null;
    if (!q) return;
    expect(q[0]).toBeGreaterThanOrEqual(map.bounds.minX + 1); expect(q[0]).toBeLessThanOrEqual(map.bounds.maxX - 1);
    expect(q[1]).toBeGreaterThanOrEqual(map.bounds.minZ + 1); expect(q[1]).toBeLessThanOrEqual(map.bounds.maxZ - 1);
  }));
  test('no quedan edificios dentro de parques', () => map.buildings.forEach((b) => {
    const c: Vec2 = [b.footprint.reduce((s, v) => s + v[0], 0) / b.footprint.length, b.footprint.reduce((s, v) => s + v[1], 0) / b.footprint.length];
    expect(map.parks.some((k) => pointInPolygon(c, k.polygon) && pointInPolygon(b.footprint[0], k.polygon)), b.id).toBe(false);
  }));
  test('ninguna calle vehicular pasa por adentro de un edificio', () => expect(roadPointsInsideBuildings(map)).toEqual([]));
  test('todo cluster de techos tiene acceso', () => roofClusters(map.buildings).forEach((c) => expect(hasAccess(c, map.props), c[0]).toBe(true)));
  test('Estación y Plaza Brown presentes', () => {
    expect(map.buildings.some((b) => b.kind === 'station')).toBe(true);
    expect(map.places.find((p) => p.id === 'plaza-almirante-brown')!.parkId).toBeDefined();
  });
  test('redondeo: sin vértices consecutivos repetidos y a 2 decimales', () => {
    for (const b of map.buildings) {
      b.footprint.forEach((p, i) => {
        const q = b.footprint[(i + 1) % b.footprint.length];
        expect(p[0] === q[0] && p[1] === q[1], b.id).toBe(false);
        expect(Math.round(p[0] * 100) / 100).toBe(p[0]);
      });
    }
  });
});

describe('findFreeSpot / randomSpawns en un mundo chico', () => {
  const tiny: MapData = {
    version: 1, origin: { lat: 0, lon: 0 }, bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    buildings: [{ id: 'b', footprint: [[-2, -2], [2, -2], [2, 2], [-2, 2]], height: 4, floors: 1, kind: 'house', wall: 'plaster', tint: '#ccc' }],
    outskirts: [], roads: [], railways: [], platforms: [], parks: [], places: [], props: [], trees: [], randomSpawns: [],
  };
  const w = buildCollisionWorld(tiny);
  test('devuelve el punto libre más cercano', () => {
    const s = findFreeSpot(w, [0, 0])!;
    expect(s[1]).toBe(0);
    const d = Math.hypot(s[0], s[2]);
    expect(d).toBeGreaterThan(2.3); expect(d).toBeLessThan(2.9);
    expect(findFreeSpot(w, [5, 5])).toEqual([5, 0, 5]);
  });
  test('null si todo dentro de maxRadius está bloqueado', () => expect(findFreeSpot(w, [0, 0], 2)).toBeNull());
  test('respeta bounds − 1 m', () => {
    expect(findFreeSpot(w, [10, 0], 0.4)).toBeNull();
    const s = findFreeSpot(w, [10, 0], 3)!;
    expect(s[0]).toBeLessThanOrEqual(9);
  });
  test('randomSpawns es determinista y respeta la separación', () => {
    const a = randomSpawns(w, 10, [8]);
    expect(a).toEqual(randomSpawns(w, 10, [8]));
    expect(a.length).toBeGreaterThan(1);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++)
      expect(Math.hypot(a[i][0] - a[j][0], a[i][2] - a[j][2])).toBeGreaterThanOrEqual(8);
  });
  test('findFreeSpot con clearance y accept', () => {
    // alrededor del origen hay 2 m de pared; con 2,5 m de aire el punto más cercano está más lejos
    const plain = findFreeSpot(w, [0, 0])!;
    const clear = findFreeSpot(w, [0, 0], 12, 2.5)!;
    expect(Math.hypot(clear[0], clear[2])).toBeGreaterThan(Math.hypot(plain[0], plain[2]));
    expect(w.overlaps(clear[0], clear[2], 0.35 + 2.5, 0.05, 1.8)).toBe(false);
    const east = findFreeSpot(w, [0, 0], 12, 0, (p) => p[0] > 4)!;
    expect(east[0]).toBeGreaterThan(4);
    expect(findFreeSpot(w, [0, 0], 12, 0, () => false)).toBeNull();
  });
});

describe('filterTrees', () => {
  const t = (x: number, z: number): Tree => ({ position: [x, z], variant: 0, scale: 1 });
  const props: Prop[] = [
    { kind: 'fountain', position: [0, 0], radius: 3 },
    { kind: 'monument', placeId: 'm', position: [50, 0], style: 'statue' },
    { kind: 'bench', position: [100, 0], rotation: 0 },
    { kind: 'ladder', base: [150, 0], normal: [0, 1], topY: 4, buildingId: 'x' },
  ];
  const platform: Vec2[][] = [[[200, 0], [210, 0], [210, 5], [200, 5]]];
  test('saca los que pisan props y andenes y deja el resto', () => {
    const drop = [t(4.9, 0), t(53, 0), t(101, 0), t(150, 1), t(205, 2), t(199.7, 2)];
    const keep = [t(5.1, 0), t(55, 0), t(102, 0), t(150, 2), t(199.4, 2)];
    expect(filterTrees([...drop, ...keep], props, platform)).toEqual(keep);
  });
});
