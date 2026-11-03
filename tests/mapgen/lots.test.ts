import polygonClipping from 'polygon-clipping';
import { expect, test } from 'vitest';
import { carveLots, frontEdgesOf, frontIsContra, layoutLots, lotBuilding, lotSign } from '../../src/mapgen/lots.ts';
import { bufferLine, ROAD_SPECS } from '../../src/mapgen/osm.ts';
import type { Frontage } from '../../src/mapgen/frontage.ts';
import type { FrenteInput, LoteInput } from '../../src/mapgen/frentes-input.ts';
import { polygonArea } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, Road } from '../../src/shared/mapdata.ts';

const lote = (o: Partial<LoteInput> = {}): LoteInput => ({
  ancho: 10, pisos: 1, fondo: 15, retiro: 0, color: '#ccbbaa', pb: 'vidriera', arriba: 'ventanas',
  material: 'revoque', puerta: 'medio', ...o,
});
const frente = (lotes: Partial<LoteInput>[]): FrenteInput => ({
  id: 't', calle: 'A', desde: 'B', hasta: 'C', vereda: 'sur', fecha: '2026-01-01', osmAusentes: [], lotes: lotes.map(lote),
});
const recta: Frontage = {
  id: 't', line: [[0, 0], [100, 0]], length: 100, inward: 1, setback: 8,
  ext: [[-20, 0], [120, 0]], corners: [[], []],
};
const closed = (r: Vec2[]): [number, number][] => [...r, r[0]].map((p): [number, number] => [p[0], p[1]]);
const overlap = (a: Vec2[], b: Vec2[]): number =>
  polygonClipping.intersection([closed(a)], [closed(b)]).reduce((s, poly) => s + polygonArea(poly[0].slice(0, -1) as Vec2[]), 0);
const lenOf = (pts: Vec2[]): number => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const zs = (pts: Vec2[]): number[] => pts.map((p) => p[1]);

test('reparte el frente en proporción a los anchos', () => {
  const ls = layoutLots(frente([{ ancho: 30 }, { ancho: 30 }, { ancho: 40 }]), recta, []);
  expect(ls.map((l) => l.id)).toEqual(['t-1', 't-2', 't-3']);
  expect(ls.map((l) => lenOf(l.front))).toEqual([expect.closeTo(30, 2), expect.closeTo(30, 2), expect.closeTo(40, 2)]);
  expect(ls[0].front[0][0]).toBeCloseTo(0, 2);
  expect(ls[2].front.at(-1)![0]).toBeCloseTo(100, 2);
});

test('escala si la suma difiere hasta 10 %', () => {
  const ls = layoutLots(frente([{ ancho: 45 }, { ancho: 50 }]), recta, []);
  expect(lenOf(ls[0].front)).toBeCloseTo(45 * (100 / 95), 2);
  expect(lenOf(ls[1].front)).toBeCloseTo(50 * (100 / 95), 2);
});

test('error si difiere más de 10 %', () =>
  expect(() => layoutLots(frente([{ ancho: 80 }]), recta, [])).toThrow('frente t: los anchos suman 80,0 m pero el frente mide 100,0 m (−20,0 %). ¿Falta o sobra un lote?'));

test('fondo y retiro', () => {
  const [l] = layoutLots(frente([{ ancho: 100, retiro: 3, fondo: 12 }]), recta, []);
  const z = zs(l.footprint!);
  expect(Math.min(...z)).toBeCloseTo(3, 6);
  expect(Math.max(...z)).toBeCloseTo(15, 6);
  const cz = l.claim.flatMap(zs);
  expect(Math.min(...cz)).toBeCloseTo(-8, 6);
  expect(Math.max(...cz)).toBeCloseTo(15, 6);
  l.front.forEach(([, y]) => expect(y).toBeCloseTo(3, 6));
});

test('pisos 0: sin edificio, con claim', () => {
  const ls = layoutLots(frente([{ ancho: 50, pisos: 0, color: '' }, { ancho: 50 }]), recta, []);
  expect(ls[0].footprint).toBeNull();
  expect(lotBuilding(ls[0])).toBeNull();
  const cz = ls[0].claim.flatMap(zs);
  expect(Math.min(...cz)).toBeCloseTo(-8, 6);
  expect(Math.max(...cz)).toBeCloseTo(15, 6);
});

test('esquina oblicua: el primer lote sigue la transversal y no la pisa', () => {
  const c = Math.cos(Math.PI / 3);
  const s = Math.sin(Math.PI / 3);
  const corridor = bufferLine([[0 - 60 * c, -60 * s], [0 + 60 * c, 60 * s]], 7);
  const fr: Frontage = { ...recta, corners: [[corridor], []] };
  const [l] = layoutLots(frente([{ ancho: 50 }, { ancho: 50 }]), fr, []);
  expect(overlap(l.footprint!, corridor)).toBeLessThan(0.01);
  expect(frontEdgesOf(l.footprint!, [...corridor, corridor[0]], 0.05).length).toBeGreaterThan(0);
  expect(l.cornerRings).toHaveLength(1);
  expect(l.front[0][0]).toBeGreaterThan(0);
});

test('curva de 20°: los lotes vecinos no se superponen', () => {
  const a = (20 * Math.PI) / 180;
  const line: Vec2[] = [[0, 0], [50, 0], [50 + 50 * Math.cos(a), 50 * Math.sin(a)]];
  const fr: Frontage = { ...recta, line, length: 100, ext: [[-20, 0], ...line.slice(1, 2), [50 + 70 * Math.cos(a), 70 * Math.sin(a)]] };
  const ls = layoutLots(frente([{ ancho: 25 }, { ancho: 25 }, { ancho: 25 }, { ancho: 25 }]), fr, []);
  for (let i = 0; i < ls.length; i++)
    for (let j = i + 1; j < ls.length; j++) expect(overlap(ls[i].footprint!, ls[j].footprint!)).toBeLessThan(0.01);
});

test('ningún lote pisa la calzada ni la vereda de una calle vehicular que cruza la manzana', () => {
  const r: Road = { id: 'X', kind: 'residential', name: 'X', ...ROAD_SPECS.residential, points: [[50, -20], [50, 60]] };
  const ls = layoutLots(frente([{ ancho: 25 }, { ancho: 25 }, { ancho: 25 }, { ancho: 25 }]), recta, [r]);
  const corridor = bufferLine(r.points, 7);
  for (const l of ls) expect(overlap(l.footprint!, corridor)).toBeLessThan(0.01);
});

test('lotSign: frente, alto y bandera', () => {
  const cartel = (posicion: 'frente' | 'alto' | 'bandera', ancho?: number) =>
    ({ texto: 'X', fondo: '#111111', letra: '#ffffff', fuente: 'sans' as const, cursiva: false, posicion, ancho });
  const ls = layoutLots(frente([{ ancho: 30, cartel: cartel('frente') }, { ancho: 30, pisos: 3, cartel: cartel('alto') },
    { ancho: 40, cartel: cartel('bandera') }]), recta, []);
  const f = lotSign(ls[0], 4)!;
  expect(f.bottomY).toBe(2.35);
  expect(f.width).toBeCloseTo(29.6, 2);
  expect(f.normal[1]).toBeCloseTo(-1, 6);
  expect(f.anchor[1]).toBeCloseTo(-0.08, 6);
  expect(f.look).toEqual({ fondo: '#111111', letra: '#ffffff', marco: '#111111', fuente: 'sans' });
  expect(lotSign(ls[1], 10.2)!.bottomY).toBeCloseTo(9.2, 6);
  const b = lotSign(ls[2], 4)!;
  expect(b.blade).toBe(true);
  expect(b.normal[0]).toBeCloseTo(1, 6);
  expect(b.normal[1]).toBeCloseTo(0, 6);
  expect(b.width).toBe(1.2);
  expect(b.anchor[1]).toBeCloseTo(-0.7, 6);
  expect(b.bottomY).toBe(2.6);
  expect(lotSign(layoutLots(frente([{ ancho: 100 }]), recta, [])[0], 4)).toBeNull();
});

const edificio = (id: string, fp: Vec2[]): Building => ({ id, footprint: fp, height: 4, floors: 1, kind: 'shop', wall: 'plaster', tint: '#aaaaaa' });

test('carveLots: recorta, conserva el id de la pieza mayor, numera el resto y tira las de menos de 12 m²', () => {
  const b = edificio('b0001', [[0, 0], [40, 0], [40, 20], [0, 20]]);
  const claim: Vec2[] = [[15, -5], [25, -5], [25, 25], [15, 25]];
  const out = carveLots([b], [claim]);
  expect(out.map((o) => o.id)).toEqual(['b0001', 'b0001-2']);
  out.forEach((o) => expect(polygonArea(o.footprint)).toBeCloseTo(300, 0));
  expect(Math.max(...out[0].footprint.map((p) => p[0]))).toBeLessThan(16);
  expect(out[1].tint).toBe('#aaaaaa');
  // todo cubierto salvo una franja de 0,5 × 20 = 10 m²: no queda nada
  const strip = carveLots([b], [claim, [[0, -5], [39.5, -5], [39.5, 25], [0, 25]]]);
  expect(strip).toHaveLength(0);
  const thin = carveLots([b], [claim, [[39.5, -5], [45, -5], [45, 25], [39.5, 25]]]);
  expect(thin.map((o) => o.id)).toEqual(['b0001', 'b0001-2']);
  const sliver = carveLots([b], [claim, [[0.5, -5], [15, -5], [15, 25], [0.5, 25]]]);
  expect(sliver.map((o) => o.id)).toEqual(['b0001']);
  const far = carveLots([b], [[[100, 100], [110, 100], [110, 110]]]);
  expect(far[0]).toEqual(b);
});

test('frontEdgesOf: encuentra la arista del frente con 4 mm de error y no las de los costados', () => {
  const fp: Vec2[] = [[0, 0.004], [10, 0], [10, 15], [0, 15]];
  expect(frontEdgesOf(fp, [[0, 0], [10, 0]])).toEqual([0]);
  expect(frontEdgesOf(fp, [[0, 0], [10, 0]], 0.001)).toEqual([]);
});

test('frontIsContra: la arista guardada va con o contra el sentido desde → hasta', () => {
  const fp: Vec2[] = [[0, 0], [10, 0], [10, 15], [0, 15]]; // arista 0: (0,0) → (10,0)
  expect(frontIsContra(fp, [0], [[0, 0], [10, 0]])).toBe(false);
  expect(frontIsContra(fp, [0], [[10, 0], [0, 0]])).toBe(true);
  expect(frontIsContra(fp, [], [[0, 0], [10, 0]])).toBe(false);
});

test('frontIsContra: en una curva decide la suma de todas las aristas del frente', () => {
  const fp: Vec2[] = [[0, 0], [10, 0], [10, 10], [-5, 10]]; // aristas 0 y 1 hacen una esquina
  const bend: Vec2[] = [[0, 0], [10, 0], [10, 10]];
  expect(frontIsContra(fp, [0, 1], bend)).toBe(false);
  expect(frontIsContra(fp, [0, 1], [...bend].reverse())).toBe(true);
});

test('lotBuilding: kind, wall y front', () => {
  const ls = layoutLots(frente([{ ancho: 25, pisos: 3 }, { ancho: 25, pb: 'puerta', material: 'ladrillo' }, { ancho: 50, toldo: { color: '#aa0000', rayas: true } }]), recta, []);
  const [a, b, c] = ls.map((l) => lotBuilding(l)!);
  expect(a.kind).toBe('apartments');
  expect(a.height).toBeCloseTo(10.2, 6);
  expect(b.kind).toBe('house');
  expect(b.wall).toBe('brick');
  expect(b.front!.ladrillo).toBe(true);
  expect(c.kind).toBe('shop');
  expect(c.front).toMatchObject({ edges: [], corner: [], toldo: { color: '#aa0000', rayas: true } });
});

test('el lote de esquina queda del lado del frente aunque del otro lado de la transversal haya un pedazo más grande', () => {
  const corridor: Vec2[] = [[-6, -10], [-1, -10], [-1, 40], [-6, 40]];
  const fr: Frontage = { ...recta, corners: [[corridor], []] };
  const [a] = layoutLots(frente([{ ancho: 8 }, { ancho: 92 }]), fr, []);
  const xs = a.footprint!.map((p) => p[0]);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1 - 1e-6);
  expect(Math.max(...xs)).toBeCloseTo(8, 2);
});
