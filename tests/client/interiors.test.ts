// @vitest-environment jsdom
// El dibujo de los interiores (tarea 5): texturas, luz horneada, mallas, vistas, fachada con huecos y tapas, cambio de
// calidad y liberación. Sobre el local de prueba de la tarea 4 (tests/shared/interiors/fixture.ts).
import * as THREE from 'three';
import { extrudeBuilding } from '../../src/client/world/geometry.ts';
import { lightAt } from '../../src/client/world/interiors/bake.ts';
import { buildInterior3D } from '../../src/client/world/interiors/build.ts';
import { exteriorParts } from '../../src/client/world/interiors/exterior.ts';
import { interiorTextures } from '../../src/client/world/interiors/textures.ts';
import { createInteriorViews } from '../../src/client/world/interiors/view.ts';
import { buildPhotoFacades } from '../../src/client/world/photo-facades.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { signedAreaFromAbove } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import { Kit } from '../../src/shared/interiors/kit.ts';
import type { Interior } from '../../src/shared/interiors/types.ts';
import type { Building, MapData, Opening } from '../../src/shared/mapdata.ts';
import { LOOKS, testInterior } from '../shared/interiors/fixture.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const IN_KEYS = ['in_liso', 'in_porcelanato', 'in_madera', 'in_machimbre', 'in_baldosa', 'in_ceramico', 'in_tela', 'in_metal',
  'in_ladrillo', 'in_vidrio', 'in_luz', 'in_mueble'] as const satisfies readonly InteriorKey[];
const WORLD_KEYS = ['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'asphalt',
  'cobble', 'sidewalk', 'grass', 'path', 'platform', 'rail', 'front'] as const;
/** Unos WorldMaterials de prueba, cada uno con su clave de nombre. */
const fakeMaterials = (): WorldMaterials =>
  Object.fromEntries([...WORLD_KEYS, ...IN_KEYS].map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as WorldMaterials;

const meshesOf = (o: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if (c instanceof THREE.Mesh) out.push(c); });
  return out;
};
/** Los triángulos de una geometría (con la matriz de su malla, si se da), en el mundo. */
function triangles(g: THREE.BufferGeometry, matrix?: THREE.Matrix4): THREE.Triangle[] {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, k) => k);
  const v = (k: number): THREE.Vector3 => {
    const x = new THREE.Vector3().fromBufferAttribute(p, k);
    return matrix ? x.applyMatrix4(matrix) : x;
  };
  const out: THREE.Triangle[] = [];
  for (let k = 0; k < idx.length; k += 3) out.push(new THREE.Triangle(v(idx[k]), v(idx[k + 1]), v(idx[k + 2])));
  return out;
}
const areaOf = (ts: THREE.Triangle[]): number => ts.reduce((s, t) => s + t.getArea(), 0);

/** 30 sillas alrededor de 10 mesas, en dos columnas a lo largo del salón. */
const furnish = (k: Kit): void => {
  for (let t = 0; t < 10; t++) {
    const [x, z] = [t < 5 ? 3 : 7, 3 + (t % 5) * 2.4];
    k.furniture('mesa', [x, z], 0, 0);
    for (const dx of [-0.9, 0, 0.9]) k.furniture('silla', [x + dx, z + 0.7], 0, Math.PI);
  }
};

/** El local de prueba corrido (dx, dz), con otro id: para ver varios interiores a la vez. */
function shifted(id: string, dx: number, dz: number): Interior {
  const { b, input } = testInterior();
  const move = (p: Vec2): Vec2 => [p[0] + dx, p[1] + dz];
  const k = new Kit({ ...b, id: `b-${id}`, footprint: b.footprint.map(move) },
    { ...input, placeId: id, buildingId: `b-${id}`, frame: { ...input.frame, origin: move(input.frame.origin) } });
  k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
  return k.done(0.8);
}

/** Una cámara como la del juego: pies en `pos` (ojos a 1,6 m), mirando a `yaw` (0 mira a −z, π a +z). */
function cameraAt(pos: Vec3, yaw: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.15, 1000);
  c.rotation.order = 'YXZ';
  c.position.set(pos[0], pos[1] + 1.6, pos[2]);
  c.rotation.set(0, yaw, 0);
  return c;
}

describe('interiorTextures', () => {
  test('las 9 texturas, de 512 px de lado y con RepeatWrapping; vetas y juntas de un PRNG con semilla', () => {
    const calls: string[] = [];
    vi.restoreAllMocks();
    stubCanvas(undefined, (method, args) => calls.push(`${method}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : typeof a)).join(',')})`));
    // three le pone un uuid a cada textura (MathUtils.generateUUID, con Math.random): esas llamadas no son del dibujo
    const real = Math.random.bind(Math);
    const drawing: string[] = [];
    vi.spyOn(Math, 'random').mockImplementation(() => {
      const stack = new Error().stack ?? '';
      if (!stack.includes('generateUUID')) drawing.push(stack);
      return real();
    });
    const img = document.createElement('canvas');
    img.width = img.height = 16;
    const t = interiorTextures(512, { revoque: img, metal: img, ladrillo: img });
    expect(Object.keys(t).sort()).toEqual(['baldosa', 'ceramico', 'ladrillo', 'liso', 'machimbre', 'madera', 'metal', 'porcelanato', 'tela']);
    for (const x of Object.values(t)) {
      const image = x.image as HTMLCanvasElement;
      expect([image.width, image.height]).toEqual([512, 512]);
      expect([x.wrapS, x.wrapT]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping]);
    }
    expect(drawing).toEqual([]);
    // con la misma semilla, el mismo dibujo
    const first = calls.splice(0);
    interiorTextures(512, { revoque: img, metal: img, ladrillo: img });
    expect(calls).toEqual(first);
    expect(first.filter((c) => c.startsWith('fillRect')).length).toBeGreaterThan(500);
  });
});

describe('buildInterior3D', () => {
  const { interior } = testInterior({ extra: furnish });
  const m = fakeMaterials();

  test('≤ 20 mallas, las 30 sillas en una sola InstancedMesh, nada con sombra y cada nombre es su material', () => {
    const { group, box } = buildInterior3D(interior, m, 'media');
    const meshes = meshesOf(group);
    expect(meshes.length).toBeLessThanOrEqual(20);
    const instanced = meshes.filter((x): x is THREE.InstancedMesh => x instanceof THREE.InstancedMesh);
    expect(instanced.filter((x) => x.count === 30)).toHaveLength(1);
    expect(instanced.filter((x) => x.count === 10)).toHaveLength(1); // las mesas también
    for (const x of meshes) {
      expect(x.castShadow).toBe(false);
      expect(x.receiveShadow).toBe(false);
      expect(x.name).toMatch(/^(in_[a-z]+|labels:\d+)$/);
      if (x.name.startsWith('in_')) {
        expect(IN_KEYS).toContain(x.name);
        expect(x.material).toBe(m[x.name as InteriorKey]);
      }
    }
    // una por Mat usada: paredes y techo (liso), piso (porcelanato) y vidrio, más los muebles
    expect(meshes.filter((x) => !(x instanceof THREE.InstancedMesh)).map((x) => x.name).sort()).toEqual(['in_liso', 'in_porcelanato', 'in_vidrio']);
    expect(box.min.toArray()).toEqual([0, 0, 0]);
    expect(box.max.toArray()).toEqual([10, 7, 15]);
  });

  test('en baja no van los muebles de detalle 2; en media sí', () => {
    const { interior: i } = testInterior({ extra: (k) => {
      furnish(k);
      for (let n = 0; n < 5; n++) k.furniture('lampara', [1 + n * 2, 14], 0, 0, undefined, 2);
    } });
    const counts = (q: 'baja' | 'media') =>
      meshesOf(buildInterior3D(i, m, q).group).filter((x): x is THREE.InstancedMesh => x instanceof THREE.InstancedMesh).map((x) => x.count).sort((a, b) => a - b);
    expect(counts('media')).toEqual([5, 10, 30]);
    expect(counts('baja')).toEqual([10, 30]);
  });

  test('los carteles de adentro van en una malla por página; los bloques y carteles `out`, no (son del chunk)', () => {
    const look = { fondo: '#123456', letra: '#ffffff', marco: '#123456', fuente: 'sans' as const };
    const { interior: i } = testInterior({ extra: (k) => {
      k.label('CAJA', [5, 14.8], 2.2, [0, -1], 1.6, 0.4, look);
      k.label('AFUERA', [5, -0.06], 2.8, [0, -1], 3, 0.9, look, { out: true });
      k.block([[0, -1.2], [10, -1.2], [10, 0], [0, 0]], 3.0, 3.2, 'solid', 'otro', { top: LOOKS.pared, side: LOOKS.pared }, true);
    } });
    const meshes = meshesOf(buildInterior3D(i, m, 'media').group);
    expect(meshes.filter((x) => x.name.startsWith('labels:')).map((x) => x.name)).toEqual(['labels:0']);
    // el alero de afuera (z < 0) no está en las mallas del interior
    for (const x of meshes.filter((y) => !(y instanceof THREE.InstancedMesh))) {
      for (const t of triangles(x.geometry)) expect(Math.max(t.a.z, t.b.z, t.c.z)).toBeGreaterThan(-0.05);
    }
    const out = exteriorParts(i);
    expect(out.signs).toEqual([{ text: 'AFUERA', anchor: [5, -0.06], normal: [0, -1], width: 3, bottomY: 2.8 - 0.45, look }]);
    expect(areaOf(triangles(out.geometry))).toBeCloseTo(10 * 1.2 + 2 * (10 + 1.2) * 0.2, 4); // tope y costados
    expect(Object.keys(out.geometry.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
  });
});

describe('lightAt', () => {
  const { interior } = testInterior();
  const back: [Vec3, Vec3][] = [[[0.2, 0.02, 14.8], [0, 1, 0]], [[5, 1.5, 14.8], [0, 0, -1]], [[5, 0.02, 14.5], [0, 1, 0]], [[9.8, 2.5, 14.8], [-1, 0, 0]]];

  test('a 0,5 m de un vidrio hay más luz que en el rincón del fondo (y que en el medio del salón: es la del vidrio)', () => {
    const near: [Vec3, Vec3] = [[2.1, 1.3, 0.62], [0, 1, 0]]; // el vidrio de x 0,5 a 3,7, con la cara de adentro en z = 0,12
    const corner = lightAt(interior, [0.2, 0.02, 14.8], [0, 1, 0]);
    expect(lightAt(interior, ...near)).toBeGreaterThan(corner);
    expect(lightAt(interior, ...near)).toBeLessThanOrEqual(1);
    expect(corner).toBeGreaterThanOrEqual(0);
    const dark: Interior = { ...interior, ambient: 0.05, lamps: [] };
    expect(lightAt(dark, ...near)).toBeGreaterThan(lightAt(dark, [5, 1.3, 7.5], [0, 1, 0]) + 0.2);
  });

  test('con ambient 0,05 y sin lámparas, el fondo da ≤ 0,15; una lámpara cerca aclara y no se pasa de 1', () => {
    const dark: Interior = { ...interior, ambient: 0.05, lamps: [] };
    for (const [p, n] of back) expect(lightAt(dark, p, n)).toBeLessThanOrEqual(0.15);
    const lit: Interior = { ...dark, lamps: [{ at: [5, 2.9, 12], radius: 4, power: 5 }] };
    expect(lightAt(lit, [5, 0.02, 12], [0, 1, 0])).toBeGreaterThan(lightAt(dark, [5, 0.02, 12], [0, 1, 0]) + 0.3);
    const blinding: Interior = { ...dark, lamps: [{ at: [5, 1, 12], radius: 4, power: 50 }] };
    expect(lightAt(blinding, [5, 0.02, 12], [0, 1, 0])).toBe(1);
  });

  test('oclusión de rincón: sin aberturas, el rincón da menos que el borde contra una pared, y este menos que el medio', () => {
    const closed: Interior = { ...interior, doors: [], blocks: interior.blocks.filter((b) => b.role !== 'vidrio') };
    const [corner, edge, middle] = ([[0.25, 0.02, 14.75], [5, 0.02, 14.75], [5, 0.02, 7.5]] as Vec3[]).map((p) => lightAt(closed, p, [0, 1, 0]));
    expect(corner).toBeLessThan(edge - 0.02);
    expect(edge).toBeLessThan(middle - 0.1);
    expect(middle).toBeCloseTo(closed.ambient, 6);
  });
});

describe('vistas', () => {
  const a = shifted('a', 0, 0);

  test('con la cámara adentro se dibuja ese solo, aunque otro esté a 20 m y en pantalla (Review Focus 5)', () => {
    const b = shifted('b', 0, -28); // de z −28 a −13: el fondo a 20 m de la cámara, que mira hacia él
    const views = createInteriorViews([a, b], fakeMaterials(), 'alta', new Map());
    views.update(cameraAt([5, 0, 7], 0));
    expect(views.drawn()).toEqual(['a']);
    views.update(cameraAt([5, 0, -9], Math.PI)); // en la vereda entre los dos, mirando al primero
    expect(views.drawn()).toEqual(['a']);
    views.update(cameraAt([5, 0, -9], 0)); // y mirando al otro
    expect(views.drawn()).toEqual(['b']);
  });

  test('a 59 m mirándolo se dibuja; a 59 m de espaldas, no; a 61 m, no', () => {
    const views = createInteriorViews([a], fakeMaterials(), 'media', new Map());
    views.update(cameraAt([5, 0, -59], Math.PI));
    expect(views.drawn()).toEqual(['a']);
    views.update(cameraAt([5, 0, -59], 0));
    expect(views.drawn()).toEqual([]);
    views.update(cameraAt([5, 0, -61], Math.PI));
    expect(views.drawn()).toEqual([]);
  });

  test('con 3 en pantalla a < 60 m y max 2 (media), se dibujan los 2 más cercanos; en baja, 1', () => {
    const list = [shifted('lejos', 0, 45), a, shifted('medio', 0, 25)];
    const views = createInteriorViews(list, fakeMaterials(), 'media', new Map());
    const cam = cameraAt([5, 0, -10], Math.PI);
    views.update(cam);
    expect(views.drawn()).toEqual(['a', 'medio']);
    views.setQuality('baja');
    views.update(cam);
    expect(views.drawn()).toEqual(['a']);
    const shown = views.group.children.filter((c) => c.name.startsWith('interior:') && c.visible).map((c) => c.name);
    expect(shown).toEqual(['interior:a']);
  });

  test('las tapas de uno dibujado se esconden y las de uno no dibujado se ven, también las que llegan después', () => {
    const b = shifted('b', 0, 25);
    const tapa = (): THREE.Mesh => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const [ta, tb] = [tapa(), tapa()];
    const views = createInteriorViews([a, b], fakeMaterials(), 'baja', new Map([['a', [ta]], ['b', [tb]]]));
    views.update(cameraAt([5, 0, -10], Math.PI));
    expect(views.drawn()).toEqual(['a']);
    expect([ta.visible, tb.visible]).toEqual([false, true]);
    const [la, lb] = [tapa(), tapa()];
    views.addTapas('a', [la]);
    views.addTapas('b', [lb]);
    expect([la.visible, lb.visible]).toEqual([false, true]);
    views.update(cameraAt([5, 0, -10], 0)); // de espaldas: ninguno
    expect([ta.visible, tb.visible, la.visible, lb.visible]).toEqual([true, true, true, true]);
  });
});

describe('fachada con huecos', () => {
  const { b, input } = testInterior();
  // además de las tres del frente: una en un costado (arista 1, x = 0) y una en el fondo que cruza el piso de arriba
  const openings: Opening[] = [
    ...input.openings,
    { kind: 'vidrio', edge: 1, s0: 5, s1: 7.5, y0: 0.5, y1: 2.0 },
    { kind: 'vidrio', edge: 2, s0: 3, s1: 5, y0: 2.8, y1: 3.6 },
  ];
  const openingArea = (os: Opening[]): number => os.reduce((s, o) => s + (o.s1 - o.s0) * (o.y1 - o.y0), 0);
  /** El centro de una abertura y la normal de su arista (hacia afuera), en la planta guardada `fp`. */
  const centre = (fp: Vec2[], o: Opening): { at: THREE.Vector3; out: THREE.Vector3 } => {
    const [p, q] = [fp[o.edge], fp[(o.edge + 1) % fp.length]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const d = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    const s = (o.s0 + o.s1) / 2;
    // afuera es la derecha de la arista recorrida en sentido antihorario
    const n = signedAreaFromAbove(fp) > 0 ? [-d[1], d[0]] : [d[1], -d[0]];
    return { at: new THREE.Vector3(p[0] + d[0] * s, (o.y0 + o.y1) / 2, p[1] + d[1] * s), out: new THREE.Vector3(n[0], 0, n[1]) };
  };
  const wallsOf = (e: ReturnType<typeof extrudeBuilding>): THREE.BufferGeometry[] =>
    [e.walls.ground, e.walls.upper, e.walls.front, ...e.walls.overrides.map((o) => o.geometry)];
  const hits = (ts: THREE.Triangle[], at: THREE.Vector3, out: THREE.Vector3): boolean => {
    const ray = new THREE.Ray(at.clone().addScaledVector(out, 1), out.clone().negate());
    return ts.some((t) => {
      const x = ray.intersectTriangle(t.a, t.b, t.c, false, new THREE.Vector3());
      return x !== null && x.distanceTo(ray.origin) < 2;
    });
  };
  const lot: Building = { ...b, front: { edges: [0], corner: [], pb: 'vidriera', arriba: 'ventanas', puerta: 'inicio' } };
  // la misma planta guardada al revés (horaria): la arista e pasa a ser la n − 2 − e, recorrida al revés
  const n = b.footprint.length;
  const cw: Building = { ...b, footprint: [...b.footprint].reverse() };
  const lenOf = (fp: Vec2[], e: number): number => Math.hypot(fp[(e + 1) % n][0] - fp[e][0], fp[(e + 1) % n][1] - fp[e][1]);
  const cwOpenings = openings.map((o): Opening => ({ ...o, edge: (2 * n - 2 - o.edge) % n,
    s0: lenOf(b.footprint, o.edge) - o.s1, s1: lenOf(b.footprint, o.edge) - o.s0 }));

  test.each([
    ['un edificio común', b, openings],
    ['un lote (frente con el atlas, costados de parapet)', lot, openings],
    ['una planta guardada en sentido horario', cw, cwOpenings],
  ] as const)('%s: ninguna pared cubre el centro de una abertura y las tapas suman su área', (_name, bd, os) => {
    const e = extrudeBuilding(bd, os);
    const ts = wallsOf(e).flatMap((g) => triangles(g));
    for (const o of os) {
      const { at, out } = centre(bd.footprint, o);
      expect(hits(ts, at, out), `abertura de la arista ${o.edge}`).toBe(false);
      expect(hits(Object.values(e.tapas).flatMap((g) => triangles(g)), at, out), `tapa de la arista ${o.edge}`).toBe(true);
    }
    const tapas = Object.values(e.tapas).flatMap((g) => triangles(g));
    expect(Math.abs(areaOf(tapas) - openingArea(os))).toBeLessThan(1e-6);
    // lo que falta en las paredes es justo lo de las tapas
    const whole = wallsOf(extrudeBuilding(bd)).flatMap((g) => triangles(g));
    expect(Math.abs(areaOf(whole) - areaOf(ts) - areaOf(tapas))).toBeLessThan(1e-6);
  });

  test('las tapas van por material: el frente de un lote al atlas y sus costados a parapet', () => {
    expect(Object.keys(extrudeBuilding(lot, openings).tapas).sort()).toEqual(['front', 'parapet']);
    expect(Object.keys(extrudeBuilding(b, openings).tapas).sort()).toEqual(['wallGroundShop', 'wallUpper']);
    expect(extrudeBuilding(b).tapas).toEqual({});
  });

  test('la foto de fachada se recorta en las aberturas de su arista y lo recortado es su tapa, con el mismo material (D5)', async () => {
    class LoadingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 8; height = 8; naturalWidth = 8; naturalHeight = 8;
      set src(_: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', LoadingImage);
    const place = { id: 'prueba', name: 'Prueba', type: 'bank' as const, position: [5, 7] as Vec2, enterable: true, buildingId: b.id,
      sign: { text: 'P', anchor: [5, -0.1] as Vec2, normal: [0, -1] as Vec2, width: 6, bottomY: 2.4 }, spawn: [5, 0, -3] as Vec3 };
    const map = { places: [place], buildings: [b] } as unknown as MapData;
    const photo = { placeId: 'prueba', commonsFile: 'x.jpg', corners: [[0, 0], [8, 0], [8, 8], [0, 8]] as [Vec2, Vec2, Vec2, Vec2], widthM: 10, heightM: 3 };
    const { group, tapas } = await buildPhotoFacades(map, [photo], '/', 32, 1, new Map([['prueba', openings]]));
    group.updateMatrixWorld(true);
    const [wall, tapa] = ['photoFacade-prueba', 'photoFacade-prueba:tapa'].map((name) => group.getObjectByName(name) as THREE.Mesh);
    expect(tapas.get('prueba')).toEqual([tapa]);
    expect(tapa.material).toBe(wall.material);
    const front = input.openings; // las de la arista 0, la de la foto
    for (const o of front) {
      const { at, out } = centre(b.footprint, o);
      expect(hits(triangles(wall.geometry, wall.matrixWorld), at, out)).toBe(false);
      expect(hits(triangles(tapa.geometry, tapa.matrixWorld), at, out)).toBe(true);
    }
    expect(Math.abs(areaOf(triangles(tapa.geometry)) - openingArea(front))).toBeLessThan(1e-6);
    expect(areaOf(triangles(wall.geometry)) + areaOf(triangles(tapa.geometry))).toBeCloseTo(10 * 3, 6);
  });
});

describe('calidad y liberación', () => {
  const look = { fondo: '#123456', letra: '#ffffff', marco: '#123456', fuente: 'sans' as const };
  const { interior } = testInterior({ extra: (k) => {
    furnish(k);
    k.label('CAJA', [5, 14.8], 2.2, [0, -1], 1.6, 0.4, look);
    for (let n = 0; n < 5; n++) k.furniture('lampara', [1 + n * 2, 14], 0, 0, undefined, 2);
  } });
  const inside = cameraAt([5, 0, 7], Math.PI);
  /** Como scene.setMaterials: a cada malla cuyo nombre es una clave, el material nuevo. */
  const swap = (root: THREE.Object3D, m: WorldMaterials): void => root.traverse((o) => {
    if (o instanceof THREE.Mesh && Object.hasOwn(m, o.name)) o.material = m[o.name as keyof WorldMaterials];
  });

  test.each([
    ['después de cambiarlos', true],
    ['antes de cambiarlos', false],
  ] as const)('setQuality %s (Review Focus 3): toda malla del interior usa uno de los materiales nuevos', (_name, swapFirst) => {
    const [m1, m2] = [fakeMaterials(), fakeMaterials()];
    const views = createInteriorViews([interior], m1, 'media', new Map());
    views.update(inside);
    expect(views.drawn()).toEqual(['prueba']);
    if (swapFirst) swap(views.group, m2);
    views.setQuality('baja'); // vuelve a armar: cambia el detalle
    if (!swapFirst) swap(views.group, m2);
    for (const x of Object.values(m1)) x.dispose();
    views.update(inside);
    const fresh = new Set<THREE.Material>(Object.values(m2));
    const drawnMeshes = meshesOf(views.group).filter((x) => !x.name.startsWith('labels:'));
    expect(drawnMeshes.length).toBeGreaterThan(IN_KEYS.length); // las del interior, además de las escondidas por material
    for (const x of drawnMeshes) expect(fresh.has(x.material as THREE.Material), x.name).toBe(true);
    // y en baja ya no están las lámparas de detalle 2
    expect(meshesOf(views.group).filter((x): x is THREE.InstancedMesh => x instanceof THREE.InstancedMesh).map((x) => x.count).sort((p, q) => p - q)).toEqual([10, 30]);
  });

  test('dispose libera cada geometría y la textura de los carteles, y no toca los materiales compartidos', () => {
    const m = fakeMaterials();
    const views = createInteriorViews([interior], m, 'media', new Map());
    const meshes = meshesOf(views.group);
    const geometries = new Set(meshes.map((x) => x.geometry));
    const labelTextures = meshes.filter((x) => x.name.startsWith('labels:')).map((x) => (x.material as THREE.MeshBasicMaterial).map!);
    expect(labelTextures).toHaveLength(1);
    const geo = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const tex = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const mat = vi.spyOn(THREE.Material.prototype, 'dispose');
    views.dispose();
    for (const g of geometries) expect(geo.mock.contexts).toContain(g);
    for (const t of labelTextures) expect(tex.mock.contexts).toContain(t);
    const shared = new Set<unknown>(Object.values(m));
    expect(mat.mock.contexts.filter((x) => shared.has(x))).toEqual([]);
    expect(views.group.children).toHaveLength(0);
  });
});
