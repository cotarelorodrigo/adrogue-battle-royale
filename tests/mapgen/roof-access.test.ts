// Prueba de acceso real a los techos sobre el mapa generado (public/map/adrogue.map.json): el jugador de verdad
// (stepPlayer a 60 Hz) sube por cada escalera y por 50 contenedores, y termina parado sobre el techo, no trabado contra
// el pretil. Manda sobre el chequeo rápido `hasAccess` de assemble.test (que solo mira que haya una ayuda).
import { readFileSync } from 'node:fs';
import { buildCollisionWorld, DUMPSTER } from '../../src/shared/collision.ts';
import { SIM_HZ } from '../../src/shared/fixed-step.ts';
import { hash01, pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, MapData, Prop } from '../../src/shared/mapdata.ts';
import { PLAYER, initialState, stepPlayer } from '../../src/shared/player.ts';
import type { PlayerInput, PlayerState } from '../../src/shared/player.ts';

type Ladder = Extract<Prop, { kind: 'ladder' }>;
type Dumpster = Extract<Prop, { kind: 'dumpster' }>;

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const byId = new Map(map.buildings.map((b) => [b.id, b]));
const H = 1 / SIM_HZ;
const MAX_STEPS = 20 * SIM_HZ;
/** Donde se para el jugador para agarrar la escalera (como el recorrido de e2e y los huecos de pockets.ts). */
const LADDER_FOOT = 0.45;
/** Contenedores que se prueban, elegidos con una semilla fija. */
const DUMPSTERS = 50;
const SEED = 'acceso-a-techos';

const press = (yaw: number, jump: boolean): PlayerInput => ({ forward: 1, right: 0, jump, crouch: false, yaw, pitch: 0 });
/** yaw que mira hacia `d` (adelante = (−sin yaw, −cos yaw)). */
const yawToward = (d: Vec2): number => Math.atan2(-d[0], -d[1]);

/** ¿Parado (caminando y apoyado) sobre el techo de `b`, a ±5 cm de su alto y dentro de su planta? */
const onRoof = (s: PlayerState, b: Building): boolean =>
  s.mode === 'walk' && s.onGround && Math.abs(s.pos[1] - b.height) <= 0.05 && pointInPolygon([s.pos[0], s.pos[2]], b.footprint);

/** Pasos de 1/60 s con la entrada de `input(paso, estado)` hasta quedar sobre el techo de `b` o hasta 20 s. */
function climb(start: Vec2, b: Building, input: (step: number, s: PlayerState) => PlayerInput): PlayerState {
  let s = initialState([start[0], 0, start[1]]);
  for (let k = 0; k < MAX_STEPS && !onRoof(s, b); k++) s = stepPlayer(s, input(k, s), world, H);
  return s;
}

const where = (s: PlayerState): string =>
  `termina en ${s.pos.map((v) => v.toFixed(2)).join(', ')} (${s.mode}${s.onGround ? ', apoyado' : ''})`;

test('desde cada escalera, W apretada: termina parado sobre el techo de su edificio', () => {
  const ladders = map.props.filter((p): p is Ladder => p.kind === 'ladder');
  expect(ladders.length).toBeGreaterThan(400);
  const fails: string[] = [];
  for (const l of ladders) {
    const b = byId.get(l.buildingId)!;
    const len = Math.hypot(l.normal[0], l.normal[1]);
    const n: Vec2 = [l.normal[0] / len, l.normal[1] / len];
    const yaw = yawToward([-n[0], -n[1]]); // mirando a la pared
    const s = climb([l.base[0] + n[0] * LADDER_FOOT, l.base[1] + n[1] * LADDER_FOOT], b, () => press(yaw, false));
    if (!onRoof(s, b)) fails.push(`${b.id} (techo a ${b.height} m, escalera en ${l.base.join(', ')}): ${where(s)}`);
  }
  expect(fails).toEqual([]);
}, 60_000);

test(`${DUMPSTERS} contenedores elegidos con semilla fija: arrimarse, saltar al contenedor y de ahí al techo vecino`, () => {
  const all = map.props.filter((p): p is Dumpster => p.kind === 'dumpster');
  expect(all.length).toBeGreaterThan(DUMPSTERS);
  const picked = all.map((d, i) => ({ d, k: hash01(`${SEED}:${i}`) })).sort((a, b) => a.k - b.k).slice(0, DUMPSTERS).map((e) => e.d);
  const fails: string[] = [];
  for (const d of picked) {
    // el lado largo va a lo largo de la pared: el edificio queda de un lado de la perpendicular (sin θ, cos θ)
    const perp: Vec2 = [Math.sin(d.rotation), Math.cos(d.rotation)];
    const side = [1, -1].find((k) => map.buildings.some((b) => pointInPolygon(
      [d.position[0] + perp[0] * k * (DUMPSTER.depth / 2 + 0.45), d.position[1] + perp[1] * k * (DUMPSTER.depth / 2 + 0.45)], b.footprint)));
    if (side === undefined) {
      fails.push(`contenedor en ${d.position.join(', ')}: sin edificio al lado`);
      continue;
    }
    const toWall: Vec2 = [perp[0] * side, perp[1] * side];
    const behind: Vec2 = [d.position[0] + toWall[0] * (DUMPSTER.depth / 2 + 0.45), d.position[1] + toWall[1] * (DUMPSTER.depth / 2 + 0.45)];
    const b = map.buildings.find((x) => pointInPolygon(behind, x.footprint))!;
    // desde la vereda, del otro lado del contenedor: 0,5 m de arrimada con W, después W + salto hasta trepar dos veces
    // (al contenedor y al borde del techo) y de ahí W sola, como un jugador: con el salto apretado, en un techo angosto
    // volvería a trepar al pretil de enfrente antes de apoyarse
    const back = DUMPSTER.depth / 2 + PLAYER.radius + 0.5;
    const yaw = yawToward(toWall);
    let mantles = 0, prev: PlayerState['mode'] = 'walk';
    const input = (k: number, st: PlayerState): PlayerInput => {
      if (st.mode === 'mantle' && prev !== 'mantle') mantles++;
      prev = st.mode;
      return press(yaw, k >= 0.3 * SIM_HZ && mantles < 2);
    };
    const s = climb([d.position[0] - toWall[0] * back, d.position[1] - toWall[1] * back], b, input);
    if (!onRoof(s, b)) fails.push(`${b.id} (techo a ${b.height} m, contenedor en ${d.position.join(', ')}): ${where(s)}`);
  }
  expect(fails).toEqual([]);
}, 60_000);
