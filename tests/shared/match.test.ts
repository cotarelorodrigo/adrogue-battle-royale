import { readFileSync } from 'node:fs';
import { CollisionWorld, buildCollisionWorld } from '../../src/shared/collision.ts';
import { AMMO_BOX, AMMO_MAX, BODY_RADIUS, WEAPONS, newGun } from '../../src/shared/combat.ts';
import type { WeaponId } from '../../src/shared/combat.ts';
import { SIM_HZ } from '../../src/shared/fixed-step.ts';
import type { Vec3 } from '../../src/shared/geo.ts';
import type { LootItem } from '../../src/shared/loot.ts';
import type { Building, MapData } from '../../src/shared/mapdata.ts';
import { MATCH, canTake, hitboxes, nearestDrop, newMatch, stepMatch } from '../../src/shared/match.ts';
import type { MatchDrop, MatchEvent, MatchInput, MatchState } from '../../src/shared/match.ts';
import { PLAYER, initialState } from '../../src/shared/player.ts';
import { zoneAt } from '../../src/shared/zone.ts';

// Mapa mínimo: 200 × 200 m con un edificio de 6 m en x ∈ [20, 40], z ∈ [−10, 10]. El piso es y = 0.
const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
const building: Building = { id: 'b1', footprint: [[20, -10], [40, -10], [40, 10], [20, 10]], height: 6, floors: 2, kind: 'house', wall: 'plaster', tint: '#ccc' };
const INSIDE: Vec3 = [30, 0, 0]; // un punto de aparición adentro del edificio: nadie tiene que aparecer ahí
const map: MapData = {
  version: 1, origin: { lat: 0, lon: 0 }, bounds, buildings: [building], outskirts: [], roads: [], railways: [], platforms: [],
  parks: [], places: [], signs: [], props: [], trees: [],
  randomSpawns: [[0, 0, 0], [-30, 0, 0], [0, 0, -30], [0, 0, 30], INSIDE, [-30, 0, -30], [-30, 0, 30], [-60, 0, 0]],
  lootSpots: Array.from({ length: 10 }, (_, i) => ({ pos: [-50 + 10 * i, 0, 60] as Vec3, tier: 'lugar' as const })),
};
const world = new CollisionWorld([{ polygon: building.footprint, minY: 0, maxY: building.height }], [], bounds);
const open = new CollisionWorld([], [], bounds); // sin el edificio: la zona puede caer en cualquier lado
/** El mapa generado (public/map/adrogue.map.json), con sus 64 puntos de aparición. */
const realMap = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const realWorld = buildCollisionWorld(realMap);

const H = 1 / SIM_HZ;
const idle: MatchInput = { forward: 0, right: 0, jump: false, crouch: false, yaw: 0, pitch: 0, fire: false, aim: false, reload: false, use: false, heal: false, slot: null };
const step = (s: MatchState, inp: Partial<MatchInput> = {}, w = world, h = H): MatchState => stepMatch(s, { ...idle, ...inp }, w, h);
/** `secs` segundos a 60 Hz con la misma entrada; junta los eventos de todos los pasos. */
function run(s: MatchState, inp: Partial<MatchInput>, secs: number, all: MatchEvent[] = []): MatchState {
  for (let i = 0; i < Math.round(secs * SIM_HZ); i++) {
    s = step(s, inp);
    all.push(...s.events);
  }
  return s;
}
/** Un toque: un paso con los botones de `press` y otro sin ellos (con la misma mirada). */
const tap = (s: MatchState, press: Partial<MatchInput>, look: Partial<MatchInput> = {}): MatchState => step(step(s, { ...look, ...press }), look);
/** Copia modificada (el estado es datos: structuredClone alcanza). */
function mod(s: MatchState, f: (c: MatchState) => void): MatchState {
  const c = structuredClone(s);
  f(c);
  return c;
}
const of = <T extends MatchEvent['type']>(evs: MatchEvent[], type: T) => evs.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type);

/** Partida con el jugador en el origen (mirando a −z) y maniquíes quietos en `dummies`, sin chaleco salvo `armor`, y sin botín. */
function setup(dummies: Vec3[] = [[-40, 0, 0]], armor: number[] = []): MatchState {
  const s = newMatch(map, world, { seed: 1, dummies: dummies.length });
  return mod(s, (c) => {
    c.me.player = initialState([0, 0, 0]);
    c.dummies.forEach((d, i) => {
      d.player = initialState(dummies[i]);
      d.vitals = { hp: 100, armor: armor[i] ?? 0 };
    });
    c.drops = [];
  });
}
const withGun = (s: MatchState, slot: 0 | 1, id: WeaponId, ammo = 0) => mod(s, (c) => {
  c.inv.slots[slot] = newGun(id);
  c.inv.ammo[WEAPONS[id].ammo] = ammo;
});
const drop = (id: number, pos: Vec3, item: LootItem): MatchDrop => ({ id, pos, item });
const withDrops = (s: MatchState, drops: MatchDrop[]) => mod(s, (c) => {
  c.drops = drops;
  c.nextDropId = Math.max(0, ...drops.map((d) => d.id)) + 1;
});
/** Mirando a −z hacia abajo: los objetos a 1–2,5 m adelante quedan en la mira. */
const DOWN: Partial<MatchInput> = { pitch: -0.7 };
/** Pitch para que el rayo desde el ojo del jugador parado en el origen pase a la altura `y` a `d` m. */
const pitchTo = (y: number, d: number) => Math.atan2(y - PLAYER.eye, d);

describe('newMatch', () => {
  test('es determinista por semilla', () => {
    const a = newMatch(map, world, { seed: 3, dummies: 4 });
    expect(newMatch(map, world, { seed: 3, dummies: 4 })).toEqual(a);
    expect(structuredClone(a)).toEqual(a); // datos puros
    expect(newMatch(map, world, { seed: 4, dummies: 4 })).not.toEqual(a);
  });

  test('nadie arranca superpuesto ni adentro de un sólido; todos en puntos de aparición distintos', () => {
    const armors = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = newMatch(map, world, { seed, dummies: 6 }); // 7 jugadores en los 7 puntos libres
      const all = [s.me, ...s.dummies];
      for (const f of all) {
        expect(map.randomSpawns).toContainEqual(f.player.pos);
        expect(f.player.pos).not.toEqual(INSIDE);
        expect(world.overlaps(f.player.pos[0], f.player.pos[2], PLAYER.radius, 0, PLAYER.height)).toBe(false);
      }
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i].player.pos, b = all[j].player.pos;
          expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThanOrEqual(2 * PLAYER.radius);
        }
      }
      for (const d of s.dummies) {
        expect(d.vitals.hp).toBe(100);
        expect([0, 25, 50]).toContain(d.vitals.armor);
        armors.add(d.vitals.armor);
      }
    }
    expect([...armors].sort((x, y) => x - y)).toEqual([0, 25, 50]);
  });

  test('el jugador arranca sin armas, con vida 100 y chaleco 0; botín y zona sorteados', () => {
    const s = newMatch(map, world, { seed: 9, dummies: 3 });
    expect(s.me.vitals).toEqual({ hp: 100, armor: 0 });
    expect(s.me.alive).toBe(true);
    expect(s.inv).toEqual({ slots: [null, null], active: 0, ammo: { liviana: 0, cartuchos: 0, pesada: 0 }, medkits: 0, healingUntil: null });
    expect(s.dummies.map((d) => d.name)).toEqual(['Maniquí 1', 'Maniquí 2', 'Maniquí 3']);
    expect(new Set([s.me.id, ...s.dummies.map((d) => d.id)]).size).toBe(4);
    expect(s.drops.length).toBeGreaterThanOrEqual(10); // 'lugar' nunca sale vacío
    expect(s.nextDropId).toBe(Math.max(...s.drops.map((d) => d.id)) + 1);
    expect(s.zone.circles).toHaveLength(5);
    expect(s).toMatchObject({ t: 0, seed: 9, over: null, kills: 0, events: [], aiming: false });
  });

  test('sin puntos libres para todos, avisa', () => {
    expect(() => newMatch(map, world, { seed: 1, dummies: 7 })).toThrow(/puntos de aparición/);
  });

  test('en el mapa real, con 0 a 23 maniquíes, todos arrancan adentro del primer círculo', () => {
    let some = 0; // partidas donde algún punto libre quedaba afuera del círculo: el filtro hizo falta
    for (let n = 0; n <= 23; n++) {
      for (const seed of [1, 7, 42, 1234, 99991]) {
        const s = newMatch(realMap, realWorld, { seed, dummies: n });
        const z = zoneAt(s.zone, 0);
        for (const f of [s.me, ...s.dummies]) {
          expect(Math.hypot(f.player.pos[0] - z.center[0], f.player.pos[2] - z.center[1]), `n = ${n}, semilla ${seed}, ${f.id}`)
            .toBeLessThanOrEqual(z.r - MATCH.spawnMargin);
        }
        if (realMap.randomSpawns.some((p) => Math.hypot(p[0] - z.center[0], p[2] - z.center[1]) > z.r)) some++;
      }
    }
    expect(some).toBeGreaterThan(0);
  });

  test('si adentro del círculo no entran todos, se completa con los puntos más cercanos al centro', () => {
    // 200 × 200 m: con 3 jugadores r0 = 141,4 × 0,5 = 70,7 m. Adentro (a menos de r0 − 10) hay un solo punto.
    const far: MapData = { ...map, buildings: [], randomSpawns: [[0, 0, 95], [20, 0, 0], [0, 0, -68], [-90, 0, 0], [65, 0, 0]] };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = newMatch(far, open, { seed, dummies: 2 });
      expect(s.zone.r0).toBeCloseTo(70.71, 2);
      const all = [s.me, ...s.dummies].map((f) => f.player.pos);
      expect([...all].sort((a, b) => a[0] - b[0] || a[2] - b[2])).toEqual([[0, 0, -68], [20, 0, 0], [65, 0, 0]]);
      seen.add(JSON.stringify(s.me.player.pos));
    }
    expect(seen.size).toBe(3); // el sorteo sigue repartiendo quién va en cada uno
  });
});

describe('stepMatch: pureza', () => {
  test('no modifica el estado que recibe, y el mismo estado (o su copia) da lo mismo', () => {
    const s = withGun(setup([[0, 0, -10]]), 0, 'escopeta');
    const before = structuredClone(s);
    const inp = { fire: true, pitch: pitchTo(1.1, 10) };
    const a = step(s, inp);
    expect(s).toEqual(before);
    expect(step(s, inp)).toEqual(a);
    expect(step(structuredClone(s), inp)).toEqual(a);
    expect(of(a.events, 'shot')).toHaveLength(1);
    expect(a.t).toBeCloseTo(H, 12);
  });

  test('tampoco lo modifica al juntar con las ranuras llenas, terminar una recarga y una curación, y en la zona', () => {
    // en una esquina (afuera de la zona), con el rifle recargando y una curación, las dos por terminar en este paso
    const before = mod(withGun(withGun(setup(), 1, 'pistola'), 0, 'rifle', 50), (c) => {
      c.me.player = initialState([-95, 0, -95]);
      c.me.vitals.hp = 40;
      c.inv.medkits = 1;
      c.inv.healingUntil = 0;
      c.inv.slots[0]!.inMag = 5;
      c.inv.slots[0]!.reloadUntil = 0;
      c.drops = [drop(1, [-95, 0, -96.5], { kind: 'arma', weapon: 'escopeta' })];
      c.nextDropId = 2;
    });
    const snapBefore = structuredClone(before);
    const a = step(before, DOWN);
    expect(a.inv.slots[0]).toMatchObject({ inMag: 30, reloadUntil: null });
    expect(a.inv.ammo.liviana).toBe(25);
    expect(a.inv).toMatchObject({ medkits: 0, healingUntil: null });
    expect(a.events).toEqual([{ type: 'zone-hurt', dmg: H }]);
    expect(a.me.vitals.hp).toBeCloseTo(90 - H, 9);
    const snapA = structuredClone(a);
    const b = step(a, { ...DOWN, use: true }); // las dos ranuras llenas: el rifle queda en el piso
    expect(b.inv.slots.map((g) => g?.id)).toEqual(['escopeta', 'pistola']);
    expect(b.drops).toMatchObject([{ id: 2, item: { kind: 'arma', weapon: 'rifle' }, inMag: 30 }]);
    expect(before).toEqual(snapBefore);
    expect(a).toEqual(snapA);
  });

  test('los eventos son solo los del último paso', () => {
    const a = step(withGun(setup(), 0, 'pistola'), { fire: true });
    expect(of(a.events, 'shot')).toHaveLength(1);
    expect(step(a).events).toEqual([]);
  });
});

describe('juntar', () => {
  test('un arma con las ranuras vacías va al slot 0 con el cargador lleno; la caja de al lado es otro drop', () => {
    let s = withDrops(setup(), [
      drop(1, [0, 0, -1.5], { kind: 'arma', weapon: 'escopeta' }),
      drop(2, [0.6, 0, -1.5], { kind: 'municion', ammo: 'cartuchos' }),
    ]);
    s = step(s, DOWN);
    expect(nearestDrop(s)?.id).toBe(1);
    s = tap(s, { use: true }, DOWN);
    expect(s.inv.slots[0]).toMatchObject({ id: 'escopeta', inMag: WEAPONS.escopeta.mag, reloadUntil: null });
    expect(s.inv.slots[1]).toBeNull();
    expect(s.drops.map((d) => d.id)).toEqual([2]);
    expect(nearestDrop(s)?.id).toBe(2);
    s = step(s, { ...DOWN, use: true });
    expect(s.events).toEqual([{ type: 'pickup', item: { kind: 'municion', ammo: 'cartuchos' } }]);
    expect(s.inv.ammo.cartuchos).toBe(AMMO_BOX.cartuchos);
    expect(s.drops).toEqual([]);
    expect(nearestDrop(s)).toBeNull();
  });

  test('E junta una vez por toque, aunque quede apretada', () => {
    let s = withDrops(setup(), [drop(1, [0, 0, -1.5], { kind: 'botiquin' }), drop(2, [0.3, 0, -1.6], { kind: 'botiquin' })]);
    s = run(s, { ...DOWN, use: true }, 0.5);
    expect(s.inv.medkits).toBe(1);
  });

  test('hay que mirarlo, salvo que esté a menos de 1 m; a 2,5 m o más no se junta', () => {
    const at = (pos: Vec3, look: Partial<MatchInput>) => nearestDrop(step(withDrops(setup(), [drop(1, pos, { kind: 'chaleco' })]), look));
    expect(at([0, 0, -2], DOWN)).not.toBeNull();
    expect(at([0, 0, -2], { pitch: 0.7 })).toBeNull(); // mirando arriba
    expect(at([0, 0, 2], DOWN)).toBeNull(); // detrás
    expect(at([0, 0, 0.8], { pitch: 0.7 })).not.toBeNull(); // a los pies, mire adonde mire
    expect(at([0, 0, -2.6], { pitch: -0.5 })).toBeNull();
    expect(at([0, 3, -1.5], { pitch: 0.7 })).toBeNull(); // en un techo, arriba
  });

  test('con las dos ranuras llenas, el arma activa queda en el piso donde estaba el objeto, con sus balas', () => {
    let s = withGun(withGun(setup(), 0, 'rifle'), 1, 'pistola');
    s = mod(s, (c) => { c.inv.slots[0]!.inMag = 7; });
    s = withDrops(s, [drop(5, [0, 0, -1.5], { kind: 'arma', weapon: 'escopeta' })]);
    s = tap(s, { use: true }, DOWN);
    expect(s.inv.slots.map((g) => g?.id)).toEqual(['escopeta', 'pistola']);
    expect(s.drops).toEqual([{ id: 6, pos: [0, 0, -1.5], item: { kind: 'arma', weapon: 'rifle' }, inMag: 7 }]);
    expect(s.nextDropId).toBe(7);
    expect(nearestDrop(s)?.id).toBe(6);
    // se puede volver a juntar: vuelve con sus 7 balas y la escopeta queda en el piso
    s = tap(s, { use: true }, DOWN);
    expect(s.inv.slots[0]).toMatchObject({ id: 'rifle', inMag: 7 });
    expect(s.drops.map((d) => d.item)).toEqual([{ kind: 'arma', weapon: 'escopeta' }]);
  });

  test('si la mano está vacía y la otra ranura no, el arma va a la mano', () => {
    let s = mod(withGun(setup(), 0, 'pistola'), (c) => { c.inv.active = 1; });
    s = withDrops(s, [drop(1, [0, 0, -1.5], { kind: 'arma', weapon: 'rifle' })]);
    s = tap(s, { use: true }, DOWN);
    expect(s.inv.slots.map((g) => g?.id)).toEqual(['pistola', 'rifle']);
    expect(s.inv.active).toBe(1);
  });
});

describe('munición, chaleco y botiquines', () => {
  test('una caja de munición no pasa de AMMO_MAX; con el máximo, queda en el piso', () => {
    let s = mod(setup(), (c) => { c.inv.ammo.liviana = AMMO_MAX.liviana - 10; });
    s = withDrops(s, [drop(1, [0, 0, -1.5], { kind: 'municion', ammo: 'liviana' }), drop(2, [0.4, 0, -1.6], { kind: 'municion', ammo: 'liviana' })]);
    s = tap(s, { use: true }, DOWN);
    expect(s.inv.ammo.liviana).toBe(AMMO_MAX.liviana);
    expect(nearestDrop(s)).toBeNull();
    s = tap(s, { use: true }, DOWN);
    expect(s.drops.map((d) => d.id)).toEqual([2]);
  });

  test('el chaleco suma 50 hasta 100', () => {
    let s = withDrops(setup(), [1, 2, 3].map((i) => drop(i, [0.3 * (i - 2), 0, -1.5 - 0.1 * i], { kind: 'chaleco' })));
    s = tap(s, { use: true }, DOWN);
    expect(s.me.vitals.armor).toBe(50);
    s = mod(s, (c) => { c.me.vitals.armor = 70; });
    s = tap(s, { use: true }, DOWN);
    expect(s.me.vitals.armor).toBe(100);
    s = tap(s, { use: true }, DOWN);
    expect(s.me.vitals.armor).toBe(100);
    expect(s.drops).toHaveLength(1); // con el chaleco lleno no se junta
  });

  test('canTake dice si sirve juntarlo; nearestDrop con all también ve lo que no (para el cartel de "lleno")', () => {
    let s = mod(setup(), (c) => { c.inv.ammo.cartuchos = AMMO_MAX.cartuchos; });
    s = step(withDrops(s, [drop(1, [0, 0, -1.5], { kind: 'municion', ammo: 'cartuchos' })]), DOWN);
    expect(nearestDrop(s)).toBeNull();
    const d = nearestDrop(s, { all: true })!;
    expect(d.id).toBe(1);
    expect(canTake(s, d)).toBe(false);
    expect(nearestDrop(step(s, { pitch: 0.7 }), { all: true })).toBeNull(); // las mismas reglas de alcance: mirando arriba, nada
    s = mod(s, (c) => { c.inv.ammo.cartuchos = 0; });
    expect(canTake(s, d)).toBe(true);
    expect(nearestDrop(s)?.id).toBe(1);
    expect(canTake(s, { ...d, item: { kind: 'arma', weapon: 'rifle' } })).toBe(true); // un arma, siempre
    expect(nearestDrop(mod(s, (c) => { c.over = { won: false, alive: 0, at: c.t }; }), { all: true })).toBeNull();
  });

  test('se guardan hasta 3 botiquines: el cuarto queda en el piso', () => {
    let s = withDrops(setup(), [1, 2, 3, 4].map((i) => drop(i, [0.3 * (i - 2.5), 0, -1.4 - 0.1 * i], { kind: 'botiquin' })));
    for (let i = 0; i < 4; i++) s = tap(s, { use: true }, DOWN);
    expect(s.inv.medkits).toBe(MATCH.medkitsMax);
    expect(s.drops).toHaveLength(1);
    expect(s.drops[0].item).toEqual({ kind: 'botiquin' });
    expect(nearestDrop(s)).toBeNull();
  });
});

describe('disparar', () => {
  test('el rifle a un maniquí a 10 m, al pecho, le baja 20 (y el chaleco absorbe primero)', () => {
    for (const [armor, vitals] of [[0, { hp: 80, armor: 0 }], [25, { hp: 100, armor: 5 }]] as const) {
      const s = step(withGun(setup([[0, 0, -10]], [armor]), 0, 'rifle'), { fire: true, aim: true, pitch: pitchTo(1.1, 10) });
      expect(s.aiming).toBe(true);
      const [hit] = of(s.events, 'hit');
      expect(hit).toMatchObject({ id: s.dummies[0].id, part: 'cuerpo', dmg: 20 });
      expect(s.dummies[0].vitals).toEqual(vitals);
      const [shot] = of(s.events, 'shot');
      expect(shot.weapon).toBe('rifle');
      expect(shot.from).toEqual([0, PLAYER.eye, 0]);
      expect(shot.to).toHaveLength(1);
      expect(s.inv.slots[0]!.inMag).toBe(29);
    }
  });

  test('escopeta a quemarropa: un hit por perdigón, y lo que pierde (vida + chaleco) es la suma', () => {
    const s = step(withGun(setup([[0, 0, -2]], [25]), 0, 'escopeta'), { fire: true, pitch: pitchTo(1.1, 2) });
    const hits = of(s.events, 'hit');
    expect(hits).toHaveLength(WEAPONS.escopeta.pellets);
    const total = hits.reduce((sum, e) => sum + e.dmg, 0);
    expect(total).toBeCloseTo(WEAPONS.escopeta.pellets * WEAPONS.escopeta.damage, 9); // a 2 m no baja
    const v = s.dummies[0].vitals;
    expect(100 - v.hp + (25 - v.armor)).toBeCloseTo(total, 9);
    expect(v.armor).toBe(0);
  });

  test('para la dispersión, saltar también es moverse (velocidad en 3D)', () => {
    const look = { yaw: Math.PI, pitch: 0 };
    const g: Vec3 = [-Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), -Math.cos(look.yaw) * Math.cos(look.pitch)];
    /** Desvío (grados) de cada bala respecto de la mira, con el rifle sin apuntar durante 0,6 s. */
    const deviations = (inp: Partial<MatchInput>): number[] => {
      const evs: MatchEvent[] = [];
      run(withGun(setup(), 0, 'rifle'), { ...look, fire: true, ...inp }, 0.6, evs);
      return of(evs, 'shot').flatMap((sh) => sh.to.map((p) => {
        const v = [p[0] - sh.from[0], p[1] - sh.from[1], p[2] - sh.from[2]];
        const dot = v[0] * g[0] + v[1] * g[1] + v[2] * g[2];
        const cross = Math.hypot(v[1] * g[2] - v[2] * g[1], v[2] * g[0] - v[0] * g[2], v[0] * g[1] - v[1] * g[0]);
        return (Math.atan2(cross, dot) * 180) / Math.PI;
      }));
    };
    const still = deviations({});
    const jumping = deviations({ jump: true }); // salto en el lugar: velocidad solo vertical
    expect(still).toHaveLength(6);
    expect(jumping).toHaveLength(6);
    expect(Math.max(...still)).toBeLessThanOrEqual(WEAPONS.rifle.spreadStill + 1e-6);
    expect(Math.max(...jumping)).toBeGreaterThan(WEAPONS.rifle.spreadStill);
    expect(Math.max(...jumping)).toBeLessThanOrEqual(WEAPONS.rifle.spreadMove + 1e-6);
  });

  test('la automática dispara mientras está apretada, a su cadencia (9/s: 27 balas en 2,95 s)', () => {
    const evs: MatchEvent[] = [];
    const s = run(withGun(setup(), 0, 'rifle'), { fire: true, yaw: Math.PI }, 2.95, evs);
    expect(of(evs, 'shot')).toHaveLength(27);
    expect(s.inv.slots[0]!.inMag).toBe(3);
  });

  test('5 tiros del francotirador a la cabeza: el primero ya lo mata (95 × 2 > 100 + 50), emite kill y suma kills', () => {
    // un segundo maniquí lejos, para que la partida siga después de la primera muerte
    let s = withGun(setup([[0, 0, -10], [-40, 0, 0]], [50]), 0, 'francotirador');
    const look = { aim: true, pitch: pitchTo(1.62, 10) };
    const evs: MatchEvent[] = [];
    for (let i = 0; i < 5; i++) {
      s = step(s, { ...look, fire: true });
      evs.push(...s.events);
      s = run(s, look, 1.5, evs); // la cadencia es 0,7/s
    }
    expect(of(evs, 'shot')).toHaveLength(5);
    expect(of(evs, 'hit')).toMatchObject([{ id: 'm1', part: 'cabeza', dmg: 190 }]);
    expect(of(evs, 'kill')).toEqual([{ type: 'kill', id: 'm1', name: 'Maniquí 1' }]);
    expect(s.inv.slots[0]!.inMag).toBe(0);
    expect(s.dummies[0].alive).toBe(false);
    expect(s.dummies[1].alive).toBe(true);
    expect(s.kills).toBe(1);
    expect(hitboxes(s).map((b) => b.id)).toEqual(['m2']);
    expect(s.over).toBeNull();
  });

  test('matar al último maniquí es la victoria', () => {
    const s = step(withGun(setup([[0, 0, -10]], [50]), 0, 'francotirador'), { aim: true, pitch: pitchTo(1.62, 10), fire: true });
    expect(s.dummies[0]).toMatchObject({ alive: false, diedAt: s.t });
    expect(s.kills).toBe(1);
    expect(s.over).toEqual({ won: true, alive: 1, at: s.t });
    expect(s.events.map((e) => e.type)).toEqual(['shot', 'hit', 'kill', 'over']);
    expect(of(s.events, 'over')).toEqual([{ type: 'over', won: true }]);
  });

  test('la pistola no repite si fire queda apretado', () => {
    const evs: MatchEvent[] = [];
    let s = run(withGun(setup(), 0, 'pistola'), { fire: true, yaw: Math.PI }, 1, evs);
    expect(of(evs, 'shot')).toHaveLength(1);
    expect(s.inv.slots[0]!.inMag).toBe(11);
    s = tap(step(s), { fire: true }); // soltar y volver a apretar
    expect(s.inv.slots[0]!.inMag).toBe(10);
  });

  test('vacía y sin reserva hace clic (empty) y no dispara ni recarga; sin arma no pasa nada', () => {
    const s = mod(withGun(setup(), 0, 'pistola'), (c) => { c.inv.slots[0]!.inMag = 0; });
    const a = step(s, { fire: true });
    expect(a.events).toEqual([{ type: 'empty' }]);
    expect(a.inv.slots[0]!.reloadUntil).toBeNull();
    expect(step(setup(), { fire: true }).events).toEqual([]);
  });

  test('vacía y con reserva, apretar el gatillo hace clic y recarga, como R', () => {
    const s0 = mod(withGun(setup(), 0, 'pistola', 20), (c) => { c.inv.slots[0]!.inMag = 0; });
    let s = step(s0, { fire: true });
    expect(s.events).toEqual([{ type: 'empty' }, { type: 'reload', weapon: 'pistola' }]);
    expect(s.inv.slots[0]).toEqual(step(s0, { reload: true }).inv.slots[0]); // lo mismo que con R
    expect(s.inv.slots[0]!.reloadUntil).toBeCloseTo(WEAPONS.pistola.reload, 9);
    s = run(s, { fire: true }, WEAPONS.pistola.reload + 0.05); // mantenerlo no repite el clic ni dispara al terminar
    expect(s.inv.slots[0]).toMatchObject({ inMag: 12, reloadUntil: null });
    expect(s.inv.ammo.liviana).toBe(8);
  });

  test('la automática que se vacía con el gatillo apretado no recarga sola: recién al volver a apretarlo', () => {
    const evs: MatchEvent[] = [];
    let s = mod(withGun(setup(), 0, 'rifle', 30), (c) => { c.inv.slots[0]!.inMag = 2; });
    s = run(s, { fire: true, yaw: Math.PI }, 1, evs);
    expect(of(evs, 'shot')).toHaveLength(2);
    expect(evs.filter((e) => e.type === 'empty' || e.type === 'reload')).toEqual([]);
    expect(s.inv.slots[0]).toMatchObject({ inMag: 0, reloadUntil: null });
    s = tap(step(s), { fire: true });
    expect(s.inv.slots[0]!.reloadUntil).not.toBeNull();
  });

  test('pegado a una pared, la bala pega en la pared: impacto y sin daño al maniquí de atrás', () => {
    // mirando a +x con el cuerpo contra el edificio (que arranca en x = 20); el maniquí está atrás, en x = 45
    const s0 = mod(withGun(setup([[45, 0, 0]]), 0, 'pistola'), (c) => { c.me.player = initialState([20 - PLAYER.radius - 0.01, 0, 0]); });
    const s = step(s0, { fire: true, aim: true, yaw: -Math.PI / 2 });
    expect(of(s.events, 'hit')).toEqual([]);
    const [imp] = of(s.events, 'impact');
    expect(imp.point[0]).toBeCloseTo(20, 6);
    expect(imp.normal).toEqual([-1, 0, 0]);
    expect(of(s.events, 'shot')[0].to).toEqual([imp.point]);
    expect(s.dummies[0].vitals.hp).toBe(100);
  });

  test('el jugador no es blanco de sus propios disparos', () => {
    const s = step(withGun(setup(), 0, 'escopeta'), { fire: true, pitch: -Math.PI / 2 }); // a los pies
    expect(of(s.events, 'hit')).toEqual([]);
    expect(of(s.events, 'impact')).toHaveLength(WEAPONS.escopeta.pellets);
    expect(s.me.vitals.hp).toBe(100);
  });
});

describe('maniquíes sólidos', () => {
  const REACH = PLAYER.radius + BODY_RADIUS;
  const plan = (p: Vec3, d: Vec3) => Math.hypot(p[0] - d[0], p[2] - d[2]);

  test('no se atraviesa un maniquí: queda pegado adelante, sin velocidad hacia él', () => {
    const d: Vec3 = [0, 0, -3];
    const s = run(setup([d]), { forward: 1 }, 1); // mirando a −z, hacia el maniquí
    expect(s.me.player.pos[2]).toBeGreaterThan(d[2]);
    expect(plan(s.me.player.pos, d)).toBeCloseTo(REACH, 6);
    expect(s.me.player.pos[0]).toBeCloseTo(0, 6);
    expect(Math.hypot(s.me.player.vel[0], s.me.player.vel[2])).toBeLessThan(MATCH.movingSpeed); // para la dispersión, quieto
    expect(s.dummies[0].player.pos).toEqual(d); // el maniquí no se mueve
  });

  test('en diagonal se resbala por el costado y sigue', () => {
    const d: Vec3 = [0.3, 0, -3];
    let s = setup([d]);
    for (let i = 0; i < 90; i++) {
      s = step(s, { forward: 1 });
      expect(plan(s.me.player.pos, d)).toBeGreaterThan(REACH - 1e-6);
    }
    expect(s.me.player.pos[2]).toBeLessThan(d[2] - REACH); // ya lo pasó
  });

  test('uno muerto no frena', () => {
    const s0 = mod(setup([[0, 0, -3], [-40, 0, 0]]), (c) => { c.dummies[0].alive = false; c.dummies[0].vitals.hp = 0; });
    const s = run(s0, { forward: 1 }, 1);
    expect(s.me.player.pos[2]).toBeLessThan(-5);
  });

  test('con los pies arriba de su cabeza no lo empuja de costado; al bajar, sí (encima no se para)', () => {
    const d: Vec3 = [0, 0, -3];
    let s = mod(setup([d]), (c) => { c.me.player = { ...initialState([0.2, 2.5, -3]), onGround: false }; });
    s = run(s, {}, 0.2); // los pies todavía arriba de 1,8 m
    expect(s.me.player.pos[1]).toBeGreaterThan(1.8);
    expect(s.me.player.pos[0]).toBeCloseTo(0.2, 9);
    s = run(s, {}, 1);
    expect(s.me.player.onGround).toBe(true);
    expect(s.me.player.pos[1]).toBe(0);
    expect(plan(s.me.player.pos, d)).toBeCloseTo(REACH, 6);
  });

  test('entre un maniquí y una pared sin lugar no pasa, y tampoco se mete en la pared', () => {
    // el edificio arranca en x = 20; el maniquí, a 0,9 m de la pared: entre los dos quedan 0,55 m y el cuerpo mide 0,7
    const d: Vec3 = [19.1, 0, 0];
    const s0 = mod(setup([d]), (c) => { c.me.player = initialState([20 - PLAYER.radius - 0.01, 0, -3]); });
    let s = s0;
    for (let i = 0; i < 90; i++) {
      s = step(s, { forward: 1, yaw: Math.PI }); // hacia +z, a lo largo de la pared
      const p = s.me.player.pos;
      expect(world.overlaps(p[0], p[2], PLAYER.radius, p[1] + PLAYER.stepUp, p[1] + PLAYER.height)).toBe(false);
      expect(plan(p, d)).toBeGreaterThan(REACH - 1e-6);
    }
    expect(s.me.player.pos[2]).toBeLessThan(d[2]);
  });

  test('parado adentro de uno (lo pusieron ahí), el paso siguiente lo saca; y desde ahí un tiro a la espalda no le pega', () => {
    const d: Vec3 = [0, 0, -10];
    const s0 = withGun(mod(setup([d]), (c) => { c.me.player = initialState([0.1, 0, -10.1]); }), 0, 'pistola');
    const s = step(s0, { fire: true, yaw: 0, pitch: 1.4 }); // casi vertical y hacia atrás (+z)
    expect(plan(s.me.player.pos, d)).toBeCloseTo(REACH, 6);
    expect(of(s.events, 'hit')).toEqual([]);
    expect(s.dummies[0].vitals.hp).toBe(100);
  });
});

describe('recargar', () => {
  test('no pasa de la reserva y la descuenta', () => {
    let s = mod(withGun(setup(), 0, 'rifle', 10), (c) => { c.inv.slots[0]!.inMag = 10; });
    s = step(s, { reload: true });
    expect(s.events).toEqual([{ type: 'reload', weapon: 'rifle' }]);
    s = run(s, { fire: true }, WEAPONS.rifle.reload - 0.1);
    expect(s.inv.slots[0]!.inMag).toBe(10); // recargando no dispara
    s = run(s, {}, 0.15);
    expect(s.inv.slots[0]).toMatchObject({ inMag: 20, reloadUntil: null });
    expect(s.inv.ammo.liviana).toBe(0);
    // con reserva de sobra llena el cargador
    s = mod(s, (c) => { c.inv.ammo.liviana = 100; });
    s = run(step(s, { reload: true }), {}, WEAPONS.rifle.reload + 0.05);
    expect(s.inv.slots[0]!.inMag).toBe(30);
    expect(s.inv.ammo.liviana).toBe(90);
  });

  test('sin reserva no recarga; cambiar de ranura cancela la recarga sin gastar munición', () => {
    const empty = mod(withGun(setup(), 0, 'rifle', 0), (c) => { c.inv.slots[0]!.inMag = 5; });
    expect(step(empty, { reload: true }).inv.slots[0]!.reloadUntil).toBeNull();
    let s = mod(withGun(withGun(setup(), 1, 'pistola'), 0, 'rifle', 50), (c) => { c.inv.slots[0]!.inMag = 5; });
    s = step(s, { reload: true });
    s = run(s, {}, 1);
    s = step(s, { slot: 1 });
    expect(s.inv.active).toBe(1);
    s = run(s, { slot: 1 }, 2);
    s = step(s, { slot: 0 });
    expect(s.inv.slots[0]).toMatchObject({ inMag: 5, reloadUntil: null });
    expect(s.inv.ammo.liviana).toBe(50);
  });
});

describe('cambiar de arma', () => {
  /** Toca el gatillo un paso sí y otro no hasta que sale un tiro: el instante del tiro (a su hora, dentro del paso). */
  function nextShot(s: MatchState, look: Partial<MatchInput>): { s: MatchState; at: number } {
    for (let i = 0; i < 600; i++) {
      const slot = s.inv.active;
      s = step(s, { ...look, fire: i % 2 === 0 });
      if (of(s.events, 'shot').length > 0) return { s, at: s.inv.slots[slot]!.nextShotAt - 1 / WEAPONS[s.inv.slots[slot]!.id].rate };
    }
    throw new Error('no salió ningún tiro');
  }

  test('el arma que se saca tarda 0,25 s en poder disparar: con dos francotiradores no se dispara al doble', () => {
    expect(MATCH.raise).toBe(0.25);
    const look = { yaw: Math.PI };
    let s = withGun(withGun(setup(), 0, 'francotirador'), 1, 'francotirador');
    s = step(s, { ...look, fire: true });
    expect(of(s.events, 'shot')).toHaveLength(1);
    const switchAt = s.t;
    s = step(s, { ...look, slot: 1 });
    expect(s.inv.slots[1]!.nextShotAt).toBeCloseTo(switchAt + MATCH.raise, 9);
    const second = nextShot(s, look);
    expect(second.at).toBeGreaterThanOrEqual(switchAt + MATCH.raise - 1e-9);
    expect(second.at).toBeLessThan(switchAt + MATCH.raise + 3 * H);
    // de vuelta a la primera: la demora no le acorta la cadencia (0,7/s desde el primer tiro)
    s = step(second.s, { ...look, slot: 0 });
    const third = nextShot(s, look);
    expect(third.at).toBeGreaterThanOrEqual(1 / WEAPONS.francotirador.rate - 1e-9);
  });

  test('la demora no se suma a la cadencia que ya le quedaba, y seguir con la misma arma no la pone', () => {
    let s = withGun(withGun(setup(), 0, 'pistola'), 1, 'francotirador');
    s = mod(s, (c) => { c.inv.slots[1]!.nextShotAt = 5; });
    s = step(s, { slot: 1 });
    expect(s.inv.slots[1]!.nextShotAt).toBe(5); // max(5, t + raise)
    s = step(s, { slot: 1 }); // la que ya está en la mano
    expect(s.inv.slots[1]!.nextShotAt).toBe(5);
    expect(s.inv.slots[0]!.nextShotAt).toBe(0); // la que se guardó, igual
  });
});

describe('curación', () => {
  const hurt = (s: MatchState) => mod(s, (c) => { c.me.vitals.hp = 40; c.inv.medkits = 1; });

  test('el botiquín cura 50 en 3 s y mientras tanto se camina a la mitad de velocidad', () => {
    let s = step(hurt(setup()), { heal: true });
    expect(s.inv.healingUntil).toBeCloseTo(MATCH.healTime, 9);
    s = run(s, { forward: 1 }, 1);
    const z1 = s.me.player.pos[2];
    s = run(s, { forward: 1 }, 1);
    expect(Math.hypot(s.me.player.vel[0], s.me.player.vel[2])).toBeCloseTo(PLAYER.runSpeed * MATCH.healSlow, 6);
    expect(z1 - s.me.player.pos[2]).toBeCloseTo(PLAYER.runSpeed * MATCH.healSlow, 2); // 3 m en 1 s
    s = run(s, { forward: 1 }, 0.9);
    expect(s.me.vitals.hp).toBe(40);
    s = run(s, { forward: 1 }, 0.15);
    expect(s.me.vitals.hp).toBe(90);
    expect(s.inv).toMatchObject({ medkits: 0, healingUntil: null });
    s = run(s, { forward: 1 }, 0.5);
    expect(Math.hypot(s.me.player.vel[0], s.me.player.vel[2])).toBeCloseTo(PLAYER.runSpeed, 6);
  });

  test('no pasa de 100 y con la vida llena no arranca', () => {
    let s = mod(hurt(setup()), (c) => { c.me.vitals.hp = 80; });
    s = run(step(s, { heal: true }), {}, MATCH.healTime + 0.05);
    expect(s.me.vitals.hp).toBe(100);
    s = mod(s, (c) => { c.inv.medkits = 1; });
    expect(step(s, { heal: true }).inv.healingUntil).toBeNull();
  });

  test('disparar o cambiar de ranura a mitad la cancela sin consumir el botiquín', () => {
    const start = step(withGun(withGun(hurt(setup()), 0, 'rifle'), 1, 'pistola'), { heal: true });
    for (const cancel of [{ fire: true, yaw: Math.PI }, { slot: 1 as const }]) {
      let s = run(start, {}, 1.5);
      expect(s.inv.healingUntil).not.toBeNull();
      s = step(s, cancel);
      expect(s.inv.healingUntil).toBeNull();
      s = run(s, {}, 3);
      expect(s.me.vitals.hp).toBe(40);
      expect(s.inv.medkits).toBe(1);
    }
  });
});

describe('zona', () => {
  /** 2 maniquíes y el jugador, hasta los 720 s + 30 s en pasos de 0,25 s (siempre por stepMatch). */
  function toTheEnd(me: 'adentro' | 'afuera'): MatchState {
    let s = newMatch(map, open, { seed: 5, dummies: 2 });
    const last = s.zone.circles[4].center;
    const center: Vec3 = [last[0], 0, last[1]];
    const corners: Vec3[] = [[-95, 0, -95], [95, 0, 95]];
    s = mod(s, (c) => {
      c.me.player = initialState(me === 'adentro' ? center : [-95, 0, 95]);
      c.dummies.forEach((d, i) => { d.player = initialState(me === 'adentro' ? corners[i] : center); });
    });
    while (s.t < 750) s = step(s, {}, open, 0.25);
    return s;
  }

  test('con el jugador escondido en el último círculo, los maniquíes de afuera mueren por la zona y gana', () => {
    const s = toTheEnd('adentro');
    expect(s.dummies.map((d) => d.alive)).toEqual([false, false]);
    expect(s.me).toMatchObject({ alive: true, vitals: { hp: 100, armor: 0 } });
    expect(s.over).toMatchObject({ won: true, alive: 1 });
    expect(s.over!.at).toBeLessThan(720);
    expect(s.kills).toBe(0); // la zona no cuenta como eliminación del jugador
  });

  test('si el jugador está afuera, pierde', () => {
    const s = toTheEnd('afuera');
    expect(s.me.alive).toBe(false);
    expect(s.over).toMatchObject({ won: false, alive: 2 });
    expect(s.me.diedAt).toBe(s.over!.at);
  });

  test('sin maniquíes es práctica libre: no se gana, termina solo si muere el jugador', () => {
    let s = step(newMatch(map, open, { seed: 2, dummies: 0 }), {}, open);
    expect(s.dummies).toEqual([]);
    expect(s.over).toBeNull();
    s = mod(s, (c) => { c.me.player = initialState([-95, 0, -95]); }); // afuera de la zona
    while (!s.over && s.t < 750) s = step(s, {}, open, 0.25);
    expect(s.me.alive).toBe(false);
    expect(s.over).toMatchObject({ won: false, alive: 0 });
  });

  test('la zona daña solo la vida y avisa con zone-hurt', () => {
    let s = mod(setup([[-40, 0, 0]], [50]), (c) => { c.me.player = initialState([-95, 0, -95]); c.me.vitals.armor = 50; });
    s = step(s);
    expect(s.events).toEqual([{ type: 'zone-hurt', dmg: H }]); // fase 1: 1/s
    expect(s.me.vitals).toEqual({ hp: 100 - H, armor: 50 });
    expect(s.dummies[0].vitals.hp).toBe(100); // adentro
  });

  test('con la zona cerrada no hay dónde esconderse, ni en el centro: la partida siempre termina', () => {
    let s = newMatch(map, open, { seed: 5, dummies: 1 });
    const last = s.zone.circles[4].center;
    s = mod(s, (c) => {
      c.t = 720;
      c.me.player = initialState([last[0], 0, last[1]]);
      c.dummies[0].player = initialState([last[0], 0, last[1]]);
    });
    s = step(s, {}, open);
    expect(s.events).toEqual([{ type: 'zone-hurt', dmg: 10 * H }]); // fase 5: 10/s
    expect(s.me.vitals.hp).toBeCloseTo(100 - 10 * H, 9);
    expect(s.dummies[0].vitals.hp).toBeCloseTo(100 - 10 * H, 9);
  });

  test('después de over nada cambia salvo t', () => {
    const end = toTheEnd('adentro');
    let s = step(withDrops(withGun(end, 0, 'escopeta'), [drop(99, [end.me.player.pos[0], 0, end.me.player.pos[2] - 1.5], { kind: 'chaleco' })]), {}, open);
    const frozen = { ...s, t: 0 };
    for (const inp of [{ forward: 1 as const }, { fire: true }, { use: true, ...DOWN }, { heal: true }, { slot: 1 as const }, { reload: true, aim: true }]) {
      const t = s.t;
      s = step(s, inp, open);
      expect(s.t).toBeCloseTo(t + H, 9);
      expect(s.events).toEqual([]);
      expect({ ...s, t: 0 }).toEqual(frozen);
    }
    expect(nearestDrop(s)).toBeNull();
  });
});
