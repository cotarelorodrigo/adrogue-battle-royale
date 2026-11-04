import { MANTLE_REACH } from '../../src/mapgen/climb.ts';
import { CollisionWorld } from '../../src/shared/collision.ts';
import type { LadderVolume, Prism } from '../../src/shared/collision.ts';
import type { Vec3 } from '../../src/shared/geo.ts';
import type { Bounds } from '../../src/shared/mapdata.ts';
import { PLAYER, eyeHeight, initialState, stepPlayer } from '../../src/shared/player.ts';
import type { PlayerInput, PlayerState } from '../../src/shared/player.ts';

const bounds: Bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
/** Caja x ∈ [x0, x1] × z ∈ [z0, z1] × y ∈ [minY, maxY]. */
const box = (x0: number, z0: number, x1: number, z1: number, maxY: number, minY = 0): Prism =>
  ({ polygon: [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], minY, maxY });

// Mundo de prueba: el suelo es y = 0 (no es un prisma). Casi todo se recorre hacia el este (+x), cada cosa en su carril z.
const thinWallX = 10;
const world = new CollisionWorld([
  box(thinWallX, -5, thinWallX + 0.3, 5, 3), // pared de 0,3 m de espesor (carril z = 0)
  box(3, 8, 15, 12, 0.3), // cordón de 0,3 m (carril z = 10)
  box(3, 18, 15, 22, 0.6), // bloque de 0,6 m (carril z = 20)
  box(3, -12, 12, -8, 2.4), // pared de 2,4 m con lugar arriba (carril z = −10)
  box(3, -22, 12, -18, 2.6), // pared de 2,6 m (carril z = −20)
  box(-10, 26, 0, 34, 3.8), // techo A (carril z = 30)
  box(3.5, 26, 20, 34, 3.8), // techo B, a 3,5 m de A
  box(5, -35, 20, -25, 7), // edificio de 7 m con escalera en la cara oeste (carril z = −30)
  box(40, -5, 48.5, 5, 3.8), // techo junto al borde este
  box(3, -42, 3.4, -38, 2), box(3.4, -42, 9, -38, 5), // paredón de 2 m pegado a un edificio de 5 m (carril z = −40)
  box(23.7, 18.1, 24.8, 19.9, 1.4), box(25, 14, 35, 24, 3.8), // contenedor a 0,2 m de un local de 3,8 m (carril z = 19)
], [{ base: [5, -30], normal: [-1, 0], topY: 7 } satisfies LadderVolume], bounds);

const EAST = -Math.PI / 2; // forward = (−sin yaw, −cos yaw) = (1, 0)
const WEST = Math.PI / 2;
const idle: PlayerInput = { forward: 0, right: 0, jump: false, crouch: false, yaw: EAST, pitch: 0 };
const fwd: PlayerInput = { ...idle, forward: 1 };
const fwdToWall = fwd; // desde (0, 0) hacia el este está la pared de 0,3 m
const fwdJump: PlayerInput = { ...fwd, jump: true };
const crouchIn: PlayerInput = { ...idle, crouch: true };
const back: PlayerInput = { ...idle, forward: -1 };

const at = (x: number, z: number, y = 0): PlayerState => initialState([x, y, z]);
const running = (s: PlayerState, vx: number): PlayerState => ({ ...s, vel: [vx, 0, 0] });
const run = (s: PlayerState, input: PlayerInput, secs: number, w: CollisionWorld = world): PlayerState => {
  for (let t = 0; t < secs; t += 1 / 60) s = stepPlayer(s, input, w, 1 / 60);
  return s;
};
/** Igual que run, pero llama a `check` después de cada paso. */
const trace = (s: PlayerState, input: PlayerInput, secs: number, check: (s: PlayerState) => void, w: CollisionWorld = world): PlayerState => {
  for (let t = 0; t < secs; t += 1 / 60) {
    s = stepPlayer(s, input, w, 1 / 60);
    check(s);
  }
  return s;
};
const dist2D = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
const bodyOverlaps = (s: PlayerState, w: CollisionWorld = world): boolean =>
  w.overlaps(s.pos[0], s.pos[2], PLAYER.radius, s.pos[1], s.pos[1] + (s.crouching ? PLAYER.crouchHeight : PLAYER.height));

const jumpFromFlat = at(0, 0);
const maxY = (s: PlayerState): number => {
  let top = s.pos[1];
  trace(s, { ...idle, jump: true }, 1.5, (q) => (top = Math.max(top, q.pos[1])));
  return top;
};
const beforeCurb = at(2, 10);
const beforeBlock = at(2, 20);
const roofEdgeRunning = running(at(-0.2, 30, 3.8), 6);
const atWall24 = at(2.6, -10);
const atWall26 = at(2.6, -20);
const atLadder = at(4.5, -30);
const roofAtEdge = at(47, 0, 3.8);
const beforeThinWall = running(at(thinWallX - 0.4, 0), 6);

describe('tests del plan', () => {
  test('corre a 6 m/s', () => expect(dist2D(run(at(0, 0), fwd, 1).pos, [0, 0, 0])).toBeCloseTo(6, 0));
  test('la pared lo frena a radio de distancia', () => expect(run(at(0, 0), fwdToWall, 2).pos[0]).toBeCloseTo(thinWallX - 0.35, 2));
  test('sube cordón de 0,3 pero no bloque de 0,6', () => {
    expect(run(beforeCurb, fwd, 1).pos[1]).toBeCloseTo(0.3);
    const s = run(beforeBlock, fwd, 1);
    expect(s.pos[1]).toBe(0);
    expect(s.pos[0]).toBeCloseTo(3 - 0.35, 3); // frenado contra el bloque, no adentro
  });
  test('salto llega a 1,25 m', () => expect(maxY(jumpFromFlat)).toBeCloseTo(1.25, 1));
  test('salto corriendo cruza 3,5 m entre techos', () => expect(run(roofEdgeRunning, fwdJump, 1.5).pos[1]).toBeCloseTo(3.8));
  test('trepa pared de 2,4 m pero no de 2,6 m', () => {
    expect(run(atWall24, fwdJump, 1).pos[1]).toBeCloseTo(2.4);
    expect(run(atWall26, fwdJump, 1).pos[1]).toBeLessThan(0.1);
  });
  test('escalera de 7 m en ~2,3 s y termina en el techo', () => {
    const s = run(atLadder, fwd, 3);
    expect(s.pos[1]).toBeCloseTo(7);
    expect(s.mode).toBe('walk');
  });
  test('no sale del área ni saltando desde un techo', () => expect(Math.abs(run(roofAtEdge, fwdJump, 3).pos[0])).toBeLessThanOrEqual(50 - 0.35));
  test('dt = 1,0 no atraviesa la pared de 0,3 m', () => expect(stepPlayer(beforeThinWall, fwd, world, 1.0).pos[0]).toBeLessThan(thinWallX));
  test('agachado: ojos a 1,05', () => expect(eyeHeight(run(at(0, 0), crouchIn, 0.2))).toBeCloseTo(1.05));
});

describe('constantes', () => {
  test('mantleReach es el mismo alcance con el que mapgen ubica los accesos a techos', () =>
    expect(PLAYER.mantleReach).toBe(MANTLE_REACH));
});

describe('movimiento', () => {
  test('yaw 0 mira al norte (−z); right con yaw 0 va al este (+x)', () => {
    const n = run(at(0, 0), { ...fwd, yaw: 0 }, 0.5).pos;
    expect(n[2]).toBeLessThan(-2.5);
    expect(n[0]).toBeCloseTo(0, 6);
    const e = run(at(0, 0), { ...idle, yaw: 0, right: 1 }, 0.5).pos;
    expect(e[0]).toBeGreaterThan(2.5);
    expect(e[2]).toBeCloseTo(0, 6);
  });
  test('en diagonal no corre más rápido', () =>
    expect(dist2D(run(at(0, 0), { ...fwd, right: 1 }, 1).pos, [0, 0, 0])).toBeCloseTo(6, 0));
  test('agachado camina a 2,5 m/s', () =>
    expect(dist2D(run(at(0, 0), { ...fwd, crouch: true }, 1).pos, [0, 0, 0])).toBeCloseTo(2.5, 0));
  test('en diagonal contra la pared se desliza y conserva la componente tangencial', () => {
    const s = run(at(8, 3), { ...fwd, yaw: -Math.PI / 4 }, 1); // forward = (√½, −√½): noreste
    expect(s.pos[0]).toBeCloseTo(thinWallX - 0.35, 3);
    expect(s.vel[2]).toBeCloseTo(-6 * Math.SQRT1_2, 2);
    expect(s.vel[0]).toBeCloseTo(0, 3);
    expect(s.pos[2]).toBeLessThan(3 - 3.5);
  });
  test('un dt grande se recorta a maxDt', () =>
    expect(stepPlayer(beforeThinWall, fwd, world, 1.0)).toEqual(stepPlayer(beforeThinWall, fwd, world, PLAYER.maxDt)));
  test('saltar requiere soltar la tecla: mantenerla no rebota', () => {
    const s = run(jumpFromFlat, { ...idle, jump: true }, 2);
    expect(s.pos[1]).toBe(0);
    expect(s.onGround).toBe(true);
  });
  test('al bajarse corriendo de un techo cae y aterriza en el suelo', () => {
    let wasAirborne = false;
    const s = trace(at(-5, 30, 3.8), { ...fwd, yaw: 0 }, 2, (q) => {
      if (!q.onGround) wasAirborne = true;
    });
    expect(wasAirborne).toBe(true);
    expect(s.pos[1]).toBe(0);
    expect(s.onGround).toBe(true);
    expect(s.pos[2]).toBeLessThan(26 - 0.35);
  });
  // 0,698 y 0,7 (= 2r) caen en la ventana donde pushOut a veces no resuelve: ahí actúa el rechazo del subpaso.
  test.each([0.6, 0.698, 0.7])('contra una ranura de %s m entre edificios nunca queda superpuesto', (width) => {
    const hw = width / 2;
    // dos edificios de 7 m con la ranura en z ∈ [−hw, hw] y la boca en x = −20
    const slot = new CollisionWorld([box(-30, -25, -20, -hw, 7), box(-30, hw, -20, 25, 7)], [], bounds);
    for (const z0 of [-2, -1, -0.5, -0.2, 0, 0.2, 0.5, 1, 2]) {
      for (const dyaw of [-0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6]) {
        trace(at(-15, z0), { ...fwd, yaw: WEST + dyaw }, 3, (s) => {
          expect(bodyOverlaps(s, slot), `z0 ${z0} dyaw ${dyaw} en ${s.pos}`).toBe(false);
          // el disco no entra: a lo sumo toca las dos esquinas de la boca
          expect(s.pos[0]).toBeGreaterThan(-20 + Math.sqrt(Math.max(0, 0.35 ** 2 - hw ** 2)) - 1e-3);
        }, slot);
      }
    }
  });
});

describe('trepar', () => {
  test('también trepa en el aire si salta hacia la pared desde lejos', () => {
    const s = run(at(1, -10), fwdJump, 1.5);
    expect(s.pos[1]).toBeCloseTo(2.4);
    expect(s.onGround).toBe(true);
  });
  test('el alcance se mide desde donde saltó: en el aire tampoco llega a 2,6 m', () =>
    expect(run(at(1, -20), fwdJump, 1.5).pos[1]).toBeLessThan(0.1));
  test('contenedor de 1,4 m + mantle llega a un techo de 3,8 m', () => {
    const s = run(at(23.3, 19), fwdJump, 2);
    expect(s.pos[1]).toBeCloseTo(3.8);
    expect(s.pos[0]).toBeGreaterThan(25 + 0.35);
  });
  test('no trepa si arriba no hay lugar para el cuerpo', () => {
    const s = run(at(2.6, -40), fwdJump, 1);
    expect(s.mode).toBe('walk');
    expect(s.pos[1]).toBeLessThan(0.1);
  });
  test('durante el mantle ignora la entrada y termina parado en el borde', () => {
    let s = stepPlayer(atWall24, fwdJump, world, 1 / 60);
    expect(s.mode).toBe('mantle');
    expect(s.mantleTo).toEqual([2.6 + 0.6, 2.4, -10]);
    s = run(s, back, 0.2);
    expect(s.mode).toBe('mantle');
    s = run(s, idle, 0.3);
    expect(s.mode).toBe('walk');
    expect(s.onGround).toBe(true);
    expect(s.pos).toEqual([2.6 + 0.6, 2.4, -10]);
  });
});

describe('escaleras', () => {
  const climbed = run(atLadder, fwd, 1); // a ~3 m del suelo
  test('sube a 3 m/s y soltar forward lo deja quieto en la escalera', () => {
    expect(climbed.mode).toBe('ladder');
    expect(climbed.pos[1]).toBeCloseTo(3, 1);
    const held = run(climbed, idle, 1);
    expect(held.mode).toBe('ladder');
    expect(held.pos).toEqual(climbed.pos);
  });
  test('jump lo suelta: cae al suelo y no se vuelve a agarrar mientras jump sigue apretado', () => {
    const s = run(climbed, fwdJump, 1.5);
    expect(s.mode).toBe('walk');
    expect(s.pos[1]).toBe(0);
    expect(s.onGround).toBe(true);
    expect(run(s, fwd, 0.1).mode).toBe('ladder'); // al soltar jump, forward lo agarra de nuevo
  });
  test('ir para atrás lo suelta y cae', () => {
    const s = stepPlayer(climbed, back, world, 1 / 60);
    expect(s.mode).toBe('walk');
    expect(run(s, idle, 1.5).pos[1]).toBe(0);
  });
  test('de espaldas a la pared no se agarra', () => {
    const s = run(at(4.5, -30), { ...fwd, yaw: WEST }, 0.05);
    expect(s.mode).toBe('walk');
  });
});

describe('correr (Shift)', () => {
  const lane = at(-40, 40); // carril libre
  const sprint: PlayerInput = { ...fwd, sprint: true };
  const speed2D = (s: PlayerState): number => Math.hypot(s.vel[0], s.vel[2]);
  test('hacia adelante llega a sprintSpeed', () => {
    const s = run(lane, sprint, 0.5); // acelera en ~0,14 s
    expect(speed2D(s)).toBeCloseTo(PLAYER.sprintSpeed, 6);
    expect(run(s, sprint, 1).pos[0] - s.pos[0]).toBeCloseTo(PLAYER.sprintSpeed, 1); // 8,5 m en 1 s
  });
  test('en diagonal hacia adelante también', () =>
    expect(speed2D(run(lane, { ...sprint, right: 1 }, 1))).toBeCloseTo(PLAYER.sprintSpeed, 6));
  test('de costado o para atrás no corre más rápido', () => {
    expect(speed2D(run(lane, { ...idle, right: 1, sprint: true }, 1))).toBeCloseTo(PLAYER.runSpeed, 6);
    expect(speed2D(run(lane, { ...back, sprint: true }, 1))).toBeCloseTo(PLAYER.runSpeed, 6);
  });
  test('agachado no corre', () =>
    expect(speed2D(run(lane, { ...sprint, crouch: true }, 1))).toBeCloseTo(PLAYER.crouchSpeed, 6));
  test('el salto conserva la velocidad del pique', () => {
    let s = run(lane, sprint, 0.5);
    s = run(s, { ...sprint, jump: true }, 0.3);
    expect(s.onGround).toBe(false);
    expect(speed2D(s)).toBeCloseTo(PLAYER.sprintSpeed, 6);
  });
});

describe('agacharse', () => {
  // Viga baja: y ∈ [1,4; 3] sobre x ∈ [3, 8]. Es el único prisma con minY > 0 (el mapa no tiene techos colgantes).
  const beamWorld = new CollisionWorld([box(3, -2, 8, 2, 3, 1.4)], [], bounds);
  test('parado no pasa bajo la viga', () => expect(run(at(1, 0), fwd, 1, beamWorld).pos[0]).toBeCloseTo(3 - 0.35, 2));
  test('bajo la viga no se puede parar hasta salir', () => {
    let s = run(at(1, 0), { ...fwd, crouch: true }, 1.5, beamWorld);
    expect(s.pos[0]).toBeGreaterThan(3.5);
    expect(s.pos[0]).toBeLessThan(8 - 0.5);
    s = trace(s, idle, 0.5, (q) => expect(bodyOverlaps(q, beamWorld)).toBe(false), beamWorld);
    expect(s.crouching).toBe(true);
    expect(eyeHeight(s)).toBeCloseTo(1.05);
    s = run(s, fwd, 2.5, beamWorld);
    expect(s.pos[0]).toBeGreaterThan(8 + 0.35);
    expect(s.crouching).toBe(false);
    expect(eyeHeight(s)).toBeCloseTo(1.65);
  });
});

describe('pureza', () => {
  const deepFreeze = (s: PlayerState): PlayerState => {
    for (const v of Object.values(s)) if (Array.isArray(v)) Object.freeze(v);
    return Object.freeze(s);
  };
  test('stepPlayer no modifica el estado de entrada (caminando, en mantle y en la escalera)', () => {
    const states = [running(at(0, 0), 3), stepPlayer(atWall24, fwdJump, world, 1 / 60), run(atLadder, fwd, 0.5)];
    expect(states.map((s) => s.mode)).toEqual(['walk', 'mantle', 'ladder']);
    for (const s of states) {
      const copy = structuredClone(s);
      const next = stepPlayer(deepFreeze(s), fwd, world, 1 / 60);
      expect(s).toEqual(copy);
      expect(next).not.toBe(s);
      expect(next.pos).not.toBe(s.pos);
      expect(next.vel).not.toBe(s.vel);
    }
  });
  test('determinista: las mismas entradas dan el mismo resultado', () => {
    const script: [PlayerInput, number][] = [
      [fwdJump, 2], [{ ...fwd, yaw: 0.7, right: -1 }, 0.8], [crouchIn, 0.3], [{ ...fwdJump, yaw: 2 }, 1], [idle, 0.4],
    ];
    const play = (): PlayerState[] => {
      let s = at(23.3, 19);
      const out: PlayerState[] = [];
      script.forEach(([input, secs], i) => {
        const dt = [1 / 60, 1 / 144, 0.05][i % 3];
        for (let t = 0; t < secs; t += dt) out.push((s = stepPlayer(s, input, world, dt)));
      });
      return out;
    };
    expect(play()).toEqual(play());
  });
});
