import type { CollisionWorld } from './collision.ts';
import type { Vec3 } from './geo.ts';
import type { Rng } from './rng.ts';

export type WeaponId = 'pistola' | 'escopeta' | 'rifle' | 'francotirador';
export type AmmoId = 'liviana' | 'cartuchos' | 'pesada';

export interface WeaponSpec {
  /** daño por proyectil (por perdigón en la escopeta) */
  damage: number;
  pellets: number;
  /** disparos por segundo */
  rate: number;
  /** true = mantener el gatillo sigue disparando */
  auto: boolean;
  mag: number;
  /** segundos de recarga */
  reload: number;
  /** dispersión en grados (semiángulo del cono), sin apuntar */
  spreadStill: number;
  spreadMove: number;
  range: number;
  /** distancia desde la que baja el daño (lineal hasta `range`, con piso del 30 %) */
  falloffFrom?: number;
  ammo: AmmoId;
  headMult: number;
  /** fov (grados) al apuntar. Escopeta: 55°, como la pistola y el rifle (el spec no le fija uno). */
  aimFov: number;
}

/** Valores del spec §4. */
export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistola: { damage: 22, pellets: 1, rate: 4, auto: false, mag: 12, reload: 1.2, spreadStill: 1, spreadMove: 2.5, range: 120, ammo: 'liviana', headMult: 1.5, aimFov: 55 },
  escopeta: { damage: 10, pellets: 8, rate: 1.1, auto: false, mag: 6, reload: 2.4, spreadStill: 5, spreadMove: 6, range: 35, falloffFrom: 10, ammo: 'cartuchos', headMult: 1.5, aimFov: 55 },
  rifle: { damage: 20, pellets: 1, rate: 9, auto: true, mag: 30, reload: 2.0, spreadStill: 0.8, spreadMove: 3, range: 250, ammo: 'liviana', headMult: 1.5, aimFov: 55 },
  francotirador: { damage: 95, pellets: 1, rate: 0.7, auto: false, mag: 5, reload: 3.0, spreadStill: 0, spreadMove: 6, range: 400, ammo: 'pesada', headMult: 2, aimFov: 20 },
};

export const AMMO_BOX: Record<AmmoId, number> = { liviana: 30, cartuchos: 12, pesada: 8 };
export const AMMO_MAX: Record<AmmoId, number> = { liviana: 180, cartuchos: 48, pesada: 32 };

// ---------- vida y chaleco ----------

export interface Vitals { hp: number; armor: number }

/** El chaleco absorbe primero; lo que sobra va a la vida (nunca baja de 0). */
export function applyDamage(v: Vitals, dmg: number): Vitals {
  const toArmor = Math.min(v.armor, dmg);
  return { hp: Math.max(0, v.hp - (dmg - toArmor)), armor: v.armor - toArmor };
}

/** La zona ignora el chaleco: solo vida. */
export function applyZoneDamage(v: Vitals, dmg: number): Vitals {
  return { hp: Math.max(0, v.hp - dmg), armor: v.armor };
}

// ---------- arma en la mano ----------

export interface Gun { id: WeaponId; inMag: number; nextShotAt: number; reloadUntil: number | null }

export function newGun(id: WeaponId): Gun {
  return { id, inMag: WEAPONS[id].mag, nextShotAt: 0, reloadUntil: null };
}

export function canFire(g: Gun, t: number): boolean {
  return g.reloadUntil === null && g.inMag > 0 && t >= g.nextShotAt - 1e-9; // tolerancia: t + 1/rate acumula error de punto flotante
}

/** Consume 1 bala y fija el próximo disparo. Si no se puede disparar, devuelve el arma sin cambios. */
export function fire(g: Gun, t: number): Gun {
  if (!canFire(g, t)) return g;
  return { ...g, inMag: g.inMag - 1, nextShotAt: t + 1 / WEAPONS[g.id].rate };
}

/** Empieza a recargar. No hace nada con el cargador lleno, sin reserva o si ya está recargando. */
export function startReload(g: Gun, t: number, reserve: number): Gun {
  const w = WEAPONS[g.id];
  if (g.reloadUntil !== null || g.inMag >= w.mag || reserve <= 0) return g;
  return { ...g, reloadUntil: t + w.reload };
}

/** Termina la recarga cuando llegó la hora: pasa balas de la reserva al cargador y dice cuántas usó. */
export function finishReload(g: Gun, t: number, reserve: number): { gun: Gun; used: number } {
  if (g.reloadUntil === null || t < g.reloadUntil) return { gun: g, used: 0 };
  const used = Math.max(0, Math.min(WEAPONS[g.id].mag - g.inMag, reserve));
  return { gun: { ...g, inMag: g.inMag + used, reloadUntil: null }, used };
}

// ---------- dispersión ----------

/** Direcciones unitarias de `pellets` rayos, uniformes en el disco angular de semiángulo `spreadDeg` alrededor de la
 *  mira. Convención de la cámara (player.ts / scene.ts, orden 'YXZ'): yaw 0 mira a −z, yaw positivo gira a la
 *  izquierda (hacia −x), pitch positivo mira arriba. */
export function spreadDirs(rng: Rng, yaw: number, pitch: number, spreadDeg: number, pellets: number): Vec3[] {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const fwd: Vec3 = [-sy * cp, sp, -cy * cp];
  const right: Vec3 = [cy, 0, -sy];
  const up: Vec3 = [sy * sp, cp, cy * sp];
  const max = (spreadDeg * Math.PI) / 180;
  const out: Vec3[] = [];
  for (let i = 0; i < pellets; i++) {
    const theta = max * Math.sqrt(rng.next()); // sqrt: densidad uniforme en el disco
    const phi = 2 * Math.PI * rng.next();
    const s = Math.sin(theta), c = Math.cos(theta), a = s * Math.cos(phi), b = s * Math.sin(phi);
    out.push([
      c * fwd[0] + a * right[0] + b * up[0],
      c * fwd[1] + a * right[1] + b * up[1],
      c * fwd[2] + a * right[2] + b * up[2],
    ]);
  }
  return out;
}

// ---------- hitscan ----------

export interface Hitbox { id: string; pos: Vec3 /* pies */; crouching: boolean }
export type HitPart = 'cabeza' | 'cuerpo' | 'piernas';
export type ShotHit =
  | { kind: 'target'; id: string; part: HitPart; dist: number; point: Vec3 }
  | { kind: 'world'; dist: number; point: Vec3; normal: Vec3 };

export const BODY_RADIUS = 0.35;
const STAND_H = 1.8, CROUCH_H = 1.2;
const LEGS_TOP = 0.8, BODY_TOP = 1.45;
const EPS = 1e-6;

/** Distancia a la que el rayo (dir unitaria) entra en el cilindro vertical del cuerpo, o null. */
function rayCylinder(o: Vec3, d: Vec3, pos: Vec3, h: number, maxDist: number): number | null {
  const ox = o[0] - pos[0], oz = o[2] - pos[2];
  const a = d[0] * d[0] + d[2] * d[2];
  let tIn: number, tOut: number;
  if (a < 1e-12) { // rayo vertical: adentro o afuera del círculo todo el tiempo
    if (ox * ox + oz * oz > BODY_RADIUS * BODY_RADIUS) return null;
    tIn = -Infinity; tOut = Infinity;
  } else {
    const b = ox * d[0] + oz * d[2];
    const c = ox * ox + oz * oz - BODY_RADIUS * BODY_RADIUS;
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    tIn = (-b - sq) / a; tOut = (-b + sq) / a;
  }
  // recorta a la altura [0, h]
  if (Math.abs(d[1]) < 1e-12) {
    if (o[1] < pos[1] || o[1] > pos[1] + h) return null;
  } else {
    const t0 = (pos[1] - o[1]) / d[1], t1 = (pos[1] + h - o[1]) / d[1];
    tIn = Math.max(tIn, Math.min(t0, t1)); tOut = Math.min(tOut, Math.max(t0, t1));
  }
  if (tIn > tOut || tOut < 0) return null;
  const t = Math.max(tIn, 0);
  return t <= maxDist ? t : null;
}

function partAt(yFromFeet: number, crouching: boolean): HitPart {
  const y = crouching ? yFromFeet * (STAND_H / CROUCH_H) : yFromFeet;
  return y < LEGS_TOP ? 'piernas' : y < BODY_TOP ? 'cuerpo' : 'cabeza';
}

/** Primer impacto del rayo en `range` metros: cuerpos (cilindros de radio 0,35), prismas del mundo o el piso (y = 0).
 *  Un rayo que nace adentro de un prisma pega ahí mismo (dist 0), no lo atraviesa. */
export function hitscan(world: CollisionWorld, targets: readonly Hitbox[], origin: Vec3, dir: Vec3, range: number): ShotHit | null {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 0)) return null;
  const d: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
  const at = (t: number): Vec3 => [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t];

  // mundo
  let worldHit: { dist: number; point: Vec3; normal: Vec3 } | null = null;
  if (world.overlaps(origin[0], origin[2], 0, origin[1] - EPS, origin[1] + EPS)) {
    worldHit = { dist: 0, point: [origin[0], origin[1], origin[2]], normal: [-d[0] + 0, -d[1] + 0, -d[2] + 0] };
  } else {
    const r = world.raycast(origin, d, range);
    if (r) worldHit = { dist: r.dist, point: r.point, normal: r.normal };
    if (d[1] < 0 && origin[1] > 0) {
      const tg = -origin[1] / d[1];
      if (tg <= range && (worldHit === null || tg < worldHit.dist)) worldHit = { dist: tg, point: [origin[0] + d[0] * tg, 0, origin[2] + d[2] * tg], normal: [0, 1, 0] };
    }
  }

  // cuerpos
  let best: { id: string; dist: number; crouching: boolean; pos: Vec3 } | null = null;
  for (const tg of targets) {
    const h = tg.crouching ? CROUCH_H : STAND_H;
    const t = rayCylinder(origin, d, tg.pos, h, worldHit ? Math.min(range, worldHit.dist) : range);
    if (t !== null && (best === null || t < best.dist)) best = { id: tg.id, dist: t, crouching: tg.crouching, pos: tg.pos };
  }
  if (best && (worldHit === null || best.dist < worldHit.dist)) {
    const point = at(best.dist);
    const part = partAt(Math.min(Math.max(point[1] - best.pos[1], 0), best.crouching ? CROUCH_H : STAND_H), best.crouching);
    return { kind: 'target', id: best.id, part, dist: best.dist, point };
  }
  return worldHit ? { kind: 'world', ...worldHit } : null;
}

// ---------- daño ----------

const LEG_MULT = 0.75;
const FALLOFF_FLOOR = 0.3;

/** Daño de un proyectil: multiplicador por zona y, si el arma tiene `falloffFrom`, caída lineal hasta `range`
 *  (piso del 30 %). */
export function shotDamage(w: WeaponSpec, part: HitPart, dist: number): number {
  let dmg = w.damage * (part === 'cabeza' ? w.headMult : part === 'piernas' ? LEG_MULT : 1);
  if (w.falloffFrom !== undefined && dist > w.falloffFrom) {
    const k = Math.min(1, (dist - w.falloffFrom) / (w.range - w.falloffFrom));
    dmg *= 1 - k * (1 - FALLOFF_FLOOR);
  }
  return dmg;
}
