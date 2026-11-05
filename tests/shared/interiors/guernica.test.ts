// Guernica Bar (§4.8) sobre el mapa real, con el controlador del jugador y el hitscan del juego: dos pisos públicos, el
// patio de adelante (D12) con sus árboles y guirnaldas, la chapa con "GUERNICA" y las estrellas, la barra larga con los
// estantes de botellas y la torre de canillas, la escalera, la planta alta con el rincón del escenario y el balcón al
// frente (D14), afuera de la planta, sobre el patio.
import { readFileSync } from 'node:fs';
import { isFreeSpot } from '../../../src/mapgen/spawns.ts';
import { buildCollisionWorld } from '../../../src/shared/collision.ts';
import { hitscan } from '../../../src/shared/combat.ts';
import { distPointSegment, pointInPolygon, toLocal } from '../../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { INTERIOR_PLANS, interiorOf } from '../../../src/shared/interiors/index.ts';
import { LEVEL_H } from '../../../src/shared/interiors/openings.ts';
import type { Block } from '../../../src/shared/interiors/types.ts';
import type { MapData } from '../../../src/shared/mapdata.ts';
import { enterDoor, walkTo } from './walk.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const i = interiorOf(map, 'guernica-bar');
const b = map.buildings.find((x) => x.id === i.buildingId)!;
const frame = map.interiors.find((x) => x.placeId === 'guernica-bar')!.frame;

const fmt = (p: readonly number[]): string => p.map((v) => v.toFixed(2)).join(', ');
const xz = (p: Vec3): Vec2 => [p[0], p[2]];
const local = (p: Vec2): Vec2 => toLocal(frame, p);
const toRing = (p: Vec2, ring: Vec2[]): number => Math.min(...ring.map((q, k) => distPointSegment(p, q, ring[(k + 1) % ring.length])));
const boxOf = (x: Block): [number, number, number, number] => {
  const l = x.polygon.map(local);
  return [Math.min(...l.map((p) => p[0])), Math.min(...l.map((p) => p[1])), Math.max(...l.map((p) => p[0])), Math.max(...l.map((p) => p[1]))];
};
function mark(name: string): Vec3 {
  const p = i.marks[name];
  if (!p) throw new Error(`guernica-bar: falta la marca "${name}"`);
  return p;
}
const balconDoor = i.doors.find((d) => d.level === 1)!;

test('tiene su plan: dos pisos públicos (floors 0 y 1), sin terraza', () => {
  expect(INTERIOR_PLANS['guernica-bar']).toBeDefined();
  expect(i.publicFloors).toBe(2);
  expect(i.floors.map((f) => [f.level, f.y])).toEqual([[0, 0], [1, LEVEL_H]]);
  expect(i.stairs.filter((s) => s.from === 0 && s.to === 1)).toHaveLength(1);
});

describe('el balcón (D14)', () => {
  test('walkTo de planta-alta a balcon pasa por la puerta del piso 1 y queda a y = 3,2 (± 0,05), afuera de la planta', () => {
    const [p, q] = [mark('planta-alta'), mark('balcon')];
    expect(p[1]).toBeCloseTo(LEVEL_H, 6);
    expect(pointInPolygon(xz(p), b.footprint)).toBe(true);
    expect(pointInPolygon(xz(q), b.footprint)).toBe(false);
    // la recta cruza la puerta del piso 1
    const [a, c] = [local(xz(p)), local(xz(q))], d = local(balconDoor.at);
    const t = (d[1] - a[1]) / (c[1] - a[1]), u = a[0] + (c[0] - a[0]) * t;
    expect(t > 0 && t < 1 && Math.abs(u - d[0]) < balconDoor.width / 2 - 0.4, `cruza el frente en u = ${u.toFixed(2)}`).toBe(true);
    const end = walkTo(world, p, xz(q), 6);
    expect(Math.abs(end.pos[1] - LEVEL_H), `termina en ${fmt(end.pos)}`).toBeLessThanOrEqual(0.05);
    expect(Math.hypot(end.pos[0] - q[0], end.pos[2] - q[2]), `termina en ${fmt(end.pos)}`).toBeLessThan(0.6);
  });

  test('desde el balcón se entra por la puerta del piso 1 (enterDoor desde 1 m) y no se cae: la baranda negra frena', () => {
    const s = enterDoor(world, balconDoor, { from: 1 });
    expect(Math.abs(s.pos[1] - LEVEL_H)).toBeLessThanOrEqual(0.05);
    expect(pointInPolygon(xz(s.pos), b.footprint)).toBe(true);
    // caminando 3 s del balcón hacia el patio, queda arriba
    const q = mark('balcon'), out: Vec2 = [balconDoor.normal[0], balconDoor.normal[1]]; // la normal de la puerta mira afuera
    const far = walkTo(world, q, [q[0] + out[0] * 6, q[2] + out[1] * 6], 3);
    expect(Math.abs(far.pos[1] - LEVEL_H), `termina en ${fmt(far.pos)}`).toBeLessThanOrEqual(0.05);
    const rails = i.blocks.filter((x) => x.role === 'baranda' && x.collide === 'glass' && Math.abs(x.y0 - LEVEL_H) < 1e-6 && boxOf(x)[1] < -0.3);
    expect(rails.length).toBeGreaterThanOrEqual(3);
    const black = i.blocks.filter((x) => x.out && x.side && parseInt(x.side.color.slice(1, 3), 16) < 0x30 && x.y0 >= LEVEL_H - 1e-6 && x.y1 <= LEVEL_H + 1.05 && boxOf(x)[1] < -0.3);
    expect(black.length, 'la baranda negra (se ve de lejos)').toBeGreaterThanOrEqual(3);
  });

  test('un tiro de balcon a un blanco en patio le da (target)', () => {
    const p = mark('balcon'), q = mark('patio');
    expect(q[1]).toBe(0);
    const from: Vec3 = [p[0], p[1] + 1.6, p[2]], to: Vec3 = [q[0], q[1] + 1.2, q[2]];
    const hit = hitscan(world, [{ id: 'blanco', pos: q, crouching: false }], from, [to[0] - from[0], to[1] - from[1], to[2] - from[2]], 60);
    expect(hit).toMatchObject({ kind: 'target', id: 'blanco' });
  });

  test('el balcón y la chapa son out: el botín, las apariciones y el spawn del lugar siguen libres en el mundo hueco', () => {
    const near = (p: Vec2): boolean => toRing(p, b.footprint) < 15 || pointInPolygon(p, b.footprint);
    const place = map.places.find((p) => p.id === 'guernica-bar')!;
    const spots: Vec3[] = [...map.lootSpots.map((l) => l.pos), ...map.randomSpawns, place.spawn].filter((p) => near(xz(p)));
    expect(spots.length).toBeGreaterThan(0);
    for (const p of spots) expect(isFreeSpot(world, p[0], p[2], p[1]), fmt(p)).toBe(true);
    const slab = i.blocks.filter((x) => x.out && x.collide === 'solid' && Math.abs(x.y1 - LEVEL_H) < 1e-6 && boxOf(x)[1] < -1);
    expect(slab.length, 'la losa del balcón').toBeGreaterThanOrEqual(1);
  });
});

describe('planta baja', () => {
  test('la barra larga de madera oscura es sólida, con los estantes iluminados de botellas detrás y la torre de canillas', () => {
    const barra = i.blocks.filter((x) => x.role === 'mueble' && x.collide === 'solid' && x.y0 === 0 && x.y1 >= 1.0 && x.y1 <= 1.2 && (() => {
      const [u0, v0, u1, v1] = boxOf(x);
      return Math.max(u1 - u0, v1 - v0) > 5;
    })());
    expect(barra.length).toBeGreaterThanOrEqual(1);
    const top = barra[0].top ?? barra[0].side!;
    expect(top.mat).toBe('madera');
    expect(parseInt(top.color.slice(1, 3), 16)).toBeLessThan(0x70);
    const botellas = i.items.filter((it) => it.model === 'botella');
    expect(botellas.length).toBeGreaterThanOrEqual(30);
    for (const it of botellas) expect(it.detail, 'las botellas no van en baja').toBe(2);
    expect(i.items.filter((it) => it.model === 'canillas').length).toBeGreaterThanOrEqual(1);
    // los estantes brillan: hay luz debajo de cada uno
    expect(i.blocks.filter((x) => x.bottom?.mat === 'luz' || x.side?.mat === 'luz').length).toBeGreaterThanOrEqual(3);
    // y la barra frena: caminando 3 s desde la marca barra hacia ella (+U, el pasillo del barman), no se pasa
    const [bu0, bv0, , bv1] = boxOf(barra[0]);
    const q = mark('barra'), [qu, qv] = local(xz(q));
    expect(qu < bu0 && qv > bv0 && qv < bv1, 'la marca, del lado de los clientes').toBe(true);
    const far = walkTo(world, q, [q[0] + frame.u[0] * 4, q[2] + frame.u[1] * 4], 3);
    const [fu] = local(xz(far.pos));
    expect(fu, `termina en ${fmt(far.pos)} (u = ${fu.toFixed(2)})`).toBeLessThan(bu0);
    expect(fu, 'llegó a la barra').toBeGreaterThan(bu0 - 0.6);
  });

  test('detrás de las botellas de cada estante, la fila de atrás: un cartel botellas que brilla, entre las botellas y el fondo negro, a lo largo del estante', () => {
    const fila = i.labels.filter((l) => l.drawing === 'botellas');
    const botellas = i.items.filter((it) => it.model === 'botella');
    const ys = [...new Set(botellas.map((it) => it.at[1]))].sort((a, c) => a - c);
    expect(ys).toHaveLength(3);
    expect(fila).toHaveLength(3);
    const fondo = i.blocks.filter((x) => x.side && parseInt(x.side.color.slice(1, 3), 16) < 0x30 && x.y0 <= ys[0] && x.y1 >= ys[2] + 0.4 && boxOf(x)[2] - boxOf(x)[0] < 0.05);
    expect(fondo.length, 'el fondo negro de los estantes').toBeGreaterThanOrEqual(1);
    const panel = boxOf(fondo[0])[0];
    for (const [j, y] of ys.entries()) {
      const l = fila.find((x) => x.at[1] - x.height / 2 >= y - 1e-6 && x.at[1] - x.height / 2 < y + 0.05);
      expect(l, `el cartel del estante ${j + 1} (y = ${y})`).toBeDefined();
      expect(l!.glow && !l!.out).toBe(true);
      expect(l!.at[1] + l!.height / 2, 'no llega al estante de arriba').toBeLessThanOrEqual((ys[j + 1] ?? y + 0.45) - 0.03 + 1e-6);
      const [u, v] = local(xz(l!.at));
      const del = botellas.filter((it) => it.at[1] === y).map((it) => local(xz(it.at)));
      expect(u > Math.max(...del.map((p) => p[0])) + 0.04 && u < panel, `entre las botellas y el fondo: u = ${u.toFixed(3)}`).toBe(true);
      // mira a la barra (−U) y cubre todas las botellas de su estante
      const n = local([frame.origin[0] + l!.normal[0], frame.origin[1] + l!.normal[1]]);
      expect(n[0]).toBeCloseTo(-1, 6);
      for (const p of del) expect(Math.abs(p[1] - v), 'a lo ancho del cartel').toBeLessThanOrEqual(l!.width / 2);
    }
  });

  test('mesas altas (MODEL_BOX) y bajas, banquetas en la barra', () => {
    expect(i.items.filter((it) => it.model === 'mesa-alta').length).toBeGreaterThanOrEqual(3);
    expect(i.items.filter((it) => it.model === 'mesa' && it.at[1] === 0).length).toBeGreaterThanOrEqual(2);
    expect(i.items.filter((it) => it.model === 'banqueta').length).toBeGreaterThanOrEqual(8);
  });

  test('en planta baja (y = 0 y adentro de la planta: el patio también está a 0), mesas altas entre la barra y las mesas bajas, con sus banquetas; la barra de la vidriera sigue', () => {
    const abajo = (p: Vec3): boolean => p[1] === 0 && pointInPolygon(xz(p), b.footprint);
    const altas = i.items.filter((it) => it.model === 'mesa-alta' && abajo(it.at));
    const bajas = i.items.filter((it) => it.model === 'mesa' && abajo(it.at));
    expect(altas.length, 'mesas altas en planta baja').toBeGreaterThanOrEqual(1);
    expect(altas.length).toBeLessThanOrEqual(2);
    const barra = i.blocks.find((x) => x.role === 'mueble' && x.collide === 'solid' && x.y0 === 0 && x.y1 >= 1.0 && x.y1 <= 1.2 && boxOf(x)[3] - boxOf(x)[1] > 5)!;
    const [bu0, bv0, , bv1] = boxOf(barra);
    const masAllaDeLasBajas = Math.max(...bajas.map((it) => local(xz(it.at))[0]));
    const banquetas = i.items.filter((it) => it.model === 'banqueta' && abajo(it.at));
    for (const it of altas) {
      const [u, v] = local(xz(it.at));
      expect(u > masAllaDeLasBajas && u < bu0, `entre las mesas bajas y la barra: u = ${u.toFixed(2)}`).toBe(true);
      expect(v > bv0 && v < bv1, `a lo largo de la barra: v = ${v.toFixed(2)}`).toBe(true);
      expect(banquetas.filter((s) => Math.hypot(s.at[0] - it.at[0], s.at[2] - it.at[2]) < 0.8).length, 'sus banquetas').toBeGreaterThanOrEqual(2);
    }
    // la barra de la vidriera: el mueble sólido de ~1 m contra el frente, con sus banquetas mirando a la calle
    const vidriera = i.blocks.filter((x) => x.role === 'mueble' && x.collide === 'solid' && x.y0 === 0 && x.y1 >= 0.95 && x.y1 <= 1.05 && boxOf(x)[1] < 0.5 && boxOf(x)[2] - boxOf(x)[0] > 4);
    expect(vidriera).toHaveLength(1);
  });
});

describe('el patio de adelante y el frente', () => {
  test('mesas bajo árboles propios (árboles del mapa: Interior.trees, con el tronco sólido de collision.ts) y guirnaldas de lamparitas', () => {
    const patio = i.patios[0];
    expect(i.trees.length).toBeGreaterThanOrEqual(2);
    for (const t of i.trees) {
      expect(pointInPolygon(t.position, patio), 'en el patio').toBe(true);
      expect(world.overlaps(t.position[0], t.position[1], 0.05, 0.05, 1.8), `tronco sólido en ${fmt(t.position)}`).toBe(true);
    }
    const mesas = i.items.filter((it) => (it.model === 'mesa' || it.model === 'mesa-alta' || it.model === 'mesa-redonda') && pointInPolygon(xz(it.at), patio));
    expect(mesas.length).toBeGreaterThanOrEqual(3);
    expect(i.items.filter((it) => it.model === 'guirnalda').length).toBeGreaterThanOrEqual(3);
  });

  test('la chapa acanalada (out) con "GUERNICA" que brilla y una estrella a cada lado', () => {
    const name = i.labels.filter((l) => l.text.includes('GUERNICA'));
    expect(name).toHaveLength(1);
    const g = name[0];
    expect(g.out && g.glow && g.placeSign).toBe(true);
    const stars = i.labels.filter((l) => l.text === '★' && l.out);
    expect(stars).toHaveLength(2);
    const [gu] = local(xz(g.at));
    expect(stars.map((s) => Math.sign(local(xz(s.at))[0] - gu)).sort()).toEqual([-1, 1]);
    // la chapa: ondas (costillas) out detrás del cartel
    const ribs = i.blocks.filter((x) => x.out && Math.abs(x.y0 - (g.at[1] - g.height / 2)) < 0.4 && boxOf(x)[1] < 0 && boxOf(x)[1] > -0.2);
    expect(ribs.length).toBeGreaterThanOrEqual(30);
  });

  test('del patio se entra por la puerta de planta baja y se llega al pie de la escalera', () => {
    const [door] = i.doors;
    const s = enterDoor(world, door);
    expect(pointInPolygon(xz(s.pos), b.footprint)).toBe(true);
    const st = i.stairs.find((x) => x.from === 0)!;
    const end = walkTo(world, s.pos, [st.foot[0], st.foot[2]], 10);
    expect(Math.hypot(end.pos[0] - st.foot[0], end.pos[2] - st.foot[2]), `termina en ${fmt(end.pos)}`).toBeLessThan(0.6);
  });
});
