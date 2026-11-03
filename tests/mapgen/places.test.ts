import { matchPlaces, normalizeName, outwardNormal } from '../../src/mapgen/places.ts';
import type { PlaceInput } from '../../src/mapgen/places-input.ts';
import { heightFor } from '../../src/mapgen/buildings.ts';
import { unproject } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, Park, Road } from '../../src/shared/mapdata.ts';

// CCW visto desde arriba (x este, z sur): (0,-20) -> (0,-8) ... se arma con ensureCCW-equivalente a mano.
const rect = (x0: number, x1: number, z0: number, z1: number): Vec2[] => [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
const mk = (id: string, fp: Vec2[]): Building => ({ id, footprint: fp, height: 6.6, floors: 2, kind: 'shop', wall: 'plaster', tint: '#fff' });
const buildings: Building[] = [mk('b0001', rect(0, 30, -20, -8)), mk('b0002', rect(30, 60, -20, -8))];
const roads: Road[] = [
  { id: 'r1', kind: 'secondary', name: 'Calle', width: 12, sidewalk: 3, points: [[-200, 0], [200, 0]] },
  { id: 'f1', kind: 'footway', width: 2, sidewalk: 0, points: [[0, -60], [60, -60]] },
];
const parks: Park[] = [
  { id: 'p1', name: 'Plazoleta Las Delicias', polygon: rect(100, 130, -40, -10) },
  { id: 'p2', name: 'Otra', polygon: rect(200, 230, -40, -10) },
];
const inp = (id: string, type: PlaceInput['type'], p: Vec2, extra: Partial<PlaceInput> = {}): PlaceInput => {
  const { lat, lon } = unproject(p);
  return { id, name: id, type, lat, lon, enterable: false, signText: id.toUpperCase(), ...extra };
};
const input: PlaceInput[] = [
  inp('lugar-a', 'bar', [10, -14]),
  inp('lugar-b', 'bank', [70, -14], { floors: 5, tint: '#123456', wall: 'brick' }),
  inp('lejos', 'bar', [140, -14]),
  inp('lugar-c', 'club', [20, -12]),
  inp('plaza-x', 'plaza', [0, 0], { name: 'PLAZOLETA  las déLicias', signText: undefined }),
  inp('mon', 'monument', [115, -20], { signText: undefined }),
];
const snapshot = JSON.stringify(buildings);
const r = matchPlaces(input, buildings, parks, roads);
const bld = (id: string) => r.buildings.find((b) => b.id === id)!;
const pl = (id: string) => r.places.find((p) => p.id === id)!;
const spans = (s: NonNullable<ReturnType<typeof pl>['sign']>): [number, number] => {
  const c = s.anchor[0]; // la arista sur del fixture es horizontal
  return [c - s.width / 2, c + s.width / 2];
};

test('normalizeName', () => expect(normalizeName('  Plazoleta  LAS déLicias ')).toBe('plazoleta las delicias'));

test('normal exterior apunta lejos del centroide', () => {
  const sq: Vec2[] = rect(0, 2, -2, 0);
  for (let i = 0; i < 4; i++) {
    const a = sq[i], b = sq[(i + 1) % 4];
    const n = outwardNormal(a, b);
    const m: Vec2 = [(a[0] + b[0]) / 2 - 1, (a[1] + b[1]) / 2 + 1];
    expect(n[0] * m[0] + n[1] * m[1]).toBeGreaterThan(0.9);
    expect(Math.hypot(n[0], n[1])).toBeCloseTo(1);
  }
});

test('punto dentro → ese edificio y queda marcado', () => {
  expect(pl('lugar-a').buildingId).toBe('b0001');
  expect(bld('b0001').landmarkId).toBe('lugar-a');
});
test('punto a 10 m → el más cercano; a 40 m → warning', () => {
  expect(pl('lugar-b').buildingId).toBe('b0002');
  expect(pl('lejos').buildingId).toBeUndefined();
  expect(pl('lejos').sign).toBeUndefined();
  expect(r.warnings).toHaveLength(1);
});
test('overrides', () => {
  const b = bld('b0002');
  expect([b.floors, b.height, b.tint, b.wall]).toEqual([5, heightFor(5), '#123456', 'brick']);
});
test('plaza por nombre sin acentos ni mayúsculas; monumento solo posición', () => {
  expect(pl('plaza-x').parkId).toBe('p1');
  expect(pl('mon').position[0]).toBeCloseTo(115);
  expect(pl('mon').position[1]).toBeCloseTo(-20);
  expect(pl('mon').buildingId).toBeUndefined();
});
test('el cartel mira a la calle', () => {
  const s = pl('lugar-a').sign!;
  expect(s.normal[0] * 0 + s.normal[1] * 1).toBeGreaterThan(0.9);
  expect(s.bottomY).toBe(3.0);
  expect(s.text).toBe('LUGAR-A');
  expect(s.anchor[1]).toBeCloseTo(-8 + 0.08);
  expect(s.width).toBe(6);
});
test('dos lugares en un edificio → carteles sin solaparse', () => {
  const a = pl('lugar-a').sign!, c = pl('lugar-c').sign!;
  expect(c.anchor[1]).toBeCloseTo(a.anchor[1]);
  const [a0, a1] = spans(a), [c0, c1] = spans(c);
  expect(a1 <= c0 || c1 <= a0).toBe(true);
  expect(a0).toBeGreaterThanOrEqual(0);
  expect(Math.max(a1, c1)).toBeLessThanOrEqual(30);
});
test('no muta las entradas', () => expect(JSON.stringify(buildings)).toBe(snapshot));
test('estación: radio 30 m y kind station', () => {
  const rs = matchPlaces([inp('est', 'station', [0, -50])], buildings, parks, roads);
  expect(rs.places[0].buildingId).toBe('b0001');
  expect(rs.buildings.find((b) => b.id === 'b0001')!.kind).toBe('station');
  expect(rs.warnings).toHaveLength(0);
});

const hRoad = (id: string, z: number): Road => ({ id, kind: 'secondary', name: 'Calle', width: 6, sidewalk: 3, points: [[-100, z], [100, z]] });
const vRoad = (id: string, x: number): Road => ({ id, kind: 'secondary', name: 'Calle', width: 6, sidewalk: 3, points: [[x, -100], [x, 100]] });

test('una arista corta metida hacia adentro (más cercana) pierde contra la larga sobre la calle', () => {
  // bloque en U abierto al norte; la muesca (13..16,5 × 0..4) tiene un fondo de 3,5 m que mira a una calle en z = −8
  const u: Vec2[] = [[0, 30], [30, 30], [30, 0], [16.5, 0], [16.5, 4], [13, 4], [13, 0], [0, 0]];
  const res = matchPlaces([inp('u', 'bar', [15, 2])], [mk('bu', u)], [], [hRoad('rn', -8), hRoad('rs', 45)]);
  const sign = res.places[0].sign!;
  expect(sign.anchor[1]).toBeLessThan(0.1); // fachada norte (z = 0), no el fondo de la muesca (z = 4)
  expect(sign.anchor[1]).toBeGreaterThan(-0.1);
  expect(sign.normal[1]).toBeCloseTo(-1);
  expect(res.warnings).toEqual([]);
});

test('una arista cuyo rayo vuelve a cruzar el edificio no califica', () => {
  // U abierta al norte con patio de 12 m: la cara interna izquierda mira al brazo derecho; una calle en x = 27 lo "alcanza"
  const u: Vec2[] = [[0, 30], [40, 30], [40, 0], [22, 0], [22, 25], [10, 25], [10, 0], [0, 0]];
  const res = matchPlaces([inp('u', 'bar', [12, 12])], [mk('bu', u)], [], [vRoad('rv', 27), hRoad('rs', 45)]);
  const sign = res.places[0].sign!;
  expect(sign.normal[1]).toBeCloseTo(1); // fachada sur (z = 30)
  expect(sign.anchor[1]).toBeGreaterThan(29.9);
});

test('una arista con otro edificio entre ella y la calle no califica', () => {
  // la cara norte del edificio A (más cercana al lugar) mira a una calle en z = −10, pero B tapa el camino;
  // la cara sur (más lejos) da a otra calle libre
  const a = mk('ba', rect(0, 30, -20, -8)); // cara norte en z = −20
  const blocker = mk('bb', rect(0, 30, -34, -26));
  const res = matchPlaces([inp('x', 'bar', [15, -19])], [a, blocker], [], [hRoad('rn', -38), hRoad('rs', 0)]);
  const sign = res.places[0].sign!;
  expect(res.places[0].buildingId).toBe('ba');
  expect(sign.normal[1]).toBeCloseTo(1); // sur (z = −8), no norte
});

test('calle angosta: un edificio del otro lado, dentro del alcance, no descalifica la arista que da a la calle', () => {
  const a = mk('ba', rect(0, 30, -20, -8)); // cara norte en z = −20
  const road = hRoad('rn', -24); // calzada de z −27 a −21
  const across = mk('bb', rect(0, 30, -34, -28)); // a 4 m del eje, a 8 m de la arista, dentro de 15 m
  const res = matchPlaces([inp('x', 'bar', [15, -19])], [a, across], [], [road, hRoad('rs', 20)]);
  const sign = res.places[0].sign!;
  expect(res.places[0].buildingId).toBe('ba');
  expect(sign.normal[1]).toBeCloseTo(-1); // norte, hacia la calle angosta
  expect(sign.anchor[1]).toBeLessThan(-19.9);
});
