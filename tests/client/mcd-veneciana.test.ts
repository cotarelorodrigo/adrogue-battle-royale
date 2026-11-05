// @vitest-environment jsdom
// El McDonald's y La Veneciana (tarea 8) dibujados: los muebles nuevos (del tamaño de su caja, los que brillan), los
// colores de lo que brilla como se ven adentro (aces.ts, a INDOOR_EXPOSURE), lo que está al aire libre (la terraza, el
// patio y la vereda) con la luz de afuera en vez de la horneada, la exposición de afuera en el patio y en la terraza, y
// los carteles `out` de su alto (la "M" de la torre, los de los toldos).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { outdoorLight } from '../../src/client/world/interiors/bake.ts';
import { buildInterior3D } from '../../src/client/world/interiors/build.ts';
import { exteriorSigns } from '../../src/client/world/interiors/exterior.ts';
import { ITEM_GLOW, ITEM_MODELS } from '../../src/client/world/interiors/models.ts';
import { createInteriorViews } from '../../src/client/world/interiors/view.ts';
import { buildSigns } from '../../src/client/world/signs.ts';
import { tintColor } from '../../src/client/world/wall-kit.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import type { Vec3 } from '../../src/shared/geo.ts';
import { interiorOf } from '../../src/shared/interiors/index.ts';
import { GROUND_Y, MODEL_BOX } from '../../src/shared/interiors/kit.ts';
import type { ItemModel } from '../../src/shared/interiors/types.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { deltaE, hexRGB, seen } from './aces.ts';
import type { RGB } from './aces.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => vi.restoreAllMocks());

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const mcd = interiorOf(map, 'mcdonalds');
const ven = interiorOf(map, 'la-veneciana');
const H = map.buildings.find((b) => b.id === ven.buildingId)!.height;
const KEYS = ['in_liso', 'in_porcelanato', 'in_madera', 'in_machimbre', 'in_baldosa', 'in_ceramico', 'in_tela', 'in_metal',
  'in_ladrillo', 'in_vidrio', 'in_luz', 'in_mueble'] as const satisfies readonly InteriorKey[];
const WORLD = ['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'asphalt',
  'cobble', 'sidewalk', 'grass', 'path', 'platform', 'rail', 'front', ...KEYS] as const;
const fake = Object.fromEntries(WORLD.map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as WorldMaterials;
const luma = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const fmt = (c: RGB): string => `(${c.join(', ')})`;
/** El rojo y el amarillo de la marca (los de su manual: Pantone 485 y 123). */
const ROJO_MC = '#da291c', BLANCO = '#ffffff';

describe('los muebles nuevos', () => {
  const NEW: ItemModel[] = ['mesa-redonda', 'freidora', 'heladera', 'pantalla', 'mesa-picnic', 'sombrilla', 'silla-director', 'metegol', 'balde-helado'];

  test('cada uno tiene su modelo; los de MODEL_BOX, del tamaño de su caja (± 0,05 m), con el origen en el piso y en su medio', () => {
    for (const m of NEW) {
      const g = ITEM_MODELS[m]();
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      expect(bb.min.y, m).toBeGreaterThanOrEqual(-1e-6);
      const box = MODEL_BOX[m];
      if (!box) continue;
      const size = bb.getSize(new THREE.Vector3());
      // el metegol: la caja es el gabinete; las varillas con sus manijas salen ≤ 0,3 m por costado (no frenan)
      const rods = m === 'metegol' ? 0.6 : 0;
      expect(size.x - box.w, `${m}: ancho ${size.x.toFixed(2)}`).toBeGreaterThanOrEqual(-0.05);
      expect(size.x - box.w, `${m}: ancho ${size.x.toFixed(2)}`).toBeLessThanOrEqual(0.05 + rods);
      expect(Math.abs(size.z - box.d), `${m}: fondo ${size.z.toFixed(2)}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(size.y - box.h), `${m}: alto ${size.y.toFixed(2)}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(bb.min.x + bb.max.x) / 2, `${m}: centrado en x`).toBeLessThanOrEqual(0.03);
      expect(Math.abs(bb.min.z + bb.max.z) / 2, `${m}: centrado en z`).toBeLessThanOrEqual(0.03);
    }
  });

  test('brillan la pantalla de menú y los baldes de helado (ITEM_GLOW)', () => {
    expect(ITEM_GLOW.pantalla).toBe(true);
    expect(ITEM_GLOW['balde-helado']).toBe(true);
  });
});

describe('lo que brilla, como se ve adentro', () => {
  test(`"CAJA KIOSCO" y el "1": del rojo de la marca (${ROJO_MC}, ΔE ≤ 10) con la letra blanca`, () => {
    const signs = mcd.labels.filter((l) => l.text.includes('CAJA KIOSCO') || l.text === '1');
    expect(signs.length).toBeGreaterThanOrEqual(2);
    for (const l of signs) {
      expect(l.glow).toBe(true);
      const f = seen(l.look.fondo), t = seen(l.look.letra);
      expect(deltaE(f, hexRGB(ROJO_MC)), `${l.text}: el fondo ${l.look.fondo} se ve ${fmt(f)}`).toBeLessThanOrEqual(10);
      expect(deltaE(t, hexRGB(BLANCO)), `${l.text}: la letra ${l.look.letra} se ve ${fmt(t)}`).toBeLessThanOrEqual(6);
    }
  });

  test('las pantallas de menú: fondo oscuro y letra que se lee, sin quemarse', () => {
    const menus = mcd.labels.filter((l) => l.drawing === 'menu');
    expect(menus.length).toBeGreaterThanOrEqual(3);
    for (const l of menus) {
      expect(luma(seen(l.look.fondo)), `fondo ${l.look.fondo}`).toBeLessThanOrEqual(70);
      expect(luma(seen(l.look.letra)), `letra ${l.look.letra}`).toBeGreaterThanOrEqual(170);
    }
  });

  test('los baldes de helado se ven de colores (no blancos): cada uno con color y sin quemarse', () => {
    const colors = [...new Set(ven.items.filter((it) => it.model === 'balde-helado').map((it) => it.color!))];
    expect(colors.length).toBeGreaterThanOrEqual(6);
    for (const c of colors) {
      const v = seen(c);
      expect(Math.max(...v) - Math.min(...v), `${c} se ve ${fmt(v)}`).toBeGreaterThanOrEqual(45);
      expect(luma(v), `${c} se ve ${fmt(v)}`).toBeLessThanOrEqual(235);
    }
  });
});

describe('al aire libre', () => {
  /** Los colores por vértice de las mallas del interior armado (en alta) que pasan `which`, con su posición y su normal. */
  function vertices(i: typeof mcd, which: (name: string) => boolean): { p: Vec3; n: Vec3; c: Vec3 }[] {
    const meshes: THREE.Mesh[] = [];
    buildInterior3D({ ...i }, fake, 'alta').group.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && which(o.name)) meshes.push(o); });
    expect(meshes.length).toBeGreaterThan(0);
    return meshes.flatMap((m) => {
      const g = m.geometry, [p, n, c] = ['position', 'normal', 'color'].map((a) => g.getAttribute(a));
      return Array.from({ length: p.count }, (_, k) => ({ p: [p.getX(k), p.getY(k), p.getZ(k)] as Vec3, n: [n.getX(k), n.getY(k), n.getZ(k)] as Vec3, c: [c.getX(k), c.getY(k), c.getZ(k)] as Vec3 }));
    });
  }

  test('outdoorLight: la de la escena (sol y cielo, Lambert) en una cara para arriba, ~1,1; de espaldas al sol, menos', () => {
    expect(outdoorLight([0, 1, 0])).toBeGreaterThan(0.9);
    expect(outdoorLight([0, 1, 0])).toBeLessThan(1.4);
    expect(outdoorLight([0, -1, 0])).toBeLessThan(outdoorLight([0, 1, 0]) / 2);
  });

  test('la baldosa de la terraza va con la luz de afuera (no la horneada): su color por outdoorLight', () => {
    const tile = ven.blocks.find((x) => x.top?.mat === 'baldosa' && Math.abs(x.y1 - (H + GROUND_Y)) < 1e-6)!;
    const t = tintColor(tile.top!.color);
    const up = vertices(ven, (n) => n === 'in_baldosa').filter((v) => Math.abs(v.p[1] - (H + GROUND_Y)) < 1e-4 && v.n[1] > 0.99);
    expect(up.length).toBeGreaterThan(0);
    for (const v of up) expect(v.c[0]).toBeCloseTo(t.r * outdoorLight([0, 1, 0]), 4);
  });

  test('el piso del patio del McDonald\'s, también; el del salón, horneado (mucho más oscuro sin la exposición de adentro)', () => {
    const patio = mcd.patios[0];
    const inPatio = (p: Vec3): boolean => {
      let c = false;
      for (let a = 0, b = patio.length - 1; a < patio.length; b = a++) {
        const [pa, pb] = [patio[a], patio[b]];
        if ((pa[1] > p[2]) !== (pb[1] > p[2]) && p[0] < ((pb[0] - pa[0]) * (p[2] - pa[1])) / (pb[1] - pa[1]) + pa[0]) c = !c;
      }
      return c;
    };
    const all = vertices(mcd, (n) => n.startsWith('in_') && n !== 'in_vidrio' && n !== 'in_luz' && n !== 'in_mueble');
    const floor = all.filter((v) => v.n[1] > 0.99 && v.p[1] < 0.05 && inPatio(v.p));
    expect(floor.length).toBeGreaterThan(0);
    const lum = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(Math.min(...floor.map((v) => lum(v.c)))).toBeGreaterThan(0.2);
  });

  test('en el patio y en la terraza la cámara no está adentro (exposición de afuera); en el salón, sí. En el patio se dibuja el McDonald\'s', () => {
    const views = createInteriorViews([mcd, ven], fake, 'alta', new Map());
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.15, 1000);
    cam.rotation.order = 'YXZ';
    const at = (p: Vec3, yaw = 0): void => {
      cam.position.set(p[0], p[1] + 1.65, p[2]);
      cam.rotation.set(0, yaw, 0);
      cam.updateMatrixWorld();
      views.update(cam);
    };
    at(mcd.marks.patio);
    expect(views.drawn()).toEqual(['mcdonalds']);
    expect(views.inside()).toBe(false);
    at(mcd.marks.salon);
    expect(views.inside()).toBe(true);
    at(ven.marks.terraza);
    expect(views.inside()).toBe(false);
    at(ven.marks.salon);
    expect(views.inside()).toBe(true);
    views.dispose();
  });
});

describe('los carteles de afuera', () => {
  test('van de su alto: la "M" de la torre, alta; los de los toldos, bajos (Sign.height)', () => {
    const m = exteriorSigns(mcd).filter((s) => s.text === 'M');
    expect(m.length).toBeGreaterThan(0);
    for (const s of m) expect(s.height ?? 0).toBeGreaterThanOrEqual(1.2);
    const toldos = exteriorSigns(ven).filter((s) => s.text === 'La Veneciana');
    expect(toldos.length).toBeGreaterThanOrEqual(2);
    for (const s of toldos) expect(s.height ?? 1).toBeLessThanOrEqual(0.5);
    for (const [i, s] of [...mcd.labels, ...ven.labels].filter((l) => l.out).map((l) => [l, exteriorSigns(l.text === 'M' || l.text === "McDonald's" ? mcd : ven).find((x) => x.text === l.text && x.anchor[0] === l.at[0])!] as const)) {
      expect(s.height).toBe(i.height);
      expect(s.bottomY).toBeCloseTo(i.at[1] - i.height / 2, 6);
    }
  });

  test('buildSigns arma cada cartel de su alto', () => {
    const g = buildSigns([], [{ text: 'M', anchor: [0, 0], normal: [0, 1], width: 1.6, bottomY: 4, height: 1.5, look: { fondo: '#2e2e30', letra: '#ffc72c', marco: '#2e2e30', fuente: 'redondeada' } }]);
    const mesh = g.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    expect(bb.max.y - bb.min.y).toBeCloseTo(1.5, 5);
    expect(bb.min.y).toBeCloseTo(4, 5);
  });
});
