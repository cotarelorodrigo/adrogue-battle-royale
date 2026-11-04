// Puntos de botín del mapa (spec 2a §5), en tres niveles: veredas de las calles vehiculares, techos alcanzables y el
// frente de los lugares entrables (hasta que existan los interiores). Qué sale en cada uno se sortea al empezar la
// partida (src/shared/loot.ts). Todo es geométrico y determinista: el mismo mapa da los mismos puntos.
import { DUMPSTER, PARAPET_T, roofEdgeY } from '../shared/collision.ts';
import type { CollisionWorld } from '../shared/collision.ts';
import { distPointSegment, hash01, pointInPolygon, polygonArea } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { LootSpot, MapData, Road, RoadKind } from '../shared/mapdata.ts';
import { PLAYER } from '../shared/player.ts';
import { AMMO_BESIDE } from '../shared/loot.ts';
import { roofClusters } from './climb.ts';
import { rn } from './round.ts';
import { bboxOf, createGrid, distToRing } from './spatial.ts';
import { isFreeSpot } from './spawns.ts';

const NON_VEHICULAR = new Set<RoadKind>(['footway', 'pedestrian', 'service']);
/** Metros libres de todo sólido alrededor de cada punto, entre 5 cm y el alto del jugador: entran el objeto y, a
 *  AMMO_BESIDE, la caja de munición de un arma con su medio ancho (0,2 m). En un techo es la distancia al pretil (0,8 m). */
const CLEAR = AMMO_BESIDE + 0.2;
/** Un punto no queda pegado al cordón: a esto, como mínimo, del borde de toda calzada. */
const CURB = 0.2;

// Separación. Con la regla al pie de la letra (un punto cada 25 m de vereda y uno por techo de más de 60 m²) este mapa da
// unos 620 de calle y 1075 de techo: el triple de lo que pide una partida de 12 (150 a 600 en total). La calle y los
// techos se espacian a 50 m, y en los techos, entre dos vecinos, gana el más alto (spec 2a §5: prioridad a los altos).
/** Calle: metros de calle entre un punto y el siguiente, alternando la vereda. */
const STREET_STEP = 50;
/** Calle: dos puntos (o uno y un punto de un lugar) quedan al menos a esto. También saca los repetidos de los cruces y
 *  de las calles que OSM parte en varios tramos. */
const STREET_GAP = 50;
/** Calle: si el punto ideal no está libre (un árbol, un poste), se corre a lo largo de la vereda hasta esto. */
const STREET_NUDGE = [0, 1, -1, 2, -2, 3, -3, 4, -4];

/** Techo: solo los de más de esto (m²). */
const ROOF_MIN_AREA = 60;
/** Techo: dos puntos quedan al menos a esto (en planta); se ubican del techo más alto al más bajo. */
const ROOF_GAP = 50;
/** Techo: precisión (m) del punto más lejano a los bordes. */
const POLE_PRECISION = 0.05;

/** Lugar: semicírculo frente al cartel, a 2–4 m (con margen para el redondeo), con un punto ideal a PLACE_R en cada uno
 *  de estos ángulos (grados) respecto de la normal del cartel: 4 por lugar entrable. */
const PLACE_ANGLES = [-60, -20, 20, 60];
const PLACE_SPOTS = PLACE_ANGLES.length;
const PLACE_R = 3;
const PLACE_R_MIN = 2.25;
const PLACE_R_MAX = 3.75;
/** Lugar: dos puntos del mismo lugar quedan al menos a esto (no se pisan sus objetos ni sus cajas de munición). */
const PLACE_SEP = 1.5;

const r2 = (n: number): number => rn(n, 2);
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

interface Ctx {
  map: MapData;
  world: CollisionWorld;
  vehicular: Road[];
  roadGrid: ReturnType<typeof createGrid>;
}

/** ¿El punto cae sobre una calzada vehicular, o a menos de CURB de su borde? */
function onRoadway(ctx: Ctx, p: Vec2): boolean {
  for (const k of ctx.roadGrid.query(bboxOf([p]))) {
    const r = ctx.vehicular[k];
    for (let i = 0; i + 1 < r.points.length; i++) if (distPointSegment(p, r.points[i], r.points[i + 1]) < r.width / 2 + CURB) return true;
  }
  return false;
}

/** Punto en el piso donde entra el botín: libre como un punto de aparición (isFreeSpot), con CLEAR m sin sólidos
 *  alrededor y, salvo que se pida lo contrario, fuera de la calzada. */
function groundOk(ctx: Ctx, x: number, z: number, offRoad = true): boolean {
  return isFreeSpot(ctx.world, x, z) && !ctx.world.overlaps(x, z, CLEAR, 0.05, PLAYER.height) && !(offRoad && onRoadway(ctx, [x, z]));
}

const farFrom = (p: Vec2, taken: readonly Vec2[], gap: number): boolean => taken.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= gap);

/**
 * Lugar: PLACE_SPOTS puntos en semicírculo frente al cartel de cada lugar entrable, a 2–4 m y sobre la vereda. Cada
 * uno busca, cerca de su punto ideal (PLACE_R, PLACE_ANGLES), el primero libre y a PLACE_SEP de los anteriores. Si frente
 * al cartel no hay vereda (una planta de Microsoft que se la come), los que falten van sobre la calzada: en el mapa real
 * no pasa (lo controla tests/mapgen/loot-spots.test.ts).
 */
function placeSpots(ctx: Ctx): { spots: LootSpot[]; short: string[] } {
  const spots: LootSpot[] = [];
  const short: string[] = [];
  const cands: { r: number; a: number }[] = [];
  for (let r = PLACE_R_MIN; r <= PLACE_R_MAX + 1e-9; r += 0.25) for (let a = -80; a <= 80; a += 5) cands.push({ r, a });
  const byIdeal = PLACE_ANGLES.map((ideal) => {
    const cost = (c: { r: number; a: number }): number => Math.abs(c.a - ideal) + 10 * Math.abs(c.r - PLACE_R);
    return cands.map((c, i) => ({ c, i, k: cost(c) })).sort((u, v) => u.k - v.k || u.i - v.i).map((e) => e.c);
  });
  for (const place of ctx.map.places) {
    if (!place.enterable) continue;
    const sign = place.sign;
    if (!sign) { short.push(place.id); continue; }
    const n = unit(sign.normal);
    const mine: Vec2[] = [];
    let missing = byIdeal;
    for (const offRoad of [true, false]) {
      missing = missing.filter((order) => {
        for (const c of order) {
          const t = (c.a * Math.PI) / 180;
          const d: Vec2 = [n[0] * Math.cos(t) - n[1] * Math.sin(t), n[0] * Math.sin(t) + n[1] * Math.cos(t)];
          const p: Vec2 = [r2(sign.anchor[0] + d[0] * c.r), r2(sign.anchor[1] + d[1] * c.r)];
          if (!farFrom(p, mine, PLACE_SEP) || !groundOk(ctx, p[0], p[1], offRoad)) continue;
          mine.push(p);
          return false;
        }
        return true;
      });
    }
    if (mine.length < PLACE_SPOTS) short.push(place.id);
    for (const p of mine) spots.push({ pos: [p[0], 0, p[1]], tier: 'lugar' });
  }
  return { spots, short };
}

/**
 * Calle: un punto cada STREET_STEP m de cada calle vehicular, en el medio de la vereda, alternando el lado (el primero,
 * sorteado por calle). Si el punto ideal no está libre se corre a lo largo de la vereda; si tampoco, prueba la de
 * enfrente. Queda a STREET_GAP de los ya puestos (también de los de los lugares).
 */
function streetSpots(ctx: Ctx, taken: Vec2[]): LootSpot[] {
  const out: LootSpot[] = [];
  for (const r of ctx.vehicular) {
    if (r.sidewalk <= 0 || r.points.length < 2) continue;
    const lens = r.points.slice(1).map((q, i) => Math.hypot(q[0] - r.points[i][0], q[1] - r.points[i][1]));
    const total = lens.reduce((t, l) => t + l, 0);
    const off = r.width / 2 + r.sidewalk / 2;
    /** Punto de la vereda del lado `side` a `s` m del comienzo de la calle. */
    const at = (s: number, side: number): Vec2 | null => {
      let seg = 0, acc = 0;
      while (seg < lens.length - 1 && acc + lens[seg] < s) acc += lens[seg++];
      if (lens[seg] === 0) return null;
      const a = r.points[seg], b = r.points[seg + 1];
      const t = (s - acc) / lens[seg];
      const dx = (b[0] - a[0]) / lens[seg], dz = (b[1] - a[1]) / lens[seg];
      return [r2(a[0] + (b[0] - a[0]) * t - dz * off * side), r2(a[1] + (b[1] - a[1]) * t + dx * off * side)];
    };
    const first = hash01(`botin:${r.id}`) < 0.5 ? 1 : -1;
    for (let k = 0; (k + 0.5) * STREET_STEP <= total; k++) {
      const s0 = (k + 0.5) * STREET_STEP;
      const side = k % 2 === 0 ? first : -first;
      let found: Vec2 | null = null;
      for (const sd of [side, -side]) {
        for (const dn of STREET_NUDGE) {
          const s = s0 + dn;
          if (s < 0 || s > total) continue;
          const p = at(s, sd);
          if (p && farFrom(p, taken, STREET_GAP) && groundOk(ctx, p[0], p[1])) { found = p; break; }
        }
        if (found) break;
      }
      if (!found) continue;
      taken.push(found);
      out.push({ pos: [found[0], 0, found[1]], tier: 'calle' });
    }
  }
  return out;
}

/**
 * Edificios a cuyo techo se sube: su cluster de techos (roofClusters) tiene una escalera, o un contenedor pegado a un
 * techo al que se llega desde arriba del contenedor. Es el criterio de pockets.ts (accessibleBuildings) sin pedir que
 * el pie de la ayuda esté en el suelo principal: después de exitPockets todo hueco tiene salida a un techo alcanzable,
 * así que también se entra a él (bajando de ese techo), y su ayuda sirve.
 */
function reachableRoofs(map: MapData): Set<string> {
  const clusterOf = new Map<string, number>();
  roofClusters(map.buildings).forEach((c, i) => c.forEach((id) => clusterOf.set(id, i)));
  const grid = createGrid(map.buildings.map((b) => bboxOf(b.footprint)));
  const ok = new Set<number>();
  for (const p of map.props) {
    if (p.kind === 'ladder') ok.add(clusterOf.get(p.buildingId)!);
    else if (p.kind === 'dumpster') {
      for (const j of grid.query(bboxOf([p.position], DUMPSTER.length))) {
        const b = map.buildings[j];
        if (roofEdgeY(b) > DUMPSTER.height + PLAYER.mantleReach + 1e-6) continue; // desde arriba, al tope del pretil
        if (pointInPolygon(p.position, b.footprint) || distToRing(p.position, b.footprint) > DUMPSTER.depth / 2 + 0.3) continue;
        ok.add(clusterOf.get(b.id)!);
      }
    }
  }
  return new Set(map.buildings.filter((b) => ok.has(clusterOf.get(b.id)!)).map((b) => b.id));
}

interface Cell { x: number; z: number; h: number; d: number; max: number }

/**
 * El punto de adentro de la planta más lejano a sus bordes y esa distancia, a `precision` m (polo de inaccesibilidad,
 * como polylabel de Mapbox: celdas que se parten mientras puedan mejorar el mejor punto encontrado).
 */
export function farthestFromEdges(fp: Vec2[], precision = POLE_PRECISION): { p: Vec2; d: number } {
  const bb = bboxOf(fp);
  const size = Math.min(bb.maxX - bb.minX, bb.maxZ - bb.minZ);
  if (!(size > 0)) return { p: [bb.minX, bb.minZ], d: 0 };
  const cell = (x: number, z: number, h: number): Cell => {
    const d = (pointInPolygon([x, z], fp) ? 1 : -1) * distToRing([x, z], fp);
    return { x, z, h, d, max: d + h * Math.SQRT2 };
  };
  const queue: Cell[] = []; // de menor a mayor `max`: la última es la más prometedora
  const push = (c: Cell): void => {
    let lo = 0, hi = queue.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (queue[m].max < c.max) lo = m + 1; else hi = m; }
    queue.splice(lo, 0, c);
  };
  const half = size / 2;
  for (let x = bb.minX; x < bb.maxX; x += size) for (let z = bb.minZ; z < bb.maxZ; z += size) push(cell(x + half, z + half, half));
  let best = cell((bb.minX + bb.maxX) / 2, (bb.minZ + bb.maxZ) / 2, 0);
  while (queue.length > 0) {
    const c = queue.pop()!;
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) break; // ninguna de las que quedan mejora más que la precisión
    const h = c.h / 2;
    push(cell(c.x - h, c.z - h, h)); push(cell(c.x + h, c.z - h, h)); push(cell(c.x - h, c.z + h, h)); push(cell(c.x + h, c.z + h, h));
  }
  return { p: [best.x, best.z], d: best.d };
}

/**
 * Techo: uno por edificio (no relleno) de más de ROOF_MIN_AREA m² con techo alcanzable, en el punto del techo más lejano
 * a los bordes. Tiene que quedar a CLEAR del pretil y de todo sólido, adentro del área, y a ROOF_GAP de los techos ya
 * puestos: se recorren del más alto al más bajo.
 */
function roofSpots(ctx: Ctx): LootSpot[] {
  const { map, world } = ctx;
  const reach = reachableRoofs(map);
  const bd = map.bounds;
  const cands = map.buildings
    .map((b, i) => ({ b, i, area: polygonArea(b.footprint) }))
    .filter((c) => !c.b.fill && c.area > ROOF_MIN_AREA && reach.has(c.b.id))
    .sort((u, v) => v.b.height - u.b.height || v.area - u.area || u.i - v.i);
  const taken: Vec2[] = [];
  const out: LootSpot[] = [];
  for (const { b } of cands) {
    const pole = farthestFromEdges(b.footprint);
    if (pole.d < PARAPET_T + CLEAR) continue; // ni en el punto más ancho queda a CLEAR del pretil (atajo del chequeo de abajo)
    const [x, z] = [r2(pole.p[0]), r2(pole.p[1])];
    if (x < bd.minX + 1 || x > bd.maxX - 1 || z < bd.minZ + 1 || z > bd.maxZ - 1) continue;
    if (world.overlaps(x, z, CLEAR, b.height + 0.05, b.height + PLAYER.height)) continue;
    if (Math.abs(world.supportHeight(x, z, PLAYER.radius, b.height + 0.01) - b.height) > 1e-6) continue;
    if (!farFrom([x, z], taken, ROOF_GAP)) continue;
    taken.push([x, z]);
    out.push({ pos: [x, b.height, z], tier: 'techo' });
  }
  return out;
}

/** Los puntos de botín del mapa: los de la calle, los de los techos y los de los lugares, en ese orden. `world`: el
 *  mundo de colisiones del mapa terminado (con los props y las ayudas de ascenso). */
export function lootSpots(map: MapData, world: CollisionWorld): LootSpot[] {
  return placeLootSpots(map, world).spots;
}

/** Como `lootSpots`, con un aviso por cada lugar entrable que no consiguió sus PLACE_SPOTS puntos (rompe el build). */
export function placeLootSpots(map: MapData, world: CollisionWorld): { spots: LootSpot[]; warnings: string[] } {
  const vehicular = map.roads.filter((r) => !NON_VEHICULAR.has(r.kind));
  const ctx: Ctx = { map, world, vehicular, roadGrid: createGrid(vehicular.map((r) => bboxOf(r.points, r.width / 2 + CURB))) };
  const places = placeSpots(ctx);
  const street = streetSpots(ctx, places.spots.map((s) => [s.pos[0], s.pos[2]]));
  return {
    spots: [...street, ...roofSpots(ctx), ...places.spots],
    warnings: places.short.map((id) => `${id}: no entran los ${PLACE_SPOTS} puntos de botín frente al cartel`),
  };
}
