// Cine Pixel (§4.6) sobre el mapa real, con el controlador del jugador: la marquesina con "CINES PIXEL" (la P en
// magenta) sobre el frente vidriado, el hall (porcelanato con bandas, el cajón de LED azul, los afiches y el candy bar)
// y las dos salas oscuras, con butacas sólidas en gradas, la pantalla con su marco negro, las tiras ámbar de las paredes
// y los escalones con luz del pasillo.
import { readFileSync } from 'node:fs';
import { isFreeSpot } from '../../../src/mapgen/spawns.ts';
import { buildCollisionWorld } from '../../../src/shared/collision.ts';
import { distPointSegment, pointInPolygon, toLocal } from '../../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { INTERIOR_PLANS, interiorOf } from '../../../src/shared/interiors/index.ts';
import { MODEL_BOX, RISER_MAX } from '../../../src/shared/interiors/kit.ts';
import type { Block } from '../../../src/shared/interiors/types.ts';
import type { MapData } from '../../../src/shared/mapdata.ts';
import { walkTo } from './walk.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const i = interiorOf(map, 'cine-pixel');
const b = map.buildings.find((x) => x.id === i.buildingId)!;
const frame = map.interiors.find((x) => x.placeId === 'cine-pixel')!.frame;

const fmt = (p: readonly number[]): string => p.map((v) => v.toFixed(2)).join(', ');
const xz = (p: Vec3): Vec2 => [p[0], p[2]];
const local = (p: Vec2): Vec2 => toLocal(frame, p);
const centroid = (p: Vec2[]): Vec2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
const toRing = (p: Vec2, ring: Vec2[]): number => Math.min(...ring.map((q, k) => distPointSegment(p, q, ring[(k + 1) % ring.length])));
/** La caja de un bloque en el marco local: [u0, v0, u1, v1]. */
const boxOf = (x: Block): [number, number, number, number] => {
  const l = x.polygon.map(local);
  return [Math.min(...l.map((p) => p[0])), Math.min(...l.map((p) => p[1])), Math.max(...l.map((p) => p[0])), Math.max(...l.map((p) => p[1]))];
};
function mark(name: string): Vec3 {
  const p = i.marks[name];
  if (!p) throw new Error(`cine-pixel: falta la marca "${name}"`);
  return p;
}
/** El tono (0–360) y la saturación (0–1) de un color #rrggbb. */
function hueSat(hex: string): [number, number] {
  const [r, g, bl] = [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16) / 255);
  const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
  if (d === 0) return [0, 0];
  const h = mx === r ? ((g - bl) / d + 6) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / mx];
}
const butacas = i.items.filter((it) => it.model === 'butaca');
/** Las butacas en grupos: dos son del mismo grupo si quedan a < 2 m (las salas están separadas por el hall). */
function salas(): Vec3[][] {
  const groups: Vec3[][] = [];
  const seen = new Set<number>();
  butacas.forEach((_, k) => {
    if (seen.has(k)) return;
    const g: Vec3[] = [], queue = [k];
    seen.add(k);
    while (queue.length) {
      const j = queue.pop()!;
      g.push(butacas[j].at);
      butacas.forEach((o, m) => {
        if (!seen.has(m) && Math.hypot(o.at[0] - butacas[j].at[0], o.at[2] - butacas[j].at[2]) < 2) { seen.add(m); queue.push(m); }
      });
    }
    groups.push(g);
  });
  return groups;
}
/** Las pantallas: bloques de luz parados (más de 20 m² de frente) contra el frente. */
const pantallas = (): Block[] => i.blocks.filter((x) => x.side?.mat === 'luz' && (() => {
  const [u0, , u1] = boxOf(x);
  return (u1 - u0) * (x.y1 - x.y0) > 20;
})());

test('tiene su plan: un piso público de 8 m de alto (D9), sin terraza', () => {
  expect(INTERIOR_PLANS['cine-pixel']).toBeDefined();
  expect(i.publicFloors).toBe(1);
  expect(i.terrace).toBe(false);
  expect(i.floors.map((f) => f.level)).toEqual([0]);
  expect(b.height).toBe(8);
});

describe('las salas', () => {
  test('hay dos salas: dos zonas de butacas (una grande y una chica) y dos pantallas con marco negro', () => {
    const g = salas().sort((p, q) => q.length - p.length);
    expect(g).toHaveLength(2);
    expect(g[1].length).toBeGreaterThanOrEqual(40);
    expect(g[0].length).toBeGreaterThan(g[1].length);
    const ps = pantallas();
    expect(ps).toHaveLength(2);
    for (const p of ps) {
      const [u0, v0, u1] = boxOf(p);
      // cada pantalla, delante de su zona de butacas (las butacas miran hacia ella)
      const mine = g.filter((z) => z.some((q) => { const l = local(xz(q)); return l[0] > u0 && l[0] < u1; }));
      expect(mine, `pantalla de ${fmt([u0, u1])}`).toHaveLength(1);
      expect(Math.min(...mine[0].map((q) => local(xz(q))[1])), 'la primera fila a ≥ 4 m de la pantalla').toBeGreaterThan(v0 + 4);
      // el marco negro: un bloque oscuro detrás que la rodea
      const frameBlock = i.blocks.find((x) => {
        if (x === p || !x.side || parseInt(x.side.color.slice(1, 3), 16) > 0x20) return false;
        const [a0, , a1] = boxOf(x);
        return a0 < u0 - 0.1 && a1 > u1 + 0.1 && x.y0 < p.y0 - 0.1 && x.y1 > p.y1 + 0.1;
      });
      expect(frameBlock, 'marco negro').toBeDefined();
    }
  });

  test('las butacas son sólidas (su caja de MODEL_BOX) y van en gradas: cada fila más alta que la de adelante', () => {
    const box = MODEL_BOX.butaca!;
    expect(box.h).toBeGreaterThanOrEqual(0.7);
    const boxes = i.blocks.filter((x) => x.role === 'mueble' && x.collide === 'solid' && Math.abs(x.y1 - x.y0 - box.h) < 1e-6);
    expect(boxes.length).toBeGreaterThanOrEqual(butacas.length);
    for (const g of salas()) {
      const rows = [...new Set(g.map((q) => +q[1].toFixed(3)))].sort((p, q) => p - q);
      expect(rows.length, 'filas').toBeGreaterThanOrEqual(6);
      for (let k = 1; k < rows.length; k++) expect(rows[k] - rows[k - 1]).toBeGreaterThanOrEqual(0.3);
    }
  });

  test('la sala es oscura: ambient ≤ 0,05', () => {
    expect(i.ambient).toBeLessThanOrEqual(0.05);
  });

  test('walkTo de sala-grande a ultima-fila sube por los escalones del pasillo (≤ 0,2 m cada uno) y termina en la última grada (± 0,05)', () => {
    const [p, q] = [mark('sala-grande'), mark('ultima-fila')];
    // la última grada: la más alta de las de las butacas de la sala grande
    const grande = salas().sort((x, y) => y.length - x.length)[0];
    expect(q[1]).toBeCloseTo(Math.max(...grande.map((s) => s[1])), 6);
    expect(q[1]).toBeGreaterThan(3);
    // el pasillo: el piso de p a q sube de a ≤ RISER_MAX
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[2] - p[2]) / 0.02);
    let y = p[1], rises = 0;
    for (let k = 1; k <= n; k++) {
      const x = p[0] + ((q[0] - p[0]) * k) / n, z = p[2] + ((q[2] - p[2]) * k) / n;
      const s = world.supportHeight(x, z, 0.01, y + 0.45);
      expect(s - y, `escalón en ${fmt([x, z])}`).toBeLessThanOrEqual(RISER_MAX + 1e-6);
      if (s > y + 1e-6) rises++;
      y = s;
    }
    expect(rises, 'escalones').toBeGreaterThanOrEqual(10);
    const end = walkTo(world, p, xz(q), 25);
    expect(Math.abs(end.pos[1] - q[1]), `termina en ${fmt(end.pos)}`).toBeLessThanOrEqual(0.05);
    expect(Math.hypot(end.pos[0] - q[0], end.pos[2] - q[2]), `termina en ${fmt(end.pos)}`).toBeLessThan(0.6);
  });

  test('escalones con luz en el pasillo y tiras ámbar en las paredes (brillan: luz)', () => {
    const luz = i.blocks.filter((x) => x.side?.mat === 'luz' || x.top?.mat === 'luz');
    const ambar = luz.filter((x) => { const [h, s] = hueSat((x.side ?? x.top)!.color); return h > 25 && h < 50 && s > 0.5; });
    expect(ambar.length, 'tiras ámbar').toBeGreaterThanOrEqual(10);
    const escalones = i.blocks.filter((x) => x.role === 'escalon' || x.role === 'descanso');
    expect(escalones.length).toBeGreaterThanOrEqual(30);
    // una luz al pie de cada contrahuella de los escalones de la sala grande
    const [pu] = local(xz(mark('sala-grande')));
    const pasillo = escalones.filter((x) => { const [u0, , u1] = boxOf(x); return u0 < pu && pu < u1; });
    expect(pasillo.length).toBeGreaterThanOrEqual(10);
    for (const x of pasillo) {
      const [u0, v0, u1] = boxOf(x);
      const lit = luz.some((l) => { const [a0, c0, a1, c1] = boxOf(l); return a0 >= u0 - 0.05 && a1 <= u1 + 0.05 && c1 >= v0 - 0.05 && c0 <= v0 + 0.05 && l.y1 <= x.y1 + 1e-6 && l.y0 >= x.y1 - 0.25; });
      expect(lit, `escalón a ${x.y1.toFixed(2)}`).toBe(true);
    }
  });
});

describe('el hall y el candy bar', () => {
  test('se entra por la puerta y se camina del hall a cada sala', () => {
    const h = mark('hall');
    expect(pointInPolygon(xz(h), b.footprint)).toBe(true);
    for (const s of ['sala-grande', 'sala-chica']) {
      const path = i.marks[`${s}-puerta`] ? [xz(i.marks[`${s}-puerta`]), xz(mark(s))] : [xz(mark(s))];
      const end = walkTo(world, h, path, 20);
      expect(Math.hypot(end.pos[0] - mark(s)[0], end.pos[2] - mark(s)[2]), `${s}: termina en ${fmt(end.pos)}`).toBeLessThan(0.6);
    }
  });

  test('porcelanato beige con bandas gris oscuro, una pared gris oscura y el cielorraso con el cajón de LED azul', () => {
    const [hu, hv] = local(xz(mark('hall')));
    const pisos = i.blocks.filter((x) => x.y1 < 0.05 && x.top?.mat === 'porcelanato');
    const bandas = pisos.filter((x) => parseInt(x.top!.color.slice(1, 3), 16) < 0x60);
    expect(bandas.length).toBeGreaterThanOrEqual(3);
    const azul = i.blocks.filter((x) => (x.side?.mat === 'luz' || x.bottom?.mat === 'luz') && (() => { const [h, s] = hueSat((x.side ?? x.bottom)!.color); return h > 200 && h < 250 && s > 0.5; })());
    expect(azul.length, 'LED azul').toBeGreaterThanOrEqual(4);
    for (const x of azul) {
      const [u0, v0, u1, v1] = boxOf(x);
      expect(Math.abs((u0 + u1) / 2 - hu) < 12 && Math.abs((v0 + v1) / 2 - hv) < 12, 'sobre el hall').toBe(true);
      expect(x.y0).toBeGreaterThan(3);
    }
    expect(i.items.filter((it) => it.model === 'afiche').length).toBeGreaterThanOrEqual(4);
    expect(i.labels.filter((l) => l.drawing === 'afiche').length).toBeGreaterThanOrEqual(4);
  });

  test('el candy bar: un mostrador sólido blanco y negro, la pochoclera (sólida), pantallas de menú que brillan y la heladera', () => {
    expect(i.items.filter((it) => it.model === 'pochoclera')).toHaveLength(1);
    const pantallas = i.items.filter((it) => it.model === 'pantalla');
    expect(pantallas.length).toBeGreaterThanOrEqual(3);
    expect(i.labels.filter((l) => l.drawing === 'menu' && l.glow).length).toBe(pantallas.length);
    const mostrador = i.blocks.filter((x) => x.role === 'mueble' && x.collide === 'solid' && x.y1 >= 0.95 && x.y1 <= 1.15 && (() => { const [u0, , u1] = boxOf(x); return u1 - u0 > 4; })());
    expect(mostrador.length).toBeGreaterThanOrEqual(1);
    const colors = new Set(i.blocks.filter((x) => { const [u0, v0, u1, v1] = boxOf(mostrador[0]); const [a0, c0, a1, c1] = boxOf(x); return a0 >= u0 - 0.1 && a1 <= u1 + 0.1 && c0 >= v0 - 0.1 && c1 <= v1 + 0.1; })
      .flatMap((x) => [x.side?.color, x.top?.color]).filter((c): c is string => !!c).map((c) => (parseInt(c.slice(1, 3), 16) > 0xd0 ? 'blanco' : parseInt(c.slice(1, 3), 16) < 0x30 ? 'negro' : 'otro')));
    expect(colors.has('blanco') && colors.has('negro')).toBe(true);
    // la heladera de bebidas: un mueble sólido de 1,8–2,2 m con una puerta que brilla (luz) pegada a una de sus caras,
    // de al menos la mitad de su ancho y 1,2 m de alto
    const heladeras = i.blocks.filter((x) => x.collide === 'solid' && x.y1 >= 1.8 && x.y1 <= 2.2 && x.role === 'mueble');
    const conPuerta = heladeras.filter((h) => {
      const [u0, v0, u1, v1] = boxOf(h);
      return i.blocks.some((x) => {
        if (x.side?.mat !== 'luz' || x.y1 - x.y0 < 1.2 || x.y0 < h.y0 - 1e-6 || x.y1 > h.y1 + 1e-6) return false;
        const [a0, c0, a1, c1] = boxOf(x);
        // una hoja fina (≤ 6 cm) contra la cara de −V o +V (o la de −U o +U), dentro de su ancho
        const enV = c1 - c0 <= 0.06 && (Math.abs(c1 - v0) < 0.05 || Math.abs(c0 - v1) < 0.05) && a0 >= u0 - 0.01 && a1 <= u1 + 0.01 && a1 - a0 >= (u1 - u0) / 2;
        const enU = a1 - a0 <= 0.06 && (Math.abs(a1 - u0) < 0.05 || Math.abs(a0 - u1) < 0.05) && c0 >= v0 - 0.01 && c1 <= v1 + 0.01 && c1 - c0 >= (v1 - v0) / 2;
        return enV || enU;
      });
    });
    expect(conPuerta.length, 'la heladera con su puerta iluminada').toBeGreaterThanOrEqual(1);
  });
});

describe('afuera', () => {
  test('la marquesina gris carbón (out) sobre el frente vidriado, con spots, y "CINES PIXEL" en blanco con la P magenta (out)', () => {
    const marq = i.blocks.filter((x) => x.out && boxOf(x)[1] < -1.5 && x.y0 >= 2.9 && x.side && parseInt(x.side.color.slice(1, 3), 16) < 0x50);
    expect(marq.length).toBeGreaterThanOrEqual(1);
    const glass = map.interiors.find((x) => x.placeId === 'cine-pixel')!.openings.filter((o) => o.kind === 'vidrio');
    for (const g of glass) expect(Math.min(...marq.map((x) => x.y0))).toBeGreaterThanOrEqual(g.y1);
    const spots = i.blocks.filter((x) => x.out && x.bottom && parseInt(x.bottom.color.slice(1, 3), 16) > 0xd0 && boxOf(x)[1] < -0.2);
    expect(spots.length, 'spots').toBeGreaterThanOrEqual(4);
    const sign = i.labels.filter((l) => l.out && l.text.includes('CINES') && l.text.includes('PIXEL'));
    expect(sign).toHaveLength(1);
    const s = sign[0];
    expect(s.look.letra.toLowerCase()).toBe('#ffffff');
    expect(s.placeSign, 'reemplaza al cartel del lote').toBe(true);
    const a = s.look.acento!;
    expect(s.text.slice(a.desde, a.hasta)).toBe('P');
    const [h, sat] = hueSat(a.letra);
    expect(h > 290 && h < 345 && sat > 0.8, `magenta: ${a.letra}`).toBe(true);
    // al frente de la marquesina, mirando a la calle
    expect(local(xz(s.at))[1]).toBeLessThan(-1.5);
  });

  test('el botín, las apariciones y el spawn del lugar alrededor del cine siguen libres en el mundo hueco (la marquesina es out)', () => {
    const near = (p: Vec2): boolean => toRing(p, b.footprint) < 15 || pointInPolygon(p, b.footprint);
    const place = map.places.find((p) => p.id === 'cine-pixel')!;
    const spots: Vec3[] = [...map.lootSpots.map((l) => l.pos), ...map.randomSpawns, place.spawn].filter((p) => near(xz(p)));
    expect(spots.length).toBeGreaterThan(0);
    for (const p of spots) expect(isFreeSpot(world, p[0], p[2], p[1]), fmt(p)).toBe(true);
    // y nada `out` del cine pisa la vereda por debajo de 2,6 m
    for (const x of i.blocks.filter((x) => x.out && x.collide !== 'none')) {
      if (boxOf(x)[1] < 0) expect(x.y0, `bloque out a ${fmt(centroid(x.polygon))}`).toBeGreaterThanOrEqual(2.6);
    }
  });
});
