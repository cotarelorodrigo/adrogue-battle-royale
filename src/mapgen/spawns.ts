import { hash01 } from '../shared/geo.ts';
import type { Vec2, Vec3 } from '../shared/geo.ts';
import type { CollisionWorld } from '../shared/collision.ts';

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
