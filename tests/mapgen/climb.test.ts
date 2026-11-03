import { heightFor } from '../../src/mapgen/buildings.ts';
import { MANTLE_REACH, placeClimbAids, roofClusters } from '../../src/mapgen/climb.ts';
import { areaRect, distPointSegment, ensureCCW, polygonArea } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, Prop, Road } from '../../src/shared/mapdata.ts';

function box(id: string, x0: number, z0: number, x1: number, z1: number, floors: number, height = heightFor(floors)): Building {
  return {
    id,
    footprint: ensureCCW([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]),
    height,
    floors,
    kind: 'house',
    wall: 'plaster',
    tint: '#ccc',
  };
}
const road: Road = { id: 'r1', kind: 'residential', width: 6, sidewalk: 3, points: [[-100, -20], [100, -20]] };
const roads = [road];

const h1 = box('h1', 0, 0, 10, 10, 1);
const h2adj = box('h2', 10, 0, 20, 10, 2, 5.8); // Δh = 2.0 ≤ 2.4
const h3adj = box('h3', 10, 0, 20, 10, 2); // Δh = 3.2 > 2.4
const aidsFor = (b: Building[]): Prop[] => placeClimbAids(b, roads);

test('MANTLE_REACH', () => expect(MANTLE_REACH).toBe(2.4));

test('cluster de 1 piso → contenedor; de 2 pisos → escalera', () => {
  expect(aidsFor([h1])).toEqual([expect.objectContaining({ kind: 'dumpster' })]);
  expect(aidsFor([box('t', 0, 0, 10, 10, 2)])[0]).toMatchObject({ kind: 'ladder', topY: heightFor(2), buildingId: 't' });
});

test('edificios pegados con Δh ≤ 2,4 forman un cluster', () => expect(roofClusters([h1, h2adj])).toHaveLength(1));

test('Δh 3,2 → clusters separados, ambos con acceso', () => {
  expect(roofClusters([h1, h3adj])).toHaveLength(2);
  expect(placeClimbAids([h1, h3adj], roads)).toHaveLength(2);
});

test('edificios a ≤ 1 m forman cluster; a más de 1 m no', () => {
  expect(roofClusters([h1, box('n', 11, 0, 20, 10, 1)])).toHaveLength(1);
  expect(roofClusters([h1, box('n', 11.5, 0, 20, 10, 1)])).toHaveLength(2);
});

test('el acceso del cluster va en el edificio más bajo', () => {
  const [aid] = placeClimbAids([h2adj, h1], roads);
  expect(aid.kind).toBe('dumpster');
});

test('contenedor a 0,2 m de la pared y paralelo a ella', () => {
  const [aid] = aidsFor([h1]);
  if (aid.kind !== 'dumpster') throw new Error('esperaba dumpster');
  const fp = h1.footprint;
  const lx: Vec2 = [Math.cos(aid.rotation), -Math.sin(aid.rotation)];
  const ok = fp.some((a, i) => {
    const b = fp[(i + 1) % fp.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cross = (lx[0] * (b[1] - a[1]) - lx[1] * (b[0] - a[0])) / len;
    // centro a 0.2 + 1.1/2 del muro, y el eje largo paralelo
    return Math.abs(cross) < 1e-9 && Math.abs(distPointSegment(aid.position, a, b) - 0.75) < 1e-9;
  });
  expect(ok).toBe(true);
});

test('escalera: base sobre la pared con normal hacia afuera', () => {
  const [aid] = aidsFor([box('t', 0, 0, 10, 10, 3)]);
  if (aid.kind !== 'ladder') throw new Error('esperaba ladder');
  const fp = box('t', 0, 0, 10, 10, 3).footprint;
  const d = Math.min(...fp.map((a, i) => distPointSegment(aid.base, a, fp[(i + 1) % fp.length])));
  expect(d).toBeCloseTo(0, 9);
  expect(Math.hypot(aid.normal[0], aid.normal[1])).toBeCloseTo(1, 9);
  const out: Vec2 = [aid.base[0] + aid.normal[0] * 0.3, aid.base[1] + aid.normal[1] * 0.3];
  expect(out[0] < 0 || out[0] > 10 || out[1] < 0 || out[1] > 10).toBe(true);
});

test('prefiere una arista cuyo contenedor no cae en la calzada', () => {
  // calle pegada al muro norte (z=0): el contenedor ahí quedaría dentro de la calzada
  const r: Road = { id: 'r', kind: 'residential', width: 6, sidewalk: 0, points: [[-50, -1], [50, -1]] };
  const [aid] = placeClimbAids([h1], [r]);
  if (aid.kind !== 'dumpster') throw new Error('esperaba dumpster');
  expect(distPointSegment(aid.position, [-50, -1], [50, -1])).toBeGreaterThan(4);
});

test('cluster con más de 1500 m² de techo recibe 2 accesos, separados', () => {
  const big = box('big', 0, 0, 40, 40, 2); // 1600 m²
  const aids = aidsFor([big]);
  expect(polygonArea(big.footprint)).toBeGreaterThan(1500);
  expect(aids).toHaveLength(2);
  const pos = (p: Prop): Vec2 => (p.kind === 'ladder' ? p.base : (p as { position: Vec2 }).position);
  expect(Math.hypot(pos(aids[0])[0] - pos(aids[1])[0], pos(aids[0])[1] - pos(aids[1])[1])).toBeGreaterThan(10);
});

test('edificio sin arista a calle igual recibe acceso (fallback)', () => {
  // rodeado por vecinos pegados en los 4 lados con alturas distintas (clusters separados)
  const c = box('c', 0, 0, 10, 10, 1);
  const ring = [
    box('n', 0, -10, 10, 0, 3),
    box('s', 0, 10, 10, 20, 3),
    box('w', -10, 0, 0, 10, 3),
    box('e', 10, 0, 20, 10, 3),
  ];
  const aids = placeClimbAids([c, ...ring], roads);
  expect(aids.some((a) => a.kind === 'dumpster')).toBe(true);
});

test('determinista', () => {
  expect(placeClimbAids([h1, h3adj], roads)).toEqual(placeClimbAids([h1, h3adj], roads));
});

test('una escalera no se ubica a menos de 1 m del borde del área jugable', () => {
  const r = areaRect();
  const edge = box('e', r.maxX - 10, 0, r.maxX - 0.5, 10, 2);
  const [aid] = placeClimbAids([edge], roads);
  expect(aid.kind).toBe('ladder');
  const base = (aid as Extract<Prop, { kind: 'ladder' }>).base;
  expect(base[0]).toBeLessThanOrEqual(r.maxX - 1);
  expect(base[0]).toBeGreaterThanOrEqual(r.minX + 1);
  expect(base[1]).toBeGreaterThanOrEqual(r.minZ + 1);
  expect(base[1]).toBeLessThanOrEqual(r.maxZ - 1);
});
