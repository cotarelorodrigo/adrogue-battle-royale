import { placeProps } from '../../src/mapgen/props.ts';
import { distPointSegment, polygonArea, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Park, Place, Road } from '../../src/shared/mapdata.ts';

const park: Park = { id: 'p1', polygon: [[0, 0], [80, 0], [80, 60], [0, 60]] }; // 4800 m² → 12 bancos
const path: Road = { id: 'f', kind: 'footway', width: 2.5, sidewalk: 0, points: [[5, 30], [75, 30]] };
const farPath: Road = { id: 'g', kind: 'footway', width: 2.5, sidewalk: 0, points: [[500, 500], [600, 500]] };
const mon = (id: string): Omit<Place, 'spawn'> => ({ id, name: id, type: 'monument', position: [10, 10], enterable: false });
const places = [
  mon('escultura-general-san-martin'),
  mon('monumento-a-san-martin'),
  mon('monumento-al-almirante-guillermo-brown'),
  mon('monumento-a-esteban-adrogue'),
  { id: 'banco', name: 'x', type: 'bank', position: [1, 1], enterable: true } as Omit<Place, 'spawn'>,
];

test('4 monumentos con su estilo', () => {
  const props = placeProps([park], [], places, []);
  const monuments = props.filter((p) => p.kind === 'monument');
  expect(monuments.map((m) => m.style).sort()).toEqual(['column', 'equestrian', 'statue', 'statue']);
  expect(monuments.find((m) => m.placeId === 'monumento-a-san-martin')).toMatchObject({ style: 'equestrian', position: [10, 10] });
});

test('una fuente por punto OSM con radio 2,5', () => {
  const props = placeProps([], [[3, 4], [5, 6]], [], []);
  expect(props).toEqual([
    { kind: 'fountain', position: [3, 4], radius: 2.5 },
    { kind: 'fountain', position: [5, 6], radius: 2.5 },
  ]);
});

test('bancos: floor(área / 400) por plaza, dentro del polígono', () => {
  const benches = placeProps([park], [], [], []).filter((p) => p.kind === 'bench');
  expect(polygonArea(park.polygon)).toBe(4800);
  expect(benches).toHaveLength(12);
  benches.forEach((b) => expect(pointInPolygon(b.position, park.polygon)).toBe(true));
  expect(placeProps([{ id: 'tiny', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }], [], [], [])).toEqual([]);
});

test('bancos a 1,5 m del sendero interno y paralelos a él', () => {
  const benches = placeProps([park], [], [], [path, farPath]).filter((p) => p.kind === 'bench');
  expect(benches.length).toBeGreaterThanOrEqual(10);
  benches.forEach((b) => {
    expect(distPointSegment(b.position, path.points[0], path.points[1])).toBeCloseTo(1.5, 6);
    expect(Math.abs(Math.sin(b.rotation))).toBeLessThan(1e-9); // sendero E-O → rotación 0 o π
  });
});

test('rotación three.js: x local → (cos θ, −sin θ)', () => {
  const diag: Road = { id: 'd', kind: 'footway', width: 2.5, sidewalk: 0, points: [[10, 10], [10, 50]] }; // dir +z
  const benches = placeProps([park], [], [], [diag]).filter((p) => p.kind === 'bench');
  benches.forEach((b) => {
    const lx: Vec2 = [Math.cos(b.rotation), -Math.sin(b.rotation)];
    expect(Math.abs(lx[0])).toBeLessThan(1e-9);
    expect(Math.abs(lx[1])).toBeCloseTo(1, 9);
  });
});

test('determinista', () => {
  expect(placeProps([park], [[1, 1]], places, [path])).toEqual(placeProps([park], [[1, 1]], places, [path]));
});
