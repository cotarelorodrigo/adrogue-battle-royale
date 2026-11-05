import polygonClipping from 'polygon-clipping';
import { analyzeGround, exitPockets } from '../../../src/mapgen/pockets.ts';
import { isFreeSpot } from '../../../src/mapgen/spawns.ts';
import { CollisionWorld, TRUNK_R, interiorPrisms, trunkHeight } from '../../../src/shared/collision.ts';
import type { Prism } from '../../../src/shared/collision.ts';
import { hitscan } from '../../../src/shared/combat.ts';
import { SIM_HZ } from '../../../src/shared/fixed-step.ts';
import { ensureCCW, pointInPolygon, polygonArea, signedAreaFromAbove, toWorld } from '../../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../../src/shared/geo.ts';
import { publicFloorArea, validateInterior } from '../../../src/shared/interiors/index.ts';
import { GROUND_Y, Kit, MODEL_BOX, RAIL_H, RAIL_T, SOLID_MIN_H, TREAD, WALL_OUT } from '../../../src/shared/interiors/kit.ts';
import type { Block, Interior, ItemModel } from '../../../src/shared/interiors/types.ts';
import type { Building, InteriorInput, MapData } from '../../../src/shared/mapdata.ts';
import { PLAYER, initialState, stepPlayer } from '../../../src/shared/player.ts';
import type { PlayerInput, PlayerState } from '../../../src/shared/player.ts';
import { FIXTURE_BOUNDS, LOOKS, testInterior } from './fixture.ts';
import { climbStair, doorDepth, enterDoor, insideOf, walkTo } from './walk.ts';
import { areaOf, closed } from '../../helpers.ts';

const H = 1 / SIM_HZ;
const within = (v: number, want: number, tol = 0.05): void => expect(Math.abs(v - want), `${v} vs ${want}`).toBeLessThanOrEqual(tol);
const where = (s: PlayerState): string => `${s.pos.map((v) => v.toFixed(2)).join(', ')} (${s.mode}${s.onGround ? ', apoyado' : ''})`;
const input = (o: Partial<PlayerInput>): PlayerInput => ({ forward: 0, right: 0, jump: false, crouch: false, yaw: 0, pitch: 0, ...o });
/** yaw π: adelante es +z (hacia el fondo del local). */
const TO_BACK = Math.PI;

describe('entrar', () => {
  const { b, interior, world } = testInterior();
  const [door] = interior.doors;

  test('la puerta del frente: en x = 5, normal hacia la calle, de 1,6 m y en la planta baja', () => {
    expect(interior.doors).toHaveLength(1);
    expect(door.at[0]).toBeCloseTo(5, 9);
    expect(door.at[1]).toBeCloseTo(0, 9);
    expect(door.normal[1]).toBeCloseTo(-1, 9);
    expect(door.width).toBeCloseTo(1.6, 9);
    expect(door.level).toBe(0);
  });

  test('derecho: termina adentro, apoyado, a y = 0, en ≤ 3 s', () => {
    const s = enterDoor(world, door, { seconds: 3 });
    expect(insideOf(b, s.pos), where(s)).toBe(true);
    expect(doorDepth(door, s.pos), where(s)).toBeGreaterThanOrEqual(2);
    expect(s.onGround, where(s)).toBe(true);
    within(s.pos[1], 0);
  });

  // Review Focus 1: en diagonal no se traba en el marco, ni corriendo ni agachado
  test.each([
    { angleDeg: 35, sprint: true }, { angleDeg: -35, sprint: true },
    { angleDeg: 35, crouch: true }, { angleDeg: -35, crouch: true },
    { angleDeg: 35, sprint: true, crouch: true },
  ])('a %o: termina adentro, apoyado, a y = 0, en ≤ 3 s', (o) => {
    const s = enterDoor(world, door, { ...o, seconds: 3 });
    expect(insideOf(b, s.pos), where(s)).toBe(true);
    expect(doorDepth(door, s.pos), where(s)).toBeGreaterThanOrEqual(2);
    expect(s.onGround, where(s)).toBe(true);
    within(s.pos[1], 0);
  });
});

describe('vidrio', () => {
  const { b, world } = testInterior();

  test('caminar contra un vidrio no lo cruza: a los 3 s sigue afuera', () => {
    const s = walkTo(world, [2, 0, -2], [2, 5], 3);
    expect(insideOf(b, s.pos), where(s)).toBe(false);
    expect(s.pos[2]).toBeLessThan(0);
  });

  test('un tiro a y = 1,5 desde 2 m afuera, perpendicular al vidrio, pega en la cara de adentro de la pared del fondo', () => {
    const hit = hitscan(world, [], [2, 1.5, -2], [0, 0, 1], 100);
    expect(hit?.kind).toBe('world');
    within(hit!.dist, 2 + 15 - WALL_OUT);
  });

  test('con un blanco adentro detrás del vidrio da target', () => {
    const hit = hitscan(world, [{ id: 'adentro', pos: [2, 0, 3], crouching: false }], [2, 1.5, -2], [0, 0, 1], 100);
    expect(hit).toMatchObject({ kind: 'target', id: 'adentro' });
  });
});

describe('pared', () => {
  const { world } = testInterior();

  test('desde adentro, un blanco afuera detrás de la pared: el tiro da en la pared', () => {
    const hit = hitscan(world, [{ id: 'afuera', pos: [-2, 0, 7], crouching: false }], [3, 1.5, 7], [-1, 0, 0], 100);
    expect(hit?.kind).toBe('world');
    within(hit!.point[0], WALL_OUT, 1e-6);
  });

  test('por el hueco de la puerta da target', () => {
    const hit = hitscan(world, [{ id: 'vereda', pos: [5, 0, -2], crouching: false }], [5, 1.5, 5], [0, 0, -1], 100);
    expect(hit).toMatchObject({ kind: 'target', id: 'vereda' });
  });

  test('en una esquina saliente aguda la pared no se sale de la planta; un vidrio pegado a ella deja un relleno', () => {
    // triángulo con esquinas de 56° en (10, 0) y de 34° en (0, 15); el vidrio arranca a 0,1 m de la de 56°
    const b: Building = { id: 'b-punta', footprint: [[10, 0], [0, 0], [0, 15]], height: 4, floors: 1, kind: 'shop', wall: 'plaster', tint: '#d8d0c0' };
    const input: InteriorInput = {
      placeId: 'punta', buildingId: b.id, frame: { origin: [0, 0], u: [1, 0], v: [0, 1] },
      openings: [{ kind: 'vidrio', edge: 0, s0: 0.1, s1: 3, y0: 0.3, y1: 2.3 }], patios: [],
    };
    const k = new Kit(b, input);
    k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
    const interior = k.done(0.8);
    expect(validateInterior(interior)).toEqual([]);
    const near = (x: Interior['blocks'][number]): boolean => x.polygon.every((q) => Math.hypot(q[0] - 10, q[1]) < 0.4);
    expect(interior.blocks.filter((x) => near(x) && x.role === 'otro' && x.y0 === 0)).toHaveLength(1);
    // la pared sobre el vidrio arranca en su marco (x = 9,9) y, recortada, sigue siendo de 0,2 (una pared)
    const over = interior.blocks.filter((x) => x.role === 'pared' && x.y0 === 2.3 && x.polygon.some((q) => Math.hypot(q[0] - 9.9, q[1]) < 1e-9));
    expect(over).toHaveLength(1);
    expect(over[0].polygon.length).toBeGreaterThan(4);
  });
});

describe('losa y pisos cerrados', () => {
  test('adentro, isFreeSpot da true aunque la losa esté arriba', () => {
    const { world } = testInterior();
    expect(isFreeSpot(world, 5, 7)).toBe(true);
  });

  test('sin escalera (1 piso público), el piso de arriba es el bloque cerrado', () => {
    const { world } = testInterior();
    expect(world.overlaps(5, 7.5, 0.35, 3.25, 5.0)).toBe(true);
  });

  test('con 2 pisos públicos, arriba hay lugar y el piso 1 es libre', () => {
    const { world } = testInterior({ publicFloors: 2 });
    expect(world.overlaps(5, 7.5, 0.35, 3.25, 5.0)).toBe(false);
    expect(isFreeSpot(world, 5, 7.5, 3.2)).toBe(true);
  });
});

// m19 de la revisión final: las 9 plantas reales son convexas, y la cuña `otro` de la planta corrida (la de una esquina
// entrante) no la pisaba ningún test
describe('planta con esquina entrante', () => {
  /** Un local con la planta `fp` (marco local = mundo, el frente es la arista 0, de (10, 0) a (0, 0)) y la puerta de la fixture. */
  const local = (fp: Vec2[], publicFloors: number, holes?: { level: number; polygon: Vec2[] }[]) => {
    const b: Building = { id: 'b-ele', footprint: fp, height: 7, floors: 2, kind: 'shop', wall: 'plaster', tint: '#d8d0c0' };
    const input: InteriorInput = {
      placeId: 'ele', buildingId: b.id, frame: { origin: [0, 0], u: [1, 0], v: [0, 1] },
      openings: [{ kind: 'puerta', edge: 0, s0: 4.2, s1: 5.8, y0: 0, y1: 2.3 }], patios: [],
    };
    const k = new Kit(b, input);
    k.shell({ publicFloors, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo, ...(holes ? { holes } : {}) });
    const interior = k.done(0.8);
    return { b, interior, world: new CollisionWorld(interiorPrisms(interior), [], FIXTURE_BOUNDS) };
  };
  // L: la barra de adelante (z de 0 a 6) y el brazo de x de 0 a 5 hasta el fondo; la esquina entrante en (5, 6)
  const ELE: Vec2[] = [[10, 0], [0, 0], [0, 15], [5, 15], [5, 6], [10, 6]];
  // U: dos esquinas entrantes, con 2 pisos públicos y un hueco en la losa que cruza varias franjas
  const U: Vec2[] = [[12, 0], [0, 0], [0, 12], [4, 12], [4, 5], [8, 5], [8, 12], [12, 12]];
  const casos = [
    { name: 'L', fp: ELE, pf: 1, holes: undefined },
    { name: 'U', fp: U, pf: 2, holes: [{ level: 1, polygon: [[1, 2], [3, 2], [3, 9], [1, 9]] as Vec2[] }] },
  ];

  test.each(casos)('$name: validateInterior da [] y, en lo alto, paredes y techo cubren la planta justa sin pisarse', ({ fp, pf, holes }) => {
    const { b, interior } = local(fp, pf, holes);
    expect(validateInterior(interior)).toEqual([]);
    const y = b.height - 0.01;
    const top = interior.blocks.filter((x) => x.collide !== 'none' && x.y0 < y && x.y1 > y);
    const union = (rs: Vec2[][]) => polygonClipping.union(closed(rs[0]), ...rs.slice(1).map(closed));
    const slabs = union(top.filter((x) => x.role === 'losa').map((x) => x.polygon));
    const walls = union(top.filter((x) => x.role !== 'losa').map((x) => x.polygon));
    const all = polygonClipping.union(slabs, walls);
    const planta = closed(ensureCCW(fp));
    expect(areaOf(polygonClipping.difference(planta, all)), 'sin cubrir').toBeLessThan(0.01);
    expect(areaOf(polygonClipping.difference(all, planta)), 'afuera de la planta').toBeLessThan(0.01);
    expect(areaOf(polygonClipping.intersection(slabs, walls)), 'techo sobre las paredes').toBeLessThan(0.01);
  });

  test('L: se rodea el rincón entrante caminando, sin trabarse', () => {
    const { world } = local(ELE, 1);
    // de la barra de adelante al fondo del brazo: el rumbo directo choca la pared de z = 6 y se resbala por ella
    const s = walkTo(world, [8, 0, 3], [3, 12]);
    expect(Math.hypot(s.pos[0] - 3, s.pos[2] - 12), where(s)).toBeLessThan(0.5);
    expect(s.onGround, where(s)).toBe(true);
    within(s.pos[1], 0);
  });
});

describe('alturas', () => {
  const r6 = (n: number): number => Number(n.toFixed(6));
  const solids = (i: Interior, role: string) => i.blocks.filter((x) => x.role === role && x.collide !== 'none').map((x) => [r6(x.y0), r6(x.y1)]);

  test('1 piso público de 2: la planta baja a GROUND_Y sin sólido y un solo bloque cerrado de 3,0 a 7,0', () => {
    const { interior } = testInterior();
    expect(solids(interior, 'losa')).toEqual([[3.0, 7.0]]);
    const ground = interior.blocks.filter((x) => x.role === 'losa' && x.collide === 'none');
    expect(ground).toHaveLength(1);
    expect(ground[0].y1).toBe(GROUND_Y);
    expect(ground[0].top).toEqual(LOOKS.piso);
  });

  test('2 pisos públicos: la losa del piso 1 de 3,0 a 3,2 y el techo de 6,2 a 7,0', () => {
    const { interior } = testInterior({ publicFloors: 2 });
    expect(solids(interior, 'losa')).toEqual([[3.0, 3.2], [6.2, 7.0]]);
    expect(interior.floors.map((f) => [f.level, f.y])).toEqual([[0, 0], [1, 3.2]]);
  });

  test('las paredes de afuera van de 0 a height y se cortan en las aberturas, con dintel arriba de la puerta', () => {
    const { interior } = testInterior();
    const outer = interior.blocks.filter((x) => (x.role === 'pared' || x.role === 'dintel') && x.hide?.includes(0));
    expect(Math.min(...outer.map((x) => x.y0))).toBe(0);
    expect(Math.max(...outer.map((x) => x.y1))).toBe(7);
    const lintel = interior.blocks.filter((x) => x.role === 'dintel');
    expect(lintel).toHaveLength(1);
    expect([lintel[0].y0, lintel[0].y1]).toEqual([2.3, 7]);
    const panes = interior.blocks.filter((x) => x.role === 'vidrio');
    expect(panes.map((x) => x.collide)).toEqual(['glass', 'glass']);
    expect(panes.map((x) => [x.y0, x.y1])).toEqual([[0.3, 2.3], [0.3, 2.3]]);
  });

  test('un piso de 8 m (D9): el techo va de 7,2 a 8,0 y abajo queda todo el alto', () => {
    const b: Building = { id: 'alto', footprint: [[10, 0], [0, 0], [0, 15], [10, 15]], height: 8, floors: 1, kind: 'shop', wall: 'plaster', tint: '#ccc' };
    const k = new Kit(b, { placeId: 'alto', buildingId: 'alto', frame: { origin: [0, 0], u: [1, 0], v: [0, 1] }, openings: [], patios: [] });
    k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
    const i = k.done(0.8);
    expect(solids(i, 'losa')).toEqual([[7.2, 8.0]]);
    const world = new CollisionWorld(interiorPrisms(i), [], FIXTURE_BOUNDS);
    expect(world.overlaps(5, 7.5, 0.35, 0.05, 7.1)).toBe(false);
  });

  test('con terraza: el techo es un piso público más, a height, y la escalera llega hasta ahí', () => {
    const b: Building = { id: 'terraza', footprint: [[10, 0], [0, 0], [0, 15], [10, 15]], height: 3.8, floors: 1, kind: 'shop', wall: 'plaster', tint: '#ccc' };
    const k = new Kit(b, { placeId: 'terraza', buildingId: 'terraza', frame: { origin: [0, 0], u: [1, 0], v: [0, 1] }, openings: [], patios: [] });
    k.shell({ publicFloors: 1, terrace: true, wall: LOOKS.pared, floor: [LOOKS.piso, { mat: 'baldosa', color: '#b05a3a' }], ceiling: LOOKS.techo });
    k.stair({ from: 0, to: 1, foot: [9.2, 4], dir: [0, 1], width: 1.2, look: LOOKS.escalera });
    const i = k.done(0.8);
    expect(i.terrace).toBe(true);
    expect(i.floors.map((f) => [f.level, f.y])).toEqual([[0, 0], [1, 3.8]]);
    expect(validateInterior(i)).toEqual([]);
    const world = new CollisionWorld(interiorPrisms(i), [], FIXTURE_BOUNDS);
    const s = climbStair(world, i.stairs[0]);
    within(s.pos[1], 3.8);
    expect(s.onGround, where(s)).toBe(true);
    // la terraza tiene la baldosa (GROUND_Y arriba del techo, sin sólido: no se pisa con el techo del chunk, H8) y su
    // baranda alrededor del hueco; el techo, que apoya, no tiene cara de arriba
    expect(i.blocks.some((x) => x.y0 === 3.8 && x.y1 === 3.8 + GROUND_Y && x.top?.mat === 'baldosa' && x.collide === 'none')).toBe(true);
    expect(i.blocks.filter((x) => x.role === 'losa' && x.y1 === 3.8 && x.top !== undefined)).toEqual([]);
    expect(i.blocks.some((x) => x.role === 'baranda' && x.y0 === 3.8)).toBe(true);
  });

  test('los huecos de la losa (D13): el piso 1 se parte en polígonos simples sin el hueco', () => {
    const hole: Vec2[] = [[2, 5], [6, 5], [6, 10], [2, 10]];
    const { b, input } = testInterior();
    const k = new Kit(b, input);
    k.shell({ publicFloors: 2, holes: [{ level: 1, polygon: hole }], wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
    const interior = k.done(0.8);
    const world = new CollisionWorld(interiorPrisms(interior), [], FIXTURE_BOUNDS);
    expect(validateInterior(interior)).toEqual([]);
    const slab = interior.blocks.filter((x) => x.role === 'losa' && x.y1 === 3.2);
    expect(slab.length).toBeGreaterThan(1);
    expect(world.supportHeight(4, 7.5, 0.35, 4)).toBe(0);
    expect(world.supportHeight(4, 12, 0.35, 4)).toBeCloseTo(3.2, 9);
    const inset = (10 - 2 * WALL_OUT) * (15 - 2 * WALL_OUT);
    expect(slab.reduce((a, x) => a + polygonArea(x.polygon), 0)).toBeCloseTo(inset - 20, 6);
    expect(interior.floors.find((f) => f.level === 1)!.area).toBeCloseTo(inset - 20, 6);
    // la cara del costado se dibuja solo en el borde del hueco
    for (const x of slab) expect(x.hide!.length, 'aristas sin cara').toBeLessThan(x.polygon.length);
  });
});

describe('escalera', () => {
  const { b, interior, world } = testInterior({ publicFloors: 2, stair: true });
  const [s] = interior.stairs;

  test('16 contrahuellas de 0,2 m: 15 escalones sólidos de 0,3 m hasta el piso, y el StairRun 0,6 m afuera de cada punta', () => {
    const steps = interior.blocks.filter((x) => x.role === 'escalon');
    expect(steps).toHaveLength(15);
    for (const x of steps) expect(x.y0).toBe(0);
    expect(s.from).toBe(0);
    expect(s.to).toBe(1);
    expect(s.foot[0]).toBeCloseTo(9.2, 9);
    expect(s.foot[1]).toBe(0);
    expect(s.foot[2]).toBeCloseTo(4 - 0.6, 9);
    expect(s.top[1]).toBeCloseTo(3.2, 9);
    expect(s.top[2]).toBeCloseTo(4 + 15 * TREAD + 0.6, 9);
    expect(Math.abs(Math.sin(s.yaw))).toBeLessThan(1e-9); // sube hacia +z
    expect(Math.cos(s.yaw)).toBeCloseTo(-1, 9);
  });

  test('climbStair sube a y = 3,2, apoyado y caminando; bajando vuelve a y = 0', () => {
    const up = climbStair(world, s);
    within(up.pos[1], 3.2);
    expect(up.onGround, where(up)).toBe(true);
    expect(up.mode).toBe('walk');
    const down = climbStair(world, s, true);
    within(down.pos[1], 0);
    expect(down.onGround, where(down)).toBe(true);
    expect(down.mode).toBe('walk');
  });

  // Review Focus 1: corriendo no se traba en los escalones
  test('con Shift sube y baja igual', () => {
    const up = climbStair(world, s, false, { sprint: true });
    within(up.pos[1], 3.2);
    expect(up.onGround && up.mode === 'walk', where(up)).toBe(true);
    const down = climbStair(world, s, true, { sprint: true });
    within(down.pos[1], 0);
    expect(down.onGround && down.mode === 'walk', where(down)).toBe(true);
  });

  test('en el piso 1, el hueco tiene baranda de RAIL_H por el costado y el pie; por la llegada se baja', () => {
    const rails = interior.blocks.filter((x) => x.role === 'baranda');
    expect(rails.length).toBeGreaterThanOrEqual(2);
    for (const x of rails) {
      expect(x.collide).toBe('glass');
      expect(x.y1 - x.y0).toBeCloseTo(RAIL_H, 9);
    }
    const side = walkTo(world, [7, 3.2, 6], [9.2, 6], 3);
    within(side.pos[1], 3.2);
    expect(side.pos[0]).toBeLessThan(8.6 - 0.3);
    const foot = walkTo(world, [9.2, 3.2, 2.5], [9.2, 6], 3);
    within(foot.pos[1], 3.2);
    expect(foot.pos[2]).toBeLessThan(4 - 0.3);
    const arrival = walkTo(world, [9.2, 3.2, 10], [9.2, 6], 3);
    expect(arrival.pos[1]).toBeLessThan(2.5);
    expect(insideOf(b, arrival.pos)).toBe(true);
  });

  test('una baranda de caño (§4.7): el paño que frena no se ve; se ven el pasamanos, un intermedio y parantes cada ≤ 1,4 m', () => {
    const BLANCO = { mat: 'metal', color: '#f2f2f2' } as const;
    const { interior: i, world: w } = testInterior({ extra: (k) => k.railing([[1, 10], [7, 10]], 0, BLANCO, { caño: true }) });
    const rails = i.blocks.filter((x) => x.role === 'baranda');
    expect(rails).toHaveLength(1);
    expect(rails[0].collide).toBe('glass');
    expect(rails[0].side).toBeUndefined();
    expect(rails[0].top).toBeUndefined();
    const pipes = i.blocks.filter((x) => x.collide === 'none' && x.side?.color === BLANCO.color);
    const len = (x: Block): number => Math.max(...x.polygon.map((p) => p[0])) - Math.min(...x.polygon.map((p) => p[0]));
    const bars = pipes.filter((x) => len(x) > 5.9), posts = pipes.filter((x) => len(x) < 0.1);
    expect(bars.map((x) => +x.y1.toFixed(3)).sort()).toEqual([0.55, RAIL_H]);
    expect(posts.length).toBeGreaterThanOrEqual(Math.ceil(6 / 1.4) + 1);
    const xs = posts.map((x) => (Math.min(...x.polygon.map((p) => p[0])) + Math.max(...x.polygon.map((p) => p[0]))) / 2).sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k++) expect(xs[k + 1] - xs[k]).toBeLessThanOrEqual(1.4 + 1e-9);
    expect(xs[0]).toBeCloseTo(1, 6);
    expect(xs[xs.length - 1]).toBeCloseTo(7, 6);
    // frena como cualquier baranda
    const s = walkTo(w, [4, 0, 12], [4, 8], 3);
    expect(s.pos[2]).toBeGreaterThan(10.3);
  });

  test('el piso 1 cuenta sin el hueco de la escalera, y publicFloorArea suma los pisos (D11)', () => {
    const inset = (10 - 2 * WALL_OUT) * (15 - 2 * WALL_OUT);
    expect(interior.floors.map((f) => f.level)).toEqual([0, 1]);
    expect(interior.floors[0].area).toBeCloseTo(inset, 6);
    expect(interior.floors[1].area).toBeCloseTo(inset - 1.2 * 15 * TREAD, 6);
    expect(interior.floors[1].holes).toHaveLength(1);
    expect(publicFloorArea(interior)).toBeCloseTo(2 * inset - 1.2 * 15 * TREAD, 6);
  });
});

// H9 de la revisión de la T8: el pasamanos en pendiente de una escalera lo pone el kit (antes, una copia en cada plan)
describe('pasamanos de escalera (handrail)', () => {
  const VIDRIO = { mat: 'vidrio', color: '#b8d0d6' } as const, NEGRO = { mat: 'liso', color: '#1b1b1c' } as const;
  const BLANCO = { mat: 'metal', color: '#f2f2ef' } as const;
  // la del fixture: de 1,2 m contra la pared de x = 10, sube hacia +z desde z = 4; subiendo, la izquierda es +x (la pared)
  // y la derecha −x (el local, con la losa del piso 1 al lado)
  const conPasamanos = (o: Partial<Parameters<Kit['stair']>[0]>) => testInterior({ publicFloors: 2, extra: (k) => k.stair({
    from: 0, to: 1, foot: [9.2, 4], dir: [0, 1], width: 1.2, look: LOOKS.escalera, rail: VIDRIO, ...o }) });
  const cx = (x: { polygon: Vec2[] }): number => x.polygon.reduce((t, p) => t + p[0], 0) / x.polygon.length;
  const enEscalon = (x: Block): boolean => x.role === 'baranda' && x.y0 > 0.1 && x.y0 < 3.1;
  // 16 contrahuellas de 0,2 y 15 escalones: la nariz del k (1..15) está a z = 4 + (k − 1) · 0,3 y a 0,2 · k; la de la
  // llegada, a 4 + 15 · 0,3 y 3,2
  const nose = (z: number): number => 0.2 + ((z - 4) * 0.2) / TREAD;
  /** Las caras de arriba de las barras en pendiente de `color` (largas: las tapas de las puntas también miran un poco
   *  para arriba). */
  const barTops = (i: Interior, color: string) => i.panes.filter((p) => p.look.color === color && p.normal[1] > 0.3 && p.normal[1] < 0.99
    && Math.max(...p.corners.map((q) => q[2])) - Math.min(...p.corners.map((q) => q[2])) > 1);

  test('der, de vidrio: un paño por escalón sobre el borde de la huella (adentro del ancho) y el pasamanos de handrailLook a 0,93 m de las narices', () => {
    const { interior: i } = conPasamanos({ handrail: 'der', handrailLook: NEGRO });
    const panes = i.blocks.filter(enEscalon);
    for (const x of panes) {
      expect(x.collide).toBe('glass');
      expect(x.y1 - x.y0).toBeCloseTo(RAIL_H, 9);
      expect(cx(x)).toBeCloseTo(8.6 + RAIL_T / 2, 6);
      expect(x.side?.color).toBe(VIDRIO.color);
    }
    // del lado del local, la losa del piso 1 (de 3,0 a 3,2) tapa el costado: van los paños que entran abajo de ella
    // (0,2 · k + 1,0 ≤ 3,0) y los de más arriba no (el último, a 3,0, la tiene al lado)
    expect(panes.map((x) => +x.y0.toFixed(3)).sort((p, q) => p - q)).toEqual([...Array(10).keys()].map((k) => +(0.2 * (k + 1)).toFixed(3)));
    const tops = barTops(i, NEGRO.color);
    expect(tops).toHaveLength(1);
    for (const q of tops[0].corners) {
      expect(q[0]).toBeGreaterThan(8.6 - 0.011);
      expect(q[0]).toBeLessThan(8.6 + 0.08);
      within(q[1] - nose(q[2]), 0.93, 0.005);
    }
    const zs = tops[0].corners.map((q) => q[2]);
    within(Math.min(...zs), 4, 0.01);
    within(Math.max(...zs), 4 + 15 * TREAD, 0.01);
    // los parantes: cada tres escalones y en el último, del color del pasamanos, hasta abajo del pasamanos
    const posts = i.blocks.filter((x) => x.collide === 'none' && x.side?.color === NEGRO.color);
    expect(posts.map((x) => +x.y0.toFixed(3)).sort((p, q) => p - q)).toEqual([0.2, 0.8, 1.4, 2, 2.6, 3]);
    for (const x of posts) within(x.y1 - nose((Math.min(...x.polygon.map((p) => p[1])) + Math.max(...x.polygon.map((p) => p[1]))) / 2), 0.87, 0.005);
    // del lado de la pared, nada
    expect(i.blocks.filter((x) => enEscalon(x) && cx(x) > 9)).toHaveLength(0);
    expect(validateInterior(i)).toEqual([]);
  });

  test('izq va del otro lado (contra la pared: sin losa al lado, todos los paños) y ambos, de los dos', () => {
    const izq = conPasamanos({ handrail: 'izq', handrailLook: NEGRO }).interior.blocks.filter(enEscalon);
    expect(izq).toHaveLength(15);
    for (const x of izq) expect(cx(x)).toBeCloseTo(9.8 - RAIL_T / 2, 6);
    const ambos = conPasamanos({ handrail: 'ambos', handrailLook: NEGRO }).interior;
    expect(ambos.blocks.filter(enEscalon)).toHaveLength(25);
    expect(barTops(ambos, NEGRO.color)).toHaveLength(2);
    // sin handrail, como antes: ningún paño sobre los escalones
    expect(conPasamanos({}).interior.blocks.filter(enEscalon)).toHaveLength(0);
  });

  test('de caño (railStyle): los paños frenan y no se ven; se ven el pasamanos (0,9) y un intermedio (0,45) del color de rail, y los parantes', () => {
    const { interior: i } = conPasamanos({ rail: BLANCO, railStyle: { caño: true }, handrail: 'der' });
    const panes = i.blocks.filter(enEscalon);
    expect(panes).toHaveLength(10);
    for (const x of panes) {
      expect(x.collide).toBe('glass');
      expect(x.side).toBeUndefined();
      expect(x.top).toBeUndefined();
    }
    const tops = barTops(i, BLANCO.color);
    expect(tops).toHaveLength(2);
    const alturas = tops.map((p) => +(p.corners[0][1] - nose(p.corners[0][2])).toFixed(3)).sort((p, q) => p - q);
    expect(alturas).toEqual([0.45, 0.9]);
    const posts = i.blocks.filter((x) => x.collide === 'none' && x.side?.color === BLANCO.color && x.y0 > 0.1 && x.y0 < 3.1
      && Math.max(...x.polygon.map((p) => p[1])) - Math.min(...x.polygon.map((p) => p[1])) < 0.1);
    expect(posts).toHaveLength(6);
    for (const x of posts) expect(x.top?.color).toBe(BLANCO.color);
  });

  test('con pasamanos de los dos lados se sube y se baja igual', () => {
    const { interior: i, world } = conPasamanos({ handrail: 'ambos', handrailLook: NEGRO });
    const [s] = i.stairs;
    const up = climbStair(world, s);
    within(up.pos[1], 3.2);
    expect(up.onGround && up.mode === 'walk', where(up)).toBe(true);
    const down = climbStair(world, s, true);
    within(down.pos[1], 0);
    expect(down.onGround && down.mode === 'walk', where(down)).toBe(true);
  });
});

// Las gradas de un cine (T9): un tramo adentro de un nivel (rise, sin hueco) con descansos (landings)
describe('tramo adentro de un nivel, con descansos (gradas)', () => {
  const CAÑO = { mat: 'metal', color: '#2a2a2c' } as const;
  // de 1,2 m contra la pared de x = 10, sube 1,2 m hacia +z desde z = 4: escalón (0,3), descanso (0,85), escalón…; arriba,
  // una plataforma a 1,2 m (la última grada) hasta el fondo
  const grada = (o: Partial<Parameters<Kit['stair']>[0]> = {}) => testInterior({ extra: (k) => {
    k.stair({ from: 0, to: 0, rise: 1.2, landings: { every: 2, length: 0.85 }, foot: [9.2, 4], dir: [0, 1], width: 1.2, look: LOOKS.escalera, ...o });
    k.block([[8.6, 4 + 3 * TREAD + 2 * 0.85], [9.8, 4 + 3 * TREAD + 2 * 0.85], [9.8, 14.8], [8.6, 14.8]], 0, 1.2, 'solid', 'otro', { top: LOOKS.escalera, side: LOOKS.escalera });
  } });

  test('6 contrahuellas de 0,2: escalones de 0,3 y descansos de 0,85 alternados, sin hueco en el techo, y su StairRun en el nivel 0', () => {
    const { interior: i } = grada();
    const steps = i.blocks.filter((x) => x.role === 'escalon' || x.role === 'descanso')
      .map((x) => ({ role: x.role, y: +x.y1.toFixed(3), z0: +Math.min(...x.polygon.map((p) => p[1])).toFixed(3), z1: +Math.max(...x.polygon.map((p) => p[1])).toFixed(3) }))
      .sort((p, q) => p.z0 - q.z0);
    expect(steps).toEqual([
      { role: 'escalon', y: 0.2, z0: 4, z1: 4.3 }, { role: 'descanso', y: 0.4, z0: 4.3, z1: 5.15 },
      { role: 'escalon', y: 0.6, z0: 5.15, z1: 5.45 }, { role: 'descanso', y: 0.8, z0: 5.45, z1: 6.3 },
      { role: 'escalon', y: 1, z0: 6.3, z1: 6.6 },
    ]);
    expect(i.roofHoles).toEqual([]);
    expect(i.floors.map((f) => f.holes.length)).toEqual([0]);
    expect(i.blocks.filter((x) => x.role === 'baranda')).toEqual([]);
    const [s] = i.stairs;
    expect([s.from, s.to]).toEqual([0, 0]);
    expect(s.foot[1]).toBe(0);
    expect(s.top[1]).toBeCloseTo(1.2, 9);
    expect(s.top[2]).toBeCloseTo(6.6 + 0.6, 9);
    expect(validateInterior(i)).toEqual([]);
  });

  test('se sube caminando hasta la plataforma de arriba (1,2 m) y se baja', () => {
    const { interior: i, world } = grada();
    const up = climbStair(world, i.stairs[0]);
    within(up.pos[1], 1.2);
    expect(up.onGround && up.mode === 'walk', where(up)).toBe(true);
    const down = climbStair(world, i.stairs[0], true);
    within(down.pos[1], 0);
  });

  test('validateInterior: el descanso no cuenta como huella, pero la contrahuella sí (una de 0,4 avisa)', () => {
    const { interior: i } = grada();
    expect(validateInterior(i)).toEqual([]);
    // sin el escalón del medio, del pie (0) al primer descanso (0,4) hay 0,4
    const sinEscalon = { ...i, blocks: i.blocks.filter((x) => !(x.role === 'escalon' && Math.abs(x.y1 - 0.2) < 1e-6)) };
    expect(validateInterior(sinEscalon).join('\n')).toMatch(/contrahuella de 0,4/);
  });

  // H3 de la revisión de la T10: la escalera `out` (se ve siempre, con el edificio) lleva sus barandas y su pasamanos
  // también `out`; railStyle.out solo (el de las barandas de hueco, La Veneciana) no cambia el pasamanos
  test('una escalera out: las barandas, los parantes y las barras del pasamanos también son out; railStyle.out solo, no', () => {
    const { interior: i } = grada({ rail: CAÑO, railStyle: { caño: true }, handrail: 'ambos', out: true });
    const barandas = i.blocks.filter((x) => x.role === 'baranda');
    expect(barandas.length).toBeGreaterThan(0);
    for (const x of barandas) expect(x.out).toBe(true);
    const posts = i.blocks.filter((x) => x.collide === 'none' && x.side?.color === CAÑO.color);
    expect(posts.length).toBeGreaterThan(0);
    for (const x of posts) expect(x.out).toBe(true);
    const bars = i.panes.filter((p) => p.look.color === CAÑO.color);
    expect(bars.length).toBeGreaterThan(0);
    for (const p of bars) expect(p.out).toBe(true);
    expect(validateInterior(i)).toEqual([]);
    const soloRail = grada({ rail: CAÑO, railStyle: { caño: true, out: true }, handrail: 'izq' }).interior;
    expect(soloRail.blocks.filter((x) => x.role === 'baranda').some((x) => x.out)).toBe(false);
    expect(soloRail.panes.some((p) => p.out)).toBe(false);
  });

  test('el pasamanos sigue la pendiente media del tramo (de la primera nariz a la llegada), con un paño por escalón y por descanso', () => {
    const { interior: i } = grada({ rail: CAÑO, railStyle: { caño: true }, handrail: 'izq' });
    const panes = i.blocks.filter((x) => x.role === 'baranda');
    expect(panes).toHaveLength(5);
    for (const x of panes) expect(x.y1 - x.y0).toBeCloseTo(RAIL_H, 9);
    const tops = i.panes.filter((p) => p.look.color === CAÑO.color && p.normal[1] > 0.1 && p.normal[1] < 0.99
      && Math.max(...p.corners.map((q) => q[2])) - Math.min(...p.corners.map((q) => q[2])) > 1);
    expect(tops).toHaveLength(2);
    const run = 3 * TREAD + 2 * 0.85;
    const line = (z: number): number => 0.2 + ((z - 4) * (1.2 - 0.2)) / run;
    const alturas = tops.map((p) => p.corners.map((q) => +(q[1] - line(q[2])).toFixed(3)));
    for (const a of alturas) expect(new Set(a).size, a.join(' ')).toBe(1);
    expect(alturas.map((a) => a[0]).sort((p, q) => p - q)).toEqual([0.45, 0.9]);
  });
});

describe('validateInterior', () => {
  const msgs = (i: Interior): string => validateInterior(i).join('\n');

  test('el de prueba da [], con y sin escalera', () => {
    expect(validateInterior(testInterior().interior)).toEqual([]);
    expect(validateInterior(testInterior({ publicFloors: 2, stair: true }).interior)).toEqual([]);
  });

  test('una contrahuella de 0,25: "contrahuella", con el lugar y dónde', () => {
    const { interior } = testInterior({ publicFloors: 2, stair: true });
    const steps = interior.blocks.filter((x) => x.role === 'escalon').sort((p, q) => p.y1 - q.y1);
    steps[4].y1 = steps[3].y1 + 0.25;
    const m = validateInterior(interior);
    expect(m.join('\n')).toMatch(/contrahuella/);
    expect(m.every((x) => x.startsWith('prueba: '))).toBe(true);
    expect(m.join('\n')).toMatch(/escalón 5/);
  });

  test('un dintel de 2,0: "dintel"', () => {
    const { interior } = testInterior({ extra: (k) => k.wall([0.2, 10], [6, 10], { gaps: [{ at: 3, width: 1, height: 2.0 }], look: LOOKS.pared }) });
    expect(msgs(interior)).toMatch(/dintel/);
  });

  test('una baranda de 0,9: "baranda"', () => {
    const { interior } = testInterior({ extra: (k) => k.block([[2, 10], [6, 10], [6, 10.05], [2, 10.05]], 0, 0.9, 'glass', 'baranda', {}) });
    expect(msgs(interior)).toMatch(/baranda/);
  });

  test('una escalera de 1,0 de ancho: "ancho"', () => {
    const { interior } = testInterior({ publicFloors: 2, extra: (k) => k.stair({ from: 0, to: 1, foot: [2, 4], dir: [0, 1], width: 1.0, look: LOOKS.escalera }) });
    expect(msgs(interior)).toMatch(/ancho/);
  });

  test('una huella que no es de 0,3: "huella"', () => {
    const { interior } = testInterior({ publicFloors: 2, stair: true });
    const step = interior.blocks.filter((x) => x.role === 'escalon').sort((p, q) => p.y1 - q.y1)[2];
    const zMax = Math.max(...step.polygon.map((q) => q[1]));
    step.polygon = step.polygon.map(([x, z]) => [x, z === zMax ? z + 0.05 : z]); // 0,35 de huella
    expect(msgs(interior)).toMatch(/huella/);
  });

  test('un tabique de 0,15: "tabique"; una pared de 0,2 pasa', () => {
    expect(msgs(testInterior({ extra: (k) => k.wall([0.2, 10], [6, 10], { t: 0.15, look: LOOKS.pared }) }).interior)).toMatch(/tabique/);
    expect(validateInterior(testInterior({ extra: (k) => k.wall([0.2, 10], [6, 10], { t: WALL_OUT, look: LOOKS.pared }) }).interior)).toEqual([]);
  });

  test('un mueble de MODEL_BOX sin su caja: "caja"', () => {
    const { interior } = testInterior({ extra: (k) => k.furniture('mesa', [5, 8], 0, 0) });
    expect(validateInterior(interior)).toEqual([]);
    interior.blocks = interior.blocks.filter((x) => x.role !== 'mueble');
    expect(msgs(interior)).toMatch(/caja/);
  });

  test('un bloque fuera de la planta: "sale de la planta"; uno `out`, no', () => {
    const outside: Vec2[] = [[2, -3], [4, -3], [4, -2], [2, -2]];
    expect(msgs(testInterior({ extra: (k) => k.block(outside, 0, 1, 'solid', 'mueble', {}) }).interior)).toMatch(/sale de la planta/);
    expect(validateInterior(testInterior({ extra: (k) => k.block(outside, 0, 1, 'solid', 'otro', {}, true) }).interior)).toEqual([]);
  });
});

describe('muebles', () => {
  test('MODEL_BOX: las mesas y lo sólido de ≥ SOLID_MIN_H; sillas, banquetas, lámparas y la hoja de vidrio no tienen caja', () => {
    expect(MODEL_BOX.mesa).toBeDefined();
    expect(MODEL_BOX.sillon).toBeDefined();
    for (const m of ['silla', 'banqueta', 'lampara', 'hoja-vidrio'] as ItemModel[]) expect(MODEL_BOX[m], m).toBeUndefined();
    for (const [m, box] of Object.entries(MODEL_BOX)) expect(box!.h, m).toBeGreaterThanOrEqual(SOLID_MIN_H);
  });

  // Tarea 6: el frente de un modelo es su +z (models.ts). Con la cuenta de la cámara (que mira a su −z) el mueble
  // quedaba de espaldas a su yaw: un cajero automático contra la pared miraba a la pared.
  test('un mueble mira hacia su yaw (local): el +z del modelo, su frente, apunta hacia ahí; también con el marco espejado', () => {
    const { b, input } = testInterior();
    const yaws = [0, Math.PI / 2, Math.PI, -Math.PI / 3];
    for (const frame of [input.frame, { origin: [0, 15] as Vec2, u: [1, 0] as Vec2, v: [0, -1] as Vec2 }]) {
      const k = new Kit(b, { ...input, frame });
      k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
      for (const yaw of yaws) k.furniture('silla', [5, 7], 0, yaw);
      k.done(0.8).items.forEach((it, n) => {
        const a = yaws[n];
        const want: Vec2 = [Math.sin(a) * frame.u[0] + Math.cos(a) * frame.v[0], Math.sin(a) * frame.u[1] + Math.cos(a) * frame.v[1]];
        // rotación three.js sobre +Y: el +z del modelo va a (sin yaw, cos yaw)
        expect([Math.sin(it.yaw), Math.cos(it.yaw)], `yaw local ${a.toFixed(2)}`).toBeCloseTo2D(want, 9);
      });
    }
  });

  test('una mesa frena a un jugador que camina contra ella; una silla se cruza', () => {
    const table = testInterior({ extra: (k) => k.furniture('mesa', [5, 8], 0, 0) });
    expect(table.interior.items).toEqual([{ model: 'mesa', at: [5, 0, 8], yaw: expect.any(Number) }]);
    const s = walkTo(table.world, [5, 0, 5], [5, 11], 3);
    expect(s.pos[2], where(s)).toBeLessThan(8 - MODEL_BOX.mesa!.d / 2 - 0.3);
    const chair = testInterior({ extra: (k) => k.furniture('silla', [5, 8], 0, 0) });
    expect(chair.interior.blocks.some((x) => x.role === 'mueble')).toBe(false);
    const c = walkTo(chair.world, [5, 0, 5], [5, 11], 3);
    expect(Math.hypot(c.pos[0] - 5, c.pos[2] - 11), where(c)).toBeLessThan(0.5);
  });

  test('un blanco agachado detrás de una mesa, a 10 m, con un tiro desde 1,65 m al centro del cuerpo: da en la mesa', () => {
    const { world } = testInterior({ extra: (k) => k.furniture('mesa', [5, 12.6], 0, 0) });
    const shoot = (crouching: boolean) => {
      const pos: Vec3 = [5, 0, 13.4];
      const center = crouching ? PLAYER.crouchHeight / 2 : PLAYER.height / 2;
      return hitscan(world, [{ id: 'detras', pos, crouching }], [5, 1.65, 3.4], [0, center - 1.65, 10], 100);
    };
    expect(shoot(true)?.kind).toBe('world');
    expect(shoot(false)).toMatchObject({ kind: 'target', id: 'detras' }); // parado, la mesa no lo tapa
  });
});

// Tarea 9: los árboles del patio del Guernica (D12) son árboles del mapa: los dibuja vegetation.ts con los de la calle
// (la misma copa y la misma corteza) y su tronco sólido sale de collision.ts igual que el de cualquier árbol.
describe('árboles del patio (k.tree)', () => {
  const PATIO: Vec2[] = [[0, 0], [10, 0], [10, -4], [0, -4]];
  test('k.tree deja el árbol (mundo) en Interior.trees, no como mueble, y su tronco es el de un árbol del mapa: TRUNK_R, trunkHeight', () => {
    const { b, input } = testInterior();
    const k = new Kit(b, { ...input, patios: [PATIO] });
    k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
    k.tree([3, -2], 2, 0.6);
    const i = k.done(0.8);
    expect(i.trees).toEqual([{ position: [3, -2], variant: 2, scale: 0.6 }]);
    expect(i.items).toEqual([]);
    const trunks = interiorPrisms(i).filter((p) => p.tag === 'tree');
    expect(trunks).toHaveLength(1);
    expect(trunks[0].minY).toBe(0);
    expect(trunks[0].maxY).toBeCloseTo(trunkHeight({ variant: 2, scale: 0.6 }), 9);
    for (const [x, z] of trunks[0].polygon) expect(Math.hypot(x - 3, z + 2)).toBeCloseTo(TRUNK_R, 9);
    const world = new CollisionWorld(interiorPrisms(i), [], FIXTURE_BOUNDS);
    expect(world.overlaps(3, -2, 0.1, 0.05, 1.8)).toBe(true);
    expect(world.overlaps(3, -2 - TRUNK_R - 0.2, 0.1, 0.05, 1.8)).toBe(false);
  });

  test('un árbol fuera de los patios es un error', () => {
    const { b, input } = testInterior();
    const k = new Kit(b, { ...input, patios: [PATIO] });
    k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
    expect(() => k.tree([3, 6], 2, 0.6)).toThrow(/patio/);
  });
});

describe('bajo techo (Review Focus 2)', () => {
  test('saltar bajo la losa: la cabeza frena en la losa y vuelve al piso en ≤ 1,5 s', () => {
    const { world } = testInterior();
    let s = stepPlayer(initialState([5, 0, 7]), input({ jump: true }), world, H);
    let t = H, top = 0;
    while (t < 1.5 && !s.onGround) {
      s = stepPlayer(s, input({}), world, H);
      t += H;
      top = Math.max(top, s.pos[1]);
    }
    expect(s.onGround, where(s)).toBe(true);
    expect(s.pos[1]).toBe(0);
    expect(top + PLAYER.height).toBeLessThanOrEqual(3.0 + 1e-6);
    expect(top).toBeGreaterThan(1.0);
  });

  /** W + salto hacia el fondo desde z = 5,5 (pegado al mueble: así no lo pasa de un salto) hasta que termina un mantle
   *  (o 3 s). */
  const climbAt = (world: CollisionWorld): { s: PlayerState; mantled: boolean } => {
    let s = initialState([5, 0, 5.5]);
    let mantled = false;
    for (let t = 0; t < 3 * SIM_HZ; t++) {
      s = stepPlayer(s, input({ forward: 1, jump: true, yaw: TO_BACK }), world, H);
      if (s.mode === 'mantle') mantled = true;
      else if (mantled) break;
    }
    for (let t = 0; t < SIM_HZ && !s.onGround; t++) s = stepPlayer(s, input({}), world, H);
    return { s, mantled };
  };
  const box = (h: number) => (k: Kit) => k.block([[3, 6], [7, 6], [7, 6.6], [3, 6.6]], 0, h, 'solid', 'mueble', {});

  test('trepar a un mostrador de 1,1 m funciona', () => {
    const { s, mantled } = climbAt(testInterior({ extra: box(1.1) }).world);
    expect(mantled).toBe(true);
    expect(s.onGround, where(s)).toBe(true);
    within(s.pos[1], 1.1, 1e-6);
  });

  test('frente a un estante de 2,2 m bajo la losa el mantle ni arranca (al aire libre, sí)', () => {
    expect(climbAt(testInterior({ extra: box(2.2) }).world).mantled).toBe(false);
    const shelf: Prism = { polygon: [[3, 6], [7, 6], [7, 6.6], [3, 6.6]], minY: 0, maxY: 2.2 };
    expect(climbAt(new CollisionWorld([shelf], [], FIXTURE_BOUNDS)).mantled).toBe(true);
  });
});

describe('colisión', () => {
  const mapOf = (b: Building, input: InteriorInput): MapData => ({
    version: 1, origin: { lat: 0, lon: 0 }, bounds: FIXTURE_BOUNDS, buildings: [b], outskirts: [], roads: [], railways: [], platforms: [],
    parks: [], places: [], signs: [], props: [], trees: [], randomSpawns: [], lootSpots: [], interiors: [input],
  });

  test('una escalera con `approach`: el hueco arranca antes del pie y el análisis de huecos del suelo la une con el piso', () => {
    // sin approach, el borde de la losa cae sobre el primer escalón: parado ahí el disco toca la losa (arriba de 2,4 m)
    // y el escalón (abajo de 1,8 m), y para el flood fill la escalera queda suelta (un hueco con 1-2 m² de escalones)
    const before = testInterior({ publicFloors: 2, stair: true });
    expect(analyzeGround(before.world, [before.b.footprint]).pockets).toHaveLength(1);
    const a = 0.75;
    const { b, interior, world } = testInterior({ publicFloors: 2, extra: (k) => k.stair({ from: 0, to: 1, foot: [9.2, 4], dir: [0, 1], width: 1.2, look: LOOKS.escalera, rail: LOOKS.baranda, approach: a }) });
    expect(analyzeGround(world, [b.footprint]).pockets).toEqual([]);
    expect(validateInterior(interior)).toEqual([]);
    const inset = (10 - 2 * WALL_OUT) * (15 - 2 * WALL_OUT);
    expect(interior.floors[1].area).toBeCloseTo(inset - 1.2 * (15 * TREAD + a), 6);
    // los escalones no se mueven (el primero sigue en el pie) y la baranda de la punta de abajo va al borde nuevo
    const steps = interior.blocks.filter((x) => x.role === 'escalon');
    expect(Math.min(...steps.flatMap((x) => x.polygon.map((q) => q[1])))).toBeCloseTo(4, 9);
    const rails = interior.blocks.filter((x) => x.role === 'baranda' && x.y0 === 3.2);
    expect(rails.some((x) => x.polygon.every((q) => Math.abs(q[1] - (4 - a - RAIL_T / 2)) <= RAIL_T / 2 + 1e-9))).toBe(true);
    // y se sube igual
    const up = climbStair(world, interior.stairs[0]);
    within(up.pos[1], 3.2);
  });

  test('exitPockets: el piso de adentro se une con la calle por la puerta (sin la puerta sería un hueco)', () => {
    const { b, input } = testInterior();
    expect(exitPockets(mapOf(b, input)).stats.pockets).toBe(0);
    const closed = { ...input, openings: input.openings.filter((o) => o.kind !== 'puerta') };
    expect(exitPockets(mapOf(b, closed)).stats.pockets).toBe(1);
  });

  test('raycast contra el vidrio: pega por defecto (tag glass:<id>) y lo atraviesa con throughGlass', () => {
    const { world } = testInterior();
    const glass = world.raycast([2, 1.5, -2], [0, 0, 1], 100);
    expect(glass?.tag).toBe('glass:b-prueba');
    expect(glass!.dist).toBeLessThan(2 + WALL_OUT);
    const through = world.raycast([2, 1.5, -2], [0, 0, 1], 100, true);
    expect(through?.tag).toBe('b-prueba');
    within(through!.dist, 2 + 15 - WALL_OUT, 1e-6);
  });

  test('interiorPrisms: los bloques que colisionan, con el tag del edificio (o glass:) y sus alturas', () => {
    const { interior } = testInterior();
    const prisms = interiorPrisms(interior);
    expect(prisms).toHaveLength(interior.blocks.filter((x) => x.collide !== 'none').length);
    expect(new Set(prisms.map((p) => p.tag))).toEqual(new Set(['b-prueba', 'glass:b-prueba']));
  });
});

describe('marco local', () => {
  // un local de 8 × 6 girado 30° y con el marco espejado (V a la derecha de U)
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const frame = { origin: [20, -10] as Vec2, u: [c, s] as Vec2, v: [s, -c] as Vec2 };
  const local: Vec2[] = [[0, 0], [8, 0], [8, 6], [0, 6]];
  const fp = ensureCCW(local.map((p) => toWorld(frame, p)));
  const b: Building = { id: 'girado', footprint: fp, height: 3.8, floors: 1, kind: 'shop', wall: 'plaster', tint: '#ccc' };
  const front = fp.findIndex((p, i) => {
    const q = fp[(i + 1) % fp.length];
    const mid = toWorld(frame, [4, 0]);
    return Math.abs((p[0] + q[0]) / 2 - mid[0]) < 1e-9 && Math.abs((p[1] + q[1]) / 2 - mid[1]) < 1e-9;
  });
  const input: InteriorInput = { placeId: 'girado', buildingId: 'girado', frame, openings: [{ kind: 'puerta', edge: front, s0: 3, s1: 4.6, y0: 0, y1: 2.3 }], patios: [] };
  /** adelante de un yaw (convención de la cámara) */
  const fwd = (yaw: number): Vec2 => [-Math.sin(yaw), -Math.cos(yaw)];

  test('box, at y las aberturas en el marco local', () => {
    const k = new Kit(b, input);
    expect(k.box.u0).toBeCloseTo(0, 9);
    expect(k.box.u1).toBeCloseTo(8, 9);
    expect(k.box.v0).toBeCloseTo(0, 9);
    expect(k.box.v1).toBeCloseTo(6, 9);
    expect(k.at([1, 2])).toBeCloseTo2D(toWorld(frame, [1, 2]), 9);
    const [o] = k.openings;
    expect(o.a[1]).toBeCloseTo(0, 9);
    expect(o.c[1]).toBeCloseTo(0, 9);
    expect(Math.abs(o.c[0] - o.a[0])).toBeCloseTo(1.6, 9);
  });

  test('los ángulos: 0 mira a +V y π/2 a +U, en vistas, muebles, carteles y escaleras', () => {
    const k = new Kit(b, input);
    k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
    k.view('adentro', [4, 3], 0, 0);
    k.view('costado', [4, 3], 0, Math.PI / 2);
    k.furniture('mesa', [4, 3], 0, Math.PI / 2);
    k.label('CARTEL', [4, 5.8], 2, [0, -1], 1, 0.4, { fondo: '#000', letra: '#fff', marco: '#000', fuente: 'sans' });
    k.mark('centro', [4, 3], 0);
    const i = k.done(0.8);
    expect(fwd(i.views[0].yaw)).toBeCloseTo2D(frame.v, 9);
    expect(fwd(i.views[1].yaw)).toBeCloseTo2D(frame.u, 9);
    // un mueble mira con su frente, el +z del modelo (rotación three.js: va a (sin yaw, cos yaw)), no como la cámara
    expect([Math.sin(i.items[0].yaw), Math.cos(i.items[0].yaw)]).toBeCloseTo2D(frame.u, 9);
    expect(i.labels[0].normal).toBeCloseTo2D([-frame.v[0], -frame.v[1]], 9);
    expect(i.labels[0].at[1]).toBe(2);
    const at = toWorld(frame, [4, 3]);
    expect(i.marks.centro).toEqual([at[0], 0, at[1]]);
    expect(i.views[0].pos).toEqual([at[0], 0, at[1]]);
    // la caja de la mesa: el largo (w) sobre el +x del modelo, que con yaw π/2 local corre a lo largo de V
    const box = i.blocks.find((x) => x.role === 'mueble')!;
    const along = (d: Vec2) => Math.max(...box.polygon.map((p) => p[0] * d[0] + p[1] * d[1])) - Math.min(...box.polygon.map((p) => p[0] * d[0] + p[1] * d[1]));
    expect(along(frame.v)).toBeCloseTo(MODEL_BOX.mesa!.w, 9);
    expect(along(frame.u)).toBeCloseTo(MODEL_BOX.mesa!.d, 9);
    expect(validateInterior(i)).toEqual([]);
  });

  // Lo usan los planes para medir el lote (tarea 6): las caras de adentro de las paredes de afuera, en el marco local.
  test('inside: cada vértice queda adentro, a WALL_OUT de las dos aristas de su esquina; también con el marco espejado', () => {
    for (const [name, k, foot] of [['girado y espejado', new Kit(b, input), fp], ['el de prueba', new Kit(testInterior().b, testInterior().input), testInterior().b.footprint]] as const) {
      const ring = k.inside;
      expect(ring, name).toHaveLength(foot.length);
      for (const p of ring) {
        const w = k.at(p);
        const d = foot.map((a, j) => {
          const c = foot[(j + 1) % foot.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]);
          return Math.abs((w[0] - a[0]) * (c[1] - a[1]) - (w[1] - a[1]) * (c[0] - a[0])) / l;
        }).sort((x, y) => x - y);
        expect(d[0], `${name}: ${p.join(', ')}`).toBeCloseTo(WALL_OUT, 9);
        expect(d[1], `${name}: ${p.join(', ')}`).toBeCloseTo(WALL_OUT, 9);
        expect(d[2], `${name}: ${p.join(', ')}`).toBeGreaterThan(WALL_OUT + 1);
        expect(pointInPolygon(w, foot), name).toBe(true);
      }
    }
  });

  test('con el marco espejado, todos los bloques quedan antihorarios y la puerta se entra', () => {
    const k = new Kit(b, input);
    k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
    const i = k.done(0.8);
    for (const x of i.blocks) expect(signedAreaFromAbove(x.polygon), x.role).toBeGreaterThan(0);
    const world = new CollisionWorld(interiorPrisms(i), [], { minX: -50, maxX: 80, minZ: -60, maxZ: 60 });
    const st = enterDoor(world, i.doors[0]);
    expect(insideOf(b, st.pos), where(st)).toBe(true);
    expect(doorDepth(i.doors[0], st.pos)).toBeGreaterThanOrEqual(2);
  });
});
