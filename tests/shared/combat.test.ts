import { AMMO_BOX, AMMO_MAX, WEAPONS, applyDamage, applyZoneDamage, canFire, finishReload, fire, hitscan, newGun, shotDamage, spreadDirs, spreadFor, startReload } from '../../src/shared/combat.ts';
import type { Hitbox } from '../../src/shared/combat.ts';
import { CollisionWorld } from '../../src/shared/collision.ts';
import type { Prism } from '../../src/shared/collision.ts';
import type { Vec3 } from '../../src/shared/geo.ts';
import { createRng } from '../../src/shared/rng.ts';

const bounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
const box = (x0: number, z0: number, x1: number, z1: number, maxY = 6): Prism => ({ polygon: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], minY: 0, maxY });
const mk = (prisms: Prism[] = []) => new CollisionWorld(prisms, [], bounds);
const dummy: Hitbox = { id: 'm', pos: [0, 0, -10], crouching: false };
const N: Vec3 = [0, 0, -1];
/** Dispara desde (0, h, 0) hacia el punto (0, aimY, tg.z) del maniquí (por defecto horizontal). */
const shootAt = (world: CollisionWorld, h: number, tg = dummy, aimY = h) => {
  const o: Vec3 = [0, h, 0];
  return hitscan(world, [tg], o, [tg.pos[0] - o[0], aimY - h, tg.pos[2] - o[2]], 100);
};

describe('daño y chaleco', () => {
  it('el chaleco recibe primero', () => {
    expect(applyDamage({ hp: 100, armor: 30 }, 50)).toEqual({ hp: 80, armor: 0 });
  });
  it('la zona solo daña la vida', () => {
    expect(applyZoneDamage({ hp: 100, armor: 50 }, 10)).toEqual({ hp: 90, armor: 50 });
  });
  it('munición', () => {
    expect(AMMO_BOX).toEqual({ liviana: 30, cartuchos: 12, pesada: 8 });
    expect(AMMO_MAX).toEqual({ liviana: 180, cartuchos: 48, pesada: 32 });
  });
});

describe('arma en la mano', () => {
  it('el rifle vacía el cargador en 29/9 s', () => {
    let g = newGun('rifle');
    for (let i = 0; i < 30; i++) {
      const t = i / 9;
      expect(canFire(g, t)).toBe(true);
      g = fire(g, t);
    }
    expect(g.inMag).toBe(0);
    expect(g.nextShotAt).toBeCloseTo(30 / 9, 9);
    expect(canFire(g, 29 / 9 + 1)).toBe(false); // vacío
  });
  it('respeta la cadencia', () => {
    const g = fire(newGun('rifle'), 0);
    expect(canFire(g, 0.05)).toBe(false);
    expect(canFire(g, 1 / 9)).toBe(true);
  });
  it('no se dispara recargando; finishReload pasa de la reserva', () => {
    let g = newGun('rifle');
    for (let i = 0; i < 20; i++) g = fire(g, i);
    expect(g.inMag).toBe(10);
    g = startReload(g, 100, 10);
    expect(g.reloadUntil).toBeCloseTo(102, 9);
    expect(canFire(g, 101)).toBe(false);
    expect(finishReload(g, 101, 10).used).toBe(0);
    const r = finishReload(g, 102, 10);
    expect(r.used).toBe(10);
    expect(r.gun.inMag).toBe(20);
    expect(r.gun.reloadUntil).toBeNull();
  });
  it('finishReload con reserva 10 y cargador vacío deja inMag 10', () => {
    let g = newGun('rifle');
    g = { ...g, inMag: 0 };
    g = startReload(g, 0, 10);
    const r = finishReload(g, 5, 10);
    expect(r.gun.inMag).toBe(10);
    expect(r.used).toBe(10);
  });
  it('startReload no hace nada con cargador lleno o sin reserva', () => {
    const full = newGun('pistola');
    expect(startReload(full, 0, 50)).toBe(full);
    const empty = { ...full, inMag: 0 };
    expect(startReload(empty, 0, 0)).toBe(empty);
  });
});

describe('spreadDirs', () => {
  it('spread 0 da la dirección del yaw/pitch (yaw 0 = −z)', () => {
    const rng = createRng(1);
    const [d] = spreadDirs(rng, 0, 0, 0, 1);
    expect(d[0]).toBeCloseTo(0, 9); expect(d[1]).toBeCloseTo(0, 9); expect(d[2]).toBeCloseTo(-1, 9);
    const [l] = spreadDirs(rng, Math.PI / 2, 0, 0, 1); // yaw positivo gira a la izquierda (−x)
    expect(l[0]).toBeCloseTo(-1, 9); expect(l[2]).toBeCloseTo(0, 9);
    const [u] = spreadDirs(rng, 0, Math.PI / 2, 0, 1);
    expect(u[1]).toBeCloseTo(1, 9);
  });
  it('con 5° ningún rayo se aparta más de 5°, y son unitarios', () => {
    const yaw = 0.7, pitch = -0.3;
    const [c] = spreadDirs(createRng(1), yaw, pitch, 0, 1);
    for (const d of spreadDirs(createRng(3), yaw, pitch, 5, 500)) {
      expect(Math.hypot(...d)).toBeCloseTo(1, 9);
      const ang = Math.acos(Math.min(1, d[0] * c[0] + d[1] * c[1] + d[2] * c[2])) * 180 / Math.PI;
      expect(ang).toBeLessThanOrEqual(5 + 1e-9);
    }
  });
});

describe('spreadDirs distribución', () => {
  it('uniforme en el disco: ~25 % dentro de la mitad del ángulo, laterales centrados', () => {
    const yaw = 0.7, pitch = -0.3, max = 5, n = 4000;
    const [c] = spreadDirs(createRng(1), yaw, pitch, 0, 1);
    const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const up: Vec3 = [Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
    let inner = 0, sr = 0, su = 0;
    for (const d of spreadDirs(createRng(5), yaw, pitch, max, n)) {
      const ang = Math.acos(Math.min(1, d[0] * c[0] + d[1] * c[1] + d[2] * c[2])) * 180 / Math.PI;
      if (ang <= max / 2) inner++;
      sr += d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
      su += d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    }
    expect(Math.abs(inner / n - 0.25)).toBeLessThan(0.03);
    expect(Math.abs(sr / n)).toBeLessThan(0.002);
    expect(Math.abs(su / n)).toBeLessThan(0.002);
  });
});

describe('spreadFor', () => {
  const st = (aiming: boolean, moving: boolean) => ({ aiming, moving });
  it('francotirador: 0° con mira (quieto o no), 6° sin mira', () => {
    const w = WEAPONS.francotirador;
    expect(spreadFor(w, st(true, false))).toBe(0);
    expect(spreadFor(w, st(true, true))).toBe(0);
    expect(spreadFor(w, st(false, false))).toBe(6);
    expect(spreadFor(w, st(false, true))).toBe(6);
  });
  it('rifle: quieto/moviéndose, y la mira baja a la mitad', () => {
    const w = WEAPONS.rifle;
    expect(spreadFor(w, st(false, false))).toBeCloseTo(0.8, 9);
    expect(spreadFor(w, st(false, true))).toBeCloseTo(3, 9);
    expect(spreadFor(w, st(true, false))).toBeCloseTo(0.4, 9);
    expect(spreadFor(w, st(true, true))).toBeCloseTo(1.5, 9);
  });
});

describe('hitscan', () => {
  it('maniquí a 10 m: cabeza, cuerpo, piernas', () => {
    const w = mk();
    expect(shootAt(w, 1.6)).toMatchObject({ kind: 'target', part: 'cabeza' });
    expect(shootAt(w, 1.0)).toMatchObject({ kind: 'target', part: 'cuerpo' });
    const l = shootAt(w, 0.4);
    expect(l).toMatchObject({ kind: 'target', part: 'piernas' });
    expect(l!.dist).toBeCloseTo(10 - 0.35, 6);
  });
  it('agachado las partes se escalan por 1,2/1,8', () => {
    const w = mk(), c: Hitbox = { ...dummy, crouching: true };
    expect(shootAt(w, 1.1, c)).toMatchObject({ part: 'cabeza' });
    expect(shootAt(w, 0.7, c)).toMatchObject({ part: 'cuerpo' });
    expect(shootAt(w, 0.3, c)).toMatchObject({ part: 'piernas' });
    expect(shootAt(w, 1.5, c)).toBeNull(); // por encima del agachado
  });
  it('una pared en el medio da world', () => {
    const r = shootAt(mk([box(-5, -6, 5, -5)]), 1.0);
    expect(r).toMatchObject({ kind: 'world' });
    expect(r!.dist).toBeCloseTo(5, 6);
  });
  it('apuntando al piso da world con normal (0,1,0)', () => {
    const r = hitscan(mk(), [], [0, 1.6, 0], [0, -1, -1], 50);
    expect(r).toMatchObject({ kind: 'world', normal: [0, 1, 0] });
    expect(r!.dist).toBeCloseTo(1.6 * Math.SQRT2, 6);
  });
  it('tiro lateral que pasa a 0,4 m del eje no pega', () => {
    expect(hitscan(mk(), [dummy], [0.4, 1, 0], N, 100)).toBeNull();
    expect(hitscan(mk(), [dummy], [0.3, 1, 0], N, 100)).toMatchObject({ kind: 'target' });
  });
  it('un maniquí a la espalda no cuenta', () => {
    expect(hitscan(mk(), [dummy], [0, 1, 0], [0, 0, 1], 100)).toBeNull();
  });
  it('tiro desde arriba a la tapa pega en la cabeza', () => {
    // desde (0, 6, -4), hacia el punto (0, 1.8, -10): entra por la tapa
    const r = hitscan(mk(), [dummy], [0, 6, -4], [0, -4.2, -6], 100);
    expect(r).toMatchObject({ kind: 'target', part: 'cabeza' });
    expect(r!.point[1]).toBeCloseTo(1.8, 6);
  });
  it('tiro en pendiente al cuerpo', () => {
    // de (0, 3, 0) hacia (0, 1.0, -10) cruza el cilindro cerca de y ≈ 1.1
    const r = shootAt(mk(), 3, dummy, 1.0);
    expect(r).toMatchObject({ kind: 'target', part: 'cuerpo' });
    expect(r!.point[1]).toBeGreaterThan(0.8);
    expect(r!.point[1]).toBeLessThan(1.45);
  });
  it('de dos maniquíes gana el más cercano aunque venga segundo', () => {
    const far: Hitbox = { id: 'lejos', pos: [0, 0, -20], crouching: false };
    const near: Hitbox = { id: 'cerca', pos: [0, 0, -10], crouching: false };
    expect(hitscan(mk(), [far, near], [0, 1, 0], N, 100)).toMatchObject({ id: 'cerca' });
  });
  it('maniquí delante de la pared da target; pared delante del maniquí da world', () => {
    expect(hitscan(mk([box(-5, -16, 5, -15)]), [dummy], [0, 1, 0], N, 100)).toMatchObject({ kind: 'target', id: 'm' });
    expect(hitscan(mk([box(-5, -6, 5, -5)]), [dummy], [0, 1, 0], N, 100)).toMatchObject({ kind: 'world' });
  });
  it('un tiro en pendiente que toca el piso antes del maniquí da world', () => {
    // de (0, 1.6, 0) hacia (0, 0, -20): toca el piso a 20 m, antes del maniquí que está a 30 m
    const r = hitscan(mk(), [{ ...dummy, pos: [0, 0, -30] }], [0, 1.6, 0], [0, -1.6, -20], 100);
    expect(r).toMatchObject({ kind: 'world', normal: [0, 1, 0] });
    expect(r!.point[2]).toBeCloseTo(-20, 6);
  });
  it('el alcance corta el rayo', () => {
    expect(hitscan(mk(), [dummy], [0, 1, 0], N, 5)).toBeNull();
  });
  it('un rayo que arranca adentro de un prisma pega ahí a distancia 0', () => {
    const r = hitscan(mk([box(-1, -1, 1, 1)]), [dummy], [0, 1, 0], N, 100);
    expect(r).toMatchObject({ kind: 'world', dist: 0 });
  });
});

describe('shotDamage', () => {
  it('francotirador a la cabeza: 190; piernas ×0,75', () => {
    expect(shotDamage(WEAPONS.francotirador, 'cabeza', 50)).toBe(190);
    expect(shotDamage(WEAPONS.rifle, 'piernas', 10)).toBeCloseTo(15, 9);
  });
  it('perdigón de escopeta: 10 hasta 10 m, 3 a 35 m', () => {
    expect(shotDamage(WEAPONS.escopeta, 'cuerpo', 10)).toBe(10);
    expect(shotDamage(WEAPONS.escopeta, 'cuerpo', 35)).toBeCloseTo(3, 9);
    expect(shotDamage(WEAPONS.escopeta, 'cuerpo', 22.5)).toBeCloseTo(6.5, 9);
  });
});
