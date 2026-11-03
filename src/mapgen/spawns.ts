import { hash01 } from '../shared/geo.ts';
import type { Vec2, Vec3 } from '../shared/geo.ts';
import type { CollisionWorld } from '../shared/collision.ts';
import type { Sign } from '../shared/mapdata.ts';

const R = 0.35;
const STEP = 0.5;
const BORDER = 1;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Punto libre en el piso: nada lo pisa entre 0,05 y 1,8 m, nada lo apoya por encima del suelo y está dentro de los bounds − 1 m. */
export function isFreeSpot(world: CollisionWorld, x: number, z: number): boolean {
  const b = world.bounds;
  if (x < b.minX + BORDER || x > b.maxX - BORDER || z < b.minZ + BORDER || z > b.maxZ - BORDER) return false;
  return !world.overlaps(x, z, R, 0.05, 1.8) && world.supportHeight(x, z, R, Infinity) === 0;
}

/**
 * Espiral cada 0,5 m alrededor de `near`: el punto libre más cercano (candidatos redondeados a 2 decimales) o null.
 * `clearance`: metros libres de todo sólido alrededor del punto, además del radio del jugador. `accept`: filtro extra.
 */
export function findFreeSpot(
  world: CollisionWorld,
  near: Vec2,
  maxRadius = 12,
  clearance = 0,
  accept?: (p: Vec3) => boolean,
): Vec3 | null {
  for (let ring = 0; ring * STEP <= maxRadius; ring++) {
    const rad = ring * STEP;
    const n = ring === 0 ? 1 : Math.ceil((2 * Math.PI * rad) / STEP);
    let best: Vec3 | null = null;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const x = r2(near[0] + rad * Math.cos(a));
      const z = r2(near[1] + rad * Math.sin(a));
      if (!isFreeSpot(world, x, z)) continue;
      if (clearance > 0 && world.overlaps(x, z, R + clearance, 0.05, 1.8)) continue;
      if (accept && !accept([x, 0, z])) continue;
      const d = Math.hypot(x - near[0], z - near[1]);
      if (d < bestD) { bestD = d; best = [x, 0, z]; }
    }
    if (best) return best;
  }
  return null;
}

/** `count` puntos libres repartidos por hash; si no alcanzan con 25 m de separación, relaja a 15 y luego a 8. */
export function randomSpawns(world: CollisionWorld, count = 64, spacings: number[] = [25, 15, 8], tries = 4000): Vec3[] {
  const b = world.bounds;
  const out: Vec3[] = [];
  let i = 0;
  for (const spacing of spacings) {
    for (let k = 0; k < tries && out.length < count; k++, i++) {
      const x = r2(b.minX + BORDER + hash01(`rs-x-${i}`) * (b.maxX - b.minX - 2 * BORDER));
      const z = r2(b.minZ + BORDER + hash01(`rs-z-${i}`) * (b.maxZ - b.minZ - 2 * BORDER));
      if (!isFreeSpot(world, x, z)) continue;
      if (out.some((s) => Math.hypot(s[0] - x, s[2] - z) < spacing)) continue;
      out.push([x, 0, z]);
    }
    if (out.length >= count) break;
  }
  return out;
}

/** Prefijo de los avisos de relajación del punto de aparición: son esperados y no rompen el build. */
export const SPAWN_RELAXED = 'spawn-relajado:';
/** Un aviso rompe el build salvo que sea una relajación esperada del punto de aparición. */
export const isFatalWarning = (w: string): boolean => !w.startsWith(SPAWN_RELAXED);
export const EYE_Y = 1.6;
/** El rayo al cartel puede chocar solo en los últimos 0,3 m (la propia fachada). */
export const SIGN_CLEAR = 0.3;
/** De frente al cartel: coseno del ángulo máximo con la normal (60°). */
export const SIGN_FRONT_COS = 0.5;

/** ¿Se ve el cartel desde el punto `s`? De frente (≤ 60° de la normal) y sin nada en el medio. */
export function seesSign(world: CollisionWorld, sign: Sign, s: Vec3): boolean {
  const off: Vec2 = [s[0] - sign.anchor[0], s[2] - sign.anchor[1]];
  if (off[0] * sign.normal[0] + off[1] * sign.normal[1] < SIGN_FRONT_COS * Math.hypot(off[0], off[1])) return false;
  const eye: Vec3 = [s[0], EYE_Y, s[2]];
  const target: Vec3 = [sign.anchor[0], sign.bottomY + 0.45, sign.anchor[1]];
  const dir: Vec3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const dist = Math.hypot(dir[0], dir[1], dir[2]);
  const hit = world.raycast(eye, dir, dist);
  return !hit || hit.dist >= dist - SIGN_CLEAR;
}
