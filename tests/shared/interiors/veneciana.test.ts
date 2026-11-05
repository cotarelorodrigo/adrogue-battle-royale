// La Veneciana (§4.7) sobre el mapa real, con el controlador del jugador y el hitscan del juego: el salón vidriado con
// la esquina redonda, la vitrina de helados, el metegol, la escalera a la terraza con su baranda de caño y la terraza
// (el techo es un piso público más), y lo de afuera: los toldos con el nombre y las mesas de la vereda.
import { readFileSync } from 'node:fs';
import { isFreeSpot } from '../../../src/mapgen/spawns.ts';
import { buildCollisionWorld, collisionPrisms } from '../../../src/shared/collision.ts';
import { hitscan } from '../../../src/shared/combat.ts';
import { SIM_HZ } from '../../../src/shared/fixed-step.ts';
import { distPointSegment, pointInPolygon } from '../../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { INTERIOR_PLANS, interiorOf } from '../../../src/shared/interiors/index.ts';
import { GROUND_Y, MODEL_BOX, RAIL_H, WALL_OUT } from '../../../src/shared/interiors/kit.ts';
import type { Door } from '../../../src/shared/interiors/openings.ts';
import type { MapData } from '../../../src/shared/mapdata.ts';
import { initialState, stepPlayer } from '../../../src/shared/player.ts';
import type { PlayerState } from '../../../src/shared/player.ts';
import { climbStair } from './walk.ts';
import { fmt } from '../../helpers.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const i = interiorOf(map, 'la-veneciana');
const b = map.buildings.find((x) => x.id === i.buildingId)!;
const H = b.height;

const xz = (p: Vec3): Vec2 => [p[0], p[2]];
const dist2 = (a: Vec2, c: Vec2): number => Math.hypot(a[0] - c[0], a[1] - c[1]);
const unit = (a: Vec2): Vec2 => [a[0] / Math.hypot(a[0], a[1]), a[1] / Math.hypot(a[0], a[1])];
const centroid = (p: Vec2[]): Vec2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
const toRing = (p: Vec2, ring: Vec2[]): number => Math.min(...ring.map((q, k) => distPointSegment(p, q, ring[(k + 1) % ring.length])));

function mark(name: string): Vec3 {
  const p = i.marks[name];
  if (!p) throw new Error(`la-veneciana: falta la marca "${name}"`);
  return p;
}
const door: Door = i.doors[0];
const inward: Vec2 = [-door.normal[0], -door.normal[1]];
/** Cuánto se mete `p` desde la cara de afuera del frente (la de la puerta). */
const depth = (p: Vec2): number => (p[0] - door.at[0]) * inward[0] + (p[1] - door.at[1]) * inward[1];
/** La terraza: el piso del nivel 1. */
const terrace = (): { y: number; polygon: Vec2[]; holes: Vec2[][] } => i.floors.find((f) => f.level === 1)!;
/** W (sin Shift) mirando hacia `d` durante `seconds`, desde `from`. */
function press(from: Vec3, d: Vec2, seconds: number): PlayerState {
  const yaw = Math.atan2(-d[0], -d[1]);
  let s = initialState(from);
  for (let k = 0; k < seconds * SIM_HZ; k++) s = stepPlayer(s, { forward: 1, right: 0, jump: false, crouch: false, yaw, pitch: 0 }, world, 1 / SIM_HZ);
  return s;
}

test('tiene su plan: un piso y la terraza (floors 0 y 1, la terraza a height)', () => {
  expect(INTERIOR_PLANS['la-veneciana']).toBeDefined();
  expect(i.publicFloors).toBe(1);
  expect(i.terrace).toBe(true);
  expect(i.floors.map((f) => [f.level, f.y])).toEqual([[0, 0], [1, H]]);
});

describe('la escalera y la terraza', () => {
  test('climbStair llega a la terraza, a y = height (± 0,05), y baja', () => {
    const st = i.stairs.filter((s) => s.to === 1);
    expect(st).toHaveLength(1);
    const up = climbStair(world, st[0]);
    expect(Math.abs(up.pos[1] - H), `termina en ${fmt(up.pos)}`).toBeLessThanOrEqual(0.05);
    expect(up.onGround).toBe(true);
    const down = climbStair(world, st[0], true);
    expect(Math.abs(down.pos[1]), `baja a ${fmt(down.pos)}`).toBeLessThanOrEqual(0.05);
  });

  test('el hueco de la escalera tiene baranda en la terraza, y el techo se abre ahí (roofHoles)', () => {
    expect(i.roofHoles).toHaveLength(1);
    const hole = i.roofHoles[0];
    const rails = i.blocks.filter((x) => x.role === 'baranda' && Math.abs(x.y0 - H) < 1e-6 && toRing(centroid(x.polygon), hole) < 0.1);
    expect(rails.length).toBeGreaterThan(0);
    for (const x of rails) expect(Math.abs(x.y1 - x.y0 - RAIL_H)).toBeLessThan(0.01);
  });

  test('la baranda de la terraza: de caño blanco, todo alrededor (cada 0,5 m del borde hay baranda a < 0,1 m)', () => {
    const rails = i.blocks.filter((x) => x.role === 'baranda' && Math.abs(x.y0 - H) < 1e-6);
    const ring = terrace().polygon, missing: string[] = [];
    ring.forEach((p, k) => {
      const q = ring[(k + 1) % ring.length], len = dist2(p, q), n = Math.max(1, Math.ceil(len / 0.5));
      for (let j = 0; j < n; j++) {
        const at: Vec2 = [p[0] + ((q[0] - p[0]) * (j + 0.5)) / n, p[1] + ((q[1] - p[1]) * (j + 0.5)) / n];
        if (!rails.some((x) => pointInPolygon(at, x.polygon) || toRing(at, x.polygon) < 0.1)) missing.push(fmt(at));
      }
    });
    expect(missing).toEqual([]);
    // la baranda que frena no se ve: se ven los caños blancos (también de lejos, con el edificio)
    const pipes = i.blocks.filter((x) => x.out && x.collide === 'none' && x.y0 >= H - 1e-6 && x.y1 <= H + RAIL_H + 1e-6 && x.side !== undefined);
    expect(pipes.length).toBeGreaterThan(20);
    for (const x of pipes) expect(x.side!.color.toLowerCase(), fmt(centroid(x.polygon))).toMatch(/^#[ef]/);
  });

  test('caminando 4 s hacia el borde de la terraza se frena en la baranda, arriba (y = height ± 0,05)', () => {
    const t = mark('terraza');
    expect(Math.abs(t[1] - H)).toBeLessThan(1e-6);
    const ring = terrace().polygon;
    // hacia el borde más cercano y hacia el más lejano del medio de cada arista larga
    const targets = ring.map((p, k): Vec2 => {
      const q = ring[(k + 1) % ring.length];
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    }).filter((_, k) => dist2(ring[k], ring[(k + 1) % ring.length]) > 5);
    expect(targets.length).toBeGreaterThanOrEqual(3);
    for (const e of targets) {
      const s = press(t, unit([e[0] - t[0], e[1] - t[2]]), 6);
      expect(Math.abs(s.pos[1] - H), `hacia ${fmt(e)}: termina en ${fmt(s.pos)}`).toBeLessThanOrEqual(0.05);
      expect(pointInPolygon(xz(s.pos), ring), `hacia ${fmt(e)}: no se cae`).toBe(true);
    }
  });

  test('caminando 3 s hacia el hueco de la escalera desde la terraza se frena en su baranda; por el lado de la llegada, se baja', () => {
    const st = i.stairs.find((x) => x.to === 1)!, hole = i.roofHoles[0], c = centroid(hole);
    // D: subiendo la escalera; P: de través, hacia el medio de la terraza
    const D = unit([st.top[0] - st.foot[0], st.top[2] - st.foot[2]]);
    const t = mark('terraza');
    let P: Vec2 = [-D[1], D[0]];
    if ((t[0] - c[0]) * P[0] + (t[2] - c[1]) * P[1] < 0) P = [-P[0], -P[1]];
    const along = (q: Vec2, e: Vec2): number => (q[0] - c[0]) * e[0] + (q[1] - c[1]) * e[1];
    const [d0, d1] = [Math.min(...hole.map((q) => along(q, D))), Math.max(...hole.map((q) => along(q, D)))];
    const p1 = Math.max(...hole.map((q) => along(q, P)));
    const at = (d: number, p: number): Vec3 => [c[0] + D[0] * d + P[0] * p, H, c[1] + D[1] * d + P[1] * p];
    // del lado de la terraza (+P), en tres puntos a lo largo del hueco, y del lado del pie (−D) si hay dónde pararse (hoy
    // no: el frente sesgado pasa a 0,4–0,8 m del hueco); el otro costado largo es el del pretil (0,1 m entre el hueco y el
    // borde: no hay terraza)
    const starts: [Vec3, Vec2][] = [0.2, 0.5, 0.8].map((f): [Vec3, Vec2] => [at(d0 + (d1 - d0) * f, p1 + 1.2), [-P[0], -P[1]]]);
    const pie = at(d0 - 0.7, 0);
    if (isFreeSpot(world, pie[0], pie[2], H)) starts.push([pie, D]);
    for (const [from, dir] of starts) {
      expect(isFreeSpot(world, from[0], from[2], H), `desde ${fmt(from)}`).toBe(true);
      const s = press(from, dir, 3);
      expect(Math.abs(s.pos[1] - H), `desde ${fmt(from)}: termina en ${fmt(s.pos)}`).toBeLessThanOrEqual(0.05);
      expect(pointInPolygon(xz(s.pos), hole), `desde ${fmt(from)}: no se mete en el hueco`).toBe(false);
    }
    // por el lado de la llegada, de frente al hueco: baja por la escalera
    const top = at(d1 + 1.0, 0);
    expect(isFreeSpot(world, top[0], top[2], H)).toBe(true);
    const s = press(top, [-D[0], -D[1]], 3);
    expect(s.pos[1], `termina en ${fmt(s.pos)}`).toBeLessThan(H - 1);
  });

  test('la terraza se ve de baldosa terracota, GROUND_Y arriba del techo y sin sólido (el techo es el que apoya)', () => {
    const tiles = i.blocks.filter((x) => x.top?.mat === 'baldosa' && Math.abs(x.y1 - (H + GROUND_Y)) < 1e-6);
    expect(tiles.length).toBeGreaterThan(0);
    for (const x of tiles) expect(x.collide).toBe('none');
    const [r, g, bl] = [1, 3, 5].map((k) => parseInt(tiles[0].top!.color.slice(k, k + 2), 16));
    expect(r, 'terracota').toBeGreaterThan(g + 40);
    expect(g).toBeGreaterThan(bl - 10);
    // sombrillas, sillas director y mesas de madera arriba
    const up = i.items.filter((it) => Math.abs(it.at[1] - H) < 0.05);
    for (const m of ['sombrilla', 'silla-director', 'mesa']) expect(up.filter((it) => it.model === m).length, m).toBeGreaterThanOrEqual(2);
  });
});

describe('el salón', () => {
  test('el metegol es sólido, sobre una alfombra redonda gris', () => {
    expect(MODEL_BOX.metegol).toBeDefined();
    const m = i.items.filter((it) => it.model === 'metegol');
    expect(m).toHaveLength(1);
    const at = xz(m[0].at);
    expect(i.blocks.some((x) => x.role === 'mueble' && x.collide === 'solid' && pointInPolygon(at, x.polygon))).toBe(true);
    const hit = world.raycast([at[0], 3, at[1]], [0, -1, 0], 3);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.point[1] - MODEL_BOX.metegol!.h)).toBeLessThan(0.02);
    const rug = i.blocks.find((x) => x.collide === 'none' && x.y1 < 0.06 && x.polygon.length >= 16 && pointInPolygon(at, x.polygon));
    expect(rug, 'la alfombra').toBeDefined();
    const c = rug!.top!.color;
    const [r, g, bl] = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
    expect(Math.max(r, g, bl) - Math.min(r, g, bl), `${c}: gris`).toBeLessThan(20);
  });

  test('la vitrina de helados: baldes que brillan bajo el vidrio, sobre un mostrador de madera', () => {
    const baldes = i.items.filter((it) => it.model === 'balde-helado');
    expect(baldes.length).toBeGreaterThanOrEqual(12);
    expect(new Set(baldes.map((it) => it.color)).size, 'de colores').toBeGreaterThanOrEqual(6);
    for (const it of baldes) {
      const over = i.blocks.some((x) => x.collide === 'glass' && x.y0 > it.at[1] && pointInPolygon(xz(it.at), x.polygon));
      expect(over, `vidrio sobre el balde en ${fmt(it.at)}`).toBe(true);
    }
    expect(i.blocks.some((x) => x.collide === 'solid' && x.side?.mat === 'madera' && x.y1 > 0.8 && x.y1 < 1.2)).toBe(true);
  });

  test('la vitrina: el frente de vidrio, inclinado, pasa de 1,2 m, con perfiles de acero arriba y en las dos puntas', () => {
    const baldes = i.items.filter((it) => it.model === 'balde-helado');
    const near = (q: Vec3): boolean => baldes.some((it) => dist2([q[0], q[2]], xz(it.at)) < 0.8);
    const glass = i.panes.filter((x) => x.look.mat === 'vidrio' && x.corners.some(near));
    expect(glass.length, 'paños de vidrio sobre los baldes').toBeGreaterThan(0);
    const top = Math.max(...glass.flatMap((x) => x.corners.map((q) => q[1])));
    expect(top, 'el alto del vidrio').toBeGreaterThan(1.2);
    expect(glass.some((x) => Math.abs(x.normal[1]) > 0.2 && Math.abs(x.normal[1]) < 0.95), 'un paño inclinado').toBe(true);
    // el acero: piezas de metal pegadas (≤ 6 cm) a alguna esquina del vidrio
    const corners = glass.flatMap((x) => x.corners);
    const d3 = (a: Vec3, q: Vec3): number => Math.hypot(a[0] - q[0], a[1] - q[1], a[2] - q[2]);
    const steel = i.panes.filter((x) => x.look.mat === 'metal').map((x) => x.corners)
      .filter((cs) => cs.some((q) => corners.some((g) => d3(q, g) < 0.06)));
    expect(steel.length, 'perfiles de acero en el vidrio').toBeGreaterThan(0);
    expect(Math.max(...steel.flat().map((q) => q[1])), 'el perfil de arriba').toBeGreaterThan(top - 0.03);
    // en las dos puntas (a lo largo de las filas de baldes: el eje mayor de sus posiciones): perfiles que suben del
    // mostrador al borde de arriba
    const m = centroid(baldes.map((it) => xz(it.at)));
    const [sxx, szz, sxz] = baldes.reduce(([a, c, d], it) => [a + (it.at[0] - m[0]) ** 2, c + (it.at[2] - m[1]) ** 2, d + (it.at[0] - m[0]) * (it.at[2] - m[1])], [0, 0, 0]);
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), e: Vec2 = [Math.cos(ang), Math.sin(ang)];
    const s = (q: Vec3): number => (q[0] - m[0]) * e[0] + (q[2] - m[1]) * e[1];
    const [s0, s1] = [Math.min(...corners.map(s)), Math.max(...corners.map(s))];
    for (const end of [s0, s1]) {
      const ys = steel.filter((cs) => cs.every((q) => Math.abs(s(q) - end) < 0.1)).flat().map((q) => q[1]);
      expect(ys.length, `perfiles en la punta ${end.toFixed(2)}`).toBeGreaterThan(0);
      expect(Math.min(...ys), `la punta ${end.toFixed(2)}, desde abajo`).toBeLessThan(1.0);
      expect(Math.max(...ys), `la punta ${end.toFixed(2)}, hasta arriba`).toBeGreaterThan(top - 0.03);
    }
  });

  test('el cielorraso: machimbre con vigas blancas, y en la esquina redonda, un aro blanco', () => {
    const ceil = i.blocks.filter((x) => x.role === 'losa' && x.bottom?.mat === 'machimbre');
    expect(ceil.length).toBeGreaterThan(0);
    const top = Math.min(...ceil.map((x) => x.y0));
    const beams = i.blocks.filter((x) => x.collide === 'none' && Math.abs(x.y1 - top) < 0.01 && x.bottom?.color.toLowerCase().match(/^#[ef]/));
    expect(beams.length, 'vigas y aro').toBeGreaterThan(6);
    // el aro: pedazos que rodean un centro dentro del semicírculo de la esquina, todos a la misma distancia
    const ring = beams.filter((x) => x.polygon.length === 4 && dist2(x.polygon[0], x.polygon[1]) < 1.2);
    expect(ring.length, 'pedazos del aro').toBeGreaterThanOrEqual(12);
  });

  test("la vista 'vidrieras': en la vereda de Espora, a ~6 m del frente, libre, mirando las vidrieras", () => {
    const v = i.views.find((x) => x.id === 'vidrieras');
    expect(v).toBeDefined();
    expect(pointInPolygon(xz(v!.pos), b.footprint)).toBe(false);
    expect(isFreeSpot(world, v!.pos[0], v!.pos[2], v!.pos[1])).toBe(true);
    expect(Math.abs(-depth(xz(v!.pos)) - 6), `a ${(-depth(xz(v!.pos))).toFixed(2)} m del frente`).toBeLessThanOrEqual(1.5);
    const ahead: Vec2 = [-Math.sin(v!.yaw), -Math.cos(v!.yaw)];
    expect(ahead[0] * inward[0] + ahead[1] * inward[1]).toBeGreaterThan(0.9);
  });

  test('desde las vidrieras, un tiro a alguien en el salón cruza el vidrio y le da, más allá del frente', () => {
    const v = i.views.find((x) => x.id === 'vidrieras')!;
    const s = mark('salon');
    const eye: Vec3 = [v.pos[0], v.pos[1] + 1.65, v.pos[2]];
    const to: Vec3 = [s[0], s[1] + 1.2, s[2]];
    const hit = hitscan(world, [{ id: 'cliente', pos: s, crouching: false }], eye, [to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]], 60);
    expect(hit, 'le da').toMatchObject({ kind: 'target', id: 'cliente' });
    expect(depth(xz(hit!.point))).toBeGreaterThan(WALL_OUT);
  });
});

test('afuera: ≥ 2 carteles `out` con "La Veneciana" (los toldos) y en la vereda sombrillas y sillas director rojas', () => {
  expect(i.labels.filter((l) => l.out && l.text === 'La Veneciana').length).toBeGreaterThanOrEqual(2);
  const outside = i.items.filter((it) => !pointInPolygon(xz(it.at), b.footprint));
  expect(outside.filter((it) => it.model === 'sombrilla').length).toBeGreaterThanOrEqual(2);
  const chairs = outside.filter((it) => it.model === 'silla-director');
  expect(chairs.length).toBeGreaterThanOrEqual(4);
  for (const it of chairs) expect(it.color, 'roja').toMatch(/^#[a-f0-9]{2}[0-3]/);
  // nada sólido afuera: ni las mesas de la vereda
  expect(i.blocks.filter((x) => x.collide !== 'none' && !pointInPolygon(centroid(x.polygon), b.footprint)).map((x) => fmt(centroid(x.polygon)))).toEqual([]);
});

test('la vereda: cada mueble de afuera y cada mesita a ≥ 1,5 m de los props del mapa (el contenedor de la 2a), y la tela de la sombrilla no los pisa', () => {
  const kinds = new Set<string>(map.props.map((p) => p.kind));
  const props = collisionPrisms(map).prisms.filter((p) => p.tag !== undefined && kinds.has(p.tag));
  expect(props.length).toBeGreaterThan(0);
  const away = (q: Vec2): number => Math.min(...props.map((p) => (pointInPolygon(q, p.polygon) ? 0 : toRing(q, p.polygon))));
  const items = i.items.filter((it) => !pointInPolygon(xz(it.at), b.footprint) && it.at[1] < 0.1);
  const mesitas = i.blocks.filter((x) => x.out && x.y1 < 1 && !pointInPolygon(centroid(x.polygon), b.footprint));
  expect(items.length).toBeGreaterThan(0);
  expect(mesitas.length).toBeGreaterThan(0);
  const close: string[] = [];
  for (const it of items) if (away(xz(it.at)) < 1.5) close.push(`${it.model} en ${fmt(it.at)}: ${away(xz(it.at)).toFixed(2)} m`);
  for (const x of mesitas) for (const q of x.polygon) if (away(q) < 1.5) close.push(`mesita en ${fmt(q)}: ${away(q).toFixed(2)} m`);
  // la tela de la sombrilla tiene 1,3 m de radio (models.ts): su borde, a ≥ 1 m de cualquier prop
  for (const it of items.filter((x) => x.model === 'sombrilla')) if (away(xz(it.at)) < 1.3 + 1.0) close.push(`la tela de la sombrilla en ${fmt(it.at)}: ${(away(xz(it.at)) - 1.3).toFixed(2)} m`);
  expect(close).toEqual([]);
});

test('el botín, las apariciones y el spawn del lugar alrededor del local siguen libres en el mundo hueco', () => {
  const near = (p: Vec2): boolean => toRing(p, b.footprint) < 15 || pointInPolygon(p, b.footprint);
  const place = map.places.find((p) => p.id === 'la-veneciana')!;
  const spots: Vec3[] = [...map.lootSpots.map((l) => l.pos), ...map.randomSpawns, place.spawn].filter((p) => near(xz(p)));
  expect(spots.length).toBeGreaterThan(0);
  for (const p of spots) expect(isFreeSpot(world, p[0], p[2], p[1]), fmt(p)).toBe(true);
});
