// Recorridos con el controlador real del jugador (stepPlayer a SIM_HZ) para probar los interiores: entrar por una
// puerta, caminar hasta los puntos de un plan y subir o bajar una escalera. Los usan kit.test, all.test y los tests de
// cada lugar (tareas 6 a 11).
import type { CollisionWorld } from '../../../src/shared/collision.ts';
import { SIM_HZ } from '../../../src/shared/fixed-step.ts';
import { pointInPolygon } from '../../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { LEVEL_H } from '../../../src/shared/interiors/openings.ts';
import type { Door } from '../../../src/shared/interiors/openings.ts';
import type { StairRun } from '../../../src/shared/interiors/types.ts';
import type { Building } from '../../../src/shared/mapdata.ts';
import { initialState, stepPlayer } from '../../../src/shared/player.ts';
import type { PlayerInput, PlayerState } from '../../../src/shared/player.ts';

const H = 1 / SIM_HZ;
/** Se suelta W a esta distancia (m) del último punto: lo que tarda en frenar a la velocidad de correr (6²/2·60). Con
 *  Shift, a la de correr con Shift. A esta misma distancia se pasa al punto siguiente. */
const STOP = 0.3;
const STOP_SPRINT = 0.6;
/** Después de soltar W, como mucho esto (s) para que frene y se apoye. */
const SETTLE = 0.5;

interface Gait { sprint?: boolean; crouch?: boolean }

/** yaw que mira hacia `d` (adelante = (−sin yaw, −cos yaw)). */
const yawToward = (d: Vec2): number => Math.atan2(-d[0], -d[1]);
const press = (yaw: number, g: Gait, forward: 0 | 1 = 1): PlayerInput =>
  ({ forward, right: 0, jump: false, crouch: g.crouch === true, yaw, pitch: 0, sprint: g.sprint === true });

/** Sin W hasta que queda quieto y apoyado (o SETTLE s). */
function settle(world: CollisionWorld, s: PlayerState, yaw: number, g: Gait): PlayerState {
  for (let k = 0; k < SETTLE * SIM_HZ && !(s.onGround && Math.hypot(s.vel[0], s.vel[2]) < 1e-6); k++) {
    s = stepPlayer(s, press(yaw, g, 0), world, H);
  }
  return s;
}

/** Camina derecho a cada punto, en orden, y frena en el último; a lo sumo `seconds`. */
function walkPath(world: CollisionWorld, start: PlayerState, pts: readonly Vec2[], seconds: number, g: Gait): PlayerState {
  let s = start;
  let yaw = 0;
  const stop = g.sprint ? STOP_SPRINT : STOP;
  let k = 0;
  for (let step = 0; step < seconds * SIM_HZ && k < pts.length; step++) {
    const d: Vec2 = [pts[k][0] - s.pos[0], pts[k][1] - s.pos[2]];
    if (Math.hypot(d[0], d[1]) <= stop) {
      k++;
      step--;
      continue;
    }
    yaw = yawToward(d);
    s = stepPlayer(s, press(yaw, g), world, H);
  }
  return settle(world, s, yaw, g);
}

/** Cuánto (m) está `p` adentro de la puerta, medido desde su cara de afuera hacia adentro (negativo: afuera). */
export const doorDepth = (d: Door, p: Vec3): number => -((p[0] - d.at[0]) * d.normal[0] + (p[2] - d.at[1]) * d.normal[1]);

/**
 * Entra por la puerta `d` con W: arranca a `from` m del centro (2 por defecto), a la altura de su nivel (nivel · 3,2) y
 * mirando hacia adentro, girado `angleDeg` desde la normal; aprieta W (con Shift o agachado si se pide) sin cambiar de
 * rumbo hasta quedar 2 m adentro o hasta `seconds` (6). Una puerta de nivel > 0 da a un balcón: `from: 1`.
 */
export function enterDoor(
  world: CollisionWorld, d: Door, o: { angleDeg?: number; sprint?: boolean; crouch?: boolean; from?: number; seconds?: number } = {},
): PlayerState {
  const a = ((o.angleDeg ?? 0) * Math.PI) / 180;
  const [ix, iz] = [-d.normal[0], -d.normal[1]];
  const dir: Vec2 = [ix * Math.cos(a) - iz * Math.sin(a), ix * Math.sin(a) + iz * Math.cos(a)];
  const from = o.from ?? 2;
  let s = initialState([d.at[0] - dir[0] * from, d.level * LEVEL_H, d.at[1] - dir[1] * from]);
  const yaw = yawToward(dir);
  for (let k = 0; k < (o.seconds ?? 6) * SIM_HZ && doorDepth(d, s.pos) < 2; k++) s = stepPlayer(s, press(yaw, o), world, H);
  return s;
}

/** Desde `from` camina derecho a cada punto de `to` (las `marks` de un plan), en orden, y frena en el último. */
export function walkTo(world: CollisionWorld, from: Vec3, to: Vec2 | readonly Vec2[], seconds = 10): PlayerState {
  const pts: readonly Vec2[] = typeof to[0] === 'number' ? [to as Vec2] : (to as readonly Vec2[]);
  return walkPath(world, initialState(from), pts, seconds, {});
}

/** Sube la escalera de `foot` a `top` (o la baja, con `down`) con W, mirando a lo largo de ella; con Shift si se pide. */
export function climbStair(world: CollisionWorld, s: StairRun, down = false, o: { sprint?: boolean } = {}): PlayerState {
  const [a, b] = down ? [s.top, s.foot] : [s.foot, s.top];
  return walkPath(world, initialState(a), [[b[0], b[2]]], 10, o);
}

/** ¿`p` está adentro del edificio: sobre su planta y por debajo del techo? */
export const insideOf = (b: Building, p: Vec3): boolean => p[1] < b.height && pointInPolygon([p[0], p[2]], b.footprint);
