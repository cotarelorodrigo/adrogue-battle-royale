import { readFileSync } from 'node:fs';
import { buildBuildings, COMMERCIAL_STREETS, FLOOR_H, PARAPET, heightFor } from '../../src/mapgen/buildings.ts';
import type { GeoJSONFeatureCollection } from '../../src/mapgen/buildings.ts';
import { project, unproject, polygonArea, signedAreaFromAbove, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Road } from '../../src/shared/mapdata.ts';

const fc: GeoJSONFeatureCollection = JSON.parse(
  readFileSync(new URL('../fixtures/buildings-mini.geojson', import.meta.url), 'utf8'),
);
const roads: Road[] = [
  { id: 'w1', kind: 'secondary', name: 'Esteban Adrogué', width: 12, sidewalk: 3, points: [[-300, 0], [300, 0]] },
  { id: 'w2', kind: 'residential', name: 'Calle Cualquiera', width: 4, sidewalk: 3, points: [[-80, 30], [-80, 120]] },
  { id: 'w3', kind: 'footway', width: 2.5, sidewalk: 0, points: [[20, -50], [20, 100]] },
];
const { buildings, outskirts } = buildBuildings(fc, roads);

function byFixtureName(name: string) {
  const f = fc.features.find((x) => (x.properties as { name?: string }).name === name)!;
  const ring = f.geometry.coordinates[0].slice(0, -1).map(([lon, lat]) => project(lat, lon));
  const c: Vec2 = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return buildings.find((b) => pointInPolygon(c, b.footprint))!;
}

test('constantes', () => {
  expect(COMMERCIAL_STREETS).toHaveLength(8);
  expect(COMMERCIAL_STREETS).toContain('Esteban Adrogué');
  expect(FLOOR_H).toBe(3.2);
  expect(PARAPET).toBe(0.6);
  expect(heightFor(2)).toBeCloseTo(7);
});
test('descarta chicos y superpuestos; sobre-calle queda recortado en dos', () => {
  // grande-esteban, chico-esteban, 2 pedazos de sobre-calle (x≈-83 y x≈-77), solapa-a, lejos
  expect(buildings.map((b) => b.id)).toEqual(['b0001', 'b0002', 'b0003', 'b0004', 'b0005', 'b0006']);
  const cx = (b: { footprint: Vec2[] }) => b.footprint.reduce((s, p) => s + p[0], 0) / b.footprint.length;
  const zs = (b: { footprint: Vec2[] }) => b.footprint.reduce((s, p) => s + p[1], 0) / b.footprint.length;
  expect(Math.round(zs(buildings[0]))).toBe(-20);
  expect(Math.round(zs(buildings[1]))).toBe(16);
  expect(cx(buildings[2])).toBeCloseTo(-83.5, 0);
  expect(cx(buildings[3])).toBeCloseTo(-76.5, 0);
  expect(Math.round(zs(buildings[4]))).toBe(65);
  expect(Math.round(zs(buildings[5]))).toBe(85);
  for (const b of [buildings[2], buildings[3]]) expect(pointInPolygon([-80, 55], b.footprint)).toBe(false);
});
test('el footway no descarta', () => expect(byFixtureName('grande-esteban')).toBeDefined());
test('fuera del área va a outskirts', () => {
  expect(outskirts).toHaveLength(1);
  expect([heightFor(1), heightFor(2)]).toContain(outskirts[0].height);
});
test('clasificación por corredor', () => {
  const g = byFixtureName('grande-esteban');
  expect(g.kind).toBe('apartments');
  expect(g.floors).toBeGreaterThanOrEqual(4);
  expect(g.floors).toBeLessThanOrEqual(8);
  expect(byFixtureName('chico-esteban').kind).toBe('shop');
  expect(byFixtureName('lejos').kind).toBe('house');
});
test('altura = pisos·3,2 + 0,6 y CCW sin vértice repetido', () =>
  buildings.forEach((b) => {
    expect(b.height).toBeCloseTo(heightFor(b.floors));
    expect(signedAreaFromAbove(b.footprint)).toBeGreaterThan(0);
    expect(b.footprint[0]).not.toEqual(b.footprint.at(-1));
    expect(b.tint).toMatch(/^#[0-9a-f]{6}$/);
    expect(['plaster', 'brick']).toContain(b.wall);
  }));
test('determinista', () => expect(buildBuildings(fc, roads)).toEqual(buildBuildings(fc, roads)));

function rectFc(x0: number, z0: number, x1: number, z1: number): GeoJSONFeatureCollection {
  // devuelve un footprint rectangular dado en metros locales (ver unproject)
  const ring = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => {
    const { lat, lon } = unproject([x, z]);
    return [lon, lat];
  });
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

test('un footprint de 40x20 cruzado por una residential de 8 m queda en 2 edificios', () => {
  const road: Road = { id: 'r', kind: 'residential', width: 8, sidewalk: 3, points: [[0, -50], [0, 50]] };
  const r = buildBuildings(rectFc(-20, -10, 20, 10), [road]);
  expect(r.buildings).toHaveLength(2);
  for (const b of r.buildings) {
    expect(polygonArea(b.footprint)).toBeCloseTo(16 * 20, -1);
    const xs = b.footprint.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(16, 0);
    expect(pointInPolygon([0, 0], b.footprint)).toBe(false);
    expect(pointInPolygon([-3.9, 0], b.footprint) || pointInPolygon([3.9, 0], b.footprint)).toBe(false);
  }
});

test('una calle service no recorta', () => {
  const road: Road = { id: 's', kind: 'service', width: 4, sidewalk: 0, points: [[0, -50], [0, 50]] };
  const r = buildBuildings(rectFc(-20, -10, 20, 10), [road]);
  expect(r.buildings).toHaveLength(1);
  expect(polygonArea(r.buildings[0].footprint)).toBeCloseTo(800, 0);
});
