// Comprobación de las salidas de un hueco con el controlador real (la usan pockets.test y assemble.test).
import { GROUND_CELL, standingAt } from '../../src/mapgen/pockets.ts';
import type { GroundAnalysis, GroundRegion } from '../../src/mapgen/pockets.ts';
import type { CollisionWorld } from '../../src/shared/collision.ts';
import { PLAYER, initialState, stepPlayer } from '../../src/shared/player.ts';
import type { PlayerState } from '../../src/shared/player.ts';
import type { MapData, Prop } from '../../src/shared/mapdata.ts';

export type Ladder = Extract<Prop, { kind: 'ladder' }>;

/**
 * Desde los puntos del hueco al alcance de una escalera: parado ahí, mirando la pared y con W apretado, ¿sube y queda
 * parado en el techo (y = topY)? Suelta W apenas termina el mantle de arriba. Devuelve la escalera que funcionó o null.
 */
export function climbOut(world: CollisionWorld, map: MapData, region: GroundRegion): Ladder | null {
  const byBase = new Map<string, Ladder>();
  for (const p of map.props) if (p.kind === 'ladder') byBase.set(`${p.base[0]},${p.base[1]}`, p);
  const tried = new Set<Ladder>();
  for (const [x, z] of region.points) {
    if (standingAt(world, x, z) !== 1) continue; // el análisis usa un radio un poco menor: acá, el jugador de verdad
    const v = world.ladderAt(x, z, PLAYER.radius, 0);
    if (!v) continue;
    const l = byBase.get(`${v.base[0]},${v.base[1]}`)!;
    if (tried.has(l)) continue;
    tried.add(l);
    const n = Math.hypot(l.normal[0], l.normal[1]);
    const yaw = Math.atan2(l.normal[0] / n, l.normal[1] / n); // adelante = −normal: hacia la pared
    let s: PlayerState = initialState([x, 0, z]);
    let climbed = false;
    for (let t = 0; t < l.topY / PLAYER.ladderSpeed + 3; t += 1 / 60) {
      s = stepPlayer(s, { forward: 1, right: 0, jump: false, crouch: false, yaw, pitch: 0 }, world, 1 / 60);
      if (s.mode === 'mantle') climbed = true;
      else if (climbed) break;
    }
    if (climbed && s.mode === 'walk' && s.onGround && Math.abs(s.pos[1] - l.topY) < 1e-6) return l;
    if (tried.size >= 4) break;
  }
  return null;
}

/** Componente de la celda gruesa más cercana a (x, z) que no esté bloqueada (0 = principal), o −1. */
export function regionAt(g: GroundAnalysis, x: number, z: number): number {
  const fi = (x - g.x0) / GROUND_CELL, fj = (z - g.z0) / GROUND_CELL;
  const cells = [[Math.round(fi), Math.round(fj)], [Math.floor(fi), Math.floor(fj)], [Math.ceil(fi), Math.floor(fj)],
    [Math.floor(fi), Math.ceil(fj)], [Math.ceil(fi), Math.ceil(fj)]];
  for (const [i, j] of cells) {
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
    const l = g.label[j * g.nx + i];
    if (l >= 0) return l;
  }
  return -1;
}
