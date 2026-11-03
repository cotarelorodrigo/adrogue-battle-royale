import { distPointSegment, pointInPolygon, polygonArea, project } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Building, Park, Place, Road, Sign } from '../shared/mapdata.ts';
import { heightFor } from './buildings.ts';
import { bboxOf, createGrid, segToPolygonDist } from './spatial.ts';
import type { PlaceInput } from './places-input.ts';

const NEAR_M = 15;
const STATION_NEAR_M = 30;
const ROAD_REACH_M = 15;
const SIGN_OFFSET = 0.08;
const SIGN_MAX_W = 6;
const SIGN_EDGE_FRAC = 0.8;
const SIGN_GAP = 0.2;
const SIGN_BOTTOM_Y = 3.0;

export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Normal exterior unitaria de la arista a→b de un contorno antihorario visto desde arriba.
 * Coherente con signedAreaFromAbove (que usa (x, −z)): el exterior queda a la derecha de a→b en ese plano.
 */
export function outwardNormal(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

function distToFootprint(p: Vec2, fp: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < fp.length; i++) d = Math.min(d, distPointSegment(p, fp[i], fp[(i + 1) % fp.length]));
  return d;
}

function segSegDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const s: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (den !== 0) {
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(distPointSegment(a, c, d), distPointSegment(b, c, d), distPointSegment(c, a, b), distPointSegment(d, a, b));
}

/**
 * Primer t en [0, alcance] tal que el punto mid + n·t queda a ≤ `h` del segmento a–b, o null. La distancia de un punto
 * que avanza en línea recta a un segmento es convexa en t: se busca el mínimo (ternaria) y, si alcanza, el primer
 * cruce con h por bisección en el tramo decreciente. Determinista.
 */
function firstReach(mid: Vec2, n: Vec2, a: Vec2, b: Vec2, h: number): number | null {
  const f = (t: number): number => distPointSegment([mid[0] + n[0] * t, mid[1] + n[1] * t], a, b);
  if (f(0) <= h) return 0;
  let lo = 0, hi = ROAD_REACH_M;
  for (let k = 0; k < 60; k++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (f(m1) < f(m2)) hi = m2; else lo = m1;
  }
  const tMin = (lo + hi) / 2;
  if (f(tMin) > h + 1e-9) return null;
  lo = 0; hi = tMin;
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2;
    if (f(m) <= h) hi = m; else lo = m;
  }
  return hi;
}

/** Distancia t (0..alcance) a lo largo del rayo mid + n·t en la que toca por primera vez una calzada (vía no peatonal), o null. */
function roadHitDistance(mid: Vec2, n: Vec2, roads: Road[]): number | null {
  let best: number | null = null;
  for (const r of roads) {
    if (r.kind === 'footway') continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const t = firstReach(mid, n, r.points[i], r.points[i + 1], r.width / 2);
      if (t !== null && (best === null || t < best)) best = t;
    }
  }
  return best;
}

/** ¿El segmento p→q cruza alguna arista del contorno `fp` (salvo la `skip`)? */
function crossesFootprint(p: Vec2, q: Vec2, fp: Vec2[], skip: number): boolean {
  for (let i = 0; i < fp.length; i++) {
    if (i === skip) continue;
    if (segSegDist(p, q, fp[i], fp[(i + 1) % fp.length]) === 0) return true;
  }
  return false;
}

const signWidth = (len: number): number => Math.min(SIGN_EDGE_FRAC * len, SIGN_MAX_W);

/** Índice espacial de los edificios para ver si algo se interpone entre una arista y la calle. */
interface Blockers { buildings: Building[]; grid: { query(box: ReturnType<typeof bboxOf>): number[] } }

function blockersOf(buildings: Building[]): Blockers {
  return { buildings, grid: createGrid(buildings.map((b) => bboxOf(b.footprint))) };
}

/** ¿El rayo p→q toca algún edificio distinto de `self`? */
function blockedByOther(p: Vec2, q: Vec2, self: Building, bl: Blockers): boolean {
  for (const j of bl.grid.query(bboxOf([p, q]))) {
    const o = bl.buildings[j];
    if (o !== self && segToPolygonDist(p, q, o.footprint) === 0) return true;
  }
  return false;
}

interface Edge { i: number; a: Vec2; b: Vec2; len: number; mid: Vec2; n: Vec2; qualifies: boolean; dist: number }

function edgesOf(b: Building, p: Vec2, roads: Road[], bl: Blockers): Edge[] {
  const fp = b.footprint;
  const out: Edge[] = [];
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i];
    const c = fp[(i + 1) % fp.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 1e-6) continue;
    const mid: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const n = outwardNormal(a, c);
    const start: Vec2 = [mid[0] + n[0] * 1e-3, mid[1] + n[1] * 1e-3];
    // califica: cabe el cartel con 1 m de aire, el rayo llega a una calle y, hasta la calle, no cruza ningún edificio
    // (ni el propio: patios, U, L). Más allá de la calle no importa: en una calle angosta ya están los de enfrente.
    const tRoad = len >= signWidth(len) + 1 ? roadHitDistance(mid, n, roads) : null;
    const end: Vec2 = [mid[0] + n[0] * (tRoad ?? 0), mid[1] + n[1] * (tRoad ?? 0)];
    const qualifies = tRoad !== null && !crossesFootprint(start, end, fp, i) && !blockedByOther(start, end, b, bl);
    out.push({ i, a, b: c, len, mid, n, qualifies, dist: distPointSegment(p, a, c) });
  }
  return out.sort((x, y) => Number(y.qualifies) - Number(x.qualifies) || x.dist - y.dist);
}

interface Slot { text: string; p: Vec2; width: number; edge: Edge }

function layoutSign(slots: Slot[], edge: Edge): Map<Slot, Sign> {
  const out = new Map<Slot, Sign>();
  const mine = slots.filter((s) => s.edge.i === edge.i);
  const d: Vec2 = [(edge.b[0] - edge.a[0]) / edge.len, (edge.b[1] - edge.a[1]) / edge.len];
  const along = (s: Slot) => (s.p[0] - edge.a[0]) * d[0] + (s.p[1] - edge.a[1]) * d[1];
  mine.sort((x, y) => along(x) - along(y));
  const total = mine.reduce((t, s) => t + s.width, 0) + SIGN_GAP * (mine.length - 1);
  let pos = edge.len / 2 - total / 2;
  for (const s of mine) {
    const c = pos + s.width / 2;
    pos += s.width + SIGN_GAP;
    out.set(s, {
      text: s.text,
      anchor: [edge.a[0] + d[0] * c + edge.n[0] * SIGN_OFFSET, edge.a[1] + d[1] * c + edge.n[1] * SIGN_OFFSET],
      normal: edge.n,
      width: s.width,
      bottomY: SIGN_BOTTOM_Y,
    });
  }
  return out;
}

export function matchPlaces(
  input: PlaceInput[],
  buildings: Building[],
  parks: Park[],
  roads: Road[],
  /** Lugares ligados a un lote relevado: ya tienen edificio y cartel, y el relevamiento manda (no se les aplica floors/tint/wall). */
  fixed: Map<string, { buildingId: string; sign: Sign }> = new Map(),
): { places: Omit<Place, 'spawn'>[]; buildings: Building[]; warnings: string[] } {
  const blds: Building[] = buildings.map((b) => ({ ...b }));
  const blockers = blockersOf(blds);
  const warnings: string[] = [];
  const places: Omit<Place, 'spawn'>[] = [];
  const slotsByBuilding = new Map<string, Slot[]>();
  const slotOfPlace = new Map<string, Slot>();

  for (const inp of input) {
    const position = project(inp.lat, inp.lon);
    const place: Omit<Place, 'spawn'> = { id: inp.id, name: inp.name, type: inp.type, position, enterable: inp.enterable };
    places.push(place);
    if (inp.type === 'monument') continue;

    if (inp.type === 'plaza') {
      const want = normalizeName(inp.name);
      const park = parks.find((k) => k.name && normalizeName(k.name) === want) ?? parks.find((k) => pointInPolygon(position, k.polygon));
      if (park) place.parkId = park.id;
      else warnings.push(`${inp.id}: no se encontró el parque`);
      continue;
    }

    const lot = fixed.get(inp.id);
    if (lot) {
      const b = blds.find((x) => x.id === lot.buildingId);
      if (b) {
        place.buildingId = b.id;
        place.sign = lot.sign;
        b.landmarkId ??= inp.id;
      } else warnings.push(`${inp.id}: el lote ${lot.buildingId} no existe`);
      continue;
    }

    const radius = inp.type === 'station' ? STATION_NEAR_M : NEAR_M;
    let best: Building | undefined;
    const containing = blds.filter((b) => pointInPolygon(position, b.footprint));
    if (containing.length) {
      best = containing.reduce((m, b) => (polygonArea(b.footprint) < polygonArea(m.footprint) ? b : m));
    } else {
      let bd = radius;
      for (const b of blds) {
        const d = distToFootprint(position, b.footprint);
        if (d <= bd) { bd = d; best = b; }
      }
    }
    if (!best) {
      warnings.push(`${inp.id}: ningún edificio a ${radius} m o menos`);
      continue;
    }
    place.buildingId = best.id;
    best.landmarkId ??= inp.id; // con dos lugares en un edificio, manda el primero
    // un lote relevado manda: no se le pisan pisos, tinte ni material
    if (!best.front && inp.floors !== undefined) { best.floors = inp.floors; best.height = heightFor(inp.floors); }
    if (!best.front && inp.tint !== undefined) best.tint = inp.tint;
    if (!best.front && inp.wall !== undefined) best.wall = inp.wall;
    if (inp.type === 'station') best.kind = 'station';

    // Cartel: arista candidata con lugar suficiente para todos los carteles del edificio.
    const slots = slotsByBuilding.get(best.id) ?? [];
    slotsByBuilding.set(best.id, slots);
    const edges = edgesOf(best, position, roads, blockers);
    const fits = (e: Edge, w: number) => {
      const mine = slots.filter((s) => s.edge.i === e.i);
      const total = mine.reduce((t, s) => t + s.width, 0) + w + SIGN_GAP * mine.length;
      return mine.length === 0 || total <= SIGN_EDGE_FRAC * e.len;
    };
    const width = (e: Edge) => signWidth(e.len);
    // Prefiere aristas que miran a la calle; si no hay ninguna con lugar, cualquiera con lugar; si no, la mejor.
    const chosen = edges.find((e) => e.qualifies && fits(e, width(e))) ?? edges.find((e) => fits(e, width(e))) ?? edges[0];
    const slot: Slot = { text: inp.signText ?? inp.name, p: position, width: width(chosen), edge: chosen };
    if (!fits(chosen, slot.width)) warnings.push(`${inp.id}: el cartel no entra en ninguna arista de ${best.id}`);
    slots.push(slot);
    slotOfPlace.set(inp.id, slot);
  }

  const signs = new Map<Slot, Sign>();
  for (const slots of slotsByBuilding.values()) {
    for (const e of new Map(slots.map((s) => [s.edge.i, s.edge])).values()) for (const [k, v] of layoutSign(slots, e)) signs.set(k, v);
  }
  for (const pl of places) {
    const slot = slotOfPlace.get(pl.id);
    if (slot) pl.sign = signs.get(slot);
  }
  return { places, buildings: blds, warnings };
}
