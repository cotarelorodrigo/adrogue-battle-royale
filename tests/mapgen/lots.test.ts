import polygonClipping from 'polygon-clipping';
import { expect, test } from 'vitest';
import { aidEnds, carveLots, frontEdgesOf, frontIsContra, layoutLots, LOT_SIGN, lotBuilding, lotOverlap, lotSign } from '../../src/mapgen/lots.ts';
import { bufferLine, ROAD_SPECS } from '../../src/mapgen/osm.ts';
import type { Frontage } from '../../src/mapgen/frontage.ts';
import type { FrenteInput, LoteInput } from '../../src/mapgen/frentes-input.ts';
import { distPointSegment, pointInPolygon, polygonArea } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, Road, Sign } from '../../src/shared/mapdata.ts';

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

test('carveLots: claims vecinos con aristas casi coincidentes (1e-12 m) se unen sin error', () => {
  const b = edificio('b0001', [[0, 0], [40, 0], [40, 20], [0, 20]]);
  const e = 1e-12;
  const claims: Vec2[][] = [
    [[10, -5], [20 + e, -5], [20 - e, 25], [10, 25]],
    [[20, -5 + e], [30, -5], [30, 25], [20 + e, 25 - e]],
  ];
  const out = carveLots([b], claims);
  expect(out.map((o) => o.id)).toEqual(['b0001', 'b0001-2']);
  out.forEach((o) => expect(polygonArea(o.footprint)).toBeCloseTo(200, 1));
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

const cartelDe = (posicion: 'frente' | 'alto' | 'bandera', ancho?: number) =>
  ({ texto: 'X', fondo: '#111111', letra: '#ffffff', fuente: 'sans' as const, cursiva: false, posicion, ...(ancho !== undefined ? { ancho } : {}) });
/** Las dos puntas del cartel (sobre su plano de atrás, que está LOT_SIGN.offset afuera de la pared). */
const puntas = (s: Sign): Vec2[] => [-1, 1].map((k): Vec2 => [s.anchor[0] - s.normal[1] * k * s.width / 2, s.anchor[1] + s.normal[0] * k * s.width / 2]);
const distLine = (p: Vec2, line: Vec2[]): number => Math.min(...line.slice(1).map((q, i) => distPointSegment(p, line[i], q)));

test('lotSign: en un frente quebrado el cartel va en un tramo recto y sus dos puntas quedan contra la pared', () => {
  // 9 m rectos y 5 m quebrados 12° hacia adentro de la manzana (+z)
  const a = (12 * Math.PI) / 180;
  const line: Vec2[] = [[0, 0], [9, 0], [9 + 5 * Math.cos(a), 5 * Math.sin(a)]];
  const fr: Frontage = { ...recta, line, length: 14, ext: [[-20, 0], [9, 0], [9 + 30 * Math.cos(a), 30 * Math.sin(a)]] };
  for (const pos of ['frente', 'alto'] as const) {
    const [l] = layoutLots(frente([{ ancho: 14, pisos: 3, cartel: cartelDe(pos) }]), fr, []);
    expect(l.front).toHaveLength(3);
    const s = lotSign(l, 10.2)!;
    for (const p of puntas(s)) {
      expect(distLine(p, l.front), pos).toBeLessThanOrEqual(0.1);
      expect(pointInPolygon(p, l.footprint!), pos).toBe(false);
    }
    // el tramo más largo (9 m) menos el margen
    expect(s.width, pos).toBeCloseTo(9 - LOT_SIGN.margen, 6);
  }
});

test('lotSign: un quiebre de pocos centímetros no corta el cartel', () => {
  // 0,5° en el medio de 20 m: el vértice queda a 4 cm de la cuerda
  const a = (0.5 * Math.PI) / 180;
  const line: Vec2[] = [[0, 0], [10, 0], [10 + 10 * Math.cos(a), 10 * Math.sin(a)]];
  const fr: Frontage = { ...recta, line, length: 20, ext: [[-20, 0], [10, 0], [10 + 30 * Math.cos(a), 30 * Math.sin(a)]] };
  const [l] = layoutLots(frente([{ ancho: 20, cartel: cartelDe('frente') }]), fr, []);
  const s = lotSign(l, 4)!;
  expect(s.width).toBeCloseTo(20 - LOT_SIGN.margen, 2);
  // de punta a punta, la caja queda a 8 ± 5 cm de la pared y nunca adentro del edificio
  const [p, q] = puntas(s);
  for (let k = 0; k <= 10; k++) {
    const x: Vec2 = [p[0] + ((q[0] - p[0]) * k) / 10, p[1] + ((q[1] - p[1]) * k) / 10];
    expect(Math.abs(distLine(x, l.front) - LOT_SIGN.offset)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(pointInPolygon(x, l.footprint!)).toBe(false);
  }
});

test('lotSign: deja libre el tramo que ocupa una ayuda en una punta', () => {
  const [l] = layoutLots(frente([{ ancho: 100, cartel: cartelDe('frente') }]), recta, []);
  const fin = lotSign(l, 4, { fin: 1.1 })!;
  const xs = puntas(fin).map((p) => p[0]);
  expect(Math.min(...xs)).toBeCloseTo(LOT_SIGN.margen / 2, 6);
  expect(Math.max(...xs)).toBeCloseTo(100 - 1.1, 6);
  const ini = lotSign(l, 4, { inicio: 2.1 })!;
  expect(Math.min(...puntas(ini).map((p) => p[0]))).toBeCloseTo(2.1, 6);
  expect(Math.max(...puntas(ini).map((p) => p[0]))).toBeCloseTo(100 - LOT_SIGN.margen / 2, 6);
  // un ancho pedido que entra se respeta, centrado en lo que queda libre
  const [m] = layoutLots(frente([{ ancho: 100, cartel: cartelDe('frente', 6) }]), recta, []);
  const s = lotSign(m, 4, { inicio: 2.1 })!;
  expect(s.width).toBe(6);
  expect(s.anchor[0]).toBeCloseTo((2.1 + 99.8) / 2, 6);
});

test('lotSign: un cartel.ancho más largo que la fachada se achica y avisa', () => {
  const [l] = layoutLots(frente([{ ancho: 30, cartel: cartelDe('frente', 40) }, { ancho: 70 }]), recta, []);
  const warnings: string[] = [];
  const s = lotSign(l, 4, undefined, warnings)!;
  expect(s.width).toBeCloseTo(30 - LOT_SIGN.margen, 6);
  expect(warnings).toEqual(['frente t, lote 1: cartel.ancho es 40,0 m y en la fachada entran 29,6 m; se achica']);
  // lo que achica una ayuda no es un error del archivo: no avisa
  const [m] = layoutLots(frente([{ ancho: 30, cartel: cartelDe('frente', 29) }, { ancho: 70 }]), recta, []);
  const quiet: string[] = [];
  expect(lotSign(m, 4, { fin: 1.1 }, quiet)!.width).toBeCloseTo(30 - 0.2 - 1.1, 6);
  expect(quiet).toEqual([]);
});

test('aidEnds: la ayuda no va en la bahía de la puerta ni junto a la bandera', () => {
  const ends = (o: Partial<LoteInput>) => aidEnds(layoutLots(frente([{ ancho: 9, ...o }, { ancho: 91 }]), recta, [])[0]);
  expect(ends({ puerta: 'inicio' })).toEqual(['fin']);
  expect(ends({ puerta: 'fin' })).toEqual(['inicio']);
  expect(ends({ puerta: 'medio' })).toEqual(['fin', 'inicio']); // 3 bahías: la puerta en la del medio
  expect(ends({ puerta: 'medio', ancho: 6 })).toEqual(['fin']); // 2 bahías: la del medio es la primera
  expect(ends({ puerta: 'medio', cartel: cartelDe('bandera') })).toEqual(['fin']);
  expect(ends({ puerta: 'fin', cartel: cartelDe('bandera') })).toEqual(['fin']); // no queda otra: mejor la puerta que la bandera
  expect(ends({ puerta: 'inicio', ancho: 2.5 })).toEqual(['fin', 'inicio']); // una sola bahía: la puerta está en las dos
});

test('lotOverlap: área y ancho medio; una astilla casi no tiene ancho', () => {
  const sq: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  expect(lotOverlap(sq, sq)).toEqual({ area: expect.closeTo(100, 6), width: expect.closeTo(5, 6) });
  const astilla = lotOverlap(sq, [[9.98, 0], [20, 0], [20, 10], [10, 10]]); // triángulo de 2 cm × 10 m
  expect(astilla.area).toBeCloseTo(0.1, 6);
  expect(astilla.width).toBeLessThan(0.01);
  expect(lotOverlap(sq, [[50, 50], [60, 50], [60, 60]])).toEqual({ area: 0, width: 0 });
});
