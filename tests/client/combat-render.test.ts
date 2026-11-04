// @vitest-environment jsdom
// Lo que dibuja el combate: cuántos draw calls y triángulos cuesta cada cosa, y que dispose no deje nada colgado.
// jsdom no tiene WebGL: los draw calls se cuentan como los hace three (ver drawCalls) y la memoria de geometrías y
// texturas con un contador que imita a renderer.info.memory.
import * as THREE from 'three';
import { createDrops, DROP_RADIUS } from '../../src/client/combat/drops.ts';
import { createDummies, DUMMY_GONE_AFTER } from '../../src/client/combat/dummies.ts';
import { createEffects, DECAL_MAX, DECAL_MS, TRACER_MS } from '../../src/client/combat/effects.ts';
import { dropGeometry, DROP_KINDS, dummyGeometry } from '../../src/client/combat/models.ts';
import type { CombatFrame, CombatView } from '../../src/client/combat/types.ts';
import { createViewmodel, VIEW_FOV } from '../../src/client/combat/viewmodel.ts';
import type { ViewRenderer } from '../../src/client/combat/viewmodel.ts';
import { createZoneWall, ZONE_WALL_H } from '../../src/client/combat/zone-wall.ts';
import { BODY_RADIUS, newGun, WEAPONS } from '../../src/shared/combat.ts';
import type { AmmoId, WeaponId } from '../../src/shared/combat.ts';
import type { Vec3 } from '../../src/shared/geo.ts';
import type { LootItem } from '../../src/shared/loot.ts';
import { MATCH } from '../../src/shared/match.ts';
import type { Fighter, MatchDrop, MatchEvent, MatchState } from '../../src/shared/match.ts';
import { planZone, zoneAt, ZONE_TOTAL } from '../../src/shared/zone.ts';

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

const fighter = (id: string, pos: Vec3, dead?: { diedAt: number }): Fighter => ({
  id, name: id, player: { pos, vel: [0, 0, 0], onGround: true, crouching: false, mode: 'walk' },
  vitals: { hp: dead ? 0 : 100, armor: 0 }, alive: !dead, ...(dead ?? {}),
});

const ZONE = planZone({ minX: -500, maxX: 500, minZ: -400, maxZ: 400 }, 12, 7);

function matchState(over: Partial<MatchState> = {}): MatchState {
  return {
    t: 10, seed: 1, me: fighter('yo', [0, 0, 0]),
    inv: { slots: [null, null], active: 0, ammo: { liviana: 0, cartuchos: 0, pesada: 0 }, medkits: 0, healingUntil: null },
    dummies: [], drops: [], zone: ZONE, aiming: false, events: [], over: null, kills: 0, nextDropId: 1,
    look: { yaw: 0, pitch: 0 }, held: { fire: false, use: false }, shotSeq: 0, ...over,
  };
}

const armed = (weapon: WeaponId, over: Partial<MatchState> = {}): MatchState =>
  matchState({ inv: { ...matchState().inv, slots: [newGun(weapon), null] }, ...over });

const EYE: Vec3 = [0, 1.65, 0];
const frame = (state: MatchState, now: number, events: MatchEvent[] = [], cam: CombatFrame['cam'] = { pos: EYE, yaw: 0, pitch: 0 }): CombatFrame =>
  ({ state, cam, now, events });

/** Draw calls de lo que cuelga de `root`, como los cuenta three: uno por malla visible (una InstancedMesh con count 0
 *  no dibuja), uno más en la pasada de sombras si castShadow, y dos si es transparente de dos caras sin
 *  forceSinglePass (three la dibuja en dos pasadas: la cara de atrás y la de adelante). */
function drawCalls(root: THREE.Object3D, shadows = true): number {
  let n = 0;
  root.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points)) return;
    if (o instanceof THREE.InstancedMesh && o.count === 0) return;
    const m = o.material as THREE.Material;
    n += m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass ? 2 : 1;
    if (shadows && o.castShadow) n++;
  });
  return n;
}

const meshesIn = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh && o.count === 0)) out.push(o);
  });
  return out;
};
const triangles = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/** Lo que hacen WebGLGeometries y WebGLTextures con renderer.info.memory: suman una geometría o textura la primera vez
 *  que se dibuja y la restan cuando dispara su evento dispose. */
function memoryCounter() {
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();
  const track = <T extends THREE.EventDispatcher<{ dispose: object }>>(set: Set<T>, x: T): void => {
    if (set.has(x)) return;
    set.add(x);
    const gone = (): void => {
      set.delete(x);
      x.removeEventListener('dispose', gone);
    };
    x.addEventListener('dispose', gone);
  };
  return {
    get geometries() { return geometries.size; },
    get textures() { return textures.size; },
    /** Una "pasada" de render: todo lo visible que cuelga de root. */
    draw(root: THREE.Object3D): void {
      root.traverseVisible((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.Line)) return;
        track(geometries, o.geometry as THREE.BufferGeometry);
        const m = o.material as THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };
        for (const t of [m.map, m.alphaMap]) if (t) track(textures, t);
      });
    },
  };
}

/** Un renderer de mentira para el arma en mano: anota cada pasada y el estado de autoClear durante ella. */
function fakeRenderer() {
  const calls: string[] = [];
  const r = {
    autoClear: true,
    clearDepth: () => { calls.push('clearDepth'); },
    getSize: (v: THREE.Vector2) => v.set(1600, 900),
    render: (_s: THREE.Object3D, c: THREE.Camera) => { calls.push(`render autoClear=${r.autoClear} fov=${(c as THREE.PerspectiveCamera).fov}`); },
  };
  return { renderer: r as unknown as ViewRenderer, calls };
}

const instancePos = (m: THREE.InstancedMesh, i: number): THREE.Vector3 => {
  const mat = new THREE.Matrix4();
  m.getMatrixAt(i, mat);
  return new THREE.Vector3().setFromMatrixPosition(mat);
};
const instanceUp = (m: THREE.InstancedMesh, i: number): THREE.Vector3 => {
  const mat = new THREE.Matrix4();
  m.getMatrixAt(i, mat);
  return new THREE.Vector3(0, 1, 0).transformDirection(mat);
};

describe('maniquíes', () => {
  test('23 vivos son una InstancedMesh: 1 draw call, y otro en la pasada de sombras', () => {
    const root = new THREE.Group();
    const view = createDummies(root);
    const dummies = Array.from({ length: 23 }, (_, i) => fighter(`m${i + 1}`, [i * 3, 0, -10 - i]));
    view.update(frame(matchState({ dummies }), 1000));
    expect(drawCalls(root, false)).toBe(1);
    expect(drawCalls(root)).toBeLessThanOrEqual(2);
    expect(view.mesh.count).toBe(23);
    dummies.forEach((d, i) => expect(instancePos(view.mesh, i).toArray()).toEqual(d.player.pos));
  });

  test('setShadows saca la pasada de sombras (calidades baja y media), también si la malla crece', () => {
    const root = new THREE.Group();
    const view = createDummies(root);
    view.setShadows(false);
    view.update(frame(matchState({ dummies: [fighter('m1', [0, 0, -5])] }), 1000));
    expect(drawCalls(root)).toBe(1);
    const many = Array.from({ length: 40 }, (_, i) => fighter(`m${i}`, [i, 0, -5]));
    view.update(frame(matchState({ dummies: many }), 1000));
    expect(view.mesh.castShadow).toBe(false);
    view.setShadows(true);
    expect(drawCalls(root)).toBe(2);
  });

  test(`uno muerto se cae y a los ${DUMMY_GONE_AFTER} s ya no se dibuja`, () => {
    const root = new THREE.Group();
    const view = createDummies(root);
    const t = 50;
    const state = (diedAt: number): MatchState => matchState({ t, dummies: [fighter('m1', [5, 0, 5], { diedAt }), fighter('m2', [9, 0, 9])] });
    view.update(frame(matchState({ t, dummies: [fighter('m1', [5, 0, 5])] }), 0));
    expect(instanceUp(view.mesh, 0).y).toBeCloseTo(1, 6); // vivo: parado
    view.update(frame(state(t - 0.1), 0));
    expect(view.mesh.count).toBe(2);
    const falling = instanceUp(view.mesh, 0).y;
    expect(falling).toBeLessThan(1);
    expect(falling).toBeGreaterThan(0.5);
    view.update(frame(state(t - 1.5), 0));
    expect(view.mesh.count).toBe(2);
    expect(Math.abs(instanceUp(view.mesh, 0).y)).toBeLessThan(0.05); // en el piso
    view.update(frame(state(t - DUMMY_GONE_AFTER - 0.01), 0));
    expect(view.mesh.count).toBe(1);
    expect(instancePos(view.mesh, 0).toArray()).toEqual([9, 0, 9]); // queda el vivo
    view.update(frame(matchState({ t, dummies: [fighter('m1', [5, 0, 5], { diedAt: t - 10 })] }), 0));
    expect(drawCalls(root)).toBe(0);
  });

  test('un impacto lo tiñe un momento', () => {
    const root = new THREE.Group();
    const view = createDummies(root);
    const state = matchState({ dummies: [fighter('m1', [0, 0, -5]), fighter('m2', [2, 0, -5])] });
    const color = (i: number): number[] => {
      const c = new THREE.Color();
      view.mesh.getColorAt(i, c);
      return c.toArray();
    };
    view.update(frame(state, 1000, [{ type: 'hit', id: 'm2', part: 'cabeza', dmg: 33, point: [2, 1.6, -5] }]));
    expect(color(0)).toEqual([1, 1, 1]);
    expect(color(1)).not.toEqual([1, 1, 1]);
    view.update(frame(state, 1500));
    expect(color(1)).toEqual([1, 1, 1]);
  });

  test('el modelo entra en el cilindro del hitscan: radio 0,35 y de 0 a 1,8 m', () => {
    const g = dummyGeometry();
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(g.boundingBox!.max.y).toBeCloseTo(1.8, 6);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThanOrEqual(BODY_RADIUS);
    expect(triangles(g)).toBeLessThan(200);
  });
});

describe('botín', () => {
  const ITEMS: LootItem[] = [
    ...WEAPON_IDS.map((weapon): LootItem => ({ kind: 'arma', weapon })),
    ...(['liviana', 'cartuchos', 'pesada'] as AmmoId[]).map((ammo): LootItem => ({ kind: 'municion', ammo })),
    { kind: 'chaleco' }, { kind: 'botiquin' },
  ];
  // 300 objetos de todos los tipos en espiral alrededor de la cámara, de 0 a 299 m
  const drops: MatchDrop[] = Array.from({ length: 300 }, (_, i) => ({
    id: i + 1, pos: [Math.cos(i * 2.4) * i, (i % 4) * 3, Math.sin(i * 2.4) * i] as Vec3, item: ITEMS[i % ITEMS.length],
  }));

  test(`300 objetos de los ${ITEMS.length} tipos: a lo sumo 8 InstancedMesh y solo los de menos de ${DROP_RADIUS} m`, () => {
    const root = new THREE.Group();
    const view = createDrops(root);
    const cam: Vec3 = [0, 1.65, 0];
    view.update(frame(matchState({ drops }), 1000, [], { pos: cam, yaw: 0, pitch: 0 }));
    const meshes = view.meshes.filter((m) => m.visible && m.count > 0);
    expect(view.meshes.length).toBeLessThanOrEqual(8);
    expect(drawCalls(root)).toBeLessThanOrEqual(8);
    const near = drops.filter((d) => Math.hypot(d.pos[0] - cam[0], d.pos[1] + MATCH.dropLift - cam[1], d.pos[2] - cam[2]) <= DROP_RADIUS);
    expect(near.length).toBeGreaterThan(100);
    expect(near.length).toBeLessThan(drops.length);
    expect(meshes.reduce((s, m) => s + m.count, 0)).toBe(near.length);
    for (const m of meshes) {
      for (let i = 0; i < m.count; i++) expect(instancePos(m, i).distanceTo(new THREE.Vector3(...cam))).toBeLessThanOrEqual(DROP_RADIUS + 0.1);
    }
    // al alejarse, los de lejos dejan de contarse
    view.update(frame(matchState({ drops }), 1000, [], { pos: [5000, 0, 5000], yaw: 0, pitch: 0 }));
    expect(drawCalls(root)).toBe(0);
  });

  test('setRadius achica el radio (calidades baja y media) y nunca pasa de los 120 m del spec', () => {
    const root = new THREE.Group();
    const view = createDrops(root);
    const cam: Vec3 = [0, 1.65, 0];
    const count = (): number => view.meshes.reduce((s, m) => s + (m.visible ? m.count : 0), 0);
    const within = (r: number): number =>
      drops.filter((d) => Math.hypot(d.pos[0] - cam[0], d.pos[1] + MATCH.dropLift - cam[1], d.pos[2] - cam[2]) <= r).length;
    view.setRadius(80);
    view.update(frame(matchState({ drops }), 1000, [], { pos: cam, yaw: 0, pitch: 0 }));
    expect(count()).toBe(within(80));
    expect(count()).toBeLessThan(within(DROP_RADIUS));
    view.setRadius(500);
    view.update(frame(matchState({ drops }), 1000, [], { pos: cam, yaw: 0, pitch: 0 }));
    expect(count()).toBe(within(DROP_RADIUS));
  });

  test('flotan centrados a dropLift sobre su piso, donde se los mira para juntarlos, y giran despacio', () => {
    const root = new THREE.Group();
    const view = createDrops(root);
    const d: MatchDrop = { id: 4, pos: [3, 6, -2], item: { kind: 'arma', weapon: 'escopeta' } };
    const at = (now: number): THREE.Matrix4 => {
      view.update(frame(matchState({ drops: [d] }), now));
      const m = view.meshes.find((x) => x.visible && x.count === 1)!;
      const mat = new THREE.Matrix4();
      m.getMatrixAt(0, mat);
      return mat;
    };
    const p = new THREE.Vector3().setFromMatrixPosition(at(0));
    expect(p.x).toBeCloseTo(3, 6);
    expect(p.z).toBeCloseTo(-2, 6);
    expect(Math.abs(p.y - (6 + MATCH.dropLift))).toBeLessThanOrEqual(0.06);
    const yaw = (m: THREE.Matrix4): number => new THREE.Euler().setFromRotationMatrix(m, 'YXZ').y;
    const turn = Math.abs(yaw(at(1000)) - yaw(at(1100)));
    expect(turn).toBeGreaterThan(0.01); // gira…
    expect(turn).toBeLessThan(0.3); // …despacio
    for (const kind of DROP_KINDS) {
      const g = dropGeometry(kind);
      g.computeBoundingBox();
      const c = g.boundingBox!.getCenter(new THREE.Vector3());
      expect(c.length()).toBeLessThan(1e-6); // el centro del modelo es el punto de juntar
      expect(g.boundingBox!.min.y).toBeGreaterThan(-MATCH.dropLift + 0.06); // con el vaivén no toca el piso
      g.dispose();
    }
  });

  test('cada caja de munición tiene el color de su tipo', () => {
    const root = new THREE.Group();
    const view = createDrops(root);
    const box = (ammo: AmmoId, id: number): MatchDrop => ({ id, pos: [id, 0, 0], item: { kind: 'municion', ammo } });
    view.update(frame(matchState({ drops: [box('liviana', 1), box('cartuchos', 2), box('pesada', 3)] }), 0));
    const m = view.meshes.find((x) => x.visible && x.count === 3)!;
    const colors = [0, 1, 2].map((i) => m.getColorAt(i, new THREE.Color()).getHexString());
    expect(new Set(colors).size).toBe(3);
  });
});

describe('zona', () => {
  test('1 draw call: translúcida, sin sombra y sin escribir profundidad, con el radio y el centro de zoneAt', () => {
    const root = new THREE.Group();
    const view = createZoneWall(root);
    const t = 250; // cerrándose en la fase 2
    view.update(frame(matchState({ t }), 0));
    expect(drawCalls(root)).toBe(1);
    const m = view.mesh.material as THREE.MeshBasicMaterial;
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(view.mesh.castShadow).toBe(false);
    const z = zoneAt(ZONE, t);
    const p = view.mesh.geometry.getAttribute('position');
    let maxY = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i) - z.center[0], p.getZ(i) - z.center[1]);
      expect(r).toBeLessThanOrEqual(z.r + 1e-3);
      maxY = Math.max(maxY, p.getY(i));
    }
    expect(maxY).toBeCloseTo(ZONE_WALL_H, 6);
    expect(triangles(view.mesh.geometry)).toBeLessThan(1000);
  });

  test('cerrada del todo no se dibuja', () => {
    const root = new THREE.Group();
    const view = createZoneWall(root);
    view.update(frame(matchState({ t: ZONE_TOTAL + 1 }), 0));
    expect(drawCalls(root)).toBe(0);
  });

  test('la niebla no la tapa del todo y se desvanece antes del corte de camera.far', () => {
    const root = new THREE.Group();
    const view = createZoneWall(root);
    const mat = view.mesh.material as THREE.Material;
    const s = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} };
    mat.onBeforeCompile(s as never, {} as never);
    expect(s.fragmentShader).not.toContain('#include <fog_fragment>');
    expect(s.fragmentShader).toContain('gl_FragColor.a *=');
    expect(() => mat.onBeforeCompile({ ...s, fragmentShader: 'void main() {}' } as never, {} as never)).toThrow(/fog_fragment/);
  });
});

describe('arma en mano', () => {
  test.each(WEAPON_IDS)('%s: menos de 6 mallas y menos de 2.000 triángulos, con el fogonazo', (weapon) => {
    const { renderer } = fakeRenderer();
    const view = createViewmodel(renderer);
    const state = armed(weapon);
    view.update(frame(state, 1000));
    view.update(frame(state, 1016, [{ type: 'shot', weapon, from: EYE, to: [[0, 1.65, -50]] }]));
    const meshes = meshesIn(view.scene);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThan(6);
    expect(meshes.some((m) => m.name === 'muzzle-flash')).toBe(true);
    expect(meshes.reduce((s, m) => s + triangles(m.geometry), 0)).toBeLessThan(2000);
    expect(drawCalls(view.scene)).toBeLessThan(6);
    view.update(frame(state, 1200)); // el fogonazo dura un instante
    expect(meshesIn(view.scene).some((m) => m.name === 'muzzle-flash')).toBe(false);
  });

  test(`render dibuja encima en una pasada aparte, con su cámara de fov ${VIEW_FOV}: limpia solo la profundidad`, () => {
    const { renderer, calls } = fakeRenderer();
    const view = createViewmodel(renderer);
    view.update(frame(armed('rifle'), 0));
    view.render();
    expect(calls).toEqual(['clearDepth', `render autoClear=false fov=${VIEW_FOV}`]);
    expect(renderer.autoClear).toBe(true);
  });

  test('sin arma, muerto o con la mira del francotirador no hace ninguna pasada', () => {
    const { renderer, calls } = fakeRenderer();
    const view = createViewmodel(renderer);
    view.update(frame(matchState(), 0));
    view.render();
    view.update(frame(armed('pistola', { me: fighter('yo', [0, 0, 0], { diedAt: 1 }) }), 16));
    view.render();
    for (let now = 32; now < 1000; now += 16) view.update(frame(armed('francotirador', { aiming: true }), now));
    view.render();
    expect(calls).toEqual([]);
    view.update(frame(armed('rifle', { aiming: true }), 1000)); // con la mira del rifle sí se ve
    view.render();
    expect(calls).toHaveLength(2);
  });

  test('al cambiar de ranura el arma sube en MATCH.raise, también entre dos iguales', () => {
    const { renderer } = fakeRenderer();
    const view = createViewmodel(renderer);
    const pistols = (active: 0 | 1): MatchState => matchState({ inv: { ...matchState().inv, slots: [newGun('pistola'), newGun('pistola')], active } });
    for (let now = 0; now <= 1000; now += 16) view.update(frame(pistols(0), now));
    const y = (): number => view.scene.getObjectByName('pose')!.position.y;
    const up = y();
    let now = 1016;
    view.update(frame(pistols(1), now));
    expect(y()).toBeLessThan(up - 0.1); // recién sacada, abajo
    for (; now < 1016 + MATCH.raise * 1000 - 48; now += 16) view.update(frame(pistols(1), now));
    expect(y()).toBeLessThan(up - 0.005); // todavía subiendo
    for (; now <= 1016 + MATCH.raise * 1000 + 16; now += 16) view.update(frame(pistols(1), now));
    expect(y()).toBeCloseTo(up, 6);
  });

  test('el disparo la hace retroceder y la recarga saca el cargador', () => {
    const { renderer } = fakeRenderer();
    const view = createViewmodel(renderer);
    const rest = armed('rifle');
    for (let now = 0; now <= 1000; now += 16) view.update(frame(rest, now)); // ya terminó de subir
    const pose = (): THREE.Object3D => view.scene.getObjectByName('pose')!;
    const mag = (): THREE.Object3D => view.scene.getObjectByName('mag-rifle')!;
    const z0 = pose().position.z, mag0 = mag().position.clone();
    view.update(frame(rest, 1016, [{ type: 'shot', weapon: 'rifle', from: EYE, to: [[0, 0, -9]] }]));
    expect(pose().position.z).toBeGreaterThan(z0 + 0.005); // hacia atrás (+z en la cámara)
    for (let now = 1032; now <= 2000; now += 16) view.update(frame(rest, now));
    expect(pose().position.z).toBeCloseTo(z0, 3); // y vuelve
    const reloading = (k: number): MatchState => {
      const gun = { ...newGun('rifle'), inMag: 3, reloadUntil: 10 + WEAPONS.rifle.reload * (1 - k) };
      return armed('rifle', { t: 10, inv: { ...rest.inv, slots: [gun, null] } });
    };
    view.update(frame(reloading(0.45), 2016));
    expect(mag().position.distanceTo(mag0)).toBeGreaterThan(0.1);
    view.update(frame(reloading(0.99), 2032));
    expect(mag().position.distanceTo(mag0)).toBeLessThan(0.01);
  });
});

describe('efectos', () => {
  test(`trazadores: uno por perdigón, en 1 draw call, y duran ${TRACER_MS} ms`, () => {
    const root = new THREE.Group();
    const view = createEffects(root);
    const to: Vec3[] = Array.from({ length: 8 }, (_, i) => [i - 4, 1.5, -20]);
    view.update(frame(matchState(), 1000, [{ type: 'shot', weapon: 'escopeta', from: EYE, to }]));
    expect(view.tracers).toBe(8);
    expect(drawCalls(root)).toBe(1);
    view.update(frame(matchState(), 1000 + TRACER_MS / 2));
    expect(view.tracers).toBe(8);
    view.update(frame(matchState(), 1000 + TRACER_MS));
    expect(view.tracers).toBe(0);
    expect(drawCalls(root)).toBe(0);
  });

  test(`decals: después de 100 impactos quedan ${DECAL_MAX}, en 1 draw call, y a los 10 s no queda ninguno`, () => {
    const root = new THREE.Group();
    const view = createEffects(root);
    const impacts: MatchEvent[] = Array.from({ length: 100 }, (_, i) => ({ type: 'impact', point: [i, 2, -10], normal: [0, 0, 1] }));
    view.update(frame(matchState(), 5000, impacts));
    expect(view.decals).toBe(DECAL_MAX);
    expect(drawCalls(root)).toBe(1);
    // quedan los últimos 64, pegados a la pared y mirando hacia afuera
    const mesh = root.getObjectByName('decals') as THREE.InstancedMesh;
    expect(mesh.count).toBe(DECAL_MAX);
    const xs = Array.from({ length: mesh.count }, (_, i) => Math.round(instancePos(mesh, i).x)).sort((a, b) => a - b);
    expect(xs[0]).toBe(100 - DECAL_MAX);
    const p = instancePos(mesh, 0);
    expect(p.z).toBeGreaterThan(-10);
    expect(p.z).toBeLessThan(-9.95);
    view.update(frame(matchState(), 5000 + DECAL_MS - 1));
    expect(view.decals).toBe(DECAL_MAX);
    view.update(frame(matchState(), 5000 + DECAL_MS));
    expect(view.decals).toBe(0);
    expect(drawCalls(root)).toBe(0);
  });

  test('un impacto en el piso queda por encima de las capas de la calle', () => {
    const root = new THREE.Group();
    const view = createEffects(root);
    view.update(frame(matchState(), 0, [{ type: 'impact', point: [3, 0, -4], normal: [0, 1, 0] }]));
    const mesh = root.getObjectByName('decals') as THREE.InstancedMesh;
    expect(instancePos(mesh, 0).y).toBeGreaterThan(0.06); // Y_PATH, la capa más alta del suelo
    expect(instancePos(mesh, 0).y).toBeLessThan(0.1);
  });

  test('clear() borra trazadores y decals (para volver a jugar)', () => {
    const root = new THREE.Group();
    const view = createEffects(root);
    view.update(frame(matchState(), 0, [
      { type: 'shot', weapon: 'rifle', from: EYE, to: [[0, 1, -30]] },
      { type: 'impact', point: [0, 1, -30], normal: [0, 0, 1] },
    ]));
    expect([view.tracers, view.decals]).toEqual([1, 1]);
    view.clear();
    expect([view.tracers, view.decals]).toEqual([0, 0]);
    view.update(frame(matchState(), 10));
    expect(drawCalls(root)).toBe(0);
  });
});

test('las esferas del frustum culling se reusan cuadro a cuadro y siguen a lo que se dibuja', () => {
  const root = new THREE.Group();
  const dummies = createDummies(root), drops = createDrops(root), effects = createEffects(root), zone = createZoneWall(root);
  const views: CombatView[] = [dummies, drops, effects, zone];
  // a los 150 y 160 s la zona se está cerrando (fase 1): la pared cambia de radio
  const at = (x: number, t: number): MatchState => matchState({ t, dummies: [fighter('m1', [x, 0, -5])], drops: [{ id: 1, pos: [x, 0, -3], item: { kind: 'chaleco' } }] });
  const impact = (x: number): MatchEvent[] => [{ type: 'impact', point: [x, 1, -8], normal: [0, 0, 1] }];
  const decals = root.getObjectByName('decals') as THREE.InstancedMesh;
  const vest = (): THREE.InstancedMesh => drops.meshes[DROP_KINDS.indexOf('chaleco')];
  const spheres = (): (THREE.Sphere | null)[] => [dummies.mesh.boundingSphere, vest().boundingSphere, decals.boundingSphere, zone.mesh.geometry.boundingSphere];
  for (const v of views) v.update(frame(at(0, 150), 1000, impact(0)));
  const first = spheres();
  for (const sp of first) expect(sp).toBeInstanceOf(THREE.Sphere);
  for (const v of views) v.update(frame(at(50, 160), 1016, impact(50)));
  spheres().forEach((sp, i) => expect(sp, `esfera ${i}`).toBe(first[i])); // la misma, no una nueva
  expect(dummies.mesh.boundingSphere!.containsPoint(new THREE.Vector3(50, 1, -5))).toBe(true);
  expect(dummies.mesh.boundingSphere!.containsPoint(new THREE.Vector3(0, 1, -5))).toBe(false);
  expect(vest().boundingSphere!.containsPoint(new THREE.Vector3(50, MATCH.dropLift, -3))).toBe(true);
  for (const x of [0, 50]) expect(decals.boundingSphere!.containsPoint(new THREE.Vector3(x, 1, -8))).toBe(true);
  const z = zoneAt(ZONE, 160);
  expect(zone.mesh.geometry.boundingSphere!.center.toArray()).toEqual([z.center[0], ZONE_WALL_H / 2, z.center[1]]);
  expect(zone.mesh.geometry.boundingSphere!.radius).toBeCloseTo(Math.hypot(z.r, ZONE_WALL_H / 2), 9);
  expect(effects.decals).toBe(2);
});

test('dispose() deja renderer.info.memory (geometrías y texturas) como estaba y saca todo de la escena', () => {
  const memory = memoryCounter();
  const root = new THREE.Group();
  const before = { geometries: memory.geometries, textures: memory.textures };
  const { renderer } = fakeRenderer();
  const vm = createViewmodel(renderer);
  const views: CombatView[] = [createDummies(root), createDrops(root), createZoneWall(root), createEffects(root), vm];
  // muchos maniquíes y objetos (más que la capacidad inicial de las InstancedMesh), disparos e impactos, y todas las armas
  const dummies = Array.from({ length: 40 }, (_, i) => fighter(`m${i}`, [i, 0, -5]));
  const drops: MatchDrop[] = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, pos: [i % 20, 0, -Math.floor(i / 20)], item: { kind: 'botiquin' } }));
  let now = 0;
  for (const weapon of WEAPON_IDS) {
    const state = armed(weapon, { dummies, drops, t: 100 });
    const events: MatchEvent[] = [
      { type: 'shot', weapon, from: EYE, to: [[0, 1, -20]] },
      { type: 'impact', point: [0, 1, -20], normal: [0, 0, 1] },
      { type: 'hit', id: 'm1', part: 'cuerpo', dmg: 20, point: [1, 1, -5] },
    ];
    for (const v of views) v.update(frame(state, (now += 16), events));
    memory.draw(root);
    memory.draw(vm.scene);
  }
  expect(memory.geometries).toBeGreaterThan(before.geometries + 10);
  expect(memory.textures).toBeGreaterThan(before.textures); // la de los decals
  for (const v of views) v.dispose();
  expect(memory.geometries).toBe(before.geometries);
  expect(memory.textures).toBe(before.textures);
  expect(root.children).toHaveLength(0);
});
