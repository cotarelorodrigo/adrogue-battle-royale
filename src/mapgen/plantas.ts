// Las plantas relevadas en el mundo: del marco local de data/plantas.json a coordenadas de juego. Son lotes sueltos:
// siguen el camino de los lotes de data/frentes.json (recorte de Microsoft, cartel, frente con el atlas y ayudas de
// ascenso) y suman sus propios avisos (la calle, las puertas).
import polygonClipping from 'polygon-clipping';
import { ensureCCW, pointInPolygon, polygonArea, project, toWorld } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Building, Frame, Road } from '../shared/mapdata.ts';
import { FLOOR_H } from './buildings.ts';
import { cumulative, pointAt, resolveFrontage, vehicular } from './frontage.ts';
import type { Frontage } from './frontage.ts';
import type { LotShape } from './lots.ts';
import { bufferLine } from './osm.ts';
import { frontRun } from './plantas-input.ts';
import type { PlantaInput } from './plantas-input.ts';

/** Una planta en el mundo, como lote: `id` es `pl-<lugar>`; `footprint`, la planta antihoraria; `front`, la corrida de
 *  las aristas `frente` de punta a punta (en el sentido de U); `claim`, la unión de la planta, los patios, los despejes
 *  y, con marco de frente, la franja de delante, del eje de la calle a la fachada: uno o más anillos exteriores ya
 *  fusionados, antihorarios. `patios`, antihorarios (sin los despejes, que no son parte del interior). */
export interface PlantaShape extends LotShape { footprint: Vec2[]; planta: PlantaInput; frame: Frame; patios: Vec2[][] }

/** Más que esto de la planta sobre la calzada y la vereda de una calle vehicular (m²) es un error del marco. */
const CALLE_MAX = 0.5;
/** A esta distancia (m) del centro de una puerta, afuera, no puede haber otro edificio. */
const PUERTA_AFUERA = 1;

type Ring = [number, number][];
const poly = (r: Vec2[]): [Ring] => [[...r, r[0]].map((p): [number, number] => [p[0], p[1]])];
const bbox = (r: Vec2[]): [number, number, number, number] =>
  [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))];
const overlaps = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const fmt = (n: number): string => n.toFixed(1).replace('.', ',');

/** El marco de una planta y, si es de frente, el frente sobre el que se apoya. */
function frameOf(p: PlantaInput, roads: Road[]): { frame: Frame; fr?: Frontage } {
  const m = p.marco;
  if ('lat' in m) {
    const r = (m.rumbo * Math.PI) / 180;
    // U al rumbo; V a su derecha (mirando desde arriba, con el norte en −z)
    return { frame: { origin: project(m.lat, m.lon), u: [Math.sin(r), -Math.cos(r)], v: [Math.cos(r), Math.sin(r)] } };
  }
  let fr: Frontage;
  try {
    fr = resolveFrontage(roads, { id: `pl-${p.lugar}`, calle: m.calle, vereda: m.vereda, desde: m.desde, hasta: m.hasta });
  } catch (e) {
    throw new Error(`planta de ${p.lugar}: marco: ${(e as Error).message.replace(/^frente pl-[^:]*: /, '')}`);
  }
  if (m.s > fr.length + 1e-6) throw new Error(`planta de ${p.lugar}: marco: s es ${String(m.s).replace('.', ',')} m y el frente mide ${fmt(fr.length)} m`);
  return { frame: frontFrame(p.lugar, fr.line, m.s, fr.inward), fr };
}

/** El marco de frente: el origen sobre `line` a `s` m de su punta, U a lo largo del tramo donde cae y V hacia `inward`
 *  (como Frontage.inward). Un tramo sin largo no da dirección: es un error del marco (m18). */
export function frontFrame(lugar: string, line: Vec2[], s: number, inward: number): Frame {
  const cum = cumulative(line);
  let i = 1;
  while (i < line.length - 1 && cum[i] < s) i++;
  const [a, b] = [line[i - 1], line[i]];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(d > 1e-9)) throw new Error(`planta de ${lugar}: marco degenerado: en s = ${String(s).replace('.', ',')} m el tramo de la línea de edificación no tiene largo (puntos repetidos)`);
  const u: Vec2 = [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  return { origin: pointAt(line, cum, s), u, v: [-u[1] * inward, u[0] * inward] };
}

export function placePlantas(plantas: PlantaInput[], roads: Road[]): PlantaShape[] {
  return plantas.map((p): PlantaShape => {
    const { frame, fr } = frameOf(p, roads);
    const world = (r: Vec2[]): Vec2[] => r.map((q) => toWorld(frame, q));
    const footprint = ensureCCW(world(p.planta));
    const patios = p.patios.map((r) => ensureCCW(world(r)));
    // los despejes solo entran al recorte: no son patios del interior
    const pieces = [footprint, ...patios, ...p.despejes.map(world)];
    const run = frontRun(p.planta, p.frente);
    if (fr) {
      // la franja de delante, del eje de la calle a la fachada (como el claim de un lote, retiro incluido): un bloque de
      // Microsoft que se mete en la vereda, o que llena el hueco entre la línea y una planta que arranca más adentro,
      // también se recorta
      const us = [...p.planta, ...p.patios.flat()].map((q) => q[0]);
      const [u0, u1] = [Math.min(...us), Math.max(...us)];
      const vFront = Math.max(0, Math.min(...run.points.map((q) => q[1])));
      pieces.push(world([[u0, -fr.setback], [u1, -fr.setback], [u1, vFront], [u0, vFront]]));
    }
    // fusionadas acá, sin redondear: carveLots redondea al milímetro cada anillo por separado, y un patio girado que toca
    // la planta en un pedazo de arista quedaría despegado por menos de 1 mm (la unión daría dos piezas y el bloque de
    // Microsoft seguiría sobre el patio). Un hueco rodeado por las piezas también se reclama: van solo los anillos de afuera
    const claim = polygonClipping.union(poly(pieces[0]), ...pieces.slice(1).map(poly)).map((pg) => ensureCCW(pg[0].slice(0, -1) as Vec2[]));
    // como Frontage.inward: el sentido de la manzana respecto de la fachada (que corre en el sentido de U)
    const inward = frame.v[0] * -frame.u[1] + frame.v[1] * frame.u[0] > 0 ? 1 : -1;
    return {
      id: `pl-${p.lugar}`, lote: p.lote, inward, front: world(run.points), cornerRings: [],
      footprint, claim, planta: p, frame, patios,
    };
  });
}

/** Las puertas de una planta en el mundo: `k` desde 1, el centro sobre la cara exterior y la normal hacia afuera. */
export function plantaDoors(s: PlantaShape): { k: number; piso: number; center: Vec2; out: Vec2 }[] {
  const pl = s.planta.planta;
  return s.planta.puertas.map((p, k) => {
    const [a, b] = [toWorld(s.frame, pl[p.arista]), toWorld(s.frame, pl[(p.arista + 1) % pl.length])];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const center: Vec2 = [a[0] + d[0] * p.centro, a[1] + d[1] * p.centro];
    const left: Vec2 = [-d[1], d[0]];
    const out: Vec2 = pointInPolygon([center[0] + left[0] * 0.05, center[1] + left[1] * 0.05], s.footprint) ? [d[1], -d[0]] : left;
    return { k: k + 1, piso: p.piso, center, out };
  });
}

/** La escalera de mano relevada en el mundo (para climb.ts): su medio sobre la cara exterior, la normal hacia afuera y
 *  la tangente de la arista; null si la planta no la trae. */
export function plantaLadder(s: PlantaShape): { mid: Vec2; n: Vec2; d: Vec2 } | null {
  const e = s.planta.escalera;
  if (!e) return null;
  const pl = s.planta.planta;
  const [a, b] = [toWorld(s.frame, pl[e.arista]), toWorld(s.frame, pl[(e.arista + 1) % pl.length])];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const mid: Vec2 = [a[0] + d[0] * e.centro, a[1] + d[1] * e.centro];
  const left: Vec2 = [-d[1], d[0]];
  const n: Vec2 = pointInPolygon([mid[0] + left[0] * 0.05, mid[1] + left[1] * 0.05], s.footprint) ? [d[1], -d[0]] : left;
  return { mid, n, d };
}

const ringsArea = (m: polygonClipping.MultiPolygon): number =>
  m.reduce((t, pg) => t + pg.reduce((a, r, i) => a + (i === 0 ? 1 : -1) * polygonArea(r.slice(0, -1) as Vec2[]), 0), 0);

/** La planta (sin los patios) sobre la calzada y la vereda de una calle vehicular: un aviso por calle. */
export function streetWarnings(s: PlantaShape, roads: Road[]): string[] {
  const box = bbox(s.footprint);
  const byName = new Map<string, Vec2[][]>();
  for (const r of roads) {
    if (!vehicular(r)) continue;
    const corridor = bufferLine(r.points, r.width / 2 + r.sidewalk);
    if (!overlaps(bbox(corridor), box)) continue;
    const name = r.name ?? r.id;
    byName.set(name, [...(byName.get(name) ?? []), corridor]);
  }
  const out: string[] = [];
  for (const [name, corridors] of byName) {
    const street = polygonClipping.union(poly(corridors[0]), ...corridors.slice(1).map(poly));
    const area = ringsArea(polygonClipping.intersection(poly(s.footprint), street));
    if (area > CALLE_MAX) out.push(`planta de ${s.planta.lugar}: pisa la calle ${name} (${fmt(area)} m²); corré el marco hacia adentro`);
  }
  return out;
}

/** Puertas que dan a otro edificio: 1 m afuera del centro cae adentro de uno que llega más arriba que el piso de la puerta. */
export function doorWarnings(shapes: PlantaShape[], buildings: Building[]): string[] {
  const out: string[] = [];
  for (const s of shapes) {
    for (const d of plantaDoors(s)) {
      const p: Vec2 = [d.center[0] + d.out[0] * PUERTA_AFUERA, d.center[1] + d.out[1] * PUERTA_AFUERA];
      const hit = buildings.find((b) => b.id !== s.id && b.height > d.piso * FLOOR_H && pointInPolygon(p, b.footprint));
      if (hit) out.push(`planta de ${s.planta.lugar}: la puerta ${d.k} da a ${hit.id}`);
    }
  }
  return out;
}
