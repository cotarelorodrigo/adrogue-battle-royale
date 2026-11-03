import { placeTrees } from '../../src/mapgen/trees.ts';
import { distPointSegment, ensureCCW, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, Park, Road } from '../../src/shared/mapdata.ts';

const bounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
const roads: Road[] = [
  { id: 'a', kind: 'residential', width: 6, sidewalk: 3, points: [[-150, 0], [0, 0], [150, 0]] },
  { id: 'b', kind: 'residential', width: 6, sidewalk: 3, points: [[0, 0], [0, 100]] },
  { id: 'p', kind: 'footway', width: 2.5, sidewalk: 0, points: [[60, 40], [100, 60]] },
];
const buildings: Building[] = [
  {
    id: 'bb',
    footprint: ensureCCW([[20, 4], [40, 4], [40, 14], [20, 14]]),
    height: 3.8, floors: 1, kind: 'house', wall: 'plaster', tint: '#ccc',
  },
];
const park: Park = { id: 'park1', polygon: [[60, 30], [140, 30], [140, 100], [60, 100]] };

const trees = placeTrees(roads, buildings, [park], bounds);
const inPark = trees.filter((t) => pointInPolygon(t.position, park.polygon));
const street = trees.filter((t) => !pointInPolygon(t.position, park.polygon));

function distFp(p: Vec2): number {
  const fp = buildings[0].footprint;
  return Math.min(...fp.map((a, i) => distPointSegment(p, a, fp[(i + 1) % fp.length])));
}

test('hay árboles de vereda y de plaza', () => {
  expect(street.length).toBeGreaterThan(10);
  expect(inPark.length).toBeGreaterThan(5);
});

test('árboles de vereda a width/2 + sidewalk·0,7 del eje', () => {
  const t = street.find((s) => Math.abs(s.position[1]) < 6 && Math.abs(s.position[0]) > 20)!;
  expect(Math.abs(t.position[1])).toBeCloseTo(3 + 3 * 0.7, 6);
});

test('árboles: ninguno dentro de edificios ni a menos de 8 m de una esquina', () => {
  const corners: Vec2[] = [[0, 0], [-150, 0], [150, 0], [0, 100], [60, 40], [100, 60]];
  trees.forEach((t) => expect(distFp(t.position)).toBeGreaterThan(1.5));
  street.forEach((t) => {
    expect(Math.min(...corners.map((c) => Math.hypot(c[0] - t.position[0], c[1] - t.position[1])))).toBeGreaterThanOrEqual(8);
  });
});

test('árboles dentro de bounds', () => {
  const small = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  placeTrees(roads, buildings, [park], small).forEach((t) => {
    expect(t.position[0]).toBeGreaterThanOrEqual(-50);
    expect(t.position[0]).toBeLessThanOrEqual(50);
    expect(t.position[1]).toBeGreaterThanOrEqual(-50);
    expect(t.position[1]).toBeLessThanOrEqual(50);
  });
});

test('árboles en plaza con distancia mínima 7 m, dentro del polígono y a ≥ 2 m del sendero', () => {
  let min = Infinity;
  for (let i = 0; i < inPark.length; i++)
    for (let j = i + 1; j < inPark.length; j++)
      min = Math.min(min, Math.hypot(inPark[i].position[0] - inPark[j].position[0], inPark[i].position[1] - inPark[j].position[1]));
  expect(min).toBeGreaterThanOrEqual(7);
  inPark.forEach((t) => expect(distPointSegment(t.position, [60, 40], [100, 60])).toBeGreaterThanOrEqual(2));
});

test('variant y scale válidos', () => {
  trees.forEach((t) => {
    expect([0, 1, 2]).toContain(t.variant);
    expect(t.scale).toBeGreaterThanOrEqual(0.85);
    expect(t.scale).toBeLessThanOrEqual(1.2);
  });
});

test('determinista', () => expect(placeTrees(roads, buildings, [park], bounds)).toEqual(trees));
