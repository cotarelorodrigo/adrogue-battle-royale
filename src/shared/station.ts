// La estación sobre cada andén: su eje, los lados que dan a la vía, el tramo del alero con sus postes y los dos carteles
// ADROGUÉ con sus postes. La usan el dibujo (client/world/landmarks.ts) y la colisión (collision.ts: los postes son
// sólidos): lo que se ve es lo que frena.
import { clipSegment, distPointSegment, ensureCCW, MARGIN_M } from './geo.ts';
import type { Vec2 } from './geo.ts';
import type { MapData, Place } from './mapdata.ts';
import { SIGN_H } from './mapdata.ts';

/** Alto del andén (el sólido y la losa dibujada). */
export const PLATFORM_H = 1.0;
// Alero: techo a dos aguas sobre postes en el eje del andén (el techo no frena: solo los postes).
export const CANOPY_LEN = 50;
export const CANOPY_EAVE = 3.2;
export const CANOPY_RIDGE = 3.6;
export const CANOPY_OVERHANG = 0.5;
const POST_STEP = 10;
const POST_R = 0.07;
/** El poste del alero termina abajo de la cumbrera. */
const POST_TOP = PLATFORM_H + CANOPY_RIDGE - 0.1;
export const STATION_SIGN_W = 3.2;
const STATION_SIGN_BOTTOM = 2.0;
const SIGN_POST_R = 0.045;
/** Cada poste de un cartel, a esto de su punta. */
const SIGN_POST_INSET = 0.25;
/** El cartel queda contra el borde de atrás del andén, a esto de él. */
const SIGN_BACK = 0.35;
/** Un cartel pasa esto cada punta del alero. */
const SIGN_PAST_CANOPY = 8;

/** Eje del andén: dirección del lado más largo (d), su normal (w) y la extensión de la planta a lo largo (s0…s1) y a lo
 *  ancho (centro tc, ancho width). */
export interface Axis { d: Vec2; w: Vec2; s0: number; s1: number; tc: number; width: number }
/** Poste vertical: cilindro de 8 lados de radio r con un vértice en +x, de y0 a y1. */
export interface StationPost { at: Vec2; r: number; y0: number; y1: number }
/** Cartel ADROGUÉ: centro de la cara en el plano, giro (yaw: mira a la vía), alto del borde de abajo y sus dos postes. */
export interface StationSign { at: Vec2; yaw: number; bottomY: number; posts: StationPost[] }
/** Un andén: planta antihoraria, qué lados dan a la vía, eje, tramo del alero (s de sa a sb) con sus postes, y carteles. */
export interface PlatformLayout { ring: Vec2[]; rail: boolean[]; axis: Axis; sa: number; sb: number; posts: StationPost[]; signs: StationSign[] }

type StationMap = Pick<MapData, 'platforms' | 'railways' | 'bounds'> & { places: Pick<Place, 'type' | 'position'>[] };

/** Tramos de la polilínea dentro del rectángulo (cortados en el borde). */
function clippedRuns(line: Vec2[], x0: number, z0: number, x1: number, z1: number): Vec2[][] {
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  const flush = (): void => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k], b = line[k + 1];
    const c = clipSegment(a, b, x0, z0, x1, z1);
    if (!c) { flush(); continue; }
    if (c[0] !== a) flush(); // entra por el borde: tramo nuevo
    if (run.length === 0) run.push(c[0]);
    run.push(c[1]);
    if (c[1] !== b) flush();
  }
  flush();
  return runs;
}

/** Las vías recortadas al suelo dibujado (bounds + MARGIN_M). */
export function railRuns(map: Pick<MapData, 'railways' | 'bounds'>): Vec2[][] {
  const bd = map.bounds;
  const x0 = bd.minX - MARGIN_M, x1 = bd.maxX + MARGIN_M, z0 = bd.minZ - MARGIN_M, z1 = bd.maxZ + MARGIN_M;
  return map.railways.flatMap((r) => clippedRuns(r, x0, z0, x1, z1));
}

/** Distancia, punto más cercano y dirección (unitaria) del tramo de vía más cercano a p. */
function nearestRail(p: Vec2, rails: Vec2[][]): { d: number; q: Vec2; dir: Vec2 } {
  let best = { d: Infinity, q: p, dir: [1, 0] as Vec2 };
  for (const r of rails) {
    for (let k = 0; k + 1 < r.length; k++) {
      const a = r[k], b = r[k + 1];
      const d = distPointSegment(p, a, b);
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      if (d < best.d && l2 > 0) {
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
        const l = Math.sqrt(l2);
        best = { d, q: [a[0] + dx * t, a[1] + dz * t], dir: [dx / l, dz / l] };
      }
    }
  }
  return best;
}

/** Lados del anillo (antihorario) que dan a la vía: paralelos a ella (±25°), mirándola, y los más cercanos (±1 m).
 *  Las puntas del andén quedan afuera aunque toquen el eje de la vía (pasa en los datos de OSM). */
function railSides(ring: Vec2[], rails: Vec2[][]): boolean[] {
  const n = ring.length;
  const info = ring.map((a, i) => {
    const c = ring[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
    const mid: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const { d, q, dir } = nearestRail(mid, rails);
    const facing = len > 0 && (-dz * (q[0] - mid[0]) + dx * (q[1] - mid[1])) / len > 0;
    const parallel = len > 0 && Math.abs(dx * dir[0] + dz * dir[1]) / len > Math.cos((25 * Math.PI) / 180);
    return { d, ok: facing && parallel && len >= 2 };
  });
  const dmin = Math.min(...info.filter((e) => e.ok).map((e) => e.d));
  return info.map((e) => e.ok && e.d <= dmin + 1);
}

function axisOf(ring: Vec2[]): Axis {
  let d: Vec2 = [1, 0], best = 0;
  ring.forEach((a, i) => {
    const c = ring[(i + 1) % ring.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (l > best) { best = l; d = [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; }
  });
  const w: Vec2 = [-d[1], d[0]];
  const ss = ring.map((p) => p[0] * d[0] + p[1] * d[1]), ts = ring.map((p) => p[0] * w[0] + p[1] * w[1]);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  return { d, w, s0: Math.min(...ss), s1: Math.max(...ss), tc: (t0 + t1) / 2, width: t1 - t0 };
}

/** Punto del plano a `s` a lo largo del eje y `t` a lo ancho. */
export const at = (ax: Axis, s: number, t: number): Vec2 => [ax.d[0] * s + ax.w[0] * t, ax.d[1] * s + ax.w[1] * t];

/** La disposición de cada andén del mapa. El alero (CANOPY_LEN o el largo del andén) se centra en la estación, si hay. */
export function stationLayout(map: StationMap): PlatformLayout[] {
  const runs = railRuns(map);
  const station = map.places.find((p) => p.type === 'station');
  return map.platforms.map((poly) => {
    const ring = ensureCCW(poly);
    const rail = runs.length > 0 ? railSides(ring, runs) : ring.map(() => false);
    const ax = axisOf(ring);
    const len = Math.min(CANOPY_LEN, ax.s1 - ax.s0);
    const target = station ? station.position[0] * ax.d[0] + station.position[1] * ax.d[1] : (ax.s0 + ax.s1) / 2;
    const sa = Math.min(Math.max(target - len / 2, ax.s0), ax.s1 - len), sb = sa + len;
    const posts: StationPost[] = [];
    for (let s = sa + POST_STEP / 2; s < sb; s += POST_STEP) posts.push({ at: at(ax, s, ax.tc), r: POST_R, y0: PLATFORM_H, y1: POST_TOP });

    // Carteles: uno pasando cada punta del alero, contra el borde de atrás, mirando a la vía
    const railEdge = ring.findIndex((_, i) => rail[i]);
    let toRail = 1;
    if (railEdge >= 0) {
      const a = ring[railEdge], c = ring[(railEdge + 1) % ring.length];
      toRail = Math.sign(-(c[1] - a[1]) * ax.w[0] + (c[0] - a[0]) * ax.w[1]) || 1;
    }
    const tBack = ax.tc - toRail * (ax.width / 2 - SIGN_BACK);
    const yaw = Math.atan2(ax.w[0] * toRail, ax.w[1] * toRail);
    const bottomY = PLATFORM_H + STATION_SIGN_BOTTOM;
    const signs = [sa - SIGN_PAST_CANOPY, sb + SIGN_PAST_CANOPY].map((s): StationSign => {
      const sc = Math.min(Math.max(s, ax.s0 + STATION_SIGN_W), ax.s1 - STATION_SIGN_W);
      return {
        at: at(ax, sc, tBack), yaw, bottomY,
        posts: [-1, 1].map((k) => ({ at: at(ax, sc + k * (STATION_SIGN_W / 2 - SIGN_POST_INSET), tBack), r: SIGN_POST_R, y0: PLATFORM_H, y1: bottomY + SIGN_H })),
      };
    });
    return { ring, rail, axis: ax, sa, sb, posts, signs };
  });
}

/** Todos los postes de la estación: los del alero y los de los carteles. */
export function stationPosts(map: StationMap): StationPost[] {
  return stationLayout(map).flatMap((p) => [...p.posts, ...p.signs.flatMap((s) => s.posts)]);
}
