// La Casa de la Cultura (§4.4) sobre el mapa real, con el controlador del jugador y el hitscan del juego: los tres pisos
// públicos alrededor del atrio, el piso 4 cerrado con el hueco (D13), el lucernario a dos aguas que se camina por
// encima, la escalera central y la del costado, los balcones con sus columnas y barandas, las salas con tarimas y el
// auditorio con su escenario.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import polygonClipping from 'polygon-clipping';
import { isFreeSpot } from '../../../src/mapgen/spawns.ts';
import { buildCollisionWorld } from '../../../src/shared/collision.ts';
import { hitscan } from '../../../src/shared/combat.ts';
import { SIM_HZ } from '../../../src/shared/fixed-step.ts';
import { distPointSegment, pointInPolygon, polygonArea } from '../../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { cuadro } from '../../../src/shared/interiors/cultura.ts';
import { INTERIOR_PLANS, interiorOf } from '../../../src/shared/interiors/index.ts';
import { MODEL_BOX, RAIL_H, TREAD, WALL_OUT } from '../../../src/shared/interiors/kit.ts';
import { LEVEL_H } from '../../../src/shared/interiors/openings.ts';
import type { Block, Pane, StairRun } from '../../../src/shared/interiors/types.ts';
import type { MapData } from '../../../src/shared/mapdata.ts';
import { initialState, stepPlayer } from '../../../src/shared/player.ts';
import type { PlayerState } from '../../../src/shared/player.ts';
import { testInterior } from './fixture.ts';
import { walkTo } from './walk.ts';
import { areaOf, closed, fmt } from '../../helpers.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const i = interiorOf(map, 'casa-de-la-cultura');
const b = map.buildings.find((x) => x.id === i.buildingId)!;

const xz = (p: Vec3): Vec2 => [p[0], p[2]];
const dist2 = (a: Vec2, c: Vec2): number => Math.hypot(a[0] - c[0], a[1] - c[1]);
const unit = (a: Vec2): Vec2 => [a[0] / Math.hypot(a[0], a[1]), a[1] / Math.hypot(a[0], a[1])];
const centroid = (p: Vec2[]): Vec2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
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

/** El alto más alto en que la vertical por `p` corta los paños (los que no son verticales), o null. */
function paneTop(panes: Pane[], p: Vec2): number | null {
  let best: number | null = null;
  for (const q of panes) {
    const [c, n] = [q.corners[0], q.normal];
    if (Math.abs(n[1]) < 0.1 || !pointInPolygon(p, q.corners.map(xz))) continue;
    const y = c[1] - (n[0] * (p[0] - c[0]) + n[2] * (p[1] - c[2])) / n[1];
    if (best === null || y > best) best = y;
  }
  return best;
}
const NEGRO = '#1b1b1c', CREMA = '#e6dcc6';

// el marco de la casa: a lo largo del frente (el de la puerta) y hacia adentro
const door = i.doors[0];
const inward: Vec2 = [-door.normal[0], -door.normal[1]];
const along: Vec2 = [-door.normal[1], door.normal[0]];
/** Cuánto se mete `p` desde la cara de afuera del frente (la de la puerta). */
const depth = (p: Vec2): number => (p[0] - door.at[0]) * inward[0] + (p[1] - door.at[1]) * inward[1];
/** Lo que corre `p` a lo largo del frente desde la puerta. */
const side = (p: Vec2): number => (p[0] - door.at[0]) * along[0] + (p[1] - door.at[1]) * along[1];
/** Los fustes de las columnas del piso `level` (sólidos, angostos, de piso a casi el cielorraso, al borde del hueco). */
const shaftsAt = (level: number): Block[] => i.blocks.filter((x) => x.collide === 'solid' && Math.abs(x.y0 - level * LEVEL_H) < 0.3 && x.y1 - x.y0 > 2.2
  && extent(x.polygon, along) < 0.6 && extent(x.polygon, inward) < 0.6 && toRing(centroid(x.polygon), atrium(1)) < 0.6);

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
    for (const x of closedTop) expect(areaOf(polygonClipping.intersection(closed(x.polygon), closed(roof))), fmt(centroid(x.polygon))).toBeLessThan(1e-3);
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
    expect(areaOf(polygonClipping.difference(closed(roof), cover)), 'el hueco sin vidrio').toBeLessThan(0.01);
    expect(areaOf(polygonClipping.difference(cover, closed(roof))), 'vidrio fuera del hueco').toBeLessThan(0.01);
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

  test('el lucernario se dibuja en pendiente (H1): dos aguas y dos tímpanos de vidrio, a ≤ 0,04 m del tope de colisión en 20 puntos de través', () => {
    const glass = i.panes.filter((p) => p.sky && p.look.mat === 'vidrio');
    expect(glass.length).toBeGreaterThanOrEqual(2);
    expect(glass.length, 'dos aguas y dos tímpanos').toBeLessThanOrEqual(4);
    expect(glass.every((p) => p.back), 'se ven de los dos lados').toBe(true);
    // ninguna franja de colisión se dibuja: lo que se ve son los paños
    expect(i.blocks.filter((x) => x.sky && x.role === 'vidrio' && (x.top || x.side || x.bottom))).toEqual([]);
    const roof = i.roofHoles[0], c = centroid(roof), half = extent(roof, along) / 2;
    for (let j = 0; j < 20; j++) {
      const s = -half + (2 * half * (j + 0.5)) / 20;
      const p: Vec2 = [c[0] + along[0] * s, c[1] + along[1] * s];
      const drawn = paneTop(glass, p);
      const hit = world.raycast([p[0], b.height + 5, p[1]], [0, -1, 0], 10);
      expect(drawn, fmt(p)).not.toBeNull();
      expect(hit, fmt(p)).not.toBeNull();
      expect(Math.abs(drawn! - hit!.point[1]), `${fmt(p)}: dibujado a ${drawn!.toFixed(3)}, se pisa a ${hit!.point[1].toFixed(3)}`).toBeLessThanOrEqual(0.04);
    }
    // la estructura (cabios, correas y cumbrera) también va en pendiente: barras, no tramos de bloques
    expect(i.blocks.filter((x) => x.sky && x.collide === 'none')).toEqual([]);
    expect(i.panes.filter((p) => p.sky && p.look.mat !== 'vidrio').length).toBeGreaterThan(20);
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

  test('el pasamanos de las escaleras va en pendiente (H1): una barra por lado, a 0,93 ± 0,02 m sobre la línea de las narices', () => {
    const tops = i.panes.filter((p) => p.look.color === NEGRO && p.normal[1] > 0.3 && p.normal[1] < 0.99);
    for (const s of i.stairs) {
      const d = unit([s.top[0] - s.foot[0], s.top[2] - s.foot[2]]), w = stairWidth(s);
      const n = Math.ceil((s.top[1] - s.foot[1]) / 0.2 - 1e-9), r = (s.top[1] - s.foot[1]) / n;
      // la línea de las narices: la del escalón k (de 1 a n − 1) está a 0,6 + (k − 1) · TREAD del pie, a k · r
      const nose = (a: number): number => s.foot[1] + r + ((a - 0.6) * r) / TREAD;
      const at = (q: Vec3): [number, number] => {
        const [px, pz] = [q[0] - s.foot[0], q[2] - s.foot[2]];
        return [px * d[0] + pz * d[1], -px * d[1] + pz * d[0]];
      };
      // la cara de arriba de cada pasamanos (larga: las tapas de las puntas también miran un poco para arriba)
      const mine = tops.filter((p) => p.corners.every((q) => {
        const [a, lat] = at(q);
        return a > 0.4 && a < 0.6 + n * TREAD && Math.abs(lat) > w / 2 - 0.1 && Math.abs(lat) < w / 2 + 0.2;
      }) && Math.max(...p.corners.map((q) => at(q)[0])) - Math.min(...p.corners.map((q) => at(q)[0])) > 1);
      const name = `escalera del ${s.from} al ${s.to}`;
      expect(mine.length, name).toBeGreaterThanOrEqual(1);
      for (const sign of [1, -1]) {
        const one = mine.filter((p) => Math.sign(at(p.corners[0])[1]) === sign);
        expect(one.length, `${name}, lado ${sign}: una barra`).toBeLessThanOrEqual(1);
        if (one.length === 0) continue;
        const as = one[0].corners.map((q) => at(q)[0]);
        expect(Math.min(...as), name).toBeLessThanOrEqual(0.6 + 0.05);
        expect(Math.max(...as), name).toBeGreaterThanOrEqual(0.6 + (n - 2) * TREAD - 0.05);
        for (const q of one[0].corners) {
          const h = q[1] - nose(at(q)[0]);
          expect(Math.abs(h - 0.93), `${name}: a ${h.toFixed(3)} m de las narices`).toBeLessThanOrEqual(0.02);
        }
      }
    }
  });

  test('el frente de los pisos 1 y 2 es un ventanal (H2): un paño de luz de lado a lado contra la cara de adentro, montantes negros cada ≤ 1,6 m, un travesaño a 1,0 m y ningún cuadro', () => {
    const front = (p: Vec3): boolean => depth(xz(p)) > WALL_OUT - 0.01 && depth(xz(p)) < WALL_OUT + 0.12;
    const facingIn = (p: Pane): boolean => p.normal[0] * inward[0] + p.normal[2] * inward[1] > 0.99;
    const wide = Math.max(...b.footprint.map((q) => side(q))) - Math.min(...b.footprint.map((q) => side(q)));
    for (const level of [1, 2]) {
      const y = level * LEVEL_H, ceiling = level === 1 ? 2 * LEVEL_H - 0.2 : 3 * LEVEL_H - 0.2;
      const inLevel = (p: Pane): boolean => p.corners.every((q) => q[1] > y - 0.01 && q[1] < ceiling + 0.01 && front(q));
      const glow = i.panes.filter((p) => p.look.mat === 'luz' && facingIn(p) && inLevel(p));
      expect(glow.length, `nivel ${level}: el vidrio`).toBeGreaterThanOrEqual(1);
      const span = (ps: Pane[]): number => Math.max(...ps.flatMap((p) => p.corners.map((q) => side(xz(q))))) - Math.min(...ps.flatMap((p) => p.corners.map((q) => side(xz(q)))));
      expect(span(glow), `nivel ${level}: de lado a lado`).toBeGreaterThan(wide - 1.0);
      expect(Math.max(...glow.flatMap((p) => p.corners.map((q) => q[1]))) - Math.min(...glow.flatMap((p) => p.corners.map((q) => q[1]))), `nivel ${level}: de alto`).toBeGreaterThan(2.6);
      const black = i.panes.filter((p) => p.look.color === NEGRO && facingIn(p) && inLevel(p));
      // los montantes: caras altas y angostas; entre uno y el siguiente, a lo sumo 1,6 m
      const posts = black.filter((p) => {
        const ys = p.corners.map((q) => q[1]), ss = p.corners.map((q) => side(xz(q)));
        return Math.max(...ys) - Math.min(...ys) > 2.5 && Math.max(...ss) - Math.min(...ss) < 0.1;
      }).map((p) => p.corners.reduce((t, q) => t + side(xz(q)), 0) / p.corners.length).sort((p, q) => p - q);
      expect(posts.length, `nivel ${level}: montantes`).toBeGreaterThanOrEqual(10);
      for (let k = 0; k + 1 < posts.length; k++) expect(posts[k + 1] - posts[k], `nivel ${level}`).toBeLessThanOrEqual(1.6);
      // el travesaño: una cara larga y baja que pasa por y + 1,0
      expect(black.some((p) => {
        const ys = p.corners.map((q) => q[1]);
        return span([p]) > wide - 1.5 && Math.min(...ys) <= y + 1.0 && Math.max(...ys) >= y + 1.0 && Math.max(...ys) - Math.min(...ys) < 0.12;
      }), `nivel ${level}: travesaño`).toBe(true);
      const hung = i.labels.filter((l) => l.drawing === 'cuadro' && l.at[1] > y && l.at[1] < ceiling && depth(xz(l.at)) < WALL_OUT + 0.3);
      expect(hung.map((l) => fmt(l.at)), `nivel ${level}: cuadros en el frente`).toEqual([]);
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

  test('el porcelanato de la planta baja es blanco y crema (H3): guardas crema bajo las columnas de la galería y un borde en el hall', () => {
    const cream = i.blocks.filter((x) => x.top?.mat === 'porcelanato' && x.top.color.toLowerCase() === CREMA && x.collide === 'none'
      && x.y0 >= 0.015 && x.y1 <= 0.04 && x.y1 - x.y0 <= 0.01);
    const m2 = cream.reduce((t, x) => t + polygonArea(x.polygon), 0);
    expect(m2, 'm² de guarda crema').toBeGreaterThanOrEqual(20);
    // debajo de cada columna de la planta baja pasa una guarda
    const shafts = shaftsAt(0);
    expect(shafts.length).toBeGreaterThanOrEqual(4);
    for (const s of shafts) expect(cream.some((x) => pointInPolygon(centroid(s.polygon), x.polygon)), `columna en ${fmt(centroid(s.polygon))}`).toBe(true);
    // y en el hall, entre el frente y el atrio
    const hall = cream.filter((x) => depth(centroid(x.polygon)) < 6);
    expect(hall.reduce((t, x) => t + polygonArea(x.polygon), 0), 'm² de borde en el hall').toBeGreaterThanOrEqual(5);
  });

  test('los cuadros (H7): la semilla sale del lugar, no del orden (agregar uno antes no cambia los demás), y src/shared no tiene estado de módulo', () => {
    const texts = i.labels.filter((l) => l.drawing === 'cuadro').map((l) => l.text);
    expect(texts.length).toBeGreaterThan(30);
    expect(new Set(texts).size, 'cada cuadro, su dibujo').toBe(texts.length);
    const last = (first: boolean): string => {
      const { interior } = testInterior({ extra: (k) => {
        if (first) cuadro(k, [2, 14.9], 1.5, [0, -1]);
        cuadro(k, [8, 14.9], 1.5, [0, -1]);
      } });
      return interior.labels[interior.labels.length - 1].text;
    };
    expect(last(true)).toBe(last(false));
    // nada de `let` ni `var` sueltos en los módulos de src/shared: un plan sale igual se arme cuando se arme
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });
    for (const f of files('src/shared')) expect(readFileSync(f, 'utf8').match(/^(let|var) .*/gm) ?? [], f).toEqual([]);
  });

  test('el botín, las apariciones y el spawn del lugar alrededor de la casa siguen libres en el mundo hueco', () => {
    const near = (p: Vec2): boolean => toRing(p, b.footprint) < 15 || pointInPolygon(p, b.footprint);
    const place = map.places.find((p) => p.id === 'casa-de-la-cultura')!;
    const spots: Vec3[] = [...map.lootSpots.map((l) => l.pos), ...map.randomSpawns, place.spawn].filter((p) => near(xz(p)));
    expect(spots.length).toBeGreaterThan(0);
    for (const p of spots) expect(isFreeSpot(world, p[0], p[2], p[1]), fmt(p)).toBe(true);
  });
});
