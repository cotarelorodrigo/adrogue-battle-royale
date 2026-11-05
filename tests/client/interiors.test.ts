// @vitest-environment jsdom
// El dibujo de los interiores (tarea 5): texturas, luz horneada, mallas, vistas, fachada con huecos y tapas, cambio de
// calidad y liberación. Sobre el local de prueba de la tarea 4 (tests/shared/interiors/fixture.ts).
import * as THREE from 'three';
import { ADAPT_TIME, adapt, createEye, INDOOR_EXPOSURE, OUTDOOR_EXPOSURE } from '../../src/client/render/exposure.ts';
import { QUALITY } from '../../src/client/render/quality.ts';
import { SUN_DIR } from '../../src/client/render/scene.ts';
import { extrudeBuilding } from '../../src/client/world/geometry.ts';
import { crosses, crossesConvex, hitsBox, lightAt, OPENING_MAX, prism } from '../../src/client/world/interiors/bake.ts';
import { buildInterior3D, INTERIOR_EXPOSURE, MAX_MESHES } from '../../src/client/world/interiors/build.ts';
import { exteriorGeometry, exteriorSigns } from '../../src/client/world/interiors/exterior.ts';
import { GLASS_INSIDE, GLASS_OUTSIDE, glassMaterial } from '../../src/client/world/interiors/glass.ts';
import { ITEM_GLASS, ITEM_MODELS } from '../../src/client/world/interiors/models.ts';
import { interiorTextures } from '../../src/client/world/interiors/textures.ts';
import { createInteriorViews } from '../../src/client/world/interiors/view.ts';
import { buildPhotoFacades } from '../../src/client/world/photo-facades.ts';
import { tintColor } from '../../src/client/world/wall-kit.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { pointInPolygon, signedAreaFromAbove } from '../../src/shared/geo.ts';
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

const LABEL_LOOK = { fondo: '#123456', letra: '#ffffff', marco: '#123456', fuente: 'sans' as const };

/** Lo de un interior cargado, para el tope de draw calls (H3): lo de `furnish`, un bloque de cada Mat que falta (las
 *  9 con textura y la luz), 4 banquetas, 4 sillones y 4 lámparas, y 3 carteles. Sin compactar son 17 mallas: 11 Mats,
 *  5 InstancedMesh y una página de carteles. */
const load = (k: Kit): void => {
  furnish(k);
  (['madera', 'machimbre', 'baldosa', 'ceramico', 'tela', 'metal', 'ladrillo', 'luz'] as const).forEach((mat, n) => {
    const look = { mat, color: '#808080' };
    k.block([[1 + n, 13], [1.5 + n, 13], [1.5 + n, 13.5], [1 + n, 13.5]], 0, 1, 'solid', 'otro', { top: look, side: look });
  });
  for (let n = 0; n < 4; n++) {
    k.furniture('banqueta', [1 + n, 11], 0, 0);
    k.furniture('sillon', [6 + n, 11.5], 0, 0);
    k.furniture('lampara', [1 + n, 12], 0, 0);
  }
  for (const [text, x] of [['CAJA', 2], ['BAÑO', 5], ['SALIDA', 8]] as const) k.label(text, [x, 14.8], 2.2, [0, -1], 1.6, 0.4, LABEL_LOOK);
};

/** El local de prueba corrido (dx, dz), con otro id: para ver varios interiores a la vez. `extra`, en el marco local. */
function shifted(id: string, dx: number, dz: number, extra?: (k: Kit) => void): Interior {
  const { b, input } = testInterior();
  const move = (p: Vec2): Vec2 => [p[0] + dx, p[1] + dz];
  const k = new Kit({ ...b, id: `b-${id}`, footprint: b.footprint.map(move) },
    { ...input, placeId: id, buildingId: `b-${id}`, frame: { ...input.frame, origin: move(input.frame.origin) } });
  k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
  extra?.(k);
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
      // su color medio, lineal (el stub no dibuja: da negro), para el nivel 3 de baja
      expect((x.userData.tone as number[]).filter((c) => Number.isFinite(c) && c >= 0 && c <= 1)).toHaveLength(3);
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

  test('un cartel con dibujo (la puerta del tesoro, tarea 6) va en canvas: la puerta redonda con arcos, sin texto', () => {
    const calls: string[] = [];
    stubCanvas(undefined, (method) => calls.push(method));
    const { interior: i } = testInterior({ extra: (k) => k.label('Tesoro', [5, 14.78], 1.2, [0, -1], 1.8, 1.8, LABEL_LOOK, { drawing: 'tesoro' }) });
    expect(i.labels[0].drawing).toBe('tesoro');
    const meshes = meshesOf(buildInterior3D(i, m, 'media').group);
    expect(meshes.filter((x) => x.name.startsWith('labels:'))).toHaveLength(1);
    expect(calls).toContain('arc');
    expect(calls).not.toContain('fillText');
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
    // los carteles salen sin armar la geometría (H7: main solo necesita los carteles; la geometría es del chunk)
    expect(exteriorSigns(i)).toEqual([{ text: 'AFUERA', anchor: [5, -0.06], normal: [0, -1], width: 3, bottomY: 2.8 - 0.45, height: 0.9, look }]);
    const out = exteriorGeometry(i);
    expect(areaOf(triangles(out))).toBeCloseTo(10 * 1.2 + 2 * (10 + 1.2) * 0.2, 4); // tope y costados
    expect(Object.keys(out.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
  });
});

describe('tope de draw calls por calidad (H3, H6)', () => {
  const m = fakeMaterials();
  const { interior: heavy } = testInterior({ extra: load });
  const instancedOf = (ms: THREE.Mesh[]): THREE.InstancedMesh[] => ms.filter((x): x is THREE.InstancedMesh => x instanceof THREE.InstancedMesh);

  test.each(['baja', 'media', 'alta'] as const)('%s: el interior cargado (y el de furnish) entra en interiors.calls', (q) => {
    for (const i of [heavy, testInterior({ extra: furnish }).interior]) {
      const meshes = meshesOf(buildInterior3D(i, m, q).group);
      expect(meshes.length).toBeLessThanOrEqual(Math.min(MAX_MESHES, QUALITY[q].interiors.calls));
    }
  });

  test('sin compactar si entra (alta: 11 Mats, 5 instancias y una página); en baja, compactado: una malla opaca sin textura, el vidrio y una página', () => {
    const alta = meshesOf(buildInterior3D(heavy, m, 'alta').group);
    expect(alta).toHaveLength(17);
    expect(instancedOf(alta).map((x) => x.count).sort((a, b) => a - b)).toEqual([4, 4, 4, 10, 30]);
    const baja = meshesOf(buildInterior3D(heavy, m, 'baja').group);
    expect(instancedOf(baja)).toEqual([]);
    expect(baja.map((x) => x.name).sort()).toEqual(['in_mueble', 'in_vidrio', 'labels:0']);
    // todo lo opaco con el material sin textura y color por vértice; las 30 sillas siguen estando (en la malla junta)
    const opaque = baja.find((x) => x.name === 'in_mueble')!;
    expect(opaque.material).toBe(m.in_mueble);
    expect(opaque.geometry.getAttribute('color')).toBeDefined();
    const sillas = meshesOf(buildInterior3D(heavy, m, 'alta').group).find((x) => x instanceof THREE.InstancedMesh && x.count === 30)!;
    const perSilla = sillas.geometry.getAttribute('position').count;
    expect(opaque.geometry.getAttribute('position').count).toBeGreaterThan(30 * perSilla);
  });

  test('si ni compactado entra, tira un error con el placeId (H6)', () => {
    const calls = QUALITY.media.interiors.calls;
    try {
      QUALITY.media.interiors.calls = 2; // las paredes y el piso, más el vidrio: 3
      expect(() => buildInterior3D(testInterior().interior, m, 'media')).toThrow(/prueba/);
    } finally {
      QUALITY.media.interiors.calls = calls;
    }
  });

  test('las vistas eligen del más cercano al más lejano mientras la suma de mallas entre en calls (y en max)', () => {
    // tres cargados en fila, en alta (max 3, calls 36): de 17 mallas cada uno entran los dos más cercanos
    const list = [shifted('lejos', 0, 45, load), shifted('a', 0, 0, load), shifted('medio', 0, 25, load)];
    const views = createInteriorViews(list, m, 'alta', new Map());
    views.update(cameraAt([5, 0, -10], Math.PI));
    expect(views.drawn()).toEqual(['a', 'medio']);
    const drawnMeshes = views.group.children.filter((c) => c.name.startsWith('interior:') && c.visible).flatMap(meshesOf);
    expect(drawnMeshes.length).toBeLessThanOrEqual(QUALITY.alta.interiors.calls);
    // adentro, ese solo (RF5), y en baja, compactado, siempre entra solo
    views.setQuality('baja');
    views.update(cameraAt([5, 0, 7], Math.PI));
    expect(views.drawn()).toEqual(['a']);
    const inside = views.group.children.filter((c) => c.name.startsWith('interior:') && c.visible).flatMap(meshesOf);
    expect(inside.length).toBeLessThanOrEqual(QUALITY.baja.interiors.calls);
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

  test('la luz no atraviesa paredes (H5): un cuarto detrás de un tabique queda en ambient, aunque haya una vidriera y una lámpara del otro lado', () => {
    const { interior: split } = testInterior({ extra: (k) => {
      k.wall([0.2, 5], [9.8, 5], { look: LOOKS.pared }); // un tabique de lado a lado, del piso al techo
      k.lamp([5, 4], 2.5, 6, 1);
    } });
    const dark: Interior = { ...split, ambient: 0.05 };
    // en el cuarto de atrás, lejos de las paredes (sin oclusión de rincón): a 2 m de la lámpara y a 7 m de la vidriera
    for (const p of [[5, 0.02, 7], [2, 0.02, 8], [8, 1.5, 8]] as Vec3[]) expect(lightAt(dark, p, [0, 1, 0]), p.join(', ')).toBeCloseTo(0.05, 6);
    // y del lado de la vidriera sí llega (el vidrio deja pasar)
    expect(lightAt(dark, [2.1, 0.02, 2], [0, 1, 0])).toBeGreaterThan(0.2);
  });

  test('la luz de las aberturas va por área (H2b): la misma vidriera partida en 8 paños no da más luz', () => {
    const { b, input } = testInterior();
    const panes = (o: Opening): Opening[] => Array.from({ length: 8 }, (_, k) => ({ ...o, s0: o.s0 + (k * (o.s1 - o.s0)) / 8, s1: o.s0 + ((k + 1) * (o.s1 - o.s0)) / 8 }));
    const k = new Kit(b, { ...input, openings: input.openings.flatMap((o) => (o.kind === 'vidrio' ? panes(o) : [o])) });
    k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
    const many = { ...k.done(0.8), ambient: 0.05 };
    const one: Interior = { ...interior, ambient: 0.05, lamps: [] };
    expect(many.blocks.filter((x) => x.role === 'vidrio').length).toBe(16);
    for (const p of [[2.1, 0.02, 1], [5, 0.02, 4], [5, 0.02, 10]] as Vec3[]) {
      expect(lightAt(many, p, [0, 1, 0]), p.join(', ')).toBeLessThan(lightAt(one, p, [0, 1, 0]) * 1.05 + 0.005);
    }
  });

  test('la luz de las aberturas tiene tope: pegado a una vidriera enorme no pasa de ambient + OPENING_MAX', () => {
    const { b } = testInterior();
    const k = new Kit(b, { placeId: 'vidriera', buildingId: b.id, frame: { origin: [0, 0], u: [1, 0], v: [0, 1] }, patios: [],
      openings: [{ kind: 'vidrio', edge: 0, s0: 0.2, s1: 9.8, y0: 0.05, y1: 3.0 }, { kind: 'vidrio', edge: 1, s0: 0.2, s1: 14.8, y0: 0.05, y1: 3.0 }] });
    k.shell({ publicFloors: 1, wall: LOOKS.pared, floor: LOOKS.piso, ceiling: LOOKS.techo });
    const glassy = { ...k.done(0.05), lamps: [] };
    for (const [p, n] of [[[0.5, 1, 0.5], [0, 1, 0]], [[5, 0.02, 0.4], [0, 1, 0]], [[0.4, 1.5, 7], [1, 0, 0]], [[5, 1, 0.4], [0, 0, -1]]] as [Vec3, Vec3][]) {
      expect(lightAt(glassy, p, n), p.join(', ')).toBeLessThanOrEqual(0.05 + OPENING_MAX + 1e-9);
    }
    // de frente a la vidriera, a 0,4 m y lejos de los rincones: llega al tope
    expect(lightAt(glassy, [5, 1, 0.4], [0, 0, -1])).toBeGreaterThan(0.05 + OPENING_MAX * 0.9);
  });

  test('los atajos de la visibilidad (N4): con un prisma convexo, el recorte da lo mismo que el corte por tramos; la caja nunca descarta lo que el prisma tapa', () => {
    const ring = (r: number, n: number, cw = false): Vec2[] => {
      const v = Array.from({ length: n }, (_, k): Vec2 => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n)]);
      return cw ? v.reverse() : v;
    };
    const wall: Vec2[] = [[0, 0], [3, 0], [3, 0.2], [0, 0.2]];
    const prisms = [
      prism(wall, 0, 2.7), prism([...wall].reverse(), 0, 2.7), // en los dos sentidos
      prism([[0, 0], [3, 0], [2.4, 0.9], [0.4, 0.9]], 0.5, 1.5), // un trapecio
      prism(ring(4, 24), 3, 3.8), prism(ring(4, 24, true), -0.2, 0), // la losa de una planta redonda
    ];
    expect(prisms.map((q) => q.turn !== 0)).toEqual([true, true, true, true, true]);
    expect(prism([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], 0, 3).turn).toBe(0); // una L no es convexa: va por el corte general
    let seed = 7;
    const rnd = (lo: number, hi: number): number => {
      seed = (seed * 16807) % 2147483647;
      return lo + ((hi - lo) * seed) / 2147483647;
    };
    let hit = 0;
    for (const q of prisms) {
      for (let k = 0; k < 3000; k++) {
        const a: Vec3 = [rnd(-5, 5), rnd(-0.5, 4), rnd(-5, 5)];
        const b: Vec3 = k % 10 === 0 ? [a[0], rnd(-0.5, 4), a[2]] : [rnd(-5, 5), rnd(-0.5, 4), rnd(-5, 5)]; // y algunos verticales
        const want = crosses(q, a, b);
        expect(crossesConvex(q, a, b), `${JSON.stringify(q.poly[0])} ${a.map((v) => v.toFixed(3))} → ${b.map((v) => v.toFixed(3))}`).toBe(want);
        if (want) {
          hit++;
          expect(hitsBox(q, a, b)).toBe(true);
        }
      }
    }
    expect(hit).toBeGreaterThan(1000); // que haya de los dos casos
  });

  test('oclusión de rincón: sin aberturas, el rincón da menos que el borde contra una pared, y este menos que el medio', () => {
    const closed: Interior = { ...interior, doors: [], blocks: interior.blocks.filter((b) => b.role !== 'vidrio') };
    const [corner, edge, middle] = ([[0.25, 0.02, 14.75], [5, 0.02, 14.75], [5, 0.02, 7.5]] as Vec3[]).map((p) => lightAt(closed, p, [0, 1, 0]));
    expect(corner).toBeLessThan(edge - 0.02);
    expect(edge).toBeLessThan(middle - 0.1);
    expect(middle).toBeCloseTo(closed.ambient, 6);
  });

  // Tarea 6: una pared de vidrio entre el vestíbulo y el salón, o la mampara de las cajas, no da al cielo. La luz de la
  // vidriera ya la atraviesa (el vidrio no tapa); contarla como fuente la sumaría dos veces.
  test('un vidrio de adentro (una pared de vidrio, una mampara) no es fuente de cielo: solo los de las paredes de afuera', () => {
    const glass = { mat: 'vidrio', color: '#b8d0d6' } as const;
    const { interior: plain } = testInterior();
    const { interior: split } = testInterior({ extra: (k) => {
      k.wall([0.2, 8], [9.8, 8], { t: 0.04, collide: 'glass', look: glass });
      k.block([[2, 11.99], [8, 11.99], [8, 12.01], [2, 12.01]], 1.1, 2.4, 'glass', 'vidrio', { side: glass });
    } });
    expect(split.blocks.filter((x) => x.role === 'vidrio').length).toBe(plain.blocks.filter((x) => x.role === 'vidrio').length + 2);
    for (const p of [[5, 0.02, 8.5], [5, 0.02, 7.5], [5, 0.02, 12.5], [3, 0.02, 11.6]] as Vec3[]) {
      expect(lightAt({ ...split, ambient: 0.05 }, p, [0, 1, 0]), p.join(', ')).toBeCloseTo(lightAt({ ...plain, ambient: 0.05 }, p, [0, 1, 0]), 6);
    }
  });
});

describe('exposición, vidrio y adaptación del ojo (H2, H10)', () => {
  const m = fakeMaterials();
  const colorAt = (g: THREE.BufferGeometry, k: number): number[] => [0, 1, 2].map((c) => g.getAttribute('color').array[k * 3 + c]);
  const vec = (g: THREE.BufferGeometry, name: string, k: number): Vec3 => [0, 1, 2].map((c) => g.getAttribute(name).array[k * 3 + c]) as Vec3;
  const lit = testInterior({ extra: (k) => {
    k.block([[4, 13], [6, 13], [6, 13.5], [4, 13.5]], 2.5, 2.6, 'none', 'otro', { bottom: { mat: 'luz', color: '#fff4e0' } });
    for (let n = 0; n < 4; n++) {
      k.furniture('lampara', [1 + n, 12], 0, 0);
      k.furniture('silla', [6 + n, 12], 0, 0, '#a0a0a0');
    }
    k.label('ABIERTO', [3, 14.8], 2.2, [0, -1], 1.6, 0.4, LABEL_LOOK, { glow: true });
    k.label('CAJA', [7, 14.8], 2.2, [0, -1], 1.6, 0.4, LABEL_LOOK);
  } }).interior;
  // se arma en cada test: los carteles dibujan en el canvas de mentira, que se pone en beforeEach
  const build = (): THREE.Mesh[] => meshesOf(buildInterior3D(lit, m, 'alta').group);
  const named = (meshes: THREE.Mesh[], name: string): THREE.Mesh => meshes.find((x) => x.name === name && !(x instanceof THREE.InstancedMesh))!;

  test('INTERIOR_EXPOSURE escala lo horneado de los bloques, los muebles y los carteles; lo que brilla queda en 1 (H2a)', () => {
    expect(INTERIOR_EXPOSURE).toBeGreaterThan(0.1);
    expect(INTERIOR_EXPOSURE).toBeLessThan(0.7);
    const meshes = build();
    const byName = (name: string): THREE.Mesh => named(meshes, name);
    const floor = byName('in_porcelanato').geometry;
    const tint = tintColor(LOOKS.piso.color);
    for (let k = 0; k < floor.getAttribute('position').count; k += 7) {
      const want = lightAt(lit, vec(floor, 'position', k), vec(floor, 'normal', k)) * INTERIOR_EXPOSURE;
      expect(colorAt(floor, k)[0]).toBeCloseTo(tint.r * want, 5);
    }
    const glow = byName('in_luz').geometry, warm = tintColor('#fff4e0');
    for (let k = 0; k < glow.getAttribute('position').count; k++) expect(colorAt(glow, k)).toEqual([warm.r, warm.g, warm.b].map((v) => Math.fround(v)));
    const inst = meshes.filter((x): x is THREE.InstancedMesh => x instanceof THREE.InstancedMesh);
    expect(inst.map((x) => x.count)).toEqual([4, 4]);
    const lampVerts = ITEM_MODELS.lampara().getAttribute('position').count;
    const lamps = inst.find((x) => x.geometry.getAttribute('position').count === lampVerts)!, chairs = inst.find((x) => x !== lamps)!;
    expect(Array.from(lamps.instanceColor!.array).every((v) => v === 1)).toBe(true); // brillan: blanco pleno
    const grey = tintColor('#a0a0a0');
    lit.items.filter((it) => it.model === 'silla').forEach((it, k) => {
      const want = grey.r * lightAt(lit, [it.at[0], it.at[1] + 0.6, it.at[2]], [0, 1, 0]) * INTERIOR_EXPOSURE;
      expect(chairs.instanceColor!.array[k * 3]).toBeCloseTo(want, 5);
    });
    const labels = byName('labels:0').geometry;
    for (const [k, l] of lit.labels.entries()) {
      const c: Vec3 = [l.at[0] + l.normal[0] * 0.02, l.at[1], l.at[2] + l.normal[1] * 0.02];
      const want = l.glow ? 1 : lightAt(lit, c, [l.normal[0], 0, l.normal[1]]) * INTERIOR_EXPOSURE;
      for (let v = 0; v < 4; v++) expect(colorAt(labels, k * 4 + v)).toEqual([want, want, want].map((x) => Math.fround(x)));
    }
  });

  test('el vidrio no se hornea: de afuera GLASS_OUTSIDE, de adentro GLASS_INSIDE, con cualquier ambient (H2c)', () => {
    const g = named(build(), 'in_vidrio').geometry;
    for (const ambient of [0.05, 0.8]) {
      const other = meshesOf(buildInterior3D({ ...lit, ambient }, m, 'alta').group).find((x) => x.name === 'in_vidrio')!.geometry;
      expect(Array.from(other.getAttribute('color').array)).toEqual(Array.from(g.getAttribute('color').array));
      for (let k = 0; k < g.getAttribute('position').count; k++) {
        const [p, n] = [vec(g, 'position', k), vec(g, 'normal', k)];
        const outside = !pointInPolygon([p[0] + n[0] * 0.3, p[2] + n[2] * 0.3], lit.footprint);
        expect(colorAt(g, k)[0]).toBeCloseTo(outside ? GLASS_OUTSIDE : GLASS_INSIDE, 6);
      }
    }
  });

  test('el material del vidrio: color de cielo, transparente, sin escribir profundidad, y Fresnel en el shader (H2c)', () => {
    const glass = glassMaterial();
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(glass.side).toBe(THREE.DoubleSide);
    expect(glass.vertexColors).toBe(true);
    const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    glass.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).not.toBe(THREE.ShaderLib.basic.vertexShader);
    expect(shader.fragmentShader).toMatch(/gl_FrontFacing/);
    expect(shader.fragmentShader).toMatch(/pow\(/);
    expect(glass.customProgramCacheKey()).not.toBe(new THREE.MeshBasicMaterial().customProgramCacheKey());
  });

  test('la hoja de vidrio abierta lleva su paño en in_vidrio; el marco, en los muebles (H10)', () => {
    const { interior: door } = testInterior({ extra: (k) => k.furniture('hoja-vidrio', [5, 1], 0, Math.PI / 2) });
    const built = meshesOf(buildInterior3D(door, m, 'alta').group);
    const plain = meshesOf(buildInterior3D(testInterior().interior, m, 'alta').group).find((x) => x.name === 'in_vidrio')!;
    const glass = built.find((x) => x.name === 'in_vidrio')!;
    // el paño: una caja de 0,8 × 2,0 × 0,01 m
    expect(areaOf(triangles(glass.geometry)) - areaOf(triangles(plain.geometry))).toBeCloseTo(2 * (0.8 * 2.0 + 0.8 * 0.01 + 2.0 * 0.01), 4);
    const frame = built.find((x) => x.name === 'in_mueble')!;
    expect(areaOf(triangles(frame.geometry))).toBeCloseTo(areaOf(triangles(ITEM_MODELS['hoja-vidrio']())), 4);
    expect(ITEM_GLASS['hoja-vidrio']).toBeDefined();
  });

  test('adaptación del ojo (H2e): hacia el valor de adentro con una constante de ~1 s, sin pasarse, y de vuelta a la de afuera', () => {
    expect(adapt(OUTDOOR_EXPOSURE, INDOOR_EXPOSURE, 0)).toBe(OUTDOOR_EXPOSURE);
    const oneSecond = adapt(OUTDOOR_EXPOSURE, INDOOR_EXPOSURE, 1);
    expect(oneSecond).toBeCloseTo(INDOOR_EXPOSURE + (OUTDOOR_EXPOSURE - INDOOR_EXPOSURE) * Math.exp(-1 / ADAPT_TIME), 9);
    let x = OUTDOOR_EXPOSURE;
    for (let k = 0; k < 60; k++) x = adapt(x, INDOOR_EXPOSURE, 1 / 60);
    expect(x).toBeCloseTo(oneSecond, 9); // no depende de los cuadros por segundo
    for (let k = 0; k < 20 * 60; k++) { // 20 s afuera
      const next = adapt(x, OUTDOOR_EXPOSURE, 1 / 60);
      expect(Math.abs(next - OUTDOOR_EXPOSURE)).toBeLessThanOrEqual(Math.abs(x - OUTDOOR_EXPOSURE));
      x = next;
    }
    expect(x).toBeCloseTo(OUTDOOR_EXPOSURE, 6);
    expect(adapt(OUTDOOR_EXPOSURE, INDOOR_EXPOSURE, 1e6)).toBe(INDOOR_EXPOSURE);
    expect(INDOOR_EXPOSURE).toBeGreaterThan(OUTDOOR_EXPOSURE);
    expect(OUTDOOR_EXPOSURE).toBe(0.7);
  });

  test('el ojo (N3): con la rampa al entrar y al salir caminando, pero en un salto de cámara va directo a la del lugar nuevo', () => {
    const eye = createEye();
    const frames = (inside: boolean, secs: number): number[] => Array.from({ length: Math.round(secs * 60) }, () => eye.step(inside, 1 / 60));
    // el primer cuadro (la carga) ya es el del lugar: sin rampa
    expect(eye.step(false, 1 / 60)).toBe(OUTDOOR_EXPOSURE);
    // caminando hacia adentro: la rampa, de a poco y sin pasarse
    const walkIn = frames(true, 0.5);
    expect(walkIn[0]).toBeGreaterThan(OUTDOOR_EXPOSURE);
    expect(walkIn[0]).toBeLessThan(OUTDOOR_EXPOSURE + 0.1);
    expect(walkIn.at(-1)).toBeCloseTo(adapt(OUTDOOR_EXPOSURE, INDOOR_EXPOSURE, 0.5), 9);
    frames(true, 20);
    expect(eye.value).toBeCloseTo(INDOOR_EXPOSURE, 6);
    // adaptado adentro, un salto afuera (partida nueva, aparición, teletransporte): el cuadro siguiente ya es el de afuera
    eye.jump();
    expect(eye.step(false, 1 / 60)).toBe(OUTDOOR_EXPOSURE);
    // y después del salto vuelve la rampa
    expect(eye.step(true, 1 / 60)).toBeLessThan(OUTDOOR_EXPOSURE + 0.1);
    // al revés: afuera, un salto adentro (puntos bajo losa), directo a la de adentro
    frames(false, 20);
    eye.jump();
    expect(eye.step(true, 1 / 60)).toBe(INDOOR_EXPOSURE);
    // un salto sin cambiar de lugar no cambia nada
    eye.jump();
    expect(eye.step(true, 1 / 60)).toBe(INDOOR_EXPOSURE);
    // con dt ≤ 0 (el primer cuadro después de un salto también) no se traba
    eye.jump();
    expect(eye.step(false, 0)).toBe(OUTDOOR_EXPOSURE);
  });

  test('las vistas dicen si la cámara está adentro de un interior (la misma regla de update)', () => {
    const views = createInteriorViews([shifted('a', 0, 0)], m, 'media', new Map());
    views.update(cameraAt([5, 0, 7], Math.PI));
    expect(views.inside()).toBe(true);
    views.update(cameraAt([5, 0, -5], Math.PI));
    expect(views.drawn()).toEqual(['a']);
    expect(views.inside()).toBe(false);
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

  // un lote recorrido `contra` (H4), con una abertura asimétrica en el frente: si se diera vuelta, quedaría en s 8-9
  const contra: Building = { ...b, front: { edges: [0], corner: [], pb: 'vidriera', arriba: 'ventanas', puerta: 'inicio', contra: true } };
  const asymmetric: Opening[] = [{ kind: 'vidrio', edge: 0, s0: 1, s1: 2, y0: 0.3, y1: 2.3 }, ...openings.filter((o) => o.edge !== 0)];

  test.each([
    ['un edificio común', b, openings],
    ['un lote (frente con el atlas, costados de parapet)', lot, openings],
    ['una planta guardada en sentido horario', cw, cwOpenings],
    ['un lote con contra y una abertura asimétrica (H4)', contra, asymmetric],
    ['una planta horaria con una abertura asimétrica (H4)', { ...cw, front: contra.front }, asymmetric.map((o): Opening => ({ ...o, edge: (2 * n - 2 - o.edge) % n,
      s0: lenOf(b.footprint, o.edge) - o.s1, s1: lenOf(b.footprint, o.edge) - o.s0 }))],
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

  test.each([
    ['las del local', openings],
    ['una asimétrica (H4)', asymmetric],
  ] as const)('la foto de fachada se recorta en las aberturas de su arista y lo recortado es su tapa, con el mismo material (D5): %s', async (_name, os) => {
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
    const { group, tapas } = await buildPhotoFacades(map, [photo], '/', 32, 1, new Map([['prueba', [...os]]]));
    group.updateMatrixWorld(true);
    const [wall, tapa] = ['photoFacade-prueba', 'photoFacade-prueba:tapa'].map((name) => group.getObjectByName(name) as THREE.Mesh);
    expect(tapas.get('prueba')).toEqual([tapa]);
    expect(tapa.material).toBe(wall.material);
    const front = os.filter((o) => o.edge === 0); // las de la arista 0, la de la foto
    for (const o of front) {
      const { at, out } = centre(b.footprint, o);
      expect(hits(triangles(wall.geometry, wall.matrixWorld), at, out)).toBe(false);
      expect(hits(triangles(tapa.geometry, tapa.matrixWorld), at, out)).toBe(true);
    }
    expect(Math.abs(areaOf(triangles(tapa.geometry)) - openingArea(front))).toBeLessThan(1e-6);
    expect(areaOf(triangles(wall.geometry)) + areaOf(triangles(tapa.geometry))).toBeCloseTo(10 * 3, 6);
  });
});

describe('sombra entera (H1)', () => {
  // Un local de 2 m de fondo a lo largo del sol y 6 m de ancho, de 5 m de alto: el frente (arista 3) mira para el lado
  // contrario al sol y el fondo (arista 1), al sol. Una vidriera en cada uno, en el medio: A de 0,3 a 2,8 m y B de 2 a 4.
  const sunH = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize();
  const u: Vec2 = [sunH.x, sunH.y], w: Vec2 = [-sunH.y, sunH.x];
  const at = (a: number, c: number): Vec2 => [100 + u[0] * a + w[0] * c, 50 + u[1] * a + w[1] * c];
  const bd: Building = { id: 'b-sol', footprint: [at(0, 0), at(2, 0), at(2, 6), at(0, 6)], height: 5, floors: 1, kind: 'shop', wall: 'plaster', tint: '#d8d0c0' };
  const A: Opening = { kind: 'vidrio', edge: 3, s0: 2, s1: 4, y0: 0.3, y1: 2.8 };
  const B: Opening = { kind: 'vidrio', edge: 1, s0: 2, s1: 4, y0: 2.0, y1: 4.0 };
  /** Lo que proyecta en el chunk (SHADOW_CASTERS): las paredes, el techo y el pretil; las tapas no. */
  const casters = (b: Building, os: Opening[]): THREE.Triangle[] => {
    const e = extrudeBuilding(b, os);
    return [e.walls.ground, e.walls.upper, e.walls.front, ...e.walls.overrides.map((o) => o.geometry), e.roof, e.parapet].flatMap((g) => triangles(g));
  };
  /** ¿El rayo desde el suelo hacia el sol pega en una cara de espaldas al sol (las que dibuja la pasada de sombras)? */
  const shaded = (ts: THREE.Triangle[], from: Vec2): boolean => {
    const ray = new THREE.Ray(new THREE.Vector3(from[0], 0.02, from[1]), SUN_DIR.clone());
    const n = new THREE.Vector3();
    return ts.some((t) => t.getNormal(n).dot(SUN_DIR) < 0 && ray.intersectTriangle(t.a, t.b, t.c, false, new THREE.Vector3()) !== null);
  };
  // a d m del frente, del lado de la sombra: el rayo cruza el frente a 1,19·d m de alto y el fondo a 1,19·(d + 2)
  const ground = (d: number, c: number): Vec2 => at(-d, c);

  test('el rayo que entra por la vidriera de la sombra y sale por el techo o por pared maciza da sombra (la cáscara)', () => {
    const ts = casters(bd, [A]);
    for (const c of [2.5, 3, 3.5]) for (const d of [0.3, 0.5, 1, 1.5]) expect(shaded(ts, ground(d, c)), `d ${d} c ${c}`).toBe(true);
  });

  test('con dos vidrieras alineadas el sol pasa; por encima de B (d = 1,5) vuelve la sombra', () => {
    const ts = casters(bd, [A, B]);
    for (const c of [2.5, 3, 3.5]) {
      for (const d of [0.3, 0.5, 1]) expect(shaded(ts, ground(d, c)), `d ${d} c ${c}`).toBe(false);
      expect(shaded(ts, ground(1.5, c)), `d 1,5 c ${c}`).toBe(true);
    }
  });

  /** El contorno de la cáscara: cada arista de `fp` corrida `off(i)` hacia adentro, cortada con la de al lado. */
  const contour = (fp: Vec2[], off: (i: number) => number): { inner: Vec2[]; lines: { p: Vec2; d: Vec2; m: Vec2; o: number }[] } => {
    const inward = signedAreaFromAbove(fp) > 0 ? 1 : -1;
    const lines = fp.map((a, k) => {
      const c = fp[(k + 1) % fp.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const d: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len], m: Vec2 = [d[1] * inward, -d[0] * inward];
      return { p: [a[0] + m[0] * off(k), a[1] + m[1] * off(k)] as Vec2, d, m, o: off(k) };
    });
    const corner = (l: (typeof lines)[number], r: (typeof lines)[number]): Vec2 => {
      const den = l.d[0] * r.d[1] - l.d[1] * r.d[0];
      const t = ((r.p[0] - l.p[0]) * r.d[1] - (r.p[1] - l.p[1]) * r.d[0]) / den;
      return [l.p[0] + l.d[0] * t, l.p[1] + l.d[1] * t];
    };
    return { inner: lines.map((l, k) => corner(lines[(k + fp.length - 1) % fp.length], l)), lines };
  };
  /** ¿La arista mira al sol (su normal de afuera)? Solo esas llevan pared de cáscara. */
  const sunny = (l: { m: Vec2 }): boolean => -(l.m[0] * SUN_DIR.x + l.m[1] * SUN_DIR.z) > 1e-6;

  test('la cáscara: paredes solo en las aristas al sol, 15 cm adentro; el techo, 5 cm abajo y mirando abajo, del mismo polígono corrido hasta ellas; sin aberturas no hay cáscara', () => {
    const roof = (os: Opening[]): THREE.Triangle[] => triangles(extrudeBuilding(bd, os).roof);
    const n = new THREE.Vector3();
    const up = roof([]);
    expect(up.every((t) => t.getNormal(n).y > 0.999 && t.a.y === 5)).toBe(true);
    const withShell = roof([A]);
    const down = withShell.filter((t) => t.getNormal(n).y < -0.999);
    expect(down.every((t) => Math.abs(t.a.y - 4.95) < 1e-6)).toBe(true);
    // N2: hasta el borde de afuera de una pared al sol, a 5 cm del techo, el PCF de esa pared (rasante) agarraba la
    // cáscara y le hacía una banda de sombra arriba: ahí el techo de la cáscara llega hasta su pared, a 15 cm. Del lado
    // de la sombra sigue hasta el borde: si no, un rayo que entra rasante por una vidriera salía por el techo.
    expect(areaOf(down)).toBeCloseTo((2 - 0.15) * 6, 4);
    // y las paredes, 15 cm hacia adentro (N2: a 5 cm daban acné con el sol rasante) y dadas vuelta: solo el fondo (arista
    // 1), que mira al sol; las de espaldas (o de canto) miran al sol desde adentro y la pasada de sombras no las dibuja
    const walls = withShell.filter((t) => Math.abs(t.getNormal(n).y) < 1e-6);
    expect(areaOf(walls)).toBeCloseTo(6 * 5, 3);
    expect(walls.every((t) => t.getNormal(n).dot(SUN_DIR) < 0)).toBe(true);
  });

  test('en esquinas que no son rectas, las paredes de la cáscara y su techo se tocan justo (el contorno corrido, cerrado) y no salen de la planta (N2)', () => {
    // un trapecio: esquinas de 90°, 72° y 108°; con este sol, al sol miran la arista 0 y la 1 (y la vidriera, en la 0)
    const fp: Vec2[] = [[0, 0], [10, 0], [8, 6], [0, 6]];
    const b: Building = { ...bd, id: 'b-trapecio', footprint: fp };
    const open: Opening = { kind: 'vidrio', edge: 0, s0: 3, s1: 5, y0: 0.3, y1: 2.8 };
    const n = new THREE.Vector3();
    const tris = triangles(extrudeBuilding(b, [open]).roof);
    const walls = tris.filter((t) => Math.abs(t.getNormal(n).y) < 1e-6);
    const down = tris.filter((t) => t.getNormal(n).y < -0.999);
    const probe = contour(fp, () => 0);
    expect(probe.lines.map(sunny)).toEqual([true, true, false, false]);
    const { inner, lines } = contour(fp, (k) => (sunny(probe.lines[k]) ? 0.15 : 0));
    const side = (k: number): number => Math.hypot(inner[(k + 1) % 4][0] - inner[k][0], inner[(k + 1) % 4][1] - inner[k][1]);
    expect(areaOf(walls)).toBeCloseTo((side(0) + side(1)) * 5 - (5 - 3) * (2.8 - 0.3), 3);
    expect(areaOf(down)).toBeCloseTo(Math.abs(signedAreaFromAbove(inner)), 4);
    // cada vértice de las paredes, a 0,15 m de la recta de una arista al sol y adentro de la planta
    for (const t of walls) {
      for (const v of [t.a, t.b, t.c]) {
        const dist = lines.map((l) => (v.x - l.p[0]) * l.m[0] + (v.z - l.p[1]) * l.m[1] + l.o);
        expect(Math.min(...dist), `${v.x.toFixed(3)}, ${v.z.toFixed(3)}`).toBeGreaterThan(-1e-6);
        expect(dist.some((x, k) => sunny(lines[k]) && Math.abs(x - 0.15) < 1e-6)).toBe(true);
      }
    }
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
