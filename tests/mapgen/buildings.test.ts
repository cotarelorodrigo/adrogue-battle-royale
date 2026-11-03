import { readFileSync } from 'node:fs';
import { buildBuildings, COMMERCIAL_STREETS, FLOOR_H, PARAPET, heightFor } from '../../src/mapgen/buildings.ts';
import type { GeoJSONFeatureCollection } from '../../src/mapgen/buildings.ts';
import { project, signedAreaFromAbove, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Road } from '../../src/shared/mapdata.ts';

const fc: GeoJSONFeatureCollection = JSON.parse(
  readFileSync(new URL('../fixtures/buildings-mini.geojson', import.meta.url), 'utf8'),
);
const roads: Road[] = [
  { id: 'w1', kind: 'secondary', name: 'Esteban Adrogué', width: 12, sidewalk: 3, points: [[-300, 0], [300, 0]] },
  { id: 'w2', kind: 'residential', name: 'Calle Cualquiera', width: 8, sidewalk: 3, points: [[-80, 30], [-80, 120]] },
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
test('descarta chicos, sobre calles y superpuestos', () =>
  expect(buildings.map((b) => b.id)).toEqual(['b0001', 'b0002', 'b0003', 'b0004']));
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
