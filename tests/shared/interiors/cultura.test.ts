// La Casa de la Cultura (§4.4) sobre el mapa real, con el controlador del jugador y el hitscan del juego: los tres pisos
// públicos alrededor del atrio, el piso 4 cerrado con el hueco (D13), el lucernario a dos aguas que se camina por
// encima, la escalera central y la del costado, los balcones con sus columnas y barandas, las salas con tarimas y el
// auditorio con su escenario.
import { readFileSync } from 'node:fs';
import polygonClipping from 'polygon-clipping';
import { isFreeSpot } from '../../../src/mapgen/spawns.ts';
import { buildCollisionWorld } from '../../../src/shared/collision.ts';
import { hitscan } from '../../../src/shared/combat.ts';
import { SIM_HZ } from '../../../src/shared/fixed-step.ts';
import { distPointSegment, pointInPolygon, polygonArea } from '../../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { INTERIOR_PLANS, interiorOf } from '../../../src/shared/interiors/index.ts';
import { MODEL_BOX, RAIL_H } from '../../../src/shared/interiors/kit.ts';
import { LEVEL_H } from '../../../src/shared/interiors/openings.ts';
import type { Block, StairRun } from '../../../src/shared/interiors/types.ts';
import type { MapData } from '../../../src/shared/mapdata.ts';
import { initialState, stepPlayer } from '../../../src/shared/player.ts';
import type { PlayerState } from '../../../src/shared/player.ts';
import { walkTo } from './walk.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const i = interiorOf(map, 'casa-de-la-cultura');
const b = map.buildings.find((x) => x.id === i.buildingId)!;

const fmt = (p: readonly number[]): string => p.map((v) => v.toFixed(2)).join(', ');
const xz = (p: Vec3): Vec2 => [p[0], p[2]];
const dist2 = (a: Vec2, c: Vec2): number => Math.hypot(a[0] - c[0], a[1] - c[1]);
const unit = (a: Vec2): Vec2 => [a[0] / Math.hypot(a[0], a[1]), a[1] / Math.hypot(a[0], a[1])];
const centroid = (p: Vec2[]): Vec2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
const closed = (r: Vec2[]): [[number, number][]] => [[...r, r[0]].map((p): [number, number] => [p[0], p[1]])];
const area = (m: polygonClipping.MultiPolygon): number =>
  m.reduce((t, pg) => t + pg.reduce((a, r, k) => a + (k === 0 ? 1 : -1) * polygonArea(r.slice(0, -1) as Vec2[]), 0), 0);
/** Lo que mide la planta a lo largo de `d` (unitario). */
const extent = (poly: Vec2[], d: Vec2): number => {
  const s = poly.map((p) => p[0] * d[0] + p[1] * d[1]);
  return Math.max(...s) - Math.min(...s);
};
/** El ancho de una planta convexa: lo menos que mide de través a una de sus aristas (no se mide sobre `along`: el frente
 *  de la puerta y el marco del plan difieren en centésimas de grado, y a lo largo de 20 m eso suma milímetros). */
const width = (poly: Vec2[]): number => Math.min(...poly.map((p, k) => {
  const q = poly[(k + 1) % poly.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return l < 1e-9 ? Infinity : Math.max(...poly.map((r) => Math.abs((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / l));
}));
/** Distancia de `p` al contorno de `ring`. */
const toRing = (p: Vec2, ring: Vec2[]): number => Math.min(...ring.map((q, k) => distPointSegment(p, q, ring[(k + 1) % ring.length])));
/** El punto del contorno de `ring` más cercano a `p`. */
function nearestOn(p: Vec2, ring: Vec2[]): Vec2 {
  let best: Vec2 = ring[0], bd = Infinity;
  ring.forEach((a, k) => {
    const c = ring[(k + 1) % ring.length];
    const [dx, dz] = [c[0] - a[0], c[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    const q: Vec2 = [a[0] + dx * t, a[1] + dz * t];
    if (dist2(p, q) < bd) [best, bd] = [q, dist2(p, q)];
  });
  return best;
}

// el marco de la casa: a lo largo del frente (el de la puerta) y hacia adentro
const door = i.doors[0];
const inward: Vec2 = [-door.normal[0], -door.normal[1]];
const along: Vec2 = [-door.normal[1], door.normal[0]];

function mark(name: string): Vec3 {
  const p = i.marks[name];
  if (!p) throw new Error(`casa-de-la-cultura: falta la marca "${name}"`);
  return p;
}
/** El hueco del atrio en el piso `level`: el de `floors` donde cae la marca del atrio. */
function atrium(level: number): Vec2[] {
  const h = i.floors.find((f) => f.level === level)?.holes.find((r) => pointInPolygon(xz(mark('atrio')), r));
  if (!h) throw new Error(`casa-de-la-cultura: el piso ${level} no tiene el hueco del atrio`);
  return h;
}
/** W (sin Shift) mirando hacia `d` durante `seconds`, desde `from`; `each` ve cada paso. */
function press(from: Vec3, d: Vec2, seconds: number, each: (s: PlayerState) => void = () => {}): PlayerState {
  const yaw = Math.atan2(-d[0], -d[1]);
  let s = initialState(from);
  for (let k = 0; k < seconds * SIM_HZ; k++) {
    s = stepPlayer(s, { forward: 1, right: 0, jump: false, crouch: false, yaw, pitch: 0 }, world, 1 / SIM_HZ);
    each(s);
  }
  return s;
}
/** Los escalones de la escalera `s` (los `escalon` cuyo medio cae a lo largo de su corrida, como checkStairs) y su
 *  ancho: lo que mide de costado el más angosto. */
function stairWidth(s: StairRun): number {
  const d = unit([s.top[0] - s.foot[0], s.top[2] - s.foot[2]]), len = dist2(xz(s.foot), xz(s.top));
  const steps = i.blocks.filter((x) => {
    if (x.role !== 'escalon' || x.y1 <= s.foot[1] || x.y1 > s.top[1] + 1e-6) return false;
    const c = centroid(x.polygon), [px, pz] = [c[0] - s.foot[0], c[1] - s.foot[2]];
    const at = px * d[0] + pz * d[1];
    return at >= 0 && at <= len && Math.abs(-px * d[1] + pz * d[0]) < 2.5;
  });
  expect(steps.length, `escalera del ${s.from} al ${s.to}`).toBeGreaterThan(5);
  return Math.min(...steps.map((x) => extent(x.polygon, [-d[1], d[0]])));
}

test('tiene su plan: públicos el 0, el 1 y el 2 (floors 0, 1, 2 y no el 3); el piso 4, cerrado', () => {
  expect(INTERIOR_PLANS['casa-de-la-cultura']).toBeDefined();
  expect(i.publicFloors).toBe(3);
  expect(b.floors).toBe(4);
  expect(i.terrace).toBe(false);
  expect(i.floors.map((f) => f.level)).toEqual([0, 1, 2]);
  expect(i.floors.some((f) => f.level === 3)).toBe(false);
  // el bloque cerrado: de 3 · 3,2 − 0,2 hasta el techo
  const top = i.blocks.filter((x) => x.role === 'losa' && Math.abs(x.y0 - (3 * LEVEL_H - 0.2)) < 1e-6 && Math.abs(x.y1 - b.height) < 1e-6);
  expect(top.length).toBeGreaterThan(0);
});

describe('el atrio', () => {
  test('el hueco mide 10 ± 2 × 20 ± 3 m, en los pisos 1 y 2, y atraviesa el bloque cerrado y el techo (D13)', () => {
    for (const h of [atrium(1), atrium(2)]) {
      expect(Math.abs(extent(h, along) - 10), `de ancho: ${extent(h, along).toFixed(2)}`).toBeLessThanOrEqual(2);
      expect(Math.abs(extent(h, inward) - 20), `de fondo: ${extent(h, inward).toFixed(2)}`).toBeLessThanOrEqual(3);
    }
    // el techo tiene un solo hueco, el del atrio, y ninguna losa del bloque cerrado lo pisa
    expect(i.roofHoles).toHaveLength(1);
    const roof = i.roofHoles[0];
    expect(pointInPolygon(xz(mark('atrio')), roof)).toBe(true);
    expect(Math.abs(extent(roof, along) - 10)).toBeLessThanOrEqual(2);
    expect(Math.abs(extent(roof, inward) - 20)).toBeLessThanOrEqual(3);
    const closedTop = i.blocks.filter((x) => x.role === 'losa' && x.y1 > b.height - 1e-6 && x.y0 < b.height - 1);
    for (const x of closedTop) expect(area(polygonClipping.intersection(closed(x.polygon), closed(roof))), fmt(centroid(x.polygon))).toBeLessThan(1e-3);
  });

  test('un tiro hacia arriba desde el atrio, a 1,6 m, atraviesa el lucernario: null en 30 m (el plafón no frena)', () => {
    const a = mark('atrio');
    expect(a[1]).toBe(0);
    expect(hitscan(world, [], [a[0], 1.6, a[2]], [0, 1, 0], 30)).toBeNull();
    // el plafón cuelga sobre el atrio, debajo del lucernario, y es un ítem sin caja
    expect(MODEL_BOX.plafon).toBeUndefined();
    const plafon = i.items.filter((it) => it.model === 'plafon');
    expect(plafon).toHaveLength(1);
    expect(pointInPolygon(xz(plafon[0].at), i.roofHoles[0])).toBe(true);
    expect(plafon[0].at[1]).toBeGreaterThan(2 * LEVEL_H + 2.2);
    expect(plafon[0].at[1]).toBeLessThan(b.height);
  });

  test('sin throughGlass, el rayo hacia arriba pega en el lucernario, a la altura del techo (± 0,3)', () => {
    const a = mark('atrio');
    const hit = world.raycast([a[0], 1.6, a[2]], [0, 1, 0], 30);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.point[1] - b.height), `pega a ${hit!.point[1].toFixed(2)}`).toBeLessThanOrEqual(0.3);
  });

  test('el lucernario (D13): franjas de vidrio que dan al cielo, de ≤ 0,2 m, sobre todo el hueco y a dos aguas', () => {
    const glass = i.blocks.filter((x) => x.sky && x.role === 'vidrio');
    expect(glass.length).toBeGreaterThanOrEqual(40);
    for (const x of glass) {
      expect(x.collide).toBe('glass');
      expect(width(x.polygon), fmt(centroid(x.polygon))).toBeLessThanOrEqual(0.2 + 1e-6);
      expect(x.y0).toBeGreaterThanOrEqual(b.height - 1e-6);
    }
    const roof = i.roofHoles[0];
    const cover = polygonClipping.union(closed(glass[0].polygon), ...glass.slice(1).map((x) => closed(x.polygon)));
    expect(area(polygonClipping.difference(closed(roof), cover)), 'el hueco sin vidrio').toBeLessThan(0.01);
    expect(area(polygonClipping.difference(cover, closed(roof))), 'vidrio fuera del hueco').toBeLessThan(0.01);
    // a dos aguas: más alto en el medio que en los bordes, y entre una franja y la de al lado, a lo sumo un escalón
    const mid = centroid(roof);
    const across = (x: Block): number => {
      const c = centroid(x.polygon);
      return Math.abs((c[0] - mid[0]) * along[0] + (c[1] - mid[1]) * along[1]);
    };
    const byAcross = [...glass].sort((p, q) => across(p) - across(q));
    expect(byAcross[0].y1 - byAcross[byAcross.length - 1].y1).toBeGreaterThan(0.5);
    const sorted = [...glass].sort((p, q) => {
      const [cp, cq] = [centroid(p.polygon), centroid(q.polygon)];
      return (cp[0] - cq[0]) * along[0] + (cp[1] - cq[1]) * along[1];
    });
    for (let k = 0; k + 1 < sorted.length; k++) expect(Math.abs(sorted[k + 1].y1 - sorted[k].y1)).toBeLessThan(0.2);
  });

  test('sobre el lucernario: desde techo-lucernario (a 1 m), con W 6 s lo cruza sin bajar nunca de height − 0,05', () => {
    const t = mark('techo-lucernario');
    expect(Math.abs(t[1] - b.height)).toBeLessThan(1e-6);
    const roof = i.roofHoles[0];
    expect(Math.abs(toRing(xz(t), roof) - 1), 'a 1 m del lucernario').toBeLessThanOrEqual(0.15);
    const c = centroid(roof);
    const d = unit([c[0] - t[0], c[1] - t[2]]);
    // del otro lado: pasado el borde de enfrente del hueco, sobre su recta
    const far = Math.max(...roof.map((p) => (p[0] - t[0]) * d[0] + (p[1] - t[2]) * d[1]));
    let low = Infinity, crossed = false;
    const s = press(t, d, 6, (st) => {
      low = Math.min(low, st.pos[1]);
      if ((st.pos[0] - t[0]) * d[0] + (st.pos[2] - t[2]) * d[1] > far + 0.5) crossed = true;
    });
    expect(low, `bajó a ${low.toFixed(2)}`).toBeGreaterThanOrEqual(b.height - 0.05);
    expect(crossed, `termina en ${fmt(s.pos)}`).toBe(true);
  });

  test("views tiene 'atrio': adentro de la planta, a nivel 0, en el hall, mirando a lo largo del atrio", () => {
    const v = i.views.find((x) => x.id === 'atrio');
    expect(v).toBeDefined();
    expect(v!.pos[1]).toBe(0);
    expect(pointInPolygon(xz(v!.pos), b.footprint)).toBe(true);
    expect(pointInPolygon(xz(v!.pos), atrium(1))).toBe(false); // en el hall, antes del atrio
    const ahead: Vec2 = [-Math.sin(v!.yaw), -Math.cos(v!.yaw)];
    expect(ahead[0] * inward[0] + ahead[1] * inward[1]).toBeGreaterThan(0.95);
  });
});

describe('escaleras y balcones', () => {
  test('la escalera central, del 0 al 1, mide ≥ 3,0 m de ancho y sube por el atrio; la del costado, del 1 al 2, ≥ 1,2', () => {
    const central = i.stairs.filter((s) => s.from === 0 && s.to === 1);
    const side = i.stairs.filter((s) => s.from === 1 && s.to === 2);
    expect(central).toHaveLength(1);
    expect(side).toHaveLength(1);
    expect(stairWidth(central[0])).toBeGreaterThanOrEqual(3.0);
    expect(stairWidth(side[0])).toBeGreaterThanOrEqual(1.2);
    expect(pointInPolygon(xz(central[0].foot), atrium(1))).toBe(true);
    expect(pointInPolygon(xz(side[0].foot), atrium(1))).toBe(false);
  });

  test('el hueco de los balcones tiene las esquinas curvas, en tramos de ≤ 0,5 m', () => {
    for (const level of [1, 2]) {
      const h = atrium(level);
      const bent = h.map((p, k) => [p, h[(k + 1) % h.length]] as const).filter(([p, q]) => {
        const e = unit([q[0] - p[0], q[1] - p[1]]);
        return Math.abs(e[0] * along[0] + e[1] * along[1]) < 0.999 && Math.abs(e[0] * inward[0] + e[1] * inward[1]) < 0.999;
      });
      expect(bent.length, `nivel ${level}: tramos de las curvas`).toBeGreaterThanOrEqual(8);
      for (const [p, q] of bent) expect(dist2(p, q), `nivel ${level}`).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  test('balcones: columnas blancas sólidas con capitel al borde del atrio, y barandas de vidrio con tramos de reja negra', () => {
    for (const level of [0, 1, 2]) {
      const y = level * LEVEL_H;
      // un fuste: sólido, angosto, desde el piso hasta casi el cielorraso, al borde del hueco
      const shafts = i.blocks.filter((x) => x.collide === 'solid' && Math.abs(x.y0 - y) < 0.3 && x.y1 - x.y0 > 2.2
        && extent(x.polygon, along) < 0.6 && extent(x.polygon, inward) < 0.6 && toRing(centroid(x.polygon), atrium(1)) < 0.6);
      expect(shafts.length, `nivel ${level}: columnas`).toBeGreaterThanOrEqual(4);
      for (const s of shafts) {
        // el capitel: un bloque más ancho sobre el fuste
        const c = centroid(s.polygon);
        const capital = i.blocks.find((x) => x !== s && Math.abs(x.y0 - s.y1) < 0.02 && pointInPolygon(c, x.polygon)
          && extent(x.polygon, along) > extent(s.polygon, along) + 0.05);
        expect(capital, `nivel ${level}: capitel de la columna en ${fmt(c)}`).toBeDefined();
        expect(s.side?.color.toLowerCase() ?? '').toMatch(/^#[ef]/);
      }
    }
    for (const level of [1, 2]) {
      const rails = i.blocks.filter((x) => x.role === 'baranda' && Math.abs(x.y0 - level * LEVEL_H) < 1e-6);
      expect(rails.every((x) => x.collide === 'glass')).toBe(true);
      expect(rails.some((x) => x.side?.mat === 'vidrio'), `nivel ${level}: vidrio`).toBe(true);
      // la reja: barrotes negros (sin colisión: la baranda es la que frena) sobre las curvas
      const bars = i.blocks.filter((x) => x.collide === 'none' && Math.abs(x.y0 - level * LEVEL_H) < 0.05 && x.y1 - x.y0 > RAIL_H - 0.2
        && x.side !== undefined && parseInt(x.side.color.slice(1, 3), 16) < 0x40 && toRing(centroid(x.polygon), atrium(level)) < 0.3);
      expect(bars.length, `nivel ${level}: barrotes de la reja`).toBeGreaterThan(10);
    }
  });

  test('desde balcon-1 (a 1 m de la baranda), caminar 4 s hacia el atrio frena en la baranda y sigue a y = 3,2 (± 0,05)', () => {
    const p = mark('balcon-1');
    expect(Math.abs(p[1] - LEVEL_H)).toBeLessThan(1e-6);
    const rails = i.blocks.filter((x) => x.role === 'baranda' && Math.abs(x.y0 - LEVEL_H) < 1e-6);
    expect(Math.abs(Math.min(...rails.map((x) => toRing(xz(p), x.polygon))) - 1), 'a 1 m de la baranda').toBeLessThanOrEqual(0.15);
    const h = atrium(1);
    const edge = nearestOn(xz(p), h);
    const s = press(p, unit([edge[0] - p[0], edge[1] - p[2]]), 4);
    expect(Math.abs(s.pos[1] - LEVEL_H), `termina en ${fmt(s.pos)}`).toBeLessThanOrEqual(0.05);
    expect(pointInPolygon(xz(s.pos), h), 'no cae al atrio').toBe(false);
    expect(dist2(xz(s.pos), edge), 'llega a la baranda').toBeLessThan(0.6);
  });

  test('un tiro de balcon-1 a un blanco en balcon-2-enfrente, del otro lado del atrio, le da (target)', () => {
    const p = mark('balcon-1'), q = mark('balcon-2-enfrente');
    expect(Math.abs(q[1] - 2 * LEVEL_H)).toBeLessThan(1e-6);
    expect(pointInPolygon([(p[0] + q[0]) / 2, (p[2] + q[2]) / 2], atrium(1)), 'del otro lado del atrio').toBe(true);
    const from: Vec3 = [p[0], p[1] + 1.6, p[2]];
    const to: Vec3 = [q[0], q[1] + 1.2, q[2]];
    const hit = hitscan(world, [{ id: 'blanco', pos: q, crouching: false }], from, [to[0] - from[0], to[1] - from[1], to[2] - from[2]], 60);
    expect(hit).toMatchObject({ kind: 'target', id: 'blanco' });
  });
});

describe('planta baja', () => {
  test('las salas: walkTo de sala a tarima sube caminando (≤ 0,45 m) y hay paneles sólidos (MODEL_BOX)', () => {
    const t = mark('tarima');
    expect(t[1]).toBeGreaterThan(0.05);
    expect(t[1]).toBeLessThanOrEqual(0.45);
    const s = walkTo(world, mark('sala'), xz(t), 6);
    expect(Math.abs(s.pos[1] - t[1]), `termina en ${fmt(s.pos)}`).toBeLessThanOrEqual(0.05);
    expect(MODEL_BOX['panel-muestra']).toBeDefined();
    expect(i.items.filter((it) => it.model === 'panel-muestra').length).toBeGreaterThanOrEqual(4);
  });

  test('auditorio: walkTo de auditorio a escenario cruza las filas de sillas (no sólidas) y termina arriba del escenario (± 0,05)', () => {
    const a = mark('auditorio'), e = mark('escenario');
    expect(a[1]).toBe(0);
    expect(e[1]).toBeGreaterThan(0.45); // más alto que un escalón: se sube por los escalones del costado
    expect(MODEL_BOX['silla-auditorio']).toBeUndefined();
    const seats = i.items.filter((it) => it.model === 'silla-auditorio');
    expect(seats.length).toBeGreaterThanOrEqual(60);
    expect(seats.some((it) => distPointSegment(xz(it.at), xz(a), xz(e)) < 0.4), 'la recta pasa por las sillas').toBe(true);
    const s = walkTo(world, a, xz(e), 10);
    expect(Math.abs(s.pos[1] - e[1]), `termina en ${fmt(s.pos)}`).toBeLessThanOrEqual(0.05);
    expect(dist2(xz(s.pos), xz(e))).toBeLessThan(0.5);
  });

  test('el botín, las apariciones y el spawn del lugar alrededor de la casa siguen libres en el mundo hueco', () => {
    const near = (p: Vec2): boolean => toRing(p, b.footprint) < 15 || pointInPolygon(p, b.footprint);
    const place = map.places.find((p) => p.id === 'casa-de-la-cultura')!;
    const spots: Vec3[] = [...map.lootSpots.map((l) => l.pos), ...map.randomSpawns, place.spawn].filter((p) => near(xz(p)));
    expect(spots.length).toBeGreaterThan(0);
    for (const p of spots) expect(isFreeSpot(world, p[0], p[2], p[1]), fmt(p)).toBe(true);
  });
});
