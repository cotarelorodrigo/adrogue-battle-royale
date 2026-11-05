// Los planes de interior por lugar y lo que se arma con ellos: un interior por cada entrada de MapData.interiors (con su
// plan o, mientras no tenga, la caja de §2.1), su validación (§2.1 y §2.3) y el piso público que cuenta para el botín
// (D11). collision.ts arma los sólidos con esto; acá no se importa la colisión.
import polygonClipping from 'polygon-clipping';
import { pointInPolygon } from '../geo.ts';
import type { Vec2 } from '../geo.ts';
import type { Building, InteriorInput, MapData } from '../mapdata.ts';
import { LINTEL_MIN } from './openings.ts';
import { bancoPlan } from './bancos.ts';
import { cinePlan } from './cine.ts';
import { estacionPlan } from './estacion.ts';
import { guernicaPlan } from './guernica.ts';
import { culturaPlan } from './cultura.ts';
import { mcdonaldsPlan } from './mcdonalds.ts';
import { venecianaPlan } from './veneciana.ts';
import { Kit, MODEL_BOX, RAIL_H, RISER_MAX, STAIR_MIN_W, TREAD, WALL_IN, WALL_OUT, areaOf } from './kit.ts';
import type { Block, Interior, Look } from './types.ts';

export type InteriorPlan = (k: Kit) => Interior;

/** El plan de cada lugar, por placeId: cada tarea de interior agrega su línea. */
export const INTERIOR_PLANS: Partial<Record<string, InteriorPlan>> = {
  'banco-nacion': bancoPlan('nacion'),
  galicia: bancoPlan('galicia'),
  bbva: bancoPlan('bbva'),
  'casa-de-la-cultura': culturaPlan,
  mcdonalds: mcdonaldsPlan,
  'la-veneciana': venecianaPlan,
  'cine-pixel': cinePlan,
  'guernica-bar': guernicaPlan,
  'estacion-adrogue': estacionPlan,
};

/** Los looks de la caja de un lugar sin plan. */
const NEUTRO = {
  wall: { mat: 'liso', color: '#ece8e0' },
  floor: { mat: 'porcelanato', color: '#d6d2ca' },
  ceiling: { mat: 'liso', color: '#f4f2ee' },
} as const satisfies Record<string, Look>;

/** Lo del mapa que arma los interiores: los edificios y sus InteriorInput, y los andenes (los usa la estación). */
export type InteriorsMap = Pick<MapData, 'buildings' | 'interiors'> & { platforms?: MapData['platforms'] };

/** El interior de un lugar: el de su plan o, si todavía no tiene, la caja de §2.1 (un piso público, sin muebles).
 *  `platforms`: los andenes del mapa (Kit.platforms). */
export function buildInterior(b: Building, input: InteriorInput, platforms: MapData['platforms'] = []): Interior {
  const k = new Kit(b, input, platforms);
  const plan = Object.hasOwn(INTERIOR_PLANS, input.placeId) ? INTERIOR_PLANS[input.placeId] : undefined;
  if (plan) return plan(k);
  k.shell({ publicFloors: 1, ...NEUTRO });
  return k.done(0.8);
}

/** Hasta dónde se buscan los vecinos que le tapan el sol a lo de afuera de un interior (Interior.shade): la sombra de
 *  un edificio de 30 m con el sol a 50° llega a ~25 m. */
const SHADE_REACH = 40;

/** El interior con los edificios de `buildings` (salvo el suyo) a menos de SHADE_REACH de su planta y sus patios. */
function withShade(i: Interior, buildings: readonly Building[]): Interior {
  const pts = [...i.footprint, ...i.patios.flat()];
  const [x0, x1] = [Math.min(...pts.map((p) => p[0])) - SHADE_REACH, Math.max(...pts.map((p) => p[0])) + SHADE_REACH];
  const [z0, z1] = [Math.min(...pts.map((p) => p[1])) - SHADE_REACH, Math.max(...pts.map((p) => p[1])) + SHADE_REACH];
  const shade = buildings.filter((b) => b.id !== i.buildingId && b.footprint.some((p) => p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1))
    .map((b) => ({ polygon: b.footprint, height: b.height }));
  return shade.length === 0 ? i : { ...i, shade };
}

export function buildInteriors(map: InteriorsMap): Interior[] {
  const byId = new Map(map.buildings.map((b) => [b.id, b]));
  return map.interiors.map((input) => {
    const b = byId.get(input.buildingId);
    if (!b) throw new Error(`${input.placeId}: el edificio ${input.buildingId} del interior no está en el mapa`);
    return withShade(buildInterior(b, input, map.platforms), map.buildings);
  });
}

export function interiorOf(map: InteriorsMap, placeId: string): Interior {
  const input = map.interiors.find((i) => i.placeId === placeId);
  if (!input) throw new Error(`${placeId}: el lugar no tiene interior en el mapa`);
  const b = map.buildings.find((x) => x.id === input.buildingId);
  if (!b) throw new Error(`${placeId}: el edificio ${input.buildingId} del interior no está en el mapa`);
  return withShade(buildInterior(b, input, map.platforms), map.buildings);
}

/** Lo que cuenta para el botín (D11): el piso techado de los pisos públicos más la terraza. */
export function publicFloorArea(i: Interior): number {
  return i.floors.reduce((a, f) => a + f.area, 0);
}

const fmt = (n: number): string => n.toFixed(2).replace('.', ',');
const centroid = (p: Vec2[]): Vec2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
const where = (p: Vec2): string => `en ${p[0].toFixed(1)}, ${p[1].toFixed(1)}`;
/** Extensión de la planta a lo largo de `d` (unitario). */
const extent = (poly: Vec2[], d: Vec2): number => {
  const s = poly.map((p) => p[0] * d[0] + p[1] * d[1]);
  return Math.max(...s) - Math.min(...s);
};
/** Espesor de una pared o un tabique: lo que se separan sus vértices de la recta de su primera arista (una cara). */
const thickness = (poly: Vec2[]): number => {
  const [a, c] = [poly[0], poly[1]];
  const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
  return Math.max(...poly.map((p) => Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / l));
};
const closed = (r: Vec2[]): [[number, number][]] => [[...r, r[0]].map((p): [number, number] => [p[0], p[1]])];

/**
 * Lo que un interior tiene que cumplir. Cada mensaje nombra el lugar, qué está mal y dónde:
 * - escalones: contrahuella ≤ RISER_MAX, huella TREAD ± 0,01 y ancho ≥ STAIR_MIN_W;
 * - dinteles a ≥ LINTEL_MIN de su piso; barandas de RAIL_H ± 0,01;
 * - paredes de WALL_OUT ± 0,01 y tabiques de WALL_IN ± 0,01;
 * - cada mueble de MODEL_BOX con su caja `mueble`;
 * - todo bloque y todo paño que no son `out`, adentro de la planta o de un patio.
 */
export function validateInterior(i: Interior): string[] {
  const out: string[] = [];
  const say = (m: string): void => {
    out.push(`${i.placeId}: ${m}`);
  };
  checkStairs(i, say);
  const floorYs = [0, ...i.floors.map((f) => f.y)];
  for (const b of i.blocks) {
    const at = where(centroid(b.polygon));
    if (b.role === 'dintel') {
      const base = Math.max(...floorYs.filter((y) => y <= b.y0 + 1e-6));
      if (b.y0 - base < LINTEL_MIN - 1e-6) say(`dintel a ${fmt(b.y0 - base)} m de su piso ${at} (al menos ${fmt(LINTEL_MIN)})`);
    } else if (b.role === 'baranda' && Math.abs(b.y1 - b.y0 - RAIL_H) > 0.01) {
      say(`baranda de ${fmt(b.y1 - b.y0)} m de alto ${at} (tiene que medir ${fmt(RAIL_H)})`);
    } else if (b.role === 'pared' && Math.abs(thickness(b.polygon) - WALL_OUT) > 0.01) {
      say(`pared de ${fmt(thickness(b.polygon))} m de espesor ${at} (tiene que medir ${fmt(WALL_OUT)})`);
    } else if (b.role === 'tabique' && Math.abs(thickness(b.polygon) - WALL_IN) > 0.01) {
      say(`tabique de ${fmt(thickness(b.polygon))} m de espesor ${at} (tiene que medir ${fmt(WALL_IN)})`);
    }
  }
  const boxes = i.blocks.filter((b) => b.role === 'mueble');
  for (const it of i.items) {
    const box = MODEL_BOX[it.model];
    if (!box) continue;
    const has = boxes.some((b) => {
      const c = centroid(b.polygon);
      return Math.hypot(c[0] - it.at[0], c[1] - it.at[2]) < 0.02 && Math.abs(b.y0 - it.at[1]) < 1e-3 && Math.abs(b.y1 - it.at[1] - box.h) < 1e-3;
    });
    if (!has) say(`${it.model} ${where([it.at[0], it.at[2]])} sin su caja sólida (MODEL_BOX)`);
  }
  const room = polygonClipping.union(closed(i.footprint), ...i.patios.map(closed));
  for (const b of i.blocks) {
    if (b.out) continue;
    const off = areaOf(polygonClipping.difference(closed(b.polygon), room));
    if (off > 1e-3) say(`un bloque (${b.role}) sale de la planta ${where(centroid(b.polygon))}: ${fmt(off)} m² afuera`);
  }
  for (const p of i.panes) {
    if (p.out) continue;
    // una esquina sobre el borde cuenta como adentro: se mira un poco hacia el medio del paño
    const c = centroid(p.corners.map((q): Vec2 => [q[0], q[2]]));
    const off = p.corners.find((q) => {
      const r: Vec2 = [q[0] + (c[0] - q[0]) * 1e-3, q[2] + (c[1] - q[2]) * 1e-3];
      return !pointInPolygon(r, i.footprint) && !i.patios.some((pt) => pointInPolygon(r, pt));
    });
    if (off) say(`un paño (${p.look.mat}) sale de la planta ${where([off[0], off[2]])}`);
  }
  return out;
}

/** Los escalones de cada StairRun (los `escalon` y los `descanso` cuyo medio cae a lo largo de su corrida), en orden de
 *  subida: contrahuellas ≤ RISER_MAX, huellas de TREAD (las de los descansos, no) y ancho ≥ STAIR_MIN_W. */
function checkStairs(i: Interior, say: (m: string) => void): void {
  const runs = i.stairs.map((s) => {
    const [dx, dz] = [s.top[0] - s.foot[0], s.top[2] - s.foot[2]];
    const len = Math.hypot(dx, dz) || 1;
    return { s, len, d: [dx / len, dz / len] as Vec2, steps: [] as { along: number; b: Block }[] };
  });
  for (const b of i.blocks) {
    if (b.role !== 'escalon' && b.role !== 'descanso') continue;
    const c = centroid(b.polygon);
    let best: (typeof runs)[number] | null = null, bestLat = Infinity, bestAlong = 0;
    for (const r of runs) {
      const [px, pz] = [c[0] - r.s.foot[0], c[1] - r.s.foot[2]];
      const along = px * r.d[0] + pz * r.d[1], lat = Math.abs(-px * r.d[1] + pz * r.d[0]);
      if (along < 0 || along > r.len || b.y1 <= r.s.foot[1] || b.y1 > r.s.top[1] + 1e-6 || lat >= bestLat) continue;
      [best, bestLat, bestAlong] = [r, lat, along];
    }
    best?.steps.push({ along: bestAlong, b });
  }
  runs.forEach((r, k) => {
    const name = `escalera ${k + 1} (del nivel ${r.s.from} al ${r.s.to})`;
    const steps = r.steps.sort((p, q) => p.along - q.along).map((x) => x.b);
    const ys = [r.s.foot[1], ...steps.map((b) => b.y1), r.s.top[1]];
    for (let j = 0; j + 1 < ys.length; j++) {
      const rise = ys[j + 1] - ys[j];
      const at = j < steps.length ? `en el escalón ${j + 1}` : 'en la llegada';
      if (rise > RISER_MAX + 1e-6) say(`${name}: contrahuella de ${fmt(rise)} m ${at} (a lo sumo ${fmt(RISER_MAX)})`);
    }
    steps.forEach((b, j) => {
      if (b.role === 'descanso') return;
      const tread = extent(b.polygon, r.d);
      if (Math.abs(tread - TREAD) > 0.01) say(`${name}: huella de ${fmt(tread)} m en el escalón ${j + 1} (tiene que medir ${fmt(TREAD)})`);
    });
    const width = Math.min(...steps.map((b) => extent(b.polygon, [-r.d[1], r.d[0]])));
    if (steps.length > 0 && width < STAIR_MIN_W - 1e-6) say(`${name}: ancho de ${fmt(width)} m ${where([r.s.foot[0], r.s.foot[2]])} (al menos ${fmt(STAIR_MIN_W)})`);
  });
}
