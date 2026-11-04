import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseOsm, ROAD_SPECS } from '../../src/mapgen/osm.ts';
import { resolveFrontage } from '../../src/mapgen/frontage.ts';
import type { Road, RoadKind } from '../../src/shared/mapdata.ts';
import type { Vec2 } from '../../src/shared/geo.ts';

const road = (name: string, kind: RoadKind, points: Vec2[]): Road => ({ id: name, kind, name, ...ROAD_SPECS[kind], points });
const roads: Road[] = [
  road('A', 'tertiary', [[-100, 0], [100, 0]]),
  road('B', 'residential', [[-50, -60], [-50, 60]]),
  road('C', 'residential', [[50, -60], [50, 60]]),
];

test('frente recto, vereda norte: línea en z = −8 entre las líneas de edificación de B y C', () => {
  const f = resolveFrontage(roads, { id: 't', calle: 'A', desde: 'B', hasta: 'C', vereda: 'norte' });
  expect(f.inward).toBe(-1);
  expect(f.setback).toBe(8);
  expect(f.line[0][0]).toBeCloseTo(-43, 1);
  expect(f.line.at(-1)![0]).toBeCloseTo(43, 1);
  f.line.forEach(([, z]) => expect(z).toBeCloseTo(-8, 6));
  expect(f.length).toBeCloseTo(86, 1);
  expect(f.ext[0][0]).toBeCloseTo(-63, 1);
  expect(f.ext.at(-1)![0]).toBeCloseTo(63, 1);
  expect(f.corners[0]).toHaveLength(1);
  expect(f.corners[1]).toHaveLength(1);
});

test('vereda sur e invertido (desde C hasta B): va de este a oeste por z = +8', () => {
  const f = resolveFrontage(roads, { id: 't', calle: 'A', desde: 'C', hasta: 'B', vereda: 'sur' });
  expect(f.inward).toBe(-1); // la manzana queda al sur y esta línea va hacia el oeste: offsetLine(+d) iría al norte
  expect(f.line[0][0]).toBeCloseTo(43, 1);
  expect(f.line.at(-1)![0]).toBeCloseTo(-43, 1);
  f.line.forEach(([, z]) => expect(z).toBeCloseTo(8, 6));
});

test('esquina oblicua a 60°: la punta queda sobre la línea de edificación de la transversal', () => {
  const c = Math.cos(Math.PI / 3);
  const s = Math.sin(Math.PI / 3);
  const oblique = [roads[0], roads[1], road('C', 'residential', [[50 - 60 * c, -60 * s], [50 + 60 * c, 60 * s]])];
  const f = resolveFrontage(oblique, { id: 't', calle: 'A', desde: 'B', hasta: 'C', vereda: 'norte' });
  const [x, z] = f.line.at(-1)!;
  // distancia al eje de C (recta por (50,0) con dirección (c, s))
  const dist = Math.abs((x - 50) * s - z * c);
  expect(Math.abs(dist - 7)).toBeLessThan(0.06);
});

test('empalme en T: sin corredor del otro lado el frente termina en el cruce; del lado de la T, recorta', () => {
  const tee = [...roads, road('T', 'residential', [[0, 60], [0, 0]])];
  const n = resolveFrontage(tee, { id: 't', calle: 'A', desde: 'B', hasta: 'T', vereda: 'norte' });
  expect(Math.abs(n.line.at(-1)![0])).toBeLessThan(0.01);
  expect(n.corners[1]).toHaveLength(0);
  expect(n.line[0][0]).toBeCloseTo(-43, 1);
  const s = resolveFrontage(tee, { id: 't', calle: 'A', desde: 'B', hasta: 'T', vereda: 'sur' });
  expect(Math.abs(s.line.at(-1)![0] + 7)).toBeLessThan(0.06);
  expect(s.corners[1]).toHaveLength(1);
});

test('errores claros', () => {
  expect(() => resolveFrontage(roads, { id: 't', calle: 'Z', desde: 'B', hasta: 'C', vereda: 'sur' })).toThrow('frente t: no hay ninguna calle "Z"');
  expect(() => resolveFrontage(roads, { id: 't', calle: 'A', desde: 'B', hasta: 'D', vereda: 'sur' })).toThrow('frente t: "D" no cruza "A"');
  expect(() => resolveFrontage(roads, { id: 't', calle: 'A', desde: 'B', hasta: 'C', vereda: 'este' })).toThrow(/la vereda "este" no es clara/);
});

const real = parseOsm(JSON.parse(readFileSync('data/raw/osm.json', 'utf8'))).roads;

test('datos reales: EA de Pellerano a Benigno Macías, vereda norte, mide entre 55 y 80 m', () => {
  const f = resolveFrontage(real, { id: 'r', calle: 'Esteban Adrogué', desde: 'Pellerano', hasta: 'Benigno Macías', vereda: 'norte' });
  expect(f.length).toBeGreaterThan(55);
  expect(f.length).toBeLessThan(80);
});

test('datos reales: EA de Bartolomé Mitre a Pellerano resuelve igual que de Somellera a Pellerano', () => {
  const a = resolveFrontage(real, { id: 'r', calle: 'Esteban Adrogué', desde: 'Bartolomé Mitre', hasta: 'Pellerano', vereda: 'sur' });
  const b = resolveFrontage(real, { id: 'r', calle: 'Esteban Adrogué', desde: 'Somellera', hasta: 'Pellerano', vereda: 'sur' });
  expect(Math.hypot(a.line[0][0] - b.line[0][0], a.line[0][1] - b.line[0][1])).toBeLessThan(0.1);
  expect(Math.hypot(a.line.at(-1)![0] - b.line.at(-1)![0], a.line.at(-1)![1] - b.line.at(-1)![1])).toBeLessThan(0.1);
});

test('vereda que no sirve: sugiere el par que sí (este u oeste en una calle norte–sur)', () => {
  const ns: Road[] = [
    road('N', 'residential', [[0, -100], [0, 100]]),
    road('P', 'residential', [[-60, -40], [60, -40]]),
    road('Q', 'residential', [[-60, 40], [60, 40]]),
  ];
  expect(() => resolveFrontage(ns, { id: 't', calle: 'N', desde: 'P', hasta: 'Q', vereda: 'norte' }))
    .toThrow('la vereda "norte" no es clara para esta calle; usá este u oeste');
  expect(() => resolveFrontage(roads, { id: 't', calle: 'A', desde: 'B', hasta: 'C', vereda: 'este' }))
    .toThrow('la vereda "este" no es clara para esta calle; usá norte o sur');
  expect(resolveFrontage(ns, { id: 't', calle: 'N', desde: 'P', hasta: 'Q', vereda: 'este' }).length).toBeGreaterThan(50);
});
