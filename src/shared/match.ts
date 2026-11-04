// La partida de práctica (spec 2a §2–§6): estado puro y determinista. `stepMatch(estado, entrada, mundo, h)` devuelve un
// estado nuevo sin tocar el anterior, sin reloj ni Math.random. Lo corre el cliente a 60 Hz y, en la etapa 3, el servidor.
//
// El estado es datos (se puede copiar con structuredClone). El azar de los disparos no vive en un objeto Rng: cada
// disparo arma el suyo a partir de (seed, shotSeq), y shotSeq cuenta los disparos hechos.
//
// Tiempos: un paso cubre [t, t + h). Lo que se empieza en el paso (recarga, curación) arranca en t; lo que vence (fin de
// la recarga o de la curación, el próximo disparo) pasa en el paso donde cae su hora, sin redondear al paso siguiente.
// Así la cadencia es la de la tabla (9/s del rifle) y no la que da cuantizar a 60 Hz.
import { AMMO_BOX, AMMO_MAX, BODY_RADIUS, WEAPONS, applyDamage, applyZoneDamage, bodyHeight, finishReload, fire, hitscan, newGun, shotDamage,
  spreadDirs, spreadFor, startReload } from './combat.ts';
import type { AmmoId, Gun, HitPart, Hitbox, Vitals, WeaponId } from './combat.ts';
import type { CollisionWorld } from './collision.ts';
import type { Vec3 } from './geo.ts';
import { rollLoot } from './loot.ts';
import type { Drop, LootItem } from './loot.ts';
import type { MapData } from './mapdata.ts';
import { PLAYER, eyeHeight, initialState, stepPlayer } from './player.ts';
import type { PlayerInput, PlayerState } from './player.ts';
import { createRng } from './rng.ts';
import type { Rng } from './rng.ts';
import { planZone, zoneAt } from './zone.ts';
import type { ZonePlan } from './zone.ts';

/** Reglas de la partida (spec 2a §3 y §5). */
export const MATCH = {
  hpMax: 100, armorMax: 100,
  /** lo que suma un chaleco */
  armorPickup: 50,
  medkitsMax: 3,
  /** lo que cura un botiquín y cuánto tarda (s) */
  heal: 50, healTime: 3,
  /** factor de la velocidad de caminar mientras se cura */
  healSlow: 0.5,
  /** juntar: en planta a menos de pickReach m y mirándolo (coseno > pickCos desde el ojo), o a menos de pickNear m */
  pickReach: 2.5, pickNear: 1, pickCos: 0.8,
  /** el piso del objeto, a lo sumo a esta altura de los pies: ni el techo de arriba ni la calle de abajo */
  pickDy: 1,
  /** los objetos flotan a esta altura sobre su `pos`: ahí se los mira para juntarlos */
  dropLift: 0.3,
  /** más rápido que esto (m/s, en 3D: saltar o trepar también cuenta) es moverse para la dispersión */
  movingSpeed: 0.5,
  /** se aparece adentro del primer círculo de la zona, a por lo menos esto (m) de su borde */
  spawnMargin: 10,
} as const;

export interface Fighter { id: string; name: string; player: PlayerState; vitals: Vitals; alive: boolean; diedAt?: number }
export interface Inventory { slots: [Gun | null, Gun | null]; active: 0 | 1; ammo: Record<AmmoId, number>; medkits: number; healingUntil: number | null }
/** Un objeto en el piso. Un arma que se tiró guarda las balas de su cargador (`inMag`); la del botín viene llena. */
export interface MatchDrop extends Drop { inMag?: number }

export type MatchEvent =
  | { type: 'shot'; weapon: WeaponId; from: Vec3; to: Vec3[] }
  | { type: 'hit'; id: string; part: HitPart; dmg: number; point: Vec3 }
  | { type: 'impact'; point: Vec3; normal: Vec3 }
  | { type: 'kill'; id: string; name: string }
  | { type: 'pickup'; item: LootItem }
  | { type: 'reload'; weapon: WeaponId }
  | { type: 'empty' }
  | { type: 'zone-hurt'; dmg: number }
  | { type: 'over'; won: boolean };

export interface MatchState {
  t: number; seed: number; me: Fighter; inv: Inventory; dummies: Fighter[]; drops: MatchDrop[]; zone: ZonePlan; aiming: boolean;
  /** los del último paso: stepMatch los vacía al empezar */
  events: MatchEvent[];
  /** alive: cuántos quedaban vivos (en la victoria, 1: el jugador). Se gana cuando mueren todos los maniquíes; sin
   *  maniquíes desde el principio (práctica libre) solo termina con la muerte del jugador. */
  over: null | { won: boolean; alive: number; at: number };
  /** eliminaciones del jugador (las muertes por la zona no cuentan) */
  kills: number;
  nextDropId: number;
  /** hacia dónde miró el jugador en el último paso: lo usa nearestDrop */
  look: { yaw: number; pitch: number };
  /** botones que venían apretados del paso anterior: las semiautomáticas disparan y E junta por flanco */
  held: { fire: boolean; use: boolean };
  /** disparos hechos: el azar de cada uno sale de (seed, shotSeq) */
  shotSeq: number;
}

/** Entrada de un paso. `fire` y `aim` son estados: true mientras el botón está apretado. `use`, `heal`, `reload` y `slot`
 *  son pulsos: el cliente guarda cada toque hasta que lo consume un paso y en los siguientes van en false / null (la
 *  acción que arrancó sigue sola). `use` igual se toma por flanco: si llega apretado varios pasos, junta una sola vez. */
export interface MatchInput extends PlayerInput { fire: boolean; aim: boolean; reload: boolean; use: boolean; heal: boolean; slot: 0 | 1 | null }

/** Un número de 32 bits sacado del rng, para sembrar otro sorteo. */
const seedFrom = (rng: Rng): number => Math.floor(rng.next() * 4294967296) >>> 0;

/** Semilla del disparo n de la partida (mezcla tipo murmur3: disparos vecinos dan secuencias sin relación). */
function shotSeed(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Partida nueva. Con la semilla se sortean, en este orden: el botín, la zona, los puntos de aparición (distintos, entre
 * los de `map.randomSpawns` donde el cuerpo no se mete en ningún sólido y que quedan adentro del primer círculo: ver
 * spawnsInside) y el chaleco de cada maniquí (0, 25 o 50).
 * El botín sale antes que todo lo demás: la misma semilla da el mismo botín con cualquier cantidad de maniquíes.
 */
export function newMatch(map: MapData, world: CollisionWorld, opts: { seed: number; dummies: number }): MatchState {
  const n = opts.dummies;
  const free = map.randomSpawns.filter((p) => !world.overlaps(p[0], p[2], PLAYER.radius, p[1], p[1] + PLAYER.height));
  if (!Number.isInteger(n) || n < 0 || n + 1 > free.length) {
    throw new RangeError(`No entran ${n} maniquíes: hay ${free.length} puntos de aparición libres para ${n + 1} jugadores`);
  }
  const rng = createRng(opts.seed);
  const drops: MatchDrop[] = rollLoot(map.lootSpots, seedFrom(rng));
  const zone = planZone(map.bounds, n + 1, seedFrom(rng));
  const spawns = spawnsInside(free, zone, n + 1);
  // Fisher–Yates parcial: los primeros n + 1 quedan sorteados y sin repetir.
  const order = spawns.map((_, i) => i);
  for (let i = 0; i <= n; i++) {
    const j = i + Math.floor(rng.next() * (order.length - i));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const fighter = (id: string, name: string, spawn: Vec3, armor: number): Fighter =>
    ({ id, name, player: initialState(spawn), vitals: { hp: MATCH.hpMax, armor }, alive: true });
  const dummies: Fighter[] = [];
  for (let i = 1; i <= n; i++) dummies.push(fighter(`m${i}`, `Maniquí ${i}`, spawns[order[i]], 25 * Math.floor(rng.next() * 3)));
  return {
    t: 0, seed: opts.seed,
    me: fighter('yo', 'Vos', spawns[order[0]], 0),
    inv: { slots: [null, null], active: 0, ammo: { liviana: 0, cartuchos: 0, pesada: 0 }, medkits: 0, healingUntil: null },
    dummies, drops, zone, aiming: false, events: [], over: null, kills: 0,
    nextDropId: drops.reduce((m, d) => Math.max(m, d.id), 0) + 1,
    look: { yaw: 0, pitch: 0 }, held: { fire: false, use: false }, shotSeq: 0,
  };
}

/**
 * Los puntos de aparición de `free` que quedan adentro del primer círculo de la zona, a por lo menos spawnMargin de su
 * borde, en el orden de `free`. Con pocos jugadores el círculo se achica (diseño general §3.1) y pueden no alcanzar
 * para `players`: se completa con los de afuera más cercanos al centro. Si están todos adentro (la partida de 12) la
 * lista es `free` tal cual y el sorteo es el mismo que sin este filtro.
 */
function spawnsInside(free: readonly Vec3[], zone: ZonePlan, players: number): Vec3[] {
  const fromCenter = (p: Vec3): number => Math.hypot(p[0] - zone.center0[0], p[2] - zone.center0[1]);
  const limit = zone.r0 - MATCH.spawnMargin;
  const inside = free.filter((p) => fromCenter(p) <= limit);
  if (inside.length >= players) return inside;
  const nearest = free.filter((p) => fromCenter(p) > limit).sort((a, b) => fromCenter(a) - fromCenter(b)); // estable: los empates, en el orden de free
  return [...inside, ...nearest.slice(0, players - inside.length)];
}

/** Los cuerpos a los que se puede pegar: los maniquíes vivos (el jugador nunca es blanco de sus propios tiros). */
export function hitboxes(s: MatchState): Hitbox[] {
  return bodies(s.dummies);
}

function bodies(fighters: readonly Fighter[]): Hitbox[] {
  return fighters.filter((f) => f.alive).map((f) => ({ id: f.id, pos: f.player.pos, crouching: f.player.crouching }));
}

/** El objeto que juntaría `use` ahora (para el cartel "E: juntar…"), o null. */
export function nearestDrop(s: MatchState): MatchDrop | null {
  return s.over ? null : dropInReach(s.drops, s.me.player, s.me.vitals, s.inv, s.look);
}

/** ¿Sirve juntarlo? Un arma, siempre; la munición, el chaleco y los botiquines, si no se llegó al máximo. */
function canTake(item: LootItem, vitals: Vitals, inv: Inventory): boolean {
  switch (item.kind) {
    case 'arma': return true;
    case 'municion': return inv.ammo[item.ammo] < AMMO_MAX[item.ammo];
    case 'chaleco': return vitals.armor < MATCH.armorMax;
    case 'botiquin': return inv.medkits < MATCH.medkitsMax;
  }
}

/** Mirada unitaria con la convención de la cámara (spreadDirs): yaw 0 mira a −z, pitch positivo mira arriba. */
const gaze = (yaw: number, pitch: number): Vec3 => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

/** El más cercano en planta de los que sirve juntar, a menos de pickReach, con el piso a menos de pickDy de los pies y
 *  mirándolo desde el ojo (coseno > pickCos), salvo que esté a menos de pickNear. */
function dropInReach(drops: readonly MatchDrop[], p: PlayerState, vitals: Vitals, inv: Inventory, look: MatchState['look']): MatchDrop | null {
  const eyeY = p.pos[1] + eyeHeight(p);
  const g = gaze(look.yaw, look.pitch);
  let best: MatchDrop | null = null;
  let bestD: number = MATCH.pickReach;
  for (const d of drops) {
    const dx = d.pos[0] - p.pos[0], dz = d.pos[2] - p.pos[2];
    const dh = Math.hypot(dx, dz);
    if (dh >= bestD || Math.abs(d.pos[1] - p.pos[1]) > MATCH.pickDy || !canTake(d.item, vitals, inv)) continue;
    if (dh >= MATCH.pickNear) {
      const dy = d.pos[1] + MATCH.dropLift - eyeY;
      if (!(dx * g[0] + dy * g[1] + dz * g[2] > MATCH.pickCos * Math.hypot(dx, dy, dz))) continue;
    }
    best = d;
    bestD = dh;
  }
  return best;
}

/**
 * Movimiento del jugador. Durante la curación se camina a healSlow de la velocidad sin tocar stepPlayer: en el piso el
 * paso se corre en cámara lenta en el plano. stepPlayer avanza h·k con la velocidad del plano dividida por k y al final
 * se la multiplica por k: el desplazamiento es v·h, la velocidad tiende a k·runSpeed (o k·crouchSpeed) y `vel` sigue
 * siendo la real. En el aire, en la escalera o trepando, el paso es normal: la gravedad y los tiempos no cambian.
 */
function move(p: PlayerState, input: PlayerInput, world: CollisionWorld, h: number, healing: boolean): PlayerState {
  if (!healing || p.mode !== 'walk' || !p.onGround) return stepPlayer(p, input, world, h);
  const k = MATCH.healSlow;
  const q = stepPlayer({ ...p, vel: [p.vel[0] / k, p.vel[1], p.vel[2] / k] }, input, world, h * k);
  return { ...q, vel: [q.vel[0] * k, q.vel[1], q.vel[2] * k] };
}

/** Holgura para "ya está en el borde de un cuerpo" (el empuje lo deja justo en PLAYER.radius + BODY_RADIUS). */
const TOUCH_EPS = 1e-6;

/**
 * Los maniquíes vivos son sólidos para el jugador, pero no son apoyo: encima de uno no se para. Si el paso dejó al
 * jugador metido en uno (en planta, a menos de PLAYER.radius + BODY_RADIUS de su eje, y con las alturas superpuestas:
 * con los pies arriba de su cabeza no lo toca), se lo saca en planta hasta ese borde y pierde la velocidad que llevaba
 * hacia adentro (así se resbala por el costado). Si así queda metido en el mundo, fuera del mapa o en otro maniquí,
 * vuelve en planta adonde estaba antes del paso; y si ni ahí entra, el mundo gana y queda como lo dejó el paso.
 */
function keepOutOfBodies(p: PlayerState, before: PlayerState, dummies: readonly Fighter[], world: CollisionWorld): PlayerState {
  const reach = PLAYER.radius + BODY_RADIUS;
  const y = p.pos[1], top = y + (p.crouching ? PLAYER.crouchHeight : PLAYER.height);
  const solid = dummies.filter((f) => f.alive && y < f.player.pos[1] + bodyHeight(f.player.crouching) && f.player.pos[1] < top);
  let x = p.pos[0], z = p.pos[2], vx = p.vel[0], vz = p.vel[2];
  let pushed = false;
  for (const f of solid) {
    const c = f.player.pos;
    let nx = x - c[0], nz = z - c[2];
    const dist = Math.hypot(nx, nz);
    if (dist >= reach - TOUCH_EPS) continue;
    if (dist > 1e-9) {
      nx /= dist; nz /= dist;
    } else { // justo en el eje: hacia donde estaba antes del paso (o hacia +x)
      nx = before.pos[0] - c[0]; nz = before.pos[2] - c[2];
      const l = Math.hypot(nx, nz);
      [nx, nz] = l > 1e-9 ? [nx / l, nz / l] : [1, 0];
    }
    x = c[0] + nx * reach; z = c[2] + nz * reach;
    const vn = vx * nx + vz * nz;
    if (vn < 0) {
      vx -= vn * nx; vz -= vn * nz;
    }
    pushed = true;
  }
  if (!pushed) return p;
  // donde el cuerpo entra: adentro del mapa, sin pared (en el piso, arriba de la franja de los escalones, como
  // stepPlayer) y sin otro maniquí
  const lo = p.onGround ? y + PLAYER.stepUp : y, b = world.bounds, R = PLAYER.radius;
  const fits = (px: number, pz: number, others: boolean): boolean =>
    px >= b.minX + R && px <= b.maxX - R && pz >= b.minZ + R && pz <= b.maxZ - R && !world.overlaps(px, pz, R, lo, top)
    && !(others && solid.some((f) => Math.hypot(px - f.player.pos[0], pz - f.player.pos[2]) < reach - TOUCH_EPS));
  if (fits(x, z, true)) return { ...p, pos: [x, y, z], vel: [vx, p.vel[1], vz] };
  if (fits(before.pos[0], before.pos[2], false)) return { ...p, pos: [before.pos[0], y, before.pos[2]], vel: [0, p.vel[1], 0] };
  return p;
}

const finite = (x: number): number => (Number.isFinite(x) ? x : 0);

/** Juntar `d` (que está en `drops`): el inventario, el chaleco y el piso que quedan. No modifica lo que recibe. */
function takeDrop(d: MatchDrop, inv: Inventory, vitals: Vitals, drops: readonly MatchDrop[], nextDropId: number):
  { inv: Inventory; vitals: Vitals; drops: MatchDrop[]; nextDropId: number } {
  const out: Inventory = { ...inv, slots: [inv.slots[0], inv.slots[1]], ammo: { ...inv.ammo } };
  const floor = drops.filter((x) => x !== d);
  const it = d.item;
  switch (it.kind) {
    case 'arma': {
      const gun: Gun = d.inMag === undefined ? newGun(it.weapon) : { ...newGun(it.weapon), inMag: d.inMag };
      const a = out.active, b = a === 0 ? 1 : 0;
      const inHand = out.slots[a];
      if (inHand === null) out.slots[a] = gun;
      else if (out.slots[b] === null) out.slots[b] = gun;
      else { // las dos llenas: la de la mano queda en el piso, donde estaba el objeto
        floor.push({ id: nextDropId++, pos: [d.pos[0], d.pos[1], d.pos[2]], item: { kind: 'arma', weapon: inHand.id }, inMag: inHand.inMag });
        out.slots[a] = gun;
      }
      break;
    }
    case 'municion': out.ammo[it.ammo] = Math.min(AMMO_MAX[it.ammo], out.ammo[it.ammo] + AMMO_BOX[it.ammo]); break;
    case 'chaleco': vitals = { ...vitals, armor: Math.min(MATCH.armorMax, vitals.armor + MATCH.armorPickup) }; break;
    case 'botiquin': out.medkits++; break;
  }
  return { inv: out, vitals, drops: floor, nextDropId };
}

/** Un disparo de `gun` (que ya puede disparar en este paso) desde el ojo de `p`, con el azar `rng`: el arma después del
 *  tiro, los maniquíes como quedan y los eventos (`shot`, y un `hit` o un `impact` por perdigón que pega). No modifica lo
 *  que recibe. */
function shoot(gun: Gun, p: PlayerState, look: MatchState['look'], aiming: boolean, dummies: readonly Fighter[], world: CollisionWorld,
  rng: Rng, t0: number): { gun: Gun; dummies: Fighter[]; events: MatchEvent[] } {
  const w = WEAPONS[gun.id];
  const eye: Vec3 = [p.pos[0], p.pos[1] + eyeHeight(p), p.pos[2]];
  const moving = Math.hypot(p.vel[0], p.vel[1], p.vel[2]) > MATCH.movingSpeed;
  const dirs = spreadDirs(rng, look.yaw, look.pitch, spreadFor(w, { aiming, moving }), w.pellets);
  const targets = bodies(dummies);
  const out = dummies.slice();
  const shot = { type: 'shot' as const, weapon: gun.id, from: eye, to: [] as Vec3[] };
  const events: MatchEvent[] = [shot];
  for (const dir of dirs) {
    const hit = hitscan(world, targets, eye, dir, w.range);
    if (!hit) {
      shot.to.push([eye[0] + dir[0] * w.range, eye[1] + dir[1] * w.range, eye[2] + dir[2] * w.range]);
      continue;
    }
    shot.to.push(hit.point);
    if (hit.kind === 'world') {
      events.push({ type: 'impact', point: hit.point, normal: hit.normal });
      continue;
    }
    const dmg = shotDamage(w, hit.part, hit.dist);
    const i = out.findIndex((f) => f.id === hit.id);
    out[i] = { ...out[i], vitals: applyDamage(out[i].vitals, dmg) };
    events.push({ type: 'hit', id: hit.id, part: hit.part, dmg, point: hit.point });
  }
  return { gun: fire(gun, Math.max(t0, gun.nextShotAt)), dummies: out, events }; // a su hora, aunque caiga a mitad del paso
}

/**
 * Un paso de la partida, en este orden: movimiento, cambio de ranura, juntar, recarga, disparo, curación, zona, y
 * muertes y fin. Con `over` puesto solo avanza `t` (y los eventos quedan vacíos).
 */
export function stepMatch(s: MatchState, input: MatchInput, world: CollisionWorld, h: number): MatchState {
  const dt = h > 0 && Number.isFinite(h) ? h : 0;
  const t0 = s.t, t1 = s.t + dt;
  if (s.over) return { ...s, t: t1, events: [] };

  const events: MatchEvent[] = [];
  const look = { yaw: finite(input.yaw), pitch: finite(input.pitch) };
  // copias de trabajo: se modifican estas, nunca las de `s`
  let inv: Inventory = { ...s.inv, slots: [s.inv.slots[0], s.inv.slots[1]], ammo: { ...s.inv.ammo } };
  let dummies = s.dummies.slice(); // los que cambian se reemplazan por copias
  let vitals = s.me.vitals;
  let drops = s.drops;
  let nextDropId = s.nextDropId;
  let shotSeq = s.shotSeq;
  let kills = s.kills;
  const usePressed = input.use === true && !s.held.use;
  const firePressed = input.fire === true && !s.held.fire;

  // 1. movimiento: contra el mundo (stepPlayer) y después contra los maniquíes
  const player = keepOutOfBodies(move(s.me.player, input, world, dt, inv.healingUntil !== null), s.me.player, dummies, world);

  // 2. cambio de ranura: cancela la recarga del arma que se guarda y la curación
  if ((input.slot === 0 || input.slot === 1) && input.slot !== inv.active) {
    const old = inv.slots[inv.active];
    if (old && old.reloadUntil !== null) inv.slots[inv.active] = { ...old, reloadUntil: null };
    inv.active = input.slot;
    inv.healingUntil = null;
  }

  // 3. juntar
  const d = usePressed ? dropInReach(drops, player, vitals, inv, look) : null;
  if (d) {
    ({ inv, vitals, drops, nextDropId } = takeDrop(d, inv, vitals, drops, nextDropId));
    events.push({ type: 'pickup', item: d.item });
  }

  let gun = inv.slots[inv.active];
  const aiming = input.aim === true && gun !== null;

  // 4. recarga
  if (gun) {
    const ammo = WEAPONS[gun.id].ammo;
    if (gun.reloadUntil !== null && gun.reloadUntil < t1) {
      const r = finishReload(gun, gun.reloadUntil, inv.ammo[ammo]);
      inv.ammo[ammo] -= r.used;
      gun = r.gun;
    }
    if (input.reload) {
      const r = startReload(gun, t0, inv.ammo[ammo]);
      if (r !== gun) events.push({ type: 'reload', weapon: gun.id });
      gun = r;
    }
  }

  // 5. disparo: las semiautomáticas por flanco, la automática mientras está apretado
  if (gun && gun.reloadUntil === null && (WEAPONS[gun.id].auto ? input.fire === true : firePressed)) {
    if (gun.inMag <= 0) {
      if (firePressed) events.push({ type: 'empty' });
    } else if (gun.nextShotAt < t1) {
      const r = shoot(gun, player, look, aiming, dummies, world, createRng(shotSeed(s.seed, shotSeq++)), t0);
      gun = r.gun;
      dummies = r.dummies;
      events.push(...r.events);
      inv.healingUntil = null; // disparar cancela la curación
    }
  }
  if (gun) inv.slots[inv.active] = gun;
  const shotDown = new Set(dummies.filter((f) => f.alive && f.vitals.hp <= 0).map((f) => f.id));

  // 6. curación: con H y botiquines, healTime s y +heal hasta hpMax; el botiquín se gasta al terminar
  if (inv.healingUntil !== null) {
    if (inv.healingUntil < t1) {
      vitals = { ...vitals, hp: Math.min(MATCH.hpMax, vitals.hp + MATCH.heal) };
      inv.medkits--;
      inv.healingUntil = null;
    }
  } else if (input.heal && inv.medkits > 0 && vitals.hp < MATCH.hpMax) {
    inv.healingUntil = t0 + MATCH.healTime;
  }

  // 7. zona: daño a todos los vivos afuera, solo a la vida. Cerrada (radio 0), todos están afuera: la partida termina.
  const z = zoneAt(s.zone, t0);
  const zoneDmg = z.dps * dt;
  const outside = (p: Vec3): boolean => z.r <= 0 || Math.hypot(p[0] - z.center[0], p[2] - z.center[1]) > z.r;
  if (zoneDmg > 0) {
    if (outside(player.pos)) {
      vitals = applyZoneDamage(vitals, zoneDmg);
      events.push({ type: 'zone-hurt', dmg: zoneDmg });
    }
    dummies.forEach((f, i) => {
      if (f.alive && outside(f.player.pos)) dummies[i] = { ...f, vitals: applyZoneDamage(f.vitals, zoneDmg) };
    });
  }

  // 8. muertes y fin. `kill` y kills, solo para los que voló el jugador en este paso.
  dummies.forEach((f, i) => {
    if (!f.alive || f.vitals.hp > 0) return;
    dummies[i] = { ...f, alive: false, diedAt: t1 };
    if (shotDown.has(f.id)) {
      events.push({ type: 'kill', id: f.id, name: f.name });
      kills++;
    }
  });
  const meAlive = vitals.hp > 0;
  const me: Fighter = meAlive ? { ...s.me, player, vitals } : { ...s.me, player, vitals, alive: false, diedAt: t1 };
  const left = dummies.filter((f) => f.alive).length;
  // Sin maniquíes desde el principio es práctica libre: no se gana, termina solo si muere el jugador.
  const won = left === 0 && dummies.length > 0;
  const over = !meAlive ? { won: false, alive: left, at: t1 } : won ? { won: true, alive: 1, at: t1 } : null;
  if (over) events.push({ type: 'over', won: over.won });

  return {
    ...s, t: t1, me, inv, dummies, drops, aiming, events, over, kills, nextDropId, look,
    held: { fire: input.fire === true, use: input.use === true }, shotSeq,
  };
}
