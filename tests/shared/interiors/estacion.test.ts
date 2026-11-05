// La estación Adrogué (§4.9) sobre el mapa real, con el controlador del jugador y el hitscan del juego: el hall de la
// boletería (ventanillas con vidrio y reja, el cartel "BOLETERÍA", la terminal SUBE, bancos con respaldo, el mural de
// azulejos y la puerta del baño cerrada), el patio del lado del andén (D12) con la línea de molinetes y su paso abierto
// (D3), la escalera de acceso hasta el andén con narices amarillas y baldosas rojas, y lo de afuera (el zócalo celeste
// y las ventanas con rejas). Nada de eso pisa los andenes, los postes del alero ni las vías.
import { readFileSync } from 'node:fs';
import polygonClipping from 'polygon-clipping';
import { isFreeSpot } from '../../../src/mapgen/spawns.ts';
import { buildCollisionWorld } from '../../../src/shared/collision.ts';
import { hitscan } from '../../../src/shared/combat.ts';
import { distPointSegment, ensureCCW, pointInPolygon, polygonArea, toLocal } from '../../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { muralColors, muralSeed } from '../../../src/shared/interiors/estacion.ts';
import { INTERIOR_PLANS, interiorOf, publicFloorArea } from '../../../src/shared/interiors/index.ts';
import { MODEL_BOX, SOLID_MIN_H } from '../../../src/shared/interiors/kit.ts';
import type { Block } from '../../../src/shared/interiors/types.ts';
import type { MapData } from '../../../src/shared/mapdata.ts';
import { PLATFORM_H, railRuns, stationLayout } from '../../../src/shared/station.ts';
import { enterDoor, insideOf, walkStraight, walkTo, yawToward } from './walk.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const ID = 'estacion-adrogue';
const i = interiorOf(map, ID);
const b = map.buildings.find((x) => x.id === i.buildingId)!;
const frame = map.interiors.find((x) => x.placeId === ID)!.frame;
const place = map.places.find((p) => p.id === ID)!;
const layout = stationLayout(map);

type Ring = [number, number][];
const closed = (r: Vec2[]): [Ring] => [[...r, r[0]].map((p): [number, number] => [p[0], p[1]])];
const areaOf = (m: polygonClipping.MultiPolygon): number => m.reduce((t, pg) => t + pg.reduce((a, r, k) => a + (k === 0 ? 1 : -1) * polygonArea(r.slice(0, -1) as Vec2[]), 0), 0);
const overlap = (p: Vec2[], q: Vec2[]): number => areaOf(polygonClipping.intersection(closed(ensureCCW(p)), closed(ensureCCW(q))));
const fmt = (p: readonly number[]): string => p.map((v) => v.toFixed(2)).join(', ');
const xz = (p: Vec3): Vec2 => [p[0], p[2]];
const centroidOf = (ps: Vec2[]): Vec2 => [ps.reduce((t, q) => t + q[0], 0) / ps.length, ps.reduce((t, q) => t + q[1], 0) / ps.length];
const local = (p: Vec2): Vec2 => toLocal(frame, p);
/** Un vector local (U, V) en el mundo. */
const vec = ([a, c]: Vec2): Vec2 => [a * frame.u[0] + c * frame.v[0], a * frame.u[1] + c * frame.v[1]];
const boxOf = (x: Block): [number, number, number, number] => {
  const l = x.polygon.map(local);
  return [Math.min(...l.map((p) => p[0])), Math.min(...l.map((p) => p[1])), Math.max(...l.map((p) => p[0])), Math.max(...l.map((p) => p[1]))];
};
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16)) as [number, number, number];
/** Celeste: el azul manda, el verde lo sigue y el rojo queda abajo; claro. */
const celeste = (hex: string): boolean => {
  const [r, g, bl] = rgb(hex);
  return bl > g && g > r && bl - r >= 50 && bl >= 0xb0;
};
const amarillo = (hex: string): boolean => {
  const [r, g, bl] = rgb(hex);
  return r >= 0xc0 && g >= 0x90 && bl < 0x60;
};
const rojo = (hex: string): boolean => {
  const [r, g, bl] = rgb(hex);
  return r > 0x80 && r - g >= 0x40 && r - bl >= 0x40;
};
function mark(name: string): Vec3 {
  const p = i.marks[name];
  if (!p) throw new Error(`${ID}: falta la marca "${name}"`);
  return p;
}
/** La puerta de la calle (sobre el frente, V = 0) y la del patio (sobre U = 10). */
const calle = () => i.doors.find((d) => Math.abs(local(d.at)[1]) < 0.3)!;
const patioDoor = () => i.doors.find((d) => Math.abs(local(d.at)[0] - 10) < 0.3)!;
const molinetes = () => i.items.filter((it) => it.model === 'molinete');
const muebleDe = (at: Vec3): Block => i.blocks.find((x) => x.role === 'mueble' && Math.hypot(x.polygon.reduce((s, q) => s + q[0], 0) / x.polygon.length - at[0],
  x.polygon.reduce((s, q) => s + q[1], 0) / x.polygon.length - at[2]) < 0.02)!;

test('tiene su plan: un piso público sin terraza, con las marcas hall, paso-molinetes y anden', () => {
  expect(INTERIOR_PLANS[ID]).toBeDefined();
  expect(i.publicFloors).toBe(1);
  expect(i.terrace).toBe(false);
  for (const m of ['hall', 'paso-molinetes', 'anden']) expect(i.marks[m], m).toBeDefined();
  expect(mark('hall')[1]).toBe(0);
  expect(pointInPolygon(xz(mark('hall')), b.footprint), 'hall, adentro de la planta').toBe(true);
  expect(pointInPolygon(xz(mark('paso-molinetes')), i.patios[0]), 'paso-molinetes, en el patio').toBe(true);
  expect(mark('anden')[1]).toBeCloseTo(PLATFORM_H, 6);
  expect(map.platforms.some((p) => pointInPolygon(xz(mark('anden')), p)), 'anden, sobre un andén').toBe(true);
});

describe('al andén', () => {
  test('desde la puerta de la calle, walkTo([hall, paso-molinetes, anden]) termina sobre el andén, a y = PLATFORM_H (± 0,05)', () => {
    const s = enterDoor(world, calle());
    expect(insideOf(b, s.pos), `entra al hall: ${fmt(s.pos)}`).toBe(true);
    const q = mark('anden');
    const end = walkTo(world, s.pos, [xz(mark('hall')), xz(mark('paso-molinetes')), xz(q)], 20);
    expect(Math.abs(end.pos[1] - PLATFORM_H), `termina en ${fmt(end.pos)}`).toBeLessThanOrEqual(0.05);
    expect(Math.hypot(end.pos[0] - q[0], end.pos[2] - q[2]), `termina en ${fmt(end.pos)}`).toBeLessThan(0.6);
    expect(end.onGround).toBe(true);
  });

  test('el camino de puntos es recto por tramos: hall → paso cruza la puerta del patio de frente, y la escalera va alineada entre el paso y el andén', () => {
    const [h, p, a] = [local(xz(mark('hall'))), local(xz(mark('paso-molinetes'))), local(xz(mark('anden')))];
    const d = local(patioDoor().at);
    // la recta hall → paso cruza U = 10 adentro del hueco de la puerta, con el radio del jugador y aire
    const t = (d[0] - h[0]) / (p[0] - h[0]), v = h[1] + (p[1] - h[1]) * t;
    expect(t > 0 && t < 1, 'el paso queda del otro lado de la puerta').toBe(true);
    expect(Math.abs(v - d[1]), `cruza en v = ${v.toFixed(2)}`).toBeLessThanOrEqual(patioDoor().width / 2 - 0.45);
    expect(Math.abs(p[1] - h[1]) / Math.abs(p[0] - h[0]), 'casi de frente a la puerta').toBeLessThan(0.1);
    // una sola escalera, del suelo a PLATFORM_H, sobre la recta paso → anden
    expect(i.stairs).toHaveLength(1);
    const st = i.stairs[0];
    expect(st.foot[1]).toBe(0);
    expect(st.top[1]).toBeCloseTo(PLATFORM_H, 6);
    for (const q of [local(xz(st.foot)), local(xz(st.top))]) {
      const dist = distPointSegment(q, p, a);
      expect(dist, `${fmt(q)} sobre paso → anden`).toBeLessThan(0.05);
    }
  });

  test('cada tramo está libre: de hall a paso y de paso al pie de la escalera no hay nada sólido a menos de 0,4 m', () => {
    const tramo = (a: Vec3, c: Vec3): void => {
      const n = Math.ceil(Math.hypot(c[0] - a[0], c[2] - a[2]) / 0.1);
      for (let k = 0; k <= n; k++) {
        const [x, z] = [a[0] + ((c[0] - a[0]) * k) / n, a[2] + ((c[2] - a[2]) * k) / n];
        expect(world.overlaps(x, z, 0.4, 0.05, 1.8), `sólido cerca de ${fmt(local([x, z]))}`).toBe(false);
      }
    };
    tramo(mark('hall'), mark('paso-molinetes'));
    tramo(mark('paso-molinetes'), i.stairs[0].foot);
  });
});

describe('los molinetes (D3)', () => {
  test('una línea de molinetes sólidos (MODEL_BOX, ≥ SOLID_MIN_H) en el patio', () => {
    const ms = molinetes();
    expect(ms.length).toBeGreaterThanOrEqual(2);
    expect(MODEL_BOX.molinete!.h).toBeGreaterThanOrEqual(SOLID_MIN_H);
    for (const it of ms) {
      expect(pointInPolygon(xz(it.at), i.patios[0]), fmt(local(xz(it.at)))).toBe(true);
      expect(muebleDe(it.at)?.collide).toBe('solid');
    }
  });

  test('caminar contra un molinete frena, y un tiro a 0,8 m le da (world)', () => {
    const [h, p] = [xz(mark('hall')), xz(mark('paso-molinetes'))];
    const l = Math.hypot(p[0] - h[0], p[1] - h[1]);
    const d: Vec2 = [(p[0] - h[0]) / l, (p[1] - h[1]) / l]; // hacia el andén: del lado sin pagar al pagado
    for (const it of molinetes()) {
      const box = muebleDe(it.at);
      const along = (q: Vec2): number => (q[0] - it.at[0]) * d[0] + (q[1] - it.at[2]) * d[1];
      const near = Math.min(...box.polygon.map(along));
      const start: Vec3 = [it.at[0] - d[0] * 1.6, 0, it.at[2] - d[1] * 1.6];
      const end = walkTo(world, start, [it.at[0] + d[0] * 1.6, it.at[2] + d[1] * 1.6], 3);
      expect(along(xz(end.pos)), `pasó el molinete de ${fmt(local(xz(it.at)))}: termina en ${fmt(local(xz(end.pos)))}`).toBeLessThan(near - 0.3);
      expect(along(xz(end.pos)), 'llegó hasta el molinete').toBeGreaterThan(near - 0.6);
      const from: Vec3 = [start[0], 0.8, start[2]];
      const hit = hitscan(world, [], from, [d[0], 0, d[1]], 10);
      expect(hit?.kind, `tiro a 0,8 m contra el molinete de ${fmt(local(xz(it.at)))}`).toBe('world');
      expect(Math.abs(hit!.dist - (1.6 + near)), 'da en la cara del molinete').toBeLessThan(0.02);
    }
  });

  test('el paso abierto deja ≥ 1,0 m libres y paso-molinetes queda en él, a la par de la línea', () => {
    const p = mark('paso-molinetes');
    expect(world.overlaps(p[0], p[2], 0.5, 0.05, 1.8), 'un círculo de 1 m de diámetro libre en el paso').toBe(false);
    const [pu, pv] = local(xz(p));
    // la marca está sobre la recta de la línea (U del medio de los molinetes) y más allá de su punta
    const us = molinetes().map((it) => local(xz(it.at))[0]);
    expect(Math.max(...us) - Math.min(...us)).toBeLessThan(0.05);
    expect(Math.abs(pu - us[0])).toBeLessThan(0.05);
    const tops = molinetes().map((it) => boxOf(muebleDe(it.at))[3]);
    expect(pv, 'el paso, en la punta de la línea').toBeGreaterThan(Math.max(...tops));
  });
});

describe('el hall', () => {
  test('ventanillas de la boletería, con vidrio (frena jugadores, no balas) y reja, y el cartel "BOLETERÍA" arriba', () => {
    const vs = i.items.filter((it) => it.model === 'ventanilla');
    expect(vs.length).toBeGreaterThanOrEqual(2);
    const cartel = i.labels.filter((l) => l.text.includes('BOLETERÍA'));
    expect(cartel).toHaveLength(1);
    const c = cartel[0];
    expect(c.out).toBeUndefined();
    expect(pointInPolygon(xz(c.at), b.footprint)).toBe(true);
    expect(c.at[1] - c.height / 2, 'arriba de las ventanillas').toBeGreaterThan(Math.max(...vs.map((it) => it.at[1])) + 0.9);
    for (const it of vs) {
      // el vidrio de la ventanilla: un bloque glass delante, de lado a lado del hueco
      const glass = i.blocks.filter((x) => x.collide === 'glass' && x.role === 'vidrio' && Math.hypot(...((): Vec2 => {
        const [u0, v0, u1, v1] = boxOf(x), [u, v] = local(xz(it.at));
        return [Math.max(0, Math.abs((u0 + u1) / 2 - u) - 0.01), Math.max(0, Math.abs((v0 + v1) / 2 - v) - 0.15)];
      })()) < 1e-6);
      expect(glass.length, `vidrio de la ventanilla de ${fmt(local(xz(it.at)))}`).toBeGreaterThanOrEqual(1);
      // se tira a través (vidrio): desde el hall, a la altura del vidrio, la bala pasa la ventanilla
      const [u, v] = local(xz(it.at));
      const fromL: Vec2 = [u, v - 1.5];
      const from = [frame.origin[0] + vec(fromL)[0], it.at[1] + 0.5, frame.origin[1] + vec(fromL)[1]] as Vec3;
      const dir = vec([0, 1]);
      const hit = hitscan(world, [], from, [dir[0], 0, dir[1]], 10);
      expect(hit === null || hit.dist > 1.5 + 0.2, `el tiro por la ventanilla de ${fmt([u, v])} pasa el vidrio`).toBe(true);
    }
  });

  test('una terminal SUBE sólida, con su cartel', () => {
    const t = i.items.filter((it) => it.model === 'sube');
    expect(t).toHaveLength(1);
    expect(pointInPolygon(xz(t[0].at), b.footprint)).toBe(true);
    expect(muebleDe(t[0].at)?.collide).toBe('solid');
    expect(MODEL_BOX.sube!.h).toBeGreaterThanOrEqual(1.4);
    expect(i.labels.some((l) => l.text.includes('SUBE') && Math.hypot(l.at[0] - t[0].at[0], l.at[2] - t[0].at[2]) < 0.6)).toBe(true);
  });

  test('bancos con respaldo de 0,8 m, sólidos', () => {
    expect(MODEL_BOX['banco-respaldo']!.h).toBeCloseTo(0.8, 6);
    const bs = i.items.filter((it) => it.model === 'banco-respaldo');
    expect(bs.length).toBeGreaterThanOrEqual(2);
    for (const it of bs) {
      expect(pointInPolygon(xz(it.at), b.footprint)).toBe(true);
      expect(muebleDe(it.at)?.collide).toBe('solid');
    }
  });

  test('un mural de azulejos de patrón propio: cerámico con un color por azulejo, el mismo en cada armado', () => {
    const tiles = i.panes.filter((p) => p.look.mat === 'ceramico');
    expect(tiles.length).toBeGreaterThanOrEqual(60);
    const colors = new Set(tiles.map((p) => p.look.color));
    expect(colors.size).toBeGreaterThanOrEqual(4);
    // todos en una pared, verticales, adentro de la planta y arriba del zócalo
    const n0 = tiles[0].normal;
    for (const p of tiles) {
      expect(Math.hypot(p.normal[0] - n0[0], p.normal[1] - n0[1], p.normal[2] - n0[2])).toBeLessThan(1e-6);
      for (const q of p.corners) {
        expect(pointInPolygon(xz(q), b.footprint)).toBe(true);
        expect(q[1]).toBeGreaterThanOrEqual(1.2 - 1e-6);
      }
    }
    const again = interiorOf(map, ID).panes.filter((p) => p.look.mat === 'ceramico').map((p) => p.look.color);
    expect(again).toEqual(tiles.map((p) => p.look.color));
    // no es ruido: el patrón tiene simetría (el mural se lee igual reflejado a lo ancho)
    const rows = new Map<number, { s: number; c: string }[]>();
    const e: Vec2 = [-n0[2], n0[0]];
    for (const p of tiles) {
      const y = Math.round(Math.min(...p.corners.map((q) => q[1])) * 100);
      const s = p.corners.reduce((t, q) => t + q[0] * e[0] + q[2] * e[1], 0) / p.corners.length;
      rows.set(y, [...(rows.get(y) ?? []), { s, c: p.look.color }]);
    }
    let same = 0, total = 0;
    for (const r of rows.values()) {
      r.sort((a, c) => a.s - c.s);
      for (let k = 0; k < r.length / 2; k++, total++) if (r[k].c === r[r.length - 1 - k].c) same++;
    }
    expect(same / total, 'simétrico a lo ancho (al menos 3 de cada 4 pares)').toBeGreaterThanOrEqual(0.75);
  });

  // H6 de la revisión: armarlo dos veces con el mismo mapa no prueba que la semilla salga de la posición
  test('la semilla del mural sale de su posición: en el mismo lugar, el mismo mural; corrido 1 m, otro patrón', () => {
    const tiles = i.panes.filter((p) => p.look.mat === 'ceramico');
    // la esquina de abajo del primer azulejo, sin los 4 mm que sale de la pared
    const n = tiles[0].normal, p: Vec2 = [tiles[0].corners[0][0] - n[0] * 0.004, tiles[0].corners[0][2] - n[2] * 0.004];
    const seed = muralSeed(p);
    expect(muralSeed([p[0], p[1]])).toBe(seed);
    expect(muralColors(seed)).toEqual(muralColors(seed));
    // el plan usa esa semilla: los colores de los azulejos, columna por columna, son los de muralColors
    expect(tiles.map((t) => t.look.color)).toEqual(muralColors(seed).flat());
    // corrido 1 m a lo largo de la pared y hacia cada lado en el mundo: otra semilla y otro patrón
    for (const d of [vec([0, 1]), vec([0, -1]), [1, 0], [-1, 0], [0, 1], [0, -1]] as Vec2[]) {
      const q: Vec2 = [p[0] + d[0], p[1] + d[1]];
      expect(muralSeed(q), `corrido ${fmt(d)}`).not.toBe(seed);
      expect(muralColors(muralSeed(q)), `corrido ${fmt(d)}`).not.toEqual(muralColors(seed));
    }
  });

  test('la puerta del baño, cerrada: un cartel en relieve sobre la hoja y, detrás, pared', () => {
    const l = i.labels.find((x) => /BAÑO/.test(x.text));
    expect(l).toBeDefined();
    expect(pointInPolygon(xz(l!.at), b.footprint)).toBe(true);
    // la placa en relieve detrás del cartel
    const placa = i.blocks.filter((x) => x.collide === 'none' && x.y0 < l!.at[1] && x.y1 > l!.at[1] && Math.hypot(...((): Vec2 => {
      const c = x.polygon.reduce((s, q) => [s[0] + q[0] / x.polygon.length, s[1] + q[1] / x.polygon.length] as Vec2, [0, 0] as Vec2);
      return [c[0] - l!.at[0], c[1] - l!.at[2]];
    })()) < 0.05);
    expect(placa.length, 'la placa').toBeGreaterThanOrEqual(1);
    // cerrada: un tiro a través de la hoja da en pared a menos de 0,3 m
    const n = l!.normal;
    const from: Vec3 = [l!.at[0] + n[0] * 1.0, 1.0, l!.at[2] + n[1] * 1.0];
    const hit = hitscan(world, [], from, [-n[0], 0, -n[1]], 5);
    expect(hit?.kind).toBe('world');
    expect(hit!.dist).toBeLessThan(1.3);
  });

  test('tubos fluorescentes en el cielorraso del hall, con su lámpara cada uno', () => {
    const tubos = i.blocks.filter((x) => (x.bottom?.mat === 'luz' || x.side?.mat === 'luz') && x.y0 > 2.8 && pointInPolygon(x.polygon[0], b.footprint));
    expect(tubos.length).toBeGreaterThanOrEqual(4);
    expect(i.lamps.filter((l) => pointInPolygon(xz(l.at), b.footprint)).length).toBeGreaterThanOrEqual(4);
  });

  test('zócalo celeste de ~1,2 m por adentro', () => {
    const z = i.blocks.filter((x) => !x.out && x.side && celeste(x.side.color) && x.y0 === 0 && Math.abs(x.y1 - 1.2) < 0.05);
    expect(z.length).toBeGreaterThanOrEqual(4);
  });
});

describe('afuera (out)', () => {
  test('zócalo celeste de ~1,2 m en el frente y los costados, y ventanas con rejas sobre el frente', () => {
    const z = i.blocks.filter((x) => x.out && x.side && celeste(x.side.color) && Math.abs(x.y1 - x.y0 - 1.2) < 0.05);
    const frente = z.filter((x) => boxOf(x)[3] <= 0.01);
    expect(frente.length).toBeGreaterThanOrEqual(1);
    expect(z.filter((x) => boxOf(x)[2] <= 0.01).length, 'el costado de U = 0').toBeGreaterThanOrEqual(1);
    expect(z.filter((x) => boxOf(x)[0] >= 9.99).length, 'el costado del patio').toBeGreaterThanOrEqual(1);
    // ni el zócalo ni lo de las ventanas frenan (son pintura y herrería sobre la pared)
    for (const x of i.blocks.filter((y) => y.out && boxOf(y)[3] <= 0.01)) expect(x.collide).toBe('none');
    // las rejas: barrotes verticales finos delante de cada ventana, arriba del zócalo
    const barras = i.blocks.filter((x) => x.out && boxOf(x)[3] < 0 && x.y0 >= 1.2 - 1e-6 && x.y1 - x.y0 > 1.0 && boxOf(x)[2] - boxOf(x)[0] < 0.04);
    expect(barras.length).toBeGreaterThanOrEqual(12);
  });

  // H4 de la revisión: desde el andén (donde más se juega) y desde los costados, la pared no es un paño liso
  test('ventanas con reja verde también en la pared del andén (arriba de PLATFORM_H) y en los dos costados', () => {
    const vidrios = i.blocks.filter((x) => x.out && x.side?.color === '#3d4b55');
    const cara = (x: Block): string => {
      const [u0, v0, u1, v1] = boxOf(x);
      return v1 <= 0.01 ? 'frente' : v0 >= 6.38 ? 'andén' : u1 <= 0.01 ? 'U 0' : u0 >= 9.99 ? 'U 10' : `¿${fmt([u0, v0, u1, v1])}?`;
    };
    const por = (c: string): Block[] => vidrios.filter((x) => cara(x) === c);
    expect(vidrios.map(cara).filter((c) => c.startsWith('¿'))).toEqual([]);
    expect(por('frente')).toHaveLength(2);
    expect(por('andén').length, 'en la pared del andén').toBeGreaterThanOrEqual(1);
    expect(por('U 0').length, 'en el costado de U 0').toBeGreaterThanOrEqual(1);
    expect(por('U 10').length, 'en el costado del patio').toBeGreaterThanOrEqual(1);
    for (const x of por('andén')) expect(x.y0, 'arriba del andén y de su zócalo').toBeGreaterThanOrEqual(PLATFORM_H + 1.2 - 1e-6);
    // cada vidrio con su reja: barrotes verdes finos, out, delante de él (más afuera) y a su altura
    for (const x of vidrios) {
      const [u0, v0, u1, v1] = boxOf(x), along = cara(x) === 'frente' || cara(x) === 'andén' ? 0 : 1;
      const reja = i.blocks.filter((y) => {
        if (!y.out || y.side?.color !== '#2c4a36' || y.y0 < x.y0 - 1e-6 || y.y1 > x.y1 + 1e-6 || y.y1 - y.y0 < 0.5 * (x.y1 - x.y0)) return false;
        const [a0, b0, a1, b1] = boxOf(y), lo = along === 0 ? a0 : b0, hi = along === 0 ? a1 : b1;
        const fuera = cara(x) === 'frente' ? b1 <= v0 + 1e-6 : cara(x) === 'andén' ? b0 >= v1 - 1e-6 : cara(x) === 'U 0' ? a1 <= u0 + 1e-6 : a0 >= u1 - 1e-6;
        return fuera && hi - lo < 0.04 && lo >= (along === 0 ? u0 : v0) - 1e-6 && hi <= (along === 0 ? u1 : v1) + 1e-6;
      });
      expect(reja.length, `la reja de la ventana de ${cara(x)} en ${fmt(boxOf(x))}`).toBeGreaterThanOrEqual(4);
    }
  });

  // H3 de la revisión: la herrería del patio se ve de lejos, con el edificio (los molinetes no: son muebles)
  test('la herrería del patio es out: los caños de las barandas, la hoja abierta y las barras de los pasamanos', () => {
    const fuera = (q: Vec2): boolean => !pointInPolygon(q, b.footprint);
    const caños = i.blocks.filter((x) => x.collide === 'none' && x.side && fuera(centroidOf(x.polygon)) && x.y1 > 0.5 && x.role === 'otro'
      && !rojo(x.side.color) && !amarillo(x.side.color));
    expect(caños.length).toBeGreaterThan(20);
    for (const x of caños) expect(x.out, `${x.side!.color} en ${fmt(boxOf(x))}`).toBe(true);
    const barras = i.panes.filter((p) => fuera([p.corners[0][0], p.corners[0][2]]));
    expect(barras.length).toBeGreaterThan(0);
    for (const p of barras) expect(p.out).toBe(true);
  });

  test('la escalera de acceso (out): baldosas rojas en las huellas y una nariz amarilla en cada escalón', () => {
    const esc = i.blocks.filter((x) => x.role === 'escalon');
    expect(esc.length).toBeGreaterThanOrEqual(4);
    for (const x of esc) {
      expect(x.out).toBe(true);
      expect(rojo(x.top!.color), x.top!.color).toBe(true);
    }
    const narices = i.blocks.filter((x) => x.out && x.top && amarillo(x.top.color) && esc.some((e) => Math.abs(x.y0 - e.y1) < 0.01));
    expect(narices.length).toBeGreaterThanOrEqual(esc.length);
  });
});

// H11 de la revisión: la escalera llega al andén que está (no a un número copiado de OSM), y si el plan no puede ubicar
// algo, lo dice en vez de dejar un hall vacío
describe('lo que el plan ubica', () => {
  const con = (f: (x: MapData['interiors'][number]) => MapData['interiors'][number], m: Partial<MapData> = {}): MapData =>
    ({ ...map, ...m, interiors: map.interiors.map((x) => (x.placeId === ID ? f(x) : x)) });
  test('la escalera termina en el borde de atrás del andén, el que da al edificio (a lo sumo 5 mm antes y sin pisarlo)', () => {
    const top = i.stairs.find((s) => s.top[1] > PLATFORM_H - 1e-6)!;
    const anden = map.platforms.find((p) => pointInPolygon(xz(mark('anden')), p))!;
    // el descanso de arriba: el bloque rojo, sólido, de PLATFORM_H de alto, que arranca en el último escalón
    const descanso = i.blocks.find((x) => x.collide === 'solid' && Math.abs(x.y1 - PLATFORM_H) < 1e-6 && x.top && rojo(x.top.color) && x.out)!;
    expect(descanso, 'el descanso').toBeDefined();
    const [, , , v1] = boxOf(descanso);
    // donde la recta del medio de la escalera (su U) cruza el anillo del andén, del lado del edificio
    const u = local(xz(top.foot))[0], r = anden.map(local);
    const borde = Math.min(...r.flatMap((q, k) => {
      const w = r[(k + 1) % r.length];
      if ((q[0] - u) * (w[0] - u) > 0 || q[0] === w[0]) return [];
      return [q[1] + ((w[1] - q[1]) * (u - q[0])) / (w[0] - q[0])];
    }));
    expect(borde - v1, `descanso hasta V ${v1.toFixed(4)}, andén desde V ${borde.toFixed(4)}`).toBeGreaterThanOrEqual(0);
    expect(borde - v1).toBeLessThan(0.005);
    // si el andén se corre 10 cm para el lado de la vía, el descanso lo sigue; 10 cm hacia el edificio, pisaría el
    // último escalón: la escalera no entra, y lo dice
    const corrido = (dv: number): MapData => con((x) => x, { platforms: map.platforms.map((p) => (p === anden ? p.map((q): Vec2 => [q[0] + vec([0, dv])[0], q[1] + vec([0, dv])[1]]) : p)) });
    const d2 = interiorOf(corrido(0.1), ID).blocks.find((x) => x.collide === 'solid' && Math.abs(x.y1 - PLATFORM_H) < 1e-6 && x.top && rojo(x.top.color) && x.out)!;
    expect(boxOf(d2)[3] - v1).toBeCloseTo(0.1, 3);
    expect(() => interiorOf(corrido(-0.1), ID)).toThrow(/estacion-adrogue: la escalera no entra/);
  });

  test('sin patio, sin la puerta del patio, sin andén o con otra planta: un error que dice qué falta, no un hall vacío', () => {
    expect(() => interiorOf(con((x) => ({ ...x, patios: [] })), ID)).toThrow(/estacion-adrogue: .*patio/);
    expect(() => interiorOf(con((x) => ({ ...x, openings: x.openings.filter((o) => o.edge !== 1) })), ID)).toThrow(/estacion-adrogue: .*puerta del patio/);
    expect(() => interiorOf(con((x) => x, { platforms: [] }), ID)).toThrow(/estacion-adrogue: .*andén/);
    const angosto = con((x) => x, { buildings: map.buildings.map((y) => (y.id === b.id ? { ...y, height: 3.5 } : y)) });
    expect(() => interiorOf(angosto, ID)).toThrow(/estacion-adrogue: .*relevad/);
  });
});

describe('dónde está', () => {
  test('la planta no pisa ningún andén (≤ 1 m²), ni el patio', () => {
    for (const p of map.platforms) {
      expect(overlap(b.footprint, p)).toBeLessThanOrEqual(1);
      expect(overlap(i.patios[0], p)).toBeLessThanOrEqual(1);
    }
  });

  test('ningún bloque sólido del patio ni de afuera pisa un andén, un poste del alero o de un cartel, ni las vías', () => {
    const solid = i.blocks.filter((x) => x.collide !== 'none' && (x.out || !pointInPolygon(x.polygon[0], b.footprint)));
    expect(solid.length).toBeGreaterThan(0);
    const posts = layout.flatMap((l) => [...l.posts, ...l.signs.flatMap((s) => s.posts)]);
    const rails = railRuns(map);
    for (const x of solid) {
      const say = `${x.role} en ${fmt(boxOf(x))}`;
      for (const p of map.platforms) expect(overlap(x.polygon, p), `${say} pisa un andén`).toBeLessThanOrEqual(1e-3);
      for (const p of posts) {
        const d = pointInPolygon(p.at, x.polygon) ? 0 : Math.min(...x.polygon.map((q, k) => distPointSegment(p.at, q, x.polygon[(k + 1) % x.polygon.length])));
        expect(d, `${say} pisa el poste de ${fmt(p.at)}`).toBeGreaterThan(p.r + 0.3);
      }
      for (const r of rails) {
        for (let k = 0; k + 1 < r.length; k++) {
          const d = Math.min(...x.polygon.map((q) => distPointSegment(q, r[k], r[k + 1])));
          expect(d, `${say} cerca de la vía`).toBeGreaterThan(2);
        }
      }
    }
  });

  test('el botín, las apariciones y el spawn del lugar a 25 m siguen libres en el mundo hueco', () => {
    const near = (p: Vec2): boolean => Math.hypot(...local(p).map((v, k) => v - [5, 3][k]) as [number, number]) < 25;
    const spots: Vec3[] = [...map.lootSpots.map((l) => l.pos), ...map.randomSpawns, place.spawn].filter((p) => near(xz(p)));
    expect(spots.length).toBeGreaterThan(0);
    for (const p of spots) expect(isFreeSpot(world, p[0], p[2], p[1]), fmt(p)).toBe(true);
  });

  test('de place.spawn, derecho con W hacia la puerta, se entra a la planta (la T11: teleport y W)', () => {
    const d = calle();
    // como el e2e de la T11: el yaw fijo, del spawn a la puerta, y W sin girar
    const yaw = yawToward([d.at[0] - place.spawn[0], d.at[1] - place.spawn[2]]);
    const end = walkStraight(world, place.spawn, yaw, 10, (s) => insideOf(b, s.pos) && Math.hypot(s.pos[0] - d.at[0], s.pos[2] - d.at[1]) > 1.5);
    expect(insideOf(b, end.pos), `termina en ${fmt(end.pos)}`).toBe(true);
    // y es una recta: el spawn mira a la puerta de frente (en su U, a lo sumo 0,2 m del medio de la puerta)
    const [su] = local(xz(place.spawn)), [du] = local(d.at);
    expect(Math.abs(su - du)).toBeLessThan(0.2);
  });

  test('piso libre para el botín de la T11: clamp(round(piso / 40), 4, 12) puntos libres en el hall, a ≥ 1,5 m uno de otro', () => {
    const area = publicFloorArea(i);
    const need = Math.min(12, Math.max(4, Math.round(area / 40)));
    const pts: Vec2[] = [];
    for (let u = 0.6; u <= 9.4; u += 0.25) {
      for (let v = 0.6; v <= 4.2; v += 0.25) {
        const [x, z] = [frame.origin[0] + vec([u, v])[0], frame.origin[1] + vec([u, v])[1]];
        if (!isFreeSpot(world, x, z, 0)) continue;
        if (pts.every((q) => Math.hypot(q[0] - x, q[1] - z) >= 1.5)) pts.push([x, z]);
      }
    }
    expect(pts.length, `piso público ${area.toFixed(1)} m²: hacen falta ${need}`).toBeGreaterThanOrEqual(need);
  });
});
