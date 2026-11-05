// El McDonald's (§4.5) sobre el mapa real, con el controlador del jugador y el hitscan del juego: el salón detrás del
// frente vidriado, el mostrador con el paso a la cocina en una punta, la cocina que esconde, el patio del fondo a cielo
// abierto (D12) y lo de afuera: la torre con la "M" y los carteles.
import { readFileSync } from 'node:fs';
import { isFreeSpot } from '../../../src/mapgen/spawns.ts';
import { buildCollisionWorld } from '../../../src/shared/collision.ts';
import { hitscan } from '../../../src/shared/combat.ts';
import { distPointSegment, pointInPolygon } from '../../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { INTERIOR_PLANS, interiorOf } from '../../../src/shared/interiors/index.ts';
import { MODEL_BOX } from '../../../src/shared/interiors/kit.ts';
import type { Door } from '../../../src/shared/interiors/openings.ts';
import type { ItemModel } from '../../../src/shared/interiors/types.ts';
import type { MapData } from '../../../src/shared/mapdata.ts';
import { doorDepth, enterDoor, insideOf, walkTo } from './walk.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const i = interiorOf(map, 'mcdonalds');
const b = map.buildings.find((x) => x.id === i.buildingId)!;

const fmt = (p: readonly number[]): string => p.map((v) => v.toFixed(2)).join(', ');
const xz = (p: Vec3): Vec2 => [p[0], p[2]];
const dist2 = (a: Vec2, c: Vec2): number => Math.hypot(a[0] - c[0], a[1] - c[1]);
const toRing = (p: Vec2, ring: Vec2[]): number => Math.min(...ring.map((q, k) => distPointSegment(p, q, ring[(k + 1) % ring.length])));
const inPatio = (p: Vec2): boolean => i.patios.some((r) => pointInPolygon(p, r));
const count = (m: ItemModel): number => i.items.filter((it) => it.model === m).length;
const mid = (r: Vec2[]): Vec2 => [r.reduce((t, q) => t + q[0], 0) / r.length, r.reduce((t, q) => t + q[1], 0) / r.length];

function mark(name: string): Vec3 {
  const p = i.marks[name];
  if (!p) throw new Error(`mcdonalds: falta la marca "${name}"`);
  return p;
}
/** La puerta de la calle: la que no da al patio. */
const door: Door = i.doors.find((d) => !inPatio([d.at[0] + d.normal[0], d.at[1] + d.normal[1]]))!;
const inward: Vec2 = [-door.normal[0], -door.normal[1]];
/** Cuánto se mete `p` desde la cara de afuera del frente. */
const depth = (p: Vec2): number => (p[0] - door.at[0]) * inward[0] + (p[1] - door.at[1]) * inward[1];

test('tiene su plan: un piso, sin terraza, con el patio del fondo y dos puertas (la de la calle y la del patio)', () => {
  expect(INTERIOR_PLANS.mcdonalds).toBeDefined();
  expect(i.publicFloors).toBe(1);
  expect(i.terrace).toBe(false);
  expect(i.patios).toHaveLength(1);
  expect(i.doors).toHaveLength(2);
  expect(door).toBeDefined();
});

test('desde la puerta: walkTo([salon, paso-cocina, cocina]) termina a < 0,5 m de la cocina', () => {
  const s0 = enterDoor(world, door);
  const s = walkTo(world, s0.pos, [xz(mark('salon')), xz(mark('paso-cocina')), xz(mark('cocina'))], 15);
  expect(dist2(xz(s.pos), xz(mark('cocina'))), `termina en ${fmt(s.pos)}`).toBeLessThan(0.5);
  expect(insideOf(b, s.pos)).toBe(true);
});

test('el paso del mostrador: en una punta, de ≥ 1,0 m libre; el mostrador mide 1,1 m y es sólido', () => {
  const p = mark('paso-cocina');
  expect(world.overlaps(p[0], p[2], 0.5, 0.05, 1.8), `a 0,5 m de ${fmt(p)} hay algo`).toBe(false);
  // el mostrador: un bloque sólido de 1,1 m, largo, entre el salón y la cocina, que llega hasta el paso
  const counters = i.blocks.filter((x) => x.collide === 'solid' && x.y0 < 0.01 && Math.abs(x.y1 - 1.1) < 0.01
    && depth(x.polygon[0]) > depth(xz(mark('salon'))) && depth(x.polygon[0]) < depth(xz(mark('cocina'))));
  const len = Math.max(0, ...counters.map((x) => Math.max(...x.polygon.map((q, k) => dist2(q, x.polygon[(k + 1) % x.polygon.length])))));
  expect(len, 'largo del mostrador').toBeGreaterThan(6);
  expect(Math.min(...counters.map((x) => toRing(xz(p), x.polygon))), 'el paso, al lado del mostrador').toBeLessThan(1.0);
});

test('la cocina es escondite: parado en la puerta, el tiro del ojo a alguien en la cocina pega en un sólido', () => {
  const c = mark('cocina');
  const eye: Vec3 = [door.at[0] + inward[0] * 0.3, 1.65, door.at[1] + inward[1] * 0.3];
  const to: Vec3 = [c[0], c[1] + 1.2, c[2]];
  const hit = hitscan(world, [{ id: 'cocinero', pos: c, crouching: false }], eye, [to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]], 60);
  expect(hit, 'algo frena el tiro').not.toBeNull();
  expect(hit!.kind, `pega en ${fmt(hit!.point)}`).toBe('world');
  expect(hit!.dist).toBeLessThan(Math.hypot(to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]) - 0.3);
});

test('el patio del fondo (D12): walkTo llega a patio por la puerta de atrás, y ahí no hay nada arriba (cielo abierto)', () => {
  const route = ['pasillo', 'fondo', 'salida', 'patio'].map((m) => xz(mark(m)));
  const s = walkTo(world, mark('salon'), route, 20);
  const p = mark('patio');
  expect(dist2(xz(s.pos), xz(p)), `termina en ${fmt(s.pos)}`).toBeLessThan(0.5);
  expect(inPatio(xz(p))).toBe(true);
  expect(world.overlaps(p[0], p[2], 0.35, 2.0, 50)).toBe(false);
  // la pared de ladrillo del patio, las mesas de picnic y las sombrillas
  expect(i.blocks.some((x) => x.side?.mat === 'ladrillo' && x.collide === 'solid' && inPatio(mid(x.polygon)) && x.y1 > 2)).toBe(true);
  expect(i.items.filter((it) => it.model === 'mesa-picnic' && inPatio(xz(it.at))).length).toBeGreaterThanOrEqual(2);
  expect(i.items.filter((it) => it.model === 'sombrilla' && inPatio(xz(it.at))).length).toBeGreaterThanOrEqual(2);
});

test('carteles: "CAJA KIOSCO" y un "1" que brillan; pantallas de menú que brillan arriba del mostrador', () => {
  expect(i.labels.some((l) => l.text.includes('CAJA KIOSCO') && l.glow)).toBe(true);
  expect(i.labels.some((l) => l.text === '1' && l.glow)).toBe(true);
  expect(count('pantalla')).toBeGreaterThanOrEqual(3);
  expect(i.labels.filter((l) => l.drawing === 'menu' && l.glow).length).toBeGreaterThanOrEqual(3);
});

test('afuera: carteles `out` con "McDonald\'s" y con la "M"', () => {
  const out = i.labels.filter((l) => l.out);
  expect(out.some((l) => l.text === "McDonald's")).toBe(true);
  expect(out.some((l) => l.text === 'M')).toBe(true);
  // la torre: un bloque `out` arriba del techo
  expect(i.blocks.some((x) => x.out && x.y1 > b.height + 2)).toBe(true);
});

test("views tiene 'salon': adentro, a nivel 0, delante del mostrador, mirando hacia adentro", () => {
  const v = i.views.find((x) => x.id === 'salon');
  expect(v).toBeDefined();
  expect(v!.pos[1]).toBe(0);
  expect(pointInPolygon(xz(v!.pos), b.footprint)).toBe(true);
  expect(depth(xz(v!.pos))).toBeLessThan(depth(xz(mark('paso-cocina'))) - 3);
  const ahead: Vec2 = [-Math.sin(v!.yaw), -Math.cos(v!.yaw)];
  expect(ahead[0] * inward[0] + ahead[1] * inward[1]).toBeGreaterThan(0.7);
});

test('muebles: mesas redondas y sillones sólidos; sillas y banquetas no; freidoras y heladeras de acero en la cocina', () => {
  for (const m of ['mesa-redonda', 'sillon', 'freidora', 'heladera', 'mesa-picnic'] as ItemModel[]) expect(MODEL_BOX[m], m).toBeDefined();
  for (const m of ['silla', 'banqueta', 'lampara', 'sombrilla', 'pantalla'] as ItemModel[]) expect(MODEL_BOX[m], m).toBeUndefined();
  expect(count('mesa-redonda')).toBeGreaterThanOrEqual(6);
  expect(count('silla')).toBeGreaterThanOrEqual(12);
  expect(count('banqueta')).toBeGreaterThanOrEqual(4);
  expect(count('sillon')).toBeGreaterThanOrEqual(4);
  expect(i.labels.filter((l) => l.drawing === 'zigzag').length).toBeGreaterThanOrEqual(1);
  const kitchen = depth(xz(mark('paso-cocina')));
  for (const m of ['freidora', 'heladera'] as ItemModel[]) {
    const its = i.items.filter((it) => it.model === m);
    expect(its.length, m).toBeGreaterThanOrEqual(2);
    for (const it of its) expect(depth(xz(it.at)), `${m} en ${fmt(it.at)}`).toBeGreaterThan(kitchen);
  }
});

test('la heladera de acero de dos puertas mide lo que una de verdad: de 1,2 a 1,4 m de ancho', () => {
  expect(MODEL_BOX.heladera!.w).toBeGreaterThanOrEqual(1.2);
  expect(MODEL_BOX.heladera!.w).toBeLessThanOrEqual(1.4);
});

test('la puerta del personal, del pasillo del fondo a la cocina, queda libre: se pasa caminando', () => {
  // el hueco: el dintel de un tabique entre el pasillo del fondo (salida) y la cocina
  const [k, f] = [depth(xz(mark('cocina'))), depth(xz(mark('salida')))];
  const gaps = i.blocks.filter((x) => x.role === 'dintel' && depth(mid(x.polygon)) > k && depth(mid(x.polygon)) < f);
  expect(gaps.length).toBeGreaterThan(0);
  const g = mid(gaps[0].polygon);
  const route: Vec2[] = [[g[0] + inward[0] * 0.8, g[1] + inward[1] * 0.8], [g[0] - inward[0] * 0.8, g[1] - inward[1] * 0.8], xz(mark('cocina'))];
  const s = walkTo(world, mark('salida'), route, 15);
  expect(dist2(xz(s.pos), xz(mark('cocina'))), `termina en ${fmt(s.pos)}`).toBeLessThan(0.5);
});

test('el patio: por afuera, cada lado que no es del local lleva el revoque del color del ladrillo (se ve de lejos)', () => {
  const ring = i.patios[0], n = ring.length;
  const onPlan = (p: Vec2): boolean => toRing(p, b.footprint) < 1e-3;
  const skins = i.blocks.filter((x) => x.out && x.side && x.y1 > 2 && x.y0 < 0.01);
  const missing: string[] = [];
  for (let k = 0; k < n; k++) {
    const [a, c] = [ring[k], ring[(k + 1) % n]];
    if (onPlan(a) && onPlan(c)) continue;
    const m: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    if (!skins.some((x) => toRing(m, x.polygon) < 0.01)) missing.push(fmt(m));
  }
  expect(missing).toEqual([]);
});

test('las columnas revestidas en madera llevan la veta a lo alto: tablas paradas alrededor, sin caras de `madera` (su veta va a lo ancho)', () => {
  const side = (r: Vec2[], k: number): number => dist2(r[k], r[(k + 1) % r.length]);
  const cols = i.blocks.filter((x) => x.collide === 'solid' && x.role === 'otro' && x.polygon.length === 4 && x.y0 < 0.01 && x.y1 > 2.9
    && [0, 1, 2, 3].every((k) => side(x.polygon, k) > 0.3 && side(x.polygon, k) < 0.6) && pointInPolygon(mid(x.polygon), b.footprint));
  expect(cols.length).toBeGreaterThanOrEqual(2);
  for (const c of cols) {
    expect(c.side?.mat, fmt(mid(c.polygon))).not.toBe('madera');
    const boards = i.blocks.filter((x) => x.collide === 'none' && x.side && x.side.mat !== 'madera' && x.y1 - x.y0 > 2.9
      && Math.max(...x.polygon.map((q) => Math.max(...x.polygon.map((r) => dist2(q, r))))) < 0.17 && toRing(mid(x.polygon), c.polygon) < 0.06);
    expect(boards.length, `tablas alrededor de ${fmt(mid(c.polygon))}`).toBeGreaterThanOrEqual(8);
  }
});

test('cada lámpara campana tiene su lámpara de horneado a < 0,6 m', () => {
  const bells = i.items.filter((it) => it.model === 'lampara');
  expect(bells.length).toBeGreaterThanOrEqual(6);
  for (const it of bells) expect(Math.min(...i.lamps.map((l) => Math.hypot(l.at[0] - it.at[0], l.at[1] - it.at[1], l.at[2] - it.at[2]))), fmt(it.at)).toBeLessThan(0.6);
});

test('el botín, las apariciones y el spawn del lugar alrededor del local siguen libres en el mundo hueco', () => {
  const near = (p: Vec2): boolean => toRing(p, b.footprint) < 15 || pointInPolygon(p, b.footprint);
  const place = map.places.find((p) => p.id === 'mcdonalds')!;
  const spots: Vec3[] = [...map.lootSpots.map((l) => l.pos), ...map.randomSpawns, place.spawn].filter((p) => near(xz(p)));
  expect(spots.length).toBeGreaterThan(0);
  for (const p of spots) expect(isFreeSpot(world, p[0], p[2], p[1]), fmt(p)).toBe(true);
  // y la puerta de la calle sigue a la vista desde el spawn: nada sólido de afuera en el medio
  expect(doorDepth(door, place.spawn)).toBeLessThan(0);
});

// M10 de la revisión de la T11c: los vecinos que tapan el sol (Interior.shade) se buscan por cajas que se cortan, no por
// vértices adentro de la caja: un edificio largo que la cruza sin tener ningún vértice adentro también cuenta
test('un edificio largo que cruza la caja de los vecinos sin tener vértices adentro entra en Interior.shade', () => {
  const pts = [...i.footprint, ...i.patios.flat()];
  const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  const z = Math.max(...pts.map((p) => p[1])) + 15;
  const largo = { ...map.buildings[0], id: 'largo', height: 12, footprint: [[x0 - 200, z], [x1 + 200, z], [x1 + 200, z + 4], [x0 - 200, z + 4]] as Vec2[] };
  const con = interiorOf({ ...map, buildings: [...map.buildings, largo] }, 'mcdonalds');
  expect(con.shade?.some((s) => s.height === 12 && s.polygon === largo.footprint)).toBe(true);
});
