/** La zona que se achica: fases fijas (spec §6) y círculos sorteados con semilla. Módulo puro y determinista. */
import type { Vec2 } from './geo.ts';
import type { Bounds } from './mapdata.ts';
import { createRng } from './rng.ts';

/** Por fase: espera con el círculo quieto (s), cierre hasta el círculo siguiente (s),
 *  radio final como fracción de r0 y daño por segundo fuera de la zona. */
export const ZONE_PHASES: readonly { wait: number; shrink: number; radius: number; dps: number }[] = [
  { wait: 120, shrink: 90, radius: 0.6, dps: 1 },
  { wait: 90, shrink: 75, radius: 0.35, dps: 2 },
  { wait: 75, shrink: 60, radius: 0.18, dps: 4 },
  { wait: 60, shrink: 60, radius: 0.07, dps: 7 },
  { wait: 45, shrink: 45, radius: 0, dps: 10 },
];

/** Duración total de la partida hasta que la zona se cierra del todo (720 s). */
export const ZONE_TOTAL: number = ZONE_PHASES.reduce((s, p) => s + p.wait + p.shrink, 0);

export interface ZonePlan { center0: Vec2; r0: number; circles: { center: Vec2; r: number }[] }

export interface ZoneNow {
  /** 1..5; 6 = cerrada. */
  phase: number;
  center: Vec2;
  r: number;
  /** Instante absoluto (s) del próximo cambio: fin de la espera o fin del cierre. */
  nextAt: number;
  dps: number;
  shrinking: boolean;
}

/** Mayor s en [0, 1] tal que c + s·(p − c) queda dentro de `b` (c ya está adentro). */
function maxScaleInside(c: Vec2, p: Vec2, b: Bounds): number {
  let s = 1;
  const lim = (c0: number, d: number, lo: number, hi: number) => {
    if (d > 0 && c0 + d > hi) s = Math.min(s, (hi - c0) / d);
    else if (d < 0 && c0 + d < lo) s = Math.min(s, (lo - c0) / d);
  };
  lim(c[0], p[0] - c[0], b.minX, b.maxX);
  lim(c[1], p[1] - c[1], b.minZ, b.maxZ);
  return Math.max(0, s);
}

/** Planea los 5 círculos: el primero (r0) está centrado en el mapa; cada siguiente queda entero
 *  dentro del anterior y con el centro dentro de `bounds`. */
export function planZone(bounds: Bounds, players: number, seed: number): ZonePlan {
  const rng = createRng(seed);
  const center0: Vec2 = [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2];
  const diag = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const r0 = (diag / 2) * Math.max(0.35, Math.sqrt(players / 12));
  const circles: { center: Vec2; r: number }[] = [];
  let prevC = center0;
  let prevR = r0;
  for (const ph of ZONE_PHASES) {
    const r = r0 * ph.radius;
    // Centro posible: disco de radio prevR − r alrededor del anterior; si se sale del mapa se acerca al anterior
    // (que está adentro y el mapa es convexo), así que siempre hay solución.
    const ang = rng.next() * Math.PI * 2;
    const dist = (prevR - r) * Math.sqrt(rng.next());
    const p: Vec2 = [prevC[0] + Math.cos(ang) * dist, prevC[1] + Math.sin(ang) * dist];
    const s = maxScaleInside(prevC, p, bounds);
    const center: Vec2 = [prevC[0] + (p[0] - prevC[0]) * s, prevC[1] + (p[1] - prevC[1]) * s];
    circles.push({ center, r });
    prevC = center;
    prevR = r;
  }
  return { center0, r0, circles };
}

/** Estado de la zona en el instante `t` (s desde el inicio; negativo cuenta como 0). */
export function zoneAt(plan: ZonePlan, t: number): ZoneNow {
  t = Math.max(0, t);
  let start = 0;
  let from = { center: plan.center0, r: plan.r0 };
  for (let i = 0; i < ZONE_PHASES.length; i++) {
    const ph = ZONE_PHASES[i];
    const to = plan.circles[i];
    const shrinkStart = start + ph.wait;
    const end = shrinkStart + ph.shrink;
    if (t < shrinkStart) return { phase: i + 1, center: from.center, r: from.r, nextAt: shrinkStart, dps: ph.dps, shrinking: false };
    if (t < end) {
      const k = (t - shrinkStart) / ph.shrink;
      const center: Vec2 = [from.center[0] + (to.center[0] - from.center[0]) * k, from.center[1] + (to.center[1] - from.center[1]) * k];
      return { phase: i + 1, center, r: from.r + (to.r - from.r) * k, nextAt: end, dps: ph.dps, shrinking: true };
    }
    start = end;
    from = to;
  }
  const last = ZONE_PHASES[ZONE_PHASES.length - 1];
  return { phase: ZONE_PHASES.length + 1, center: from.center, r: 0, nextAt: Infinity, dps: last.dps, shrinking: false };
}
