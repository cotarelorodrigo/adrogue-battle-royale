import { heightFor } from '../../src/mapgen/buildings.ts';
import { MANTLE_REACH, placeClimbAids, placeClimbAidsWithStats, roofClusters } from '../../src/mapgen/climb.ts';
import { DUMPSTER, PARAPET_H } from '../../src/shared/collision.ts';
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
/** En la fachada de un lote, el eje de la escalera queda a esto de la punta. */
const LADDER_AT = 0.6;

test('MANTLE_REACH', () => expect(MANTLE_REACH).toBe(2.4));

test('cluster de 1 piso → contenedor; de 2 pisos → escalera', () => {
  expect(aidsFor([h1])).toEqual([expect.objectContaining({ kind: 'dumpster' })]);
  // la escalera llega al tope del pretil: el empuje del final pasa por encima
  expect(aidsFor([box('t', 0, 0, 10, 10, 2)])[0]).toMatchObject({ kind: 'ladder', topY: heightFor(2) + PARAPET_H, buildingId: 't' });
});

test('desde arriba de un contenedor el mantle llega al tope del pretil de un piso, y al contenedor desde el suelo', () => {
  expect(DUMPSTER.height + MANTLE_REACH).toBeGreaterThanOrEqual(heightFor(1) + PARAPET_H - 1e-9);
  expect(DUMPSTER.height).toBeLessThanOrEqual(MANTLE_REACH);
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

test('sin arista a la calle, la escalera va en la arista más larga con la caja libre (no contra otro edificio)', () => {
  // la arista sur (6,5 m) es la más larga pero tiene un vecino a 0,3 m: el pie de la escalera quedaría trabado
  const t: Building = { ...box('t', 0, 0, 1, 1, 2), footprint: ensureCCW([[0, 0], [6.5, 0], [6.4, 4.2], [0, 4.2]]) };
  const around = [box('s', -1, -4, 7.5, -0.3, 1), box('n', -1, 6.2, 7.5, 10, 1), box('e', 8.5, -4, 12, 10, 1), box('o', -5, -4, -2, 10, 1)];
  const { props, stats } = placeClimbAidsWithStats([t, ...around], roads);
  expect(stats.fallback).toBeGreaterThanOrEqual(1);
  const a = props.find((p) => p.kind === 'ladder' && p.buildingId === 't');
  expect(a).toMatchObject({ base: [expect.closeTo(3.2, 6), expect.closeTo(4.2, 6)], normal: [expect.closeTo(0, 9), expect.closeTo(1, 9)] });
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

test('cluster cuyas ayudas caerían todas fuera del área: noAidOutside, no noAid', () => {
  const r = areaRect();
  // entra 0,5 m al área: la única arista adentro deja la ayuda a menos de 1 m del borde
  const edge = box('e', r.maxX - 0.5, 0, r.maxX + 10, 10, 2);
  const inside = box('i', 0, 0, 10, 10, 2);
  const { props, stats } = placeClimbAidsWithStats([inside, edge], roads);
  expect(stats.noAidOutside).toBe(1);
  expect(stats.noAid).toBe(0);
  expect(props).toHaveLength(1);
});

describe('lotes relevados: la ayuda no tapa la fachada', () => {
  // calle al norte (z = −20); el lote m (x 10..20) tiene vecinos de 4 pisos pegados a los costados y un edificio de 4 pisos
  // a 0,5 m detrás: su única arista a la calle es la fachada (z = 0), de desde (x = 10) a hasta (x = 20)
  const front = (b: Building): Building => ({ ...b, front: { edges: [], corner: [], pb: 'vidriera', arriba: 'ventanas', puerta: 'inicio' } });
  const vecinos = [box('w', 0, 0, 10, 10, 4), box('e', 20, 0, 30, 10, 4), box('fondo', 0, 10.5, 30, 20, 4)];
  const line: Vec2[] = [[10, 0], [20, 0]];
  const ayudaDe = (props: Prop[], id: string) => props.find((p) => (p.kind === 'ladder' && p.buildingId === id)
    || (p.kind === 'dumpster' && p.position[0] > 10 && p.position[0] < 20 && p.position[1] < 0));
  test('con la fachada como única arista a la calle, la escalera va en la punta pedida (no en el medio) y deja el tramo anotado', () => {
    const m = front(box('m', 10, 0, 20, 10, 2));
    const fin = placeClimbAidsWithStats([m, ...vecinos], roads, new Map([['m', { line, puntas: ['fin' as const] }]]));
    const a = ayudaDe(fin.props, 'm');
    if (a?.kind !== 'ladder') throw new Error('esperaba ladder');
    // a 0,6 m de la punta y no a 0,1 + 0,4: arriba, el jugador queda 0,6 m adentro y lejos del pretil de la medianera
    // (0,2 de pretil + 0,35 de radio + margen), así cae al techo en vez de quedar parado sobre el pretil
    expect(a.base[0]).toBeCloseTo(20 - LADDER_AT, 6);
    expect(a.base[1]).toBeCloseTo(0, 6);
    expect(a.normal).toEqual([expect.closeTo(0, 9), expect.closeTo(-1, 9)]);
    expect(fin.slots.get('m')).toEqual({ fin: expect.closeTo(LADDER_AT + 0.4 + 0.2, 6) });
    const ini = placeClimbAidsWithStats([m, ...vecinos], roads, new Map([['m', { line, puntas: ['inicio' as const] }]]));
    const b = ayudaDe(ini.props, 'm');
    if (b?.kind !== 'ladder') throw new Error('esperaba ladder');
    expect(b.base[0]).toBeCloseTo(10 + LADDER_AT, 6);
    expect(ini.slots.get('m')).toEqual({ inicio: expect.closeTo(LADDER_AT + 0.6, 6) });
  });
  test('un lote de un piso: el contenedor va en la punta y reserva su largo', () => {
    const m = front(box('m', 10, 0, 20, 10, 1));
    const { props, slots } = placeClimbAidsWithStats([m, ...vecinos], roads, new Map([['m', { line, puntas: ['fin' as const] }]]));
    const a = ayudaDe(props, 'm');
    if (a?.kind !== 'dumpster') throw new Error('esperaba dumpster');
    expect(a.position[0]).toBeCloseTo(20 - 0.1 - 0.9, 6);
    expect(a.position[1]).toBeCloseTo(-0.75, 6);
    expect(slots.get('m')).toEqual({ fin: expect.closeTo(0.1 + 1.8 + 0.2, 6) });
  });
  test('con una arista libre sobre la calle de la esquina, la ayuda va ahí y la fachada queda entera', () => {
    const m = front(box('m', 10, 0, 20, 10, 2));
    // transversal por x = 26: su línea de edificación (3 + 3 m) es la arista este de m
    const esquina: Road = { id: 'r2', kind: 'residential', width: 6, sidewalk: 3, points: [[26, -100], [26, 100]] };
    const { props, slots } = placeClimbAidsWithStats([m, vecinos[0], vecinos[2]], [...roads, esquina], new Map([['m', { line, puntas: ['fin' as const] }]]));
    const a = props.find((p) => p.kind === 'ladder' && p.buildingId === 'm');
    if (a?.kind !== 'ladder') throw new Error('esperaba ladder');
    expect(a.base[0]).toBeCloseTo(20, 6);
    expect(a.normal[0]).toBeCloseTo(1, 9);
    expect(slots.has('m')).toBe(false);
  });
  test('un fondo o un costado que da a un patio, sin calle, no sirve: la ayuda va en la punta de la fachada', () => {
    const m = front(box('m', 10, 0, 20, 10, 2));
    // sin vecino al este ni edificio detrás: el costado y el fondo están libres, pero no dan a ninguna calle
    const { props, slots } = placeClimbAidsWithStats([m, vecinos[0]], roads, new Map([['m', { line, puntas: ['fin' as const] }]]));
    const a = props.find((p) => p.kind === 'ladder' && p.buildingId === 'm');
    if (a?.kind !== 'ladder') throw new Error('esperaba ladder');
    expect(a.base).toEqual([expect.closeTo(20 - LADDER_AT, 6), expect.closeTo(0, 6)]);
    expect(slots.get('m')).toEqual({ fin: expect.closeTo(LADDER_AT + 0.6, 6) });
  });
  test('sin el lote en el mapa de lotes, sigue yendo al medio de la arista', () => {
    const m = front(box('m', 10, 0, 20, 10, 2));
    const a = ayudaDe(placeClimbAidsWithStats([m, ...vecinos], roads).props, 'm');
    if (a?.kind !== 'ladder') throw new Error('esperaba ladder');
    expect(a.base[0]).toBeCloseTo(15, 6);
  });
});
