// La mira: el fov al que va la vista y cuándo se ve la mira telescópica. Con estados de verdad de newMatch.
import { aimTarget, scoped } from '../../src/client/aim.ts';
import { CollisionWorld } from '../../src/shared/collision.ts';
import { newGun, WEAPONS } from '../../src/shared/combat.ts';
import type { WeaponId } from '../../src/shared/combat.ts';
import type { Vec3 } from '../../src/shared/geo.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { newMatch } from '../../src/shared/match.ts';
import type { MatchState } from '../../src/shared/match.ts';

const NORMAL = 75;
const bounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
const map: MapData = {
  version: 1, origin: { lat: 0, lon: 0 }, bounds, buildings: [], outskirts: [], roads: [], railways: [], platforms: [],
  parks: [], places: [], signs: [], props: [], trees: [],
  randomSpawns: Array.from({ length: 4 }, (_, i) => [-15 + 10 * i, 0, 50] as Vec3),
  lootSpots: [],
};
const world = new CollisionWorld([], [], bounds);

/** Con el arma en la mano y apuntando (o no). */
function holding(weapon: WeaponId, aiming: boolean, f: (c: MatchState) => void = () => {}): MatchState {
  const c = structuredClone(newMatch(map, world, { seed: 1, dummies: 1 }));
  c.inv.slots[0] = newGun(weapon);
  c.aiming = aiming;
  f(c);
  return c;
}
const won = (c: MatchState): void => { c.over = { won: true, alive: 1, at: 30 }; };

test('apuntando, el fov va al de la mira del arma; sin apuntar, sin arma o muerto, al normal', () => {
  expect(aimTarget(holding('rifle', true), NORMAL)).toBe(WEAPONS.rifle.aimFov);
  expect(aimTarget(holding('francotirador', true), NORMAL)).toBe(WEAPONS.francotirador.aimFov);
  expect(aimTarget(holding('rifle', false), NORMAL)).toBe(NORMAL);
  expect(aimTarget(holding('rifle', true, (c) => { c.inv.slots[0] = null; }), NORMAL)).toBe(NORMAL);
  expect(aimTarget(holding('rifle', true, (c) => { c.me.alive = false; }), NORMAL)).toBe(NORMAL);
});

test('terminada la partida (aunque se siguiera apuntando) el fov vuelve al normal', () => {
  expect(aimTarget(holding('francotirador', true, won), NORMAL)).toBe(NORMAL);
});

test('la mira telescópica: francotirador apuntando y el fov ya más cerca del de la mira que del normal', () => {
  const zoom = WEAPONS.francotirador.aimFov;
  expect(scoped(holding('francotirador', true), zoom, NORMAL)).toBe(true);
  expect(scoped(holding('francotirador', true), NORMAL - 1, NORMAL)).toBe(false); // recién empieza a cerrarse
  expect(scoped(holding('francotirador', false), zoom, NORMAL)).toBe(false);
  expect(scoped(holding('rifle', true), WEAPONS.rifle.aimFov, NORMAL)).toBe(false); // sin mira telescópica
});

test('terminada la partida no se ve la mira telescópica detrás de la pantalla de fin', () => {
  expect(scoped(holding('francotirador', true, won), WEAPONS.francotirador.aimFov, NORMAL)).toBe(false);
});

test('una partida nueva arranca sin apuntar', () => {
  const fresh = newMatch(map, world, { seed: 2, dummies: 1 });
  expect(fresh.aiming).toBe(false);
  expect(aimTarget(fresh, NORMAL)).toBe(NORMAL);
});
