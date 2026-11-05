// El botín de los lugares en los pisos altos de sus interiores (balcones de la Casa de la Cultura, planta alta del
// Guernica, terraza de La Veneciana), sobre el mapa generado: el cliente lo dibuja flotando sobre ese piso y se junta
// parado en ese piso, con el controlador y la partida de verdad.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createDrops, dropKind } from '../../src/client/combat/drops.ts';
import { DROP_KINDS } from '../../src/client/combat/models.ts';
import { isFreeSpot } from '../../src/mapgen/spawns.ts';
import { buildCollisionWorld } from '../../src/shared/collision.ts';
import { SIM_HZ } from '../../src/shared/fixed-step.ts';
import { pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec3 } from '../../src/shared/geo.ts';
import { buildInteriors } from '../../src/shared/interiors/index.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { MATCH, nearestDrop, newMatch, stepMatch } from '../../src/shared/match.ts';
import type { MatchDrop, MatchInput, MatchState } from '../../src/shared/match.ts';
import { PLAYER, initialState } from '../../src/shared/player.ts';
import { fmt } from '../helpers.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const world = buildCollisionWorld(map);
const interiors = buildInteriors(map);
const H = 1 / SIM_HZ;
const idle: MatchInput = { forward: 0, right: 0, jump: false, crouch: false, yaw: 0, pitch: 0, fire: false, aim: false, reload: false, use: false, heal: false, slot: null };
/** Lo que se sube flotando y lo que oscila (drops.ts: BOB). */
const BOB = 0.04;

/** Los puntos de botín de los lugares que están en un piso alto, con su interior. */
const high = map.lootSpots.filter((s) => s.tier === 'lugar' && s.pos[1] > 0).map((s) => ({
  s, i: interiors.find((x) => pointInPolygon([s.pos[0], s.pos[2]], x.footprint))!,
}));

/** Una partida de práctica con un solo objeto en el piso: el del punto `pos`. */
function matchWith(pos: Vec3): { m: MatchState; d: MatchDrop } {
  const m = newMatch(map, world, { seed: 7, dummies: 0 });
  const d = m.drops.find((x) => x.pos[0] === pos[0] && x.pos[1] === pos[1] && x.pos[2] === pos[2]);
  if (!d) throw new Error(`no hay objeto en ${fmt(pos)}: el nivel "lugar" nunca sale vacío`);
  const c = structuredClone(m);
  c.drops = [d];
  return { m: c, d };
}

/** Un lugar para pararse a 1,2–1,6 m del objeto, en su mismo piso, libre y con línea de vista desde el ojo. */
function standNear(d: MatchDrop): Vec3 {
  const y = d.pos[1];
  for (const r of [1.2, 1.4, 1.6]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      const p: Vec3 = [d.pos[0] + r * Math.cos(a), y, d.pos[2] + r * Math.sin(a)];
      if (!isFreeSpot(world, p[0], p[2], y)) continue;
      const eye: Vec3 = [p[0], y + PLAYER.eye, p[2]];
      const dir: Vec3 = [d.pos[0] - eye[0], d.pos[1] + MATCH.dropLift - eye[1], d.pos[2] - eye[2]];
      if (!world.raycast(eye, dir, Math.hypot(...dir))) return p;
    }
  }
  throw new Error(`no hay dónde pararse cerca de ${fmt(d.pos)}`);
}

test('hay botín de lugar en cada piso alto: los balcones de la Casa, la planta alta del Guernica y la terraza de La Veneciana', () => {
  const ids = (id: string): number[] => [...new Set(high.filter((h) => h.i.placeId === id).map((h) => h.s.pos[1]))].sort((a, b) => a - b);
  expect(ids('casa-de-la-cultura')).toEqual([3.2, 6.4]);
  expect(ids('guernica-bar')).toEqual([3.2]);
  expect(ids('la-veneciana')).toEqual([3.8]);
});

describe.each(high.map((h) => [`${h.i.placeId} en ${fmt(h.s.pos)}`, h.s.pos] as const))('%s', (_, pos) => {
  const { m, d } = matchWith(pos);
  const stand = standNear(d);

  test('el cliente lo dibuja flotando sobre su piso (dropLift ± el vaivén)', () => {
    const view = createDrops(new THREE.Group());
    view.update({ state: m, cam: { pos: [stand[0], stand[1] + PLAYER.eye, stand[2]], yaw: 0, pitch: 0 }, now: 1234, events: [] });
    const mesh = view.meshes[DROP_KINDS.indexOf(dropKind(d.item))];
    expect(mesh.visible).toBe(true);
    expect(mesh.count).toBe(1);
    const p = new THREE.Vector3().setFromMatrixPosition((() => { const x = new THREE.Matrix4(); mesh.getMatrixAt(0, x); return x; })());
    // la matriz de la instancia es de 32 bits: a 200 m del origen, ~2·10⁻⁵ m de redondeo
    expect(Math.abs(p.x - d.pos[0])).toBeLessThan(1e-4);
    expect(Math.abs(p.z - d.pos[2])).toBeLessThan(1e-4);
    expect(Math.abs(p.y - (d.pos[1] + MATCH.dropLift))).toBeLessThanOrEqual(BOB + 1e-4);
    view.dispose();
  });

  test('se junta parado en ese piso, mirándolo', () => {
    let s = structuredClone(m);
    s.me.player = initialState(stand);
    const dx = d.pos[0] - stand[0], dz = d.pos[2] - stand[2];
    const look = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(d.pos[1] + MATCH.dropLift - (stand[1] + PLAYER.eye), Math.hypot(dx, dz)) };
    for (let k = 0; k < 10; k++) s = stepMatch(s, { ...idle, ...look }, world, H); // quieto: se apoya en la losa
    expect(s.me.player.onGround).toBe(true);
    expect(s.me.player.pos[1]).toBeCloseTo(d.pos[1], 6);
    expect(nearestDrop(s, world)?.id).toBe(d.id);
    s = stepMatch(s, { ...idle, ...look, use: true }, world, H);
    expect(s.events).toContainEqual({ type: 'pickup', item: d.item });
    expect(s.drops.find((x) => x.id === d.id)).toBeUndefined();
    expect(s.me.player.pos[1]).toBeCloseTo(d.pos[1], 6);
  });
});
