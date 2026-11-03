// Controlador del jugador: puro y determinista (mismo estado + entrada + dt → mismo resultado, sin azar ni reloj).
// Lo usan el cliente en cada cuadro y, más adelante, el servidor autoritativo: solo depende de src/shared.
import type { CollisionWorld } from './collision.ts';
import type { Vec3 } from './geo.ts';

export const PLAYER = { radius: 0.35, height: 1.8, crouchHeight: 1.2, eye: 1.65, crouchEye: 1.05, runSpeed: 6.0, crouchSpeed: 2.5,
  airControl: 0.3, gravity: 20, jumpVelocity: 7.07, stepUp: 0.45, mantleReach: 2.4, mantleTime: 0.45, ladderSpeed: 3.0, maxDt: 0.1, subStep: 1/120 } as const;

/** yaw: convención de la cámara de three.js (orden 'YXZ'); yaw = 0 mira hacia −z (norte). pitch solo mueve la cámara. */
export interface PlayerInput { forward: -1|0|1; right: -1|0|1; jump: boolean; crouch: boolean; yaw: number; pitch: number }
/** pos = pies. mantleT = segundos transcurridos del mantle (0 … mantleTime). jumpHeld = jump venía apretado del paso
 *  anterior: saltar pide apretarlo de nuevo (mantenerlo no rebota). */
export interface PlayerState { pos: Vec3; vel: Vec3; onGround: boolean; crouching: boolean;
  mode: 'walk'|'ladder'|'mantle'; mantleFrom?: Vec3; mantleTo?: Vec3; mantleT?: number; jumpHeld?: boolean }

const R = PLAYER.radius;
/** En el suelo la velocidad horizontal va hacia la pedida a esta aceleración: de 0 a runSpeed (o a frenar) en 0,1 s. */
const GROUND_ACCEL = PLAYER.runSpeed / 0.1;
/** En el aire se conserva la velocidad; la entrada empuja con airControl × la aceleración del suelo. */
const AIR_ACCEL = GROUND_ACCEL * PLAYER.airControl;
/** El borde para trepar se mide a esta distancia hacia adelante y el mantle deja al jugador ahí. Arriba de una
 *  escalera, el mismo empuje lo deja a esta distancia de la pared, sobre el techo. */
const MANTLE_PUSH = 0.6;
/** Holgura de mantleReach (2,4 entra; 2,6 no). */
const REACH_EPS = 1e-6;
/** Para agarrarse de una escalera hay que mirar hacia la pared: a lo sumo 60° de la normal hacia adentro. */
const LADDER_FACING = 0.5;
/** Y tiene que quedar al menos esto por subir (parado en el techo junto a la escalera no se agarra). */
const LADDER_MIN_CLIMB = 0.1;

interface Command {
  forward: number;
  jump: boolean;
  crouch: boolean;
  fx: number; fz: number; // hacia dónde mira (unitario, en el plano)
  wx: number; wz: number; // dirección pedida (unitaria, o 0 sin entrada)
}

/** Estado de trabajo, mutable: stepPlayer lo arma a partir de una copia y devuelve un PlayerState nuevo. */
interface Work {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  onGround: boolean;
  crouching: boolean;
  mode: PlayerState['mode'];
  from: Vec3; to: Vec3; mt: number;
  jumpHeld: boolean;
}

export function initialState(spawn: Vec3): PlayerState {
  return { pos: [spawn[0], spawn[1], spawn[2]], vel: [0, 0, 0], onGround: true, crouching: false, mode: 'walk', jumpHeld: false };
}

/** Altura de los ojos sobre los pies. */
export function eyeHeight(s: PlayerState): number {
  return s.crouching ? PLAYER.crouchEye : PLAYER.eye;
}

/** Avanza `dt` segundos (recortado a maxDt) en subpasos iguales de a lo sumo subStep. No modifica `s`. */
export function stepPlayer(s: PlayerState, input: PlayerInput, world: CollisionWorld, dt: number): PlayerState {
  const t = dt > 0 ? Math.min(dt, PLAYER.maxDt) : 0; // NaN o negativo → 0
  const n = Math.ceil(t / PLAYER.subStep - 1e-9);
  const h = n > 0 ? t / n : 0;
  const c = command(input);
  const m = load(s);
  for (let i = 0; i < n; i++) {
    const jumpPressed = c.jump && !m.jumpHeld;
    if (m.mode === 'mantle') mantleStep(m, h);
    else if (m.mode === 'ladder') ladderStep(m, c, world, h);
    else walkStep(m, c, world, h, jumpPressed);
    m.jumpHeld = c.jump;
  }
  return save(m);
}

function command(input: PlayerInput): Command {
  const yaw = Number.isFinite(input.yaw) ? input.yaw : 0;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const fx = -sin, fz = -cos; // adelante
  const rx = cos, rz = -sin; // derecha
  const f = Math.sign(input.forward) || 0, r = Math.sign(input.right) || 0;
  let wx = fx * f + rx * r, wz = fz * f + rz * r;
  const len = Math.hypot(wx, wz);
  if (len > 0) {
    wx /= len; wz /= len; // en diagonal no se corre más rápido
  }
  return { forward: f, jump: input.jump === true, crouch: input.crouch === true, fx, fz, wx, wz };
}

function load(s: PlayerState): Work {
  const mantle = s.mode === 'mantle' && s.mantleFrom !== undefined && s.mantleTo !== undefined;
  return {
    x: s.pos[0], y: s.pos[1], z: s.pos[2],
    vx: s.vel[0], vy: s.vel[1], vz: s.vel[2],
    onGround: s.onGround,
    crouching: s.crouching,
    mode: mantle ? 'mantle' : s.mode === 'ladder' ? 'ladder' : 'walk',
    from: mantle ? [s.mantleFrom![0], s.mantleFrom![1], s.mantleFrom![2]] : [0, 0, 0],
    to: mantle ? [s.mantleTo![0], s.mantleTo![1], s.mantleTo![2]] : [0, 0, 0],
    mt: mantle ? s.mantleT ?? 0 : 0,
    jumpHeld: s.jumpHeld === true,
  };
}

function save(m: Work): PlayerState {
  const out: PlayerState = { pos: [m.x, m.y, m.z], vel: [m.vx, m.vy, m.vz], onGround: m.onGround, crouching: m.crouching, mode: m.mode, jumpHeld: m.jumpHeld };
  if (m.mode === 'mantle') {
    out.mantleFrom = [m.from[0], m.from[1], m.from[2]];
    out.mantleTo = [m.to[0], m.to[1], m.to[2]];
    out.mantleT = m.mt;
  }
  return out;
}

/** ¿El cuerpo (alto h, pies en `feet`) en (x, z) se mete en algún prisma? Con los pies justo en una tapa, esa no cuenta. */
const blocked = (world: CollisionWorld, x: number, z: number, feet: number, h: number): boolean => world.overlaps(x, z, R, feet, feet + h);

function inBounds(world: CollisionWorld, x: number, z: number): boolean {
  const b = world.bounds;
  return x >= b.minX + R && x <= b.maxX - R && z >= b.minZ + R && z <= b.maxZ - R;
}

function walkStep(m: Work, c: Command, world: CollisionWorld, h: number, jumpPressed: boolean): void {
  if (c.crouch) m.crouching = true;
  else if (m.crouching && !blocked(world, m.x, m.z, m.y, PLAYER.height)) m.crouching = false; // pararse pide lugar
  const bodyH = m.crouching ? PLAYER.crouchHeight : PLAYER.height;

  if (m.onGround) settle(m, world, bodyH); // pies sobre el apoyo antes del pushOut horizontal

  if (c.jump && c.forward > 0 && tryMantle(m, c, world)) return;
  if (c.forward > 0 && !c.jump && tryLadder(m, c, world)) return;

  if (m.onGround) {
    const speed = m.crouching ? PLAYER.crouchSpeed : PLAYER.runSpeed;
    accelerate(m, c.wx * speed, c.wz * speed, GROUND_ACCEL * h);
    m.vy = 0;
    if (jumpPressed) {
      m.vy = PLAYER.jumpVelocity;
      m.onGround = false;
    }
  } else if (c.wx !== 0 || c.wz !== 0) {
    accelerate(m, c.wx * PLAYER.runSpeed, c.wz * PLAYER.runSpeed, AIR_ACCEL * h);
  }

  moveHorizontal(m, world, h, bodyH);
  if (!m.onGround) moveVertical(m, world, h, bodyH);
}

/** Lleva (vx, vz) hacia (tx, tz) cambiándola a lo sumo maxDv. */
function accelerate(m: Work, tx: number, tz: number, maxDv: number): void {
  const dx = tx - m.vx, dz = tz - m.vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDv) {
    m.vx = tx; m.vz = tz;
  } else {
    m.vx += (dx / d) * maxDv; m.vz += (dz / d) * maxDv;
  }
}

/** Con el jugador en el suelo: los pies pasan al apoyo más alto hasta feet + stepUp (sube un escalón o baja hasta
 *  stepUp); si abajo no hay nada a menos de stepUp, queda en el aire. Devuelve false, sin tocar nada, si para subir
 *  el escalón no hay lugar para el cuerpo. */
function settle(m: Work, world: CollisionWorld, bodyH: number): boolean {
  const sup = world.supportHeight(m.x, m.z, R, m.y + PLAYER.stepUp);
  if (sup < m.y - PLAYER.stepUp) {
    m.onGround = false;
    return true;
  }
  if (sup > m.y && blocked(world, m.x, m.z, sup, bodyH)) return false;
  m.y = sup;
  return true;
}

/** Mueve en el plano con pushOut. En el suelo las paredes empiezan arriba de la franja de stepUp (lo más bajo se
 *  sube como escalón); en el aire, en los pies. Si no se puede resolver (sigue superpuesto, o el escalón no entra), el
 *  subpaso no se mueve en el plano. La velocidad queda como el desplazamiento real (pierde lo que iba contra la pared). */
function moveHorizontal(m: Work, world: CollisionWorld, h: number, bodyH: number): void {
  const x0 = m.x, z0 = m.z;
  const cx = x0 + m.vx * h, cz = z0 + m.vz * h;
  const lo = m.onGround ? m.y + PLAYER.stepUp : m.y, hi = m.y + bodyH;
  let [x, z] = world.pushOut(cx, cz, R, lo, hi);
  const b = world.bounds;
  const bx = Math.min(Math.max(x, b.minX + R), b.maxX - R);
  const bz = Math.min(Math.max(z, b.minZ + R), b.maxZ - R);
  const clampedX = bx !== x, clampedZ = bz !== z;
  x = bx; z = bz;
  if (world.overlaps(x, z, R, lo, hi)) {
    x = x0; z = z0;
  }
  m.x = x; m.z = z;
  if (m.onGround && !settle(m, world, bodyH)) {
    m.x = x = x0; m.z = z = z0;
  }
  if (x !== cx || z !== cz) {
    m.vx = (x - x0) / h; m.vz = (z - z0) / h;
  }
  if (clampedX) m.vx = 0;
  if (clampedZ) m.vz = 0;
}

/** Gravedad (integración exacta con aceleración constante). Aterriza en el apoyo más alto que cruza. */
function moveVertical(m: Work, world: CollisionWorld, h: number, bodyH: number): void {
  const g = PLAYER.gravity;
  const y0 = m.y;
  const y1 = y0 + m.vy * h - 0.5 * g * h * h;
  const sup = world.supportHeight(m.x, m.z, R, y0);
  if (y1 <= sup) {
    m.y = sup; m.vy = 0; m.onGround = true;
    return;
  }
  if (y1 > y0 && blocked(world, m.x, m.z, y1, bodyH)) {
    m.vy = 0; // la cabeza contra algo: deja de subir
    return;
  }
  m.y = y1;
  m.vy -= g * h;
}

/** Trepar: jump + forward frente a un borde cuya tapa, a MANTLE_PUSH adelante, está entre stepUp y mantleReach por
 *  encima de donde se paró (en el suelo, los pies; en el aire, el apoyo que tiene debajo: saltar no suma alcance) y
 *  por encima de los pies, con lugar para el cuerpo parado arriba y en el camino. */
function tryMantle(m: Work, c: Command, world: CollisionWorld): boolean {
  const px = m.x + c.fx * MANTLE_PUSH, pz = m.z + c.fz * MANTLE_PUSH;
  const top = world.supportHeight(px, pz, 0, Infinity);
  const base = m.onGround ? m.y : world.supportHeight(m.x, m.z, R, m.y);
  const rise = top - base;
  if (!(top > m.y) || rise <= PLAYER.stepUp || rise > PLAYER.mantleReach + REACH_EPS) return false;
  if (!inBounds(world, px, pz) || blocked(world, px, pz, top, PLAYER.height)) return false;
  if (blocked(world, m.x, m.z, m.y, top - m.y + PLAYER.height)) return false; // lugar para subir donde está
  startMantle(m, px, top, pz);
  return true;
}

function startMantle(m: Work, x: number, y: number, z: number): void {
  m.mode = 'mantle';
  m.from = [m.x, m.y, m.z];
  m.to = [x, y, z];
  m.mt = 0;
  m.vx = 0; m.vy = 0; m.vz = 0;
  m.onGround = false;
}

/** Recorre en mantleTime, a velocidad constante, un camino en L: primero sube hasta la altura del borde y después
 *  avanza sobre él (así el cuerpo no atraviesa la esquina). La entrada se ignora. */
function mantleStep(m: Work, h: number): void {
  m.mt += h;
  const { from, to } = m;
  if (m.mt >= PLAYER.mantleTime - 1e-9) {
    m.x = to[0]; m.y = to[1]; m.z = to[2];
    m.mode = 'walk';
    m.onGround = true;
    return;
  }
  const rise = Math.max(0, to[1] - from[1]);
  const flat = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const d = ((rise + flat) * m.mt) / PLAYER.mantleTime;
  if (d <= rise) {
    m.x = from[0]; m.y = from[1] + d; m.z = from[2];
  } else {
    const k = (d - rise) / flat;
    m.x = from[0] + (to[0] - from[0]) * k; m.y = to[1]; m.z = from[2] + (to[2] - from[2]) * k;
  }
}

/** Agarrarse: forward (sin jump) dentro del volumen de una escalera, mirando hacia la pared y con algo por subir. */
function tryLadder(m: Work, c: Command, world: CollisionWorld): boolean {
  const l = world.ladderAt(m.x, m.z, R, m.y);
  if (!l || m.y >= l.topY - LADDER_MIN_CLIMB) return false;
  const nl = Math.hypot(l.normal[0], l.normal[1]);
  if (!(nl > 0) || -(c.fx * l.normal[0] + c.fz * l.normal[1]) / nl < LADDER_FACING) return false;
  m.mode = 'ladder';
  m.vx = 0; m.vy = 0; m.vz = 0;
  m.onGround = false;
  return true;
}

/** En la escalera: forward sube a ladderSpeed sin gravedad y sin moverse en el plano; sin forward queda quieto; jump o
 *  ir para atrás lo sueltan (cae). Al llegar a topY, el mismo empuje que el mantle lo deja sobre el techo. */
function ladderStep(m: Work, c: Command, world: CollisionWorld, h: number): void {
  const l = world.ladderAt(m.x, m.z, R, m.y);
  if (!l || c.jump || c.forward < 0) {
    m.mode = 'walk';
    m.onGround = false;
    m.vx = 0; m.vy = 0; m.vz = 0;
    return;
  }
  m.vy = 0;
  if (c.forward <= 0) return;
  const bodyH = m.crouching ? PLAYER.crouchHeight : PLAYER.height;
  const y = Math.min(m.y + PLAYER.ladderSpeed * h, l.topY);
  if (blocked(world, m.x, m.z, y, bodyH)) return;
  m.y = y;
  if (y < l.topY) {
    m.vy = PLAYER.ladderSpeed;
    return;
  }
  const nl = Math.hypot(l.normal[0], l.normal[1]);
  const tx = l.base[0] - (l.normal[0] / nl) * MANTLE_PUSH, tz = l.base[1] - (l.normal[1] / nl) * MANTLE_PUSH;
  if (inBounds(world, tx, tz) && !blocked(world, tx, tz, l.topY, PLAYER.height)) startMantle(m, tx, l.topY, tz);
}
