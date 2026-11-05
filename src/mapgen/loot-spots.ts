// Puntos de botín del mapa (spec 2a §5), en tres niveles: veredas de las calles vehiculares, techos alcanzables y los
// pisos públicos de los interiores de los lugares entrables (§2.5 de la etapa 2b, D11). Qué sale en cada uno se sortea
// al empezar la partida (src/shared/loot.ts). Todo es geométrico y determinista: el mismo mapa da los mismos puntos.
import { DUMPSTER, PARAPET_T, buildCollisionWorld, roofEdgeY } from '../shared/collision.ts';
import type { CollisionWorld } from '../shared/collision.ts';
import { distPointSegment, hash01, pointInPolygon, polygonArea, toLocal, toWorld } from '../shared/geo.ts';
import type { Vec2, Vec3 } from '../shared/geo.ts';
import { buildInteriors, publicFloorArea } from '../shared/interiors/index.ts';
import type { Interior } from '../shared/interiors/types.ts';
import type { Frame, LootSpot, MapData, Road, RoadKind } from '../shared/mapdata.ts';
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
/** Calle: dos puntos (o uno y la puerta principal de un lugar con interior) quedan al menos a esto. También saca los
 *  repetidos de los cruces y de las calles que OSM parte en varios tramos. */
const STREET_GAP = 50;
/** Calle: si el punto ideal no está libre (un árbol, un poste), se corre a lo largo de la vereda hasta esto. */
const STREET_NUDGE = [0, 1, -1, 2, -2, 3, -3, 4, -4];

/** Techo: solo los de más de esto (m²). */
const ROOF_MIN_AREA = 60;
/** Techo: dos puntos quedan al menos a esto (en planta); se ubican del techo más alto al más bajo. */
const ROOF_GAP = 50;
/** Techo: precisión (m) del punto más lejano a los bordes. */
const POLE_PRECISION = 0.05;

/** Lugar (D11): un punto cada PLACE_M2 m² de piso público, entre PLACE_MIN y PLACE_MAX por interior. */
const PLACE_M2 = 40;
const PLACE_MIN = 4;
const PLACE_MAX = 12;
/** Lugar: dos puntos del mismo lugar (o uno de un lugar y uno de un techo) quedan al menos a esto, en 3D: no se pisan
 *  sus objetos ni sus cajas de munición. */
const PLACE_SEP = 1.5;
/** Lugar: paso (m) de la grilla de cada piso, en el marco del interior (a lo largo del frente y hacia adentro). Por una
 *  puerta de 1 m al centro del jugador le quedan 0,3 m: con 0,2 m siempre hay una hilera de celdas que pasa, a cualquier
 *  ángulo (con vecinos en diagonal). */
const PLACE_GRID = 0.2;
/** Lugar: el recorrido arranca a esto (m) adentro de la cara de afuera de la puerta principal (D10)... */
const DOOR_IN = 0.6;
/** ...en la celda libre más cercana, a lo sumo a esto (m). También engancha el pie y la llegada de cada escalera. */
const LINK_R = 1;

/** D11: cuántos puntos de botín le tocan a un interior con `area` m² de piso público. */
export const placeLootCount = (area: number): number => Math.min(PLACE_MAX, Math.max(PLACE_MIN, Math.round(area / PLACE_M2)));

const r2 = (n: number): number => rn(n, 2);

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

/** La grilla de PLACE_GRID m de un piso, celda por celda (`a` a lo largo de U, `b` de V: la celda a·rows + b): el punto
 *  (mundo, redondeado a 2 decimales), si el jugador se para ahí (`free`) y si se llega caminando (`reached`). */
export interface FloorGrid { y: number; rows: number; x: Float64Array; z: Float64Array; free: Uint8Array; reached: Uint8Array }

/** Lo de un interior que hace falta para saber a dónde se llega caminando. */
type Walk = Pick<Interior, 'floors' | 'doors' | 'stairs'>;

/** La grilla de PLACE_GRID m del piso `k` de `i` en el marco `frame`: las celdas sobre su planta, fuera de los huecos,
 *  donde isFreeSpot da true a la altura del piso. */
function floorGrid(world: CollisionWorld, i: Walk, k: number, frame: Frame): FloorGrid {
  const f = i.floors[k];
  const loc = f.polygon.map((p) => toLocal(frame, p));
  const [a0, a1] = [Math.ceil(Math.min(...loc.map((p) => p[0])) / PLACE_GRID), Math.floor(Math.max(...loc.map((p) => p[0])) / PLACE_GRID)];
  const [b0, b1] = [Math.ceil(Math.min(...loc.map((p) => p[1])) / PLACE_GRID), Math.floor(Math.max(...loc.map((p) => p[1])) / PLACE_GRID)];
  const rows = b1 - b0 + 1, n = (a1 - a0 + 1) * rows;
  const g: FloorGrid = { y: f.y, rows, x: new Float64Array(n), z: new Float64Array(n), free: new Uint8Array(n), reached: new Uint8Array(n) };
  for (let a = a0; a <= a1; a++) {
    for (let b = b0; b <= b1; b++) {
      const c = (a - a0) * rows + (b - b0);
      const w = toWorld(frame, [a * PLACE_GRID, b * PLACE_GRID]);
      const p: Vec2 = [r2(w[0]), r2(w[1])];
      g.x[c] = p[0];
      g.z[c] = p[1];
      g.free[c] = pointInPolygon(p, f.polygon) && !f.holes.some((h) => pointInPolygon(p, h)) && isFreeSpot(world, p[0], p[1], f.y) ? 1 : 0;
    }
  }
  return g;
}

/** La celda libre de `g` más cercana a `p`, a menos de LINK_R (en empate, la primera), o −1. */
function nearestFree(g: FloorGrid, p: Vec2): number {
  let best = -1, bestD = LINK_R;
  for (let c = 0; c < g.free.length; c++) {
    if (!g.free[c]) continue;
    const d = Math.hypot(g.x[c] - p[0], g.z[c] - p[1]);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

/** Marca como alcanzadas las celdas libres unidas a `seed` (vecinas de lado o de esquina). */
function flood(g: FloorGrid, seed: number): void {
  if (seed < 0 || g.reached[seed]) return;
  const cols = g.free.length / g.rows;
  const queue = [seed];
  g.reached[seed] = 1;
  while (queue.length > 0) {
    const c = queue.pop()!;
    const [a, b] = [Math.floor(c / g.rows), c % g.rows];
    for (let da = -1; da <= 1; da++) {
      for (let db = -1; db <= 1; db++) {
        const [na, nb] = [a + da, b + db];
        if (na < 0 || nb < 0 || na >= cols || nb >= g.rows) continue;
        const nc = na * g.rows + nb;
        if (g.free[nc] && !g.reached[nc]) {
          g.reached[nc] = 1;
          queue.push(nc);
        }
      }
    }
  }
}

/**
 * Las celdas de cada piso público de `i` a las que se llega caminando desde la puerta principal: por el piso (celdas
 * libres vecinas) y de un piso a otro por sus escaleras (Interior.stairs: el pie y la llegada, cada uno en su piso). Lo
 * que no se alcanza así (un cuarto cerrado, lo alto de unas gradas, la oficina de la boletería) no lleva botín.
 */
export function walkable(world: CollisionWorld, i: Walk, frame: Frame): FloorGrid[] {
  const grids = i.floors.map((_, k) => floorGrid(world, i, k, frame));
  const at = (level: number, y: number): number => i.floors.findIndex((f) => f.level === level && Math.abs(f.y - y) < 1e-6);
  const door = i.doors[0];
  const k0 = i.floors.findIndex((f) => f.level === door.level);
  if (k0 >= 0) flood(grids[k0], nearestFree(grids[k0], [door.at[0] - door.normal[0] * DOOR_IN, door.at[1] - door.normal[1] * DOOR_IN]));
  // cada escalera une el piso de su pie con el de su llegada, para los dos lados, hasta que no cambie nada
  const links = i.stairs.map((s) => {
    const [kf, kt] = [at(s.from, s.foot[1]), at(s.to, s.top[1])];
    return kf < 0 || kt < 0 || kf === kt ? null : { kf, kt, cf: nearestFree(grids[kf], [s.foot[0], s.foot[2]]), ct: nearestFree(grids[kt], [s.top[0], s.top[2]]) };
  }).filter((l) => l !== null && l.cf >= 0 && l.ct >= 0) as { kf: number; kt: number; cf: number; ct: number }[];
  for (let changed = true; changed;) {
    changed = false;
    for (const l of links) {
      const [f, t] = [grids[l.kf].reached[l.cf], grids[l.kt].reached[l.ct]];
      if (f && !t) flood(grids[l.kt], l.ct);
      else if (t && !f) flood(grids[l.kf], l.cf);
      else continue;
      changed = true;
    }
  }
  return grids;
}

/** Cuántos de `n` le tocan a cada piso según su área: la parte entera de la proporción y, lo que sobra, a los de mayor
 *  resto (en empate, el de nivel más bajo y, en el mismo nivel, el primero de `floors`). */
export function shares(floors: readonly { area: number; level: number }[], n: number): number[] {
  const total = floors.reduce((a, f) => a + f.area, 0);
  const exact = floors.map((f) => (total > 0 ? (n * f.area) / total : 0));
  const out = exact.map(Math.floor);
  const order = exact.map((e, k) => ({ k, r: e - Math.floor(e) }))
    .sort((u, v) => v.r - u.r || floors[u.k].level - floors[v.k].level || u.k - v.k);
  for (let j = 0; j < n - out.reduce((a, b) => a + b, 0); j++) out[order[j].k]++;
  return out;
}

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Lugar (§2.5 de la etapa 2b, D11): en cada interior, placeLootCount(publicFloorArea) puntos sobre sus pisos públicos
 * (el techado más la terraza), repartidos entre los pisos según su área (shares). Cada uno es una celda a la que se llega
 * caminando desde la puerta principal (walkable), con CLEAR m libres de todo sólido entre 5 cm y el alto del jugador
 * sobre su piso, y a CLEAR de la pared y de los huecos de ese piso (la caja de munición no cae por el hueco de una
 * escalera). Se eligen por punto más lejano: el primero, el más lejos de la puerta principal; cada uno de los que siguen,
 * el más lejos de la puerta y de los ya elegidos (en 3D; en empate, la primera celda en el orden de los pisos y de la
 * grilla), a ≥ PLACE_SEP de todos ellos y de los puntos de techo (`taken`). Si no entran todos, avisa. `armed`: los
 * interiores de map.interiors ya armados, en el mismo orden; `world`: el mundo del juego, con sus edificios huecos.
 */
function interiorSpots(map: MapData, world: CollisionWorld, armed: readonly Interior[], taken: readonly LootSpot[]): { spots: LootSpot[]; warnings: string[] } {
  const spots: LootSpot[] = [];
  const warnings: string[] = [];
  armed.forEach((i, idx) => {
    const frame = map.interiors[idx].frame;
    const n = placeLootCount(publicFloorArea(i));
    const quota = shares(i.floors, n);
    const grids = walkable(world, i, frame);
    const near = taken.filter((t) => pointInPolygon([t.pos[0], t.pos[2]], i.footprint)).map((t) => t.pos);
    const cands: { p: Vec3; k: number }[] = [];
    grids.forEach((g, k) => {
      const f = i.floors[k];
      for (let c = 0; c < g.reached.length; c++) {
        if (!g.reached[c]) continue;
        const p: Vec3 = [g.x[c], f.y, g.z[c]];
        const xz: Vec2 = [p[0], p[2]];
        if (world.overlaps(p[0], p[2], CLEAR, f.y + 0.05, f.y + PLAYER.height)) continue;
        if (distToRing(xz, f.polygon) < CLEAR || f.holes.some((h) => distToRing(xz, h) < CLEAR)) continue;
        if (near.some((q) => dist3(p, q) < PLACE_SEP)) continue;
        cands.push({ p, k });
      }
    });
    const door = i.doors[0];
    const doorY = i.floors.find((f) => f.level === door.level)?.y ?? 0;
    const from: Vec3 = [door.at[0] - door.normal[0] * DOOR_IN, doorY, door.at[1] - door.normal[1] * DOOR_IN];
    const minD = Float64Array.from(cands, (c) => dist3(c.p, from));
    const left = quota.slice();
    let placed = 0;
    for (;;) {
      let best = -1;
      for (let c = 0; c < cands.length; c++) if (left[cands[c].k] > 0 && minD[c] >= PLACE_SEP && (best < 0 || minD[c] > minD[best])) best = c;
      if (best < 0) break;
      const p = cands[best].p;
      spots.push({ pos: p, tier: 'lugar' });
      left[cands[best].k]--;
      placed++;
      for (let c = 0; c < cands.length; c++) minD[c] = Math.min(minD[c], dist3(cands[c].p, p));
    }
    if (placed < n) warnings.push(`${i.placeId}: entran ${placed} de ${n} puntos de botín adentro`);
  });
  return { spots, warnings };
}

/**
 * Calle: un punto cada STREET_STEP m de cada calle vehicular, en el medio de la vereda, alternando el lado (el primero,
 * sorteado por calle). Si el punto ideal no está libre se corre a lo largo de la vereda; si tampoco, prueba la de
 * enfrente. Queda a STREET_GAP (en planta) de los ya puestos y de `taken`, la puerta principal de cada lugar con
 * interior: la vereda de la entrada de un lugar con interior queda a ≥ STREET_GAP de su puerta principal, porque su
 * botín está adentro.
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
 *  mundo de colisiones del mapa terminado (con los props y las ayudas de ascenso) para la calle y los techos. Los de los
 *  lugares van adentro de sus interiores: `armed`, los de map.interiors ya armados (buildInteriors, en el mismo orden), y
 *  `hollow`, el mundo del juego, con esos edificios huecos (buildCollisionWorld(map, armed)). Si no vienen, se arman. */
export function lootSpots(map: MapData, world: CollisionWorld, armed = buildInteriors(map), hollow = buildCollisionWorld(map, armed)): LootSpot[] {
  return placeLootSpots(map, world, armed, hollow).spots;
}

/** Como `lootSpots`, con un aviso por cada interior donde no entraron todos sus puntos (rompe el build). */
export function placeLootSpots(map: MapData, world: CollisionWorld, armed: readonly Interior[], hollow: CollisionWorld): { spots: LootSpot[]; warnings: string[] } {
  const vehicular = map.roads.filter((r) => !NON_VEHICULAR.has(r.kind));
  const ctx: Ctx = { map, world, vehicular, roadGrid: createGrid(vehicular.map((r) => bboxOf(r.points, r.width / 2 + CURB))) };
  const roofs = roofSpots(ctx);
  const places = interiorSpots(map, hollow, armed, roofs);
  const street = streetSpots(ctx, map.places.flatMap((p) => (p.door ? [p.door] : [])));
  return { spots: [...street, ...roofs, ...places.spots], warnings: places.warnings };
}
