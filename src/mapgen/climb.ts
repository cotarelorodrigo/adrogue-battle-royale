import { DUMPSTER, PARAPET_H, PARAPET_T, roofEdgeY } from '../shared/collision.ts';
import { areaRect, distPointSegment, pointInPolygon, polygonArea } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Building, Prop, Road } from '../shared/mapdata.ts';
import { PLAYER } from '../shared/player.ts';
import { outwardNormal } from './places.ts';
import { bboxOf, createGrid, polygonDist, segToPolygonDist } from './spatial.ts';
import type { Box } from './spatial.ts';

export const MANTLE_REACH = 2.4;

const LINK_DIST = 1.0;
const AREA_PER_AID = 1500;
const MIN_STREET_EDGE = 3;
const RAY_LEN = 5;
/** Un contenedor sirve si desde arriba el mantle llega al tope del pretil (los techos de un piso); si no, escalera. */
const DUMPSTER_MAX_H = DUMPSTER.height + MANTLE_REACH - PARAPET_H + 0.05;
const DUMPSTER_LEN = DUMPSTER.length;
const DUMPSTER_DEPTH = DUMPSTER.depth;
const DUMPSTER_GAP = 0.2;
const LADDER_W = 0.8;
const LADDER_D = 0.6;
const AREA_MARGIN = 1;
const NON_VEHICULAR = new Set(['footway', 'pedestrian', 'service']);
/** En la fachada de un lote, la ayuda queda a SLOT_END de la punta, y el cartel y el toldo empiezan SLOT_GAP más allá. */
const SLOT_END = 0.1;
const SLOT_GAP = 0.2;
/** Arriba de una escalera, el controlador deja al jugador a esto de la pared, sobre el techo (MANTLE_PUSH de player.ts). */
const LADDER_TOP_PUSH = 0.6;
/** Ahí el jugador tiene que quedar a esto del borde de la planta: sin tocar el pretil (PARAPET_T adentro), cae al techo.
 *  Si no, queda arriba del pretil de la medianera y, con W, camina por encima. */
const LANDING_CLEAR = PARAPET_T + PLAYER.radius + 0.03;
/** Paso con que la escalera de un lote se aleja de la punta hasta que su llegada queda libre. */
const SLOT_STEP = 0.05;
/** Una arista de la planta es de la fachada si sus dos puntas quedan a esta distancia de la línea del frente (como
 *  frontEdgesOf de lots.ts). */
const ON_FRONT = 0.15;
/** Hasta dónde se busca una calle alrededor de una arista de lote que no es la fachada (más que cualquier vereda). */
const FACES_ROAD_PAD = 6;

/** Punta de la corrida principal de un lote: `inicio` es la de `desde`, `fin` la de `hasta`. */
export type Punta = 'inicio' | 'fin';
/** Un lote relevado, para las ayudas: su fachada sobre la planta (de `desde` a `hasta`) y las puntas donde puede ir una
 *  ayuda, en orden de preferencia. `aid`: la escalera relevada de una planta (plantas.json, `escalera`), con su medio
 *  sobre la cara, la normal hacia afuera y la tangente: va ahí y en ninguna otra arista, aunque esa cara no dé a una
 *  calle (alcanza con que se llegue: opensToStreet). */
export interface LotFront { line: Vec2[]; puntas: Punta[]; aid?: { mid: Vec2; n: Vec2; d: Vec2 } }
/** Por lote: cuántos metros de la corrida principal ocupa una ayuda desde cada punta, con su margen; el cartel y el toldo
 *  dejan ese tramo libre. */
export type AidSlots = Map<string, Partial<Record<Punta, number>>>;

interface Index { buildings: Building[]; grid: { query(box: Box): number[] } }

function indexOf(buildings: Building[]): Index {
  return { buildings, grid: createGrid(buildings.map((b) => bboxOf(b.footprint))) };
}

/** Grupos de edificios cuyos techos se alcanzan entre sí: footprints a ≤ 1 m y |Δh| ≤ MANTLE_REACH. */
export function roofClusters(buildings: Building[]): string[][] {
  return clustersOf(indexOf(buildings));
}

function clustersOf(ix: Index): string[][] {
  const bs = ix.buildings;
  const parent = bs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  bs.forEach((b, i) => {
    const q: Box = bboxOf(b.footprint, LINK_DIST);
    for (const j of ix.grid.query(q)) {
      if (j <= i || Math.abs(bs[j].height - b.height) > MANTLE_REACH + 1e-9) continue;
      if (find(i) === find(j)) continue;
      if (polygonDist(b.footprint, bs[j].footprint) <= LINK_DIST) parent[find(j)] = find(i);
    }
  });
  const groups = new Map<number, number[]>();
  bs.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()].sort((a, b) => a[0] - b[0]).map((g) => g.map((i) => bs[i].id));
}

interface Edge {
  bi: number; // índice del edificio
  i: number;
  len: number;
  mid: Vec2;
  n: Vec2;
  d: Vec2; // tangente unitaria a→b
  street: boolean;
  /** Solo en la fachada de un lote: la ayuda va en esta punta y ocupa `largo` m de la corrida. */
  slot?: { punta: Punta; largo: number };
  aid?: Aid; // ayuda que iría en esta arista (perezoso)
  inside?: boolean; // la ayuda queda a ≥ 1 m del borde del área (perezoso)
  free?: boolean; // caja del acceso fuera de calzada y de otros edificios (perezoso)
}

interface Aid { prop: Prop; pos: Vec2; box: Vec2[] }

interface Ctx {
  ix: Index;
  roadBoxes: Box[];
  roadGrid: { query(box: Box): number[] };
  vehicular: Road[];
  edges: Map<number, Edge[]>;
  rect: { minX: number; maxX: number; minZ: number; maxZ: number };
  lots: Map<string, LotFront>;
}

/** ¿El rayo de RAY_LEN m desde `mid` hacia `n` sale sin tocar otro edificio? */
function opensToStreet(ctx: Ctx, bi: number, mid: Vec2, n: Vec2): boolean {
  const end: Vec2 = [mid[0] + n[0] * RAY_LEN, mid[1] + n[1] * RAY_LEN];
  for (const j of ctx.ix.grid.query(bboxOf([mid, end]))) {
    if (j !== bi && segToPolygonDist(mid, end, ctx.ix.buildings[j].footprint) === 0) return false;
  }
  return true;
}

/** ¿Un metro afuera de `mid` ya es vereda o calzada de una calle vehicular? Se llega desde la calle sin dudas. */
function facesRoad(ctx: Ctx, mid: Vec2, n: Vec2): boolean {
  const q: Vec2 = [mid[0] + n[0], mid[1] + n[1]];
  for (const k of ctx.roadGrid.query(bboxOf([q], FACES_ROAD_PAD))) {
    const r = ctx.vehicular[k];
    const reach = r.width / 2 + r.sidewalk + 0.5;
    for (let s = 0; s + 1 < r.points.length; s++) if (distPointSegment(q, r.points[s], r.points[s + 1]) <= reach) return true;
  }
  return false;
}

const nearLine = (p: Vec2, line: Vec2[]): boolean => line.some((q, i) => i > 0 && distPointSegment(p, line[i - 1], q) <= ON_FRONT);

/** ¿Arriba de una escalera con base en `base` (normal exterior n) el jugador queda lejos de todo borde de la planta? */
function landingClear(fp: Vec2[], base: Vec2, n: Vec2): boolean {
  const q: Vec2 = [base[0] - n[0] * LADDER_TOP_PUSH, base[1] - n[1] * LADDER_TOP_PUSH];
  return pointInPolygon(q, fp) && fp.every((a, i) => distPointSegment(q, a, fp[(i + 1) % fp.length]) >= LANDING_CLEAR);
}

/**
 * Aristas candidatas en la fachada de un lote: una por punta pedida, con la ayuda pegada a esa punta (en el primer tramo
 * recto, desde la punta, donde entra entera) y no en el medio, donde taparía el cartel y la vidriera. Una escalera se
 * corre lo justo para que arriba el jugador no quede sobre el pretil de la medianera.
 */
function slotEdges(ctx: Ctx, bi: number, lot: LotFront): Edge[] {
  const b = ctx.ix.buildings[bi];
  const ladder = b.height > DUMPSTER_MAX_H;
  const half = (ladder ? LADDER_W : DUMPSTER_LEN) / 2;
  const line = lot.line;
  const lens = line.slice(1).map((q, i) => Math.hypot(q[0] - line[i][0], q[1] - line[i][1]));
  const total = lens.reduce((t, l) => t + l, 0);
  if (total < MIN_STREET_EDGE) return [];
  const out: Edge[] = [];
  for (const punta of lot.puntas) {
    const order = lens.map((_, k) => k);
    if (punta === 'fin') order.reverse();
    let from = 0; // de la punta al comienzo del tramo k
    for (const k of order) {
      const len = lens[k];
      if (len >= 2 * (SLOT_END + half)) {
        const [p, q] = punta === 'inicio' ? [line[k], line[k + 1]] : [line[k + 1], line[k]];
        const d: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
        const along = (t: number): Vec2 => [p[0] + d[0] * t, p[1] + d[1] * t];
        let s = SLOT_END + half;
        let n: Vec2 = [-d[1], d[0]];
        if (pointInPolygon([along(s)[0] + n[0] * 0.05, along(s)[1] + n[1] * 0.05], b.footprint)) n = [d[1], -d[0]];
        // la escalera se aleja de la punta hasta que arriba no deja al jugador sobre el pretil de la medianera
        while (ladder && s + half + SLOT_END <= len && !landingClear(b.footprint, along(s), n)) s += SLOT_STEP;
        const mid = along(s);
        const largo = from + s + half + SLOT_GAP;
        if (largo <= total && s + half + SLOT_END <= len) out.push({ bi, i: -1, len, mid, n, d, street: opensToStreet(ctx, bi, mid, n), slot: { punta, largo } });
        break;
      }
      from += len;
    }
  }
  return out;
}

function edgesOf(ctx: Ctx, bi: number): Edge[] {
  const cached = ctx.edges.get(bi);
  if (cached) return cached;
  const b = ctx.ix.buildings[bi];
  const fp = b.footprint;
  const lot = ctx.lots.get(b.id);
  const out: Edge[] = [];
  if (lot?.aid) {
    const { mid, n, d } = lot.aid;
    out.push({ bi, i: -1, len: LADDER_W, mid, n, d, street: opensToStreet(ctx, bi, mid, n) });
    ctx.edges.set(bi, out);
    return out;
  }
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i];
    const c = fp[(i + 1) % fp.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 1e-6) continue;
    if (lot && nearLine(a, lot.line) && nearLine(c, lot.line)) continue; // la fachada de un lote: va por slotEdges
    const mid: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const n = outwardNormal(a, c);
    const d: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    // en un lote, otra arista que no sea la fachada sirve solo si da a una calle (la de la esquina): un fondo o una
    // medianera que dan a un patio pueden no tener salida, y entonces al techo no se llegaría desde la vereda
    const street = len >= MIN_STREET_EDGE && opensToStreet(ctx, bi, mid, n) && (!lot || facesRoad(ctx, mid, n));
    out.push({ bi, i, len, mid, n, d, street });
  }
  if (lot) out.push(...slotEdges(ctx, bi, lot));
  ctx.edges.set(bi, out);
  return out;
}

function makeAid(b: Building, e: Edge): Aid {
  if (b.height <= DUMPSTER_MAX_H) {
    const k = DUMPSTER_GAP + DUMPSTER_DEPTH / 2;
    const pos: Vec2 = [e.mid[0] + e.n[0] * k, e.mid[1] + e.n[1] * k];
    const hl = DUMPSTER_LEN / 2;
    const hd = DUMPSTER_DEPTH / 2;
    const corner = (s: number, t: number): Vec2 => [pos[0] + e.d[0] * hl * s + e.n[0] * hd * t, pos[1] + e.d[1] * hl * s + e.n[1] * hd * t];
    return {
      prop: { kind: 'dumpster', position: pos, rotation: Math.atan2(-e.d[1], e.d[0]) },
      pos,
      box: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
    };
  }
  const hw = LADDER_W / 2;
  const corner = (s: number, t: number): Vec2 => [e.mid[0] + e.d[0] * hw * s + e.n[0] * LADDER_D * t, e.mid[1] + e.d[1] * hw * s + e.n[1] * LADDER_D * t];
  return {
    // hasta el tope del pretil: el empuje de arriba de la escalera pasa por encima y deja al jugador sobre el techo
    prop: { kind: 'ladder', base: e.mid, normal: e.n, topY: roofEdgeY(b), buildingId: b.id },
    pos: e.mid,
    box: [corner(-1, 0), corner(1, 0), corner(1, 1), corner(-1, 1)],
  };
}

function isFree(ctx: Ctx, e: Edge, aid: Aid): boolean {
  if (e.free !== undefined) return e.free;
  const q = bboxOf(aid.box);
  let free = true;
  for (const j of ctx.ix.grid.query(q)) {
    if (j !== e.bi && polygonDist(aid.box, ctx.ix.buildings[j].footprint) === 0) {
      free = false;
      break;
    }
  }
  if (free) {
    for (const k of ctx.roadGrid.query({ minX: q.minX - 0.01, minZ: q.minZ - 0.01, maxX: q.maxX + 0.01, maxZ: q.maxZ + 0.01 })) {
      const r = ctx.vehicular[k];
      for (let s = 0; s + 1 < r.points.length && free; s++)
        if (polygonDist(aid.box, [r.points[s], r.points[s + 1]]) <= r.width / 2) free = false;
      if (!free) break;
    }
  }
  e.free = free;
  return free;
}

function aidOf(ctx: Ctx, e: Edge): Aid {
  return (e.aid ??= makeAid(ctx.ix.buildings[e.bi], e));
}

/** La ayuda (base y caja) queda a ≥ 1 m del borde del área jugable. */
function inArea(ctx: Ctx, e: Edge): boolean {
  if (e.inside !== undefined) return e.inside;
  const r = ctx.rect;
  const aid = aidOf(ctx, e);
  e.inside = [aid.pos, ...aid.box].every(([x, z]) => x >= r.minX + AREA_MARGIN && x <= r.maxX - AREA_MARGIN && z >= r.minZ + AREA_MARGIN && z <= r.maxZ - AREA_MARGIN);
  return e.inside;
}

function bestOf(ctx: Ctx, cands: Edge[], pick: (e: Edge) => number): { edge: Edge; tier: number } | null {
  // tier 0: caja libre; tier 1: cualquier arista a calle. En cada tier, la punta de la fachada de un lote va después de
  // las otras aristas. Gana el mayor `pick`, luego arista más larga, luego orden.
  for (const [tier, slot] of [[0, false], [0, true], [1, false], [1, true]] as const) {
    let best: Edge | null = null;
    let bestScore = -Infinity;
    for (const e of cands) {
      if (!e.street || !inArea(ctx, e) || (e.slot !== undefined) !== slot) continue;
      if (tier === 0 && !isFree(ctx, e, aidOf(ctx, e))) continue;
      const score = pick(e);
      if (best === null || score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && e.len > best.len + 1e-9)) {
        best = e;
        bestScore = score;
      }
    }
    if (best) return { edge: best, tier };
  }
  return null;
}

/** `noAid`: clusters con alguna arista candidata adentro del área que igual quedaron sin acceso (rompe el build).
 *  `noAidOutside`: clusters cuyas aristas candidatas caen todas fuera del área (edificios del borde): no se puede. */
export interface AidStats { clusters: number; dumpsters: number; ladders: number; tier0: number; tier1: number; fallback: number; noAid: number; noAidOutside: number }

/**
 * Como `placeClimbAids`, pero devuelve además cuántos clusters cayeron en cada nivel de preferencia.
 * `lots`: los lotes relevados (por id de edificio). En uno, la ayuda va en otra arista que dé a una calle (la de la
 * esquina) si la hay; si no, en una punta de la fachada y no en el medio, y `slots` dice cuánto ocupa (el cartel y el
 * toldo dejan ese tramo libre).
 */
export function placeClimbAidsWithStats(buildings: Building[], roads: Road[], lots: Map<string, LotFront> = new Map()): { props: Prop[]; stats: AidStats; slots: AidSlots } {
  const ix = indexOf(buildings);
  const vehicular = roads.filter((r) => !NON_VEHICULAR.has(r.kind));
  const roadBoxes = vehicular.map((r) => bboxOf(r.points, r.width / 2));
  const ctx: Ctx = { ix, roadBoxes, roadGrid: createGrid(roadBoxes), vehicular, edges: new Map(), rect: areaRect(), lots };
  const idx = new Map(buildings.map((b, i) => [b.id, i]));
  const props: Prop[] = [];
  const slots: AidSlots = new Map();
  const stats: AidStats = { clusters: 0, dumpsters: 0, ladders: 0, tier0: 0, tier1: 0, fallback: 0, noAid: 0, noAidOutside: 0 };

  for (const cluster of clustersOf(ix)) {
    stats.clusters++;
    const members = cluster.map((id) => idx.get(id)!);
    const area = members.reduce((s, i) => s + polygonArea(buildings[i].footprint), 0);
    const count = 1 + Math.floor(area / AREA_PER_AID);
    const placed: Aid[] = [];
    const push = (e: Edge): void => {
      const aid = aidOf(ctx, e);
      placed.push(aid);
      props.push(aid.prop);
      stats[aid.prop.kind === 'dumpster' ? 'dumpsters' : 'ladders']++;
      if (e.slot) {
        const id = buildings[e.bi].id;
        slots.set(id, { ...slots.get(id), [e.slot.punta]: e.slot.largo });
      }
    };

    // primer acceso: arista a calle del edificio más bajo; si no tiene, la de otro miembro (desde cualquier techo del
    // cluster se llega a los demás); si ninguno tiene, la arista más larga del más bajo
    let lowest = members[0];
    for (const i of members) if (buildings[i].height < buildings[lowest].height - 1e-9) lowest = i;
    const lowEdges = edgesOf(ctx, lowest);
    const first = bestOf(ctx, lowEdges, () => 0) ?? (members.length > 1 ? bestOf(ctx, members.flatMap((i) => edgesOf(ctx, i)), () => 0) : null);
    if (first) {
      push(first.edge);
      stats[first.tier === 0 ? 'tier0' : 'tier1']++;
    } else {
      // la arista más larga del más bajo, mejor si la caja de la ayuda queda libre (con otro edificio encima, el pie de
      // la escalera queda trabado)
      const longestOf = (es: Edge[]): Edge | undefined => {
        let best: Edge | undefined;
        for (const e of es) if (!best || e.len > best.len + 1e-9) best = e;
        return best;
      };
      const inside = lowEdges.filter((e) => inArea(ctx, e));
      const longest = longestOf(inside.filter((e) => isFree(ctx, e, aidOf(ctx, e)))) ?? longestOf(inside);
      if (longest) {
        push(longest);
        stats.fallback++;
      } else if (members.some((i) => edgesOf(ctx, i).some((e) => inArea(ctx, e)))) {
        stats.noAid++;
      } else {
        stats.noAidOutside++; // todas las aristas candidatas quedan fuera del área jugable
      }
    }

    // accesos extra: arista a calle más lejana de los ya colocados
    for (let k = 1; k < count; k++) {
      const cands = members.flatMap((i) => edgesOf(ctx, i)).filter((e) => placed.every((a) => Math.hypot(a.pos[0] - e.mid[0], a.pos[1] - e.mid[1]) > 1e-6));
      const far = (e: Edge): number => Math.min(...placed.map((a) => Math.hypot(a.pos[0] - e.mid[0], a.pos[1] - e.mid[1])));
      const pick = bestOf(ctx, cands, far);
      if (!pick) break;
      push(pick.edge);
    }
  }
  return { props, stats, slots };
}

export function placeClimbAids(buildings: Building[], roads: Road[], lots?: Map<string, LotFront>): Prop[] {
  return placeClimbAidsWithStats(buildings, roads, lots).props;
}
