// @vitest-environment jsdom
// El McDonald's y La Veneciana (tarea 8) dibujados: los muebles nuevos (del tamaño de su caja, los que brillan), los
// colores de lo que brilla como se ven adentro (aces.ts, a INDOOR_EXPOSURE), lo que está al aire libre (la terraza, el
// patio y la vereda) con la luz de afuera en vez de la horneada, la exposición de afuera en el patio y en la terraza, y
// los carteles `out` de su alto (la "M" de la torre, los de los toldos).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { OUTDOOR_EXPOSURE } from '../../src/client/render/exposure.ts';
import { SUN_DIR } from '../../src/client/render/sun.ts';
import { lightAt, outdoorLight } from '../../src/client/world/interiors/bake.ts';
import { INTERIOR_EXPOSURE, buildInterior3D } from '../../src/client/world/interiors/build.ts';
import { exteriorSigns } from '../../src/client/world/interiors/exterior.ts';
import { ITEM_GLOW, ITEM_MODELS } from '../../src/client/world/interiors/models.ts';
import { PHOTO_LUMA, photoBlend } from '../../src/client/world/interiors/textures.ts';
import { createInteriorViews } from '../../src/client/world/interiors/view.ts';
import { buildSigns, signTexture } from '../../src/client/world/signs.ts';
import { tintColor } from '../../src/client/world/wall-kit.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { CollisionWorld, interiorPrisms } from '../../src/shared/collision.ts';
import { distPointSegment, pointInPolygon, toLocal, toWorld } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import { interiorOf } from '../../src/shared/interiors/index.ts';
import { GROUND_Y, MODEL_BOX } from '../../src/shared/interiors/kit.ts';
import type { Block, ItemModel, Look } from '../../src/shared/interiors/types.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { deltaE, hexRGB, linear, seen, seenLinear } from './aces.ts';
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

describe("el cielorraso del McDonald's", () => {
  const frame = map.interiors.find((x) => x.placeId === 'mcdonalds')!.frame;
  /** El salón (marco local: U a lo largo del frente, V hacia adentro), del frente hasta el mostrador. */
  const SALON = { u0: 0.2, u1: 13.0, v0: 0.2, v1: 10.8 } as const;
  const inSalon = (p: Vec2): boolean => {
    const [u, v] = toLocal(frame, p);
    return u > SALON.u0 && u < SALON.u1 && v > SALON.v0 && v < SALON.v1;
  };
  /** Lo que se ve mirando para arriba en `p`: la cara de abajo más baja entre las del cielorraso (de 2,5 m para arriba). */
  const ceilingAt = (p: Vec2): Block | undefined =>
    mcd.blocks.filter((x) => x.bottom && x.y0 > 2.5 && pointInPolygon(p, x.polygon)).sort((a, c) => a.y0 - c.y0)[0];
  /** Cómo se ve adentro un look `liso` del cielorraso con la luz horneada `light`: la textura es la CC0 aclarada a
   *  PHOTO_LUMA.liso (sRGB; en lineal, su promedio). */
  const looks = (look: Look, light: number): RGB => seen(look.color, light * INTERIOR_EXPOSURE * linear(PHOTO_LUMA.liso));

  test('las placas oscuras se leen (luma 35–80 en la vista salon, a INDOOR_EXPOSURE), con la junta que se distingue y los spots', () => {
    expect(mcd.views.some((x) => x.id === 'salon')).toBe(true);
    // lo que se ve desde la vista salon: el cielorraso de todo el salón, del frente al mostrador, cada 0,6 m
    const hits: { look: Look; light: number }[] = [];
    for (let u = SALON.u0 + 0.4; u < SALON.u1; u += 0.6) for (let v = SALON.v0 + 1.2; v < SALON.v1; v += 0.6) {
      const p = toWorld(frame, [u, v]), c = ceilingAt(p);
      if (!c || c.bottom!.mat === 'luz') continue;
      hits.push({ look: c.bottom!, light: lightAt(mcd, [p[0], c.y0 - 0.002, p[1]], [0, -1, 0]) });
    }
    // las placas: lo que más se ve
    const n = new Map<string, number>();
    for (const h of hits) n.set(h.look.color, (n.get(h.look.color) ?? 0) + 1);
    const placas = [...n].sort((a, c) => c[1] - a[1])[0][0];
    const plates = hits.filter((h) => h.look.color === placas), look = plates[0].look;
    expect(look.mat, 'las placas: un material que ya existe (liso)').toBe('liso');
    const avg = plates.reduce((t, h) => t + h.light, 0) / plates.length;
    const p = looks(look, avg);
    expect(luma(p), `${look.color} con luz ${avg.toFixed(2)} se ve ${fmt(p)}`).toBeGreaterThanOrEqual(35);
    expect(luma(p), `${look.color} con luz ${avg.toFixed(2)} se ve ${fmt(p)}`).toBeLessThanOrEqual(80);
    // la junta: perfiles finos (≤ 5 cm) bajo el cielorraso del salón (bloques o paños), en las dos direcciones, que se
    // distinguen de las placas
    const top = Math.min(...mcd.blocks.filter((x) => x.bottom?.color === placas && x.y0 > 2.5).map((x) => x.y0));
    const near = (y: number): boolean => y > top - 0.03 && y < top;
    const pieces = [
      ...mcd.blocks.filter((x) => x.collide === 'none' && x.bottom && near(x.y0)).map((x) => ({ look: x.bottom!, q: x.polygon })),
      ...mcd.panes.filter((x) => x.normal[1] < -0.99 && x.corners.every((c) => near(c[1]))).map((x) => ({ look: x.look, q: x.corners.map((c): Vec2 => [c[0], c[2]]) })),
    ].filter((x) => x.look.mat !== 'luz' && x.look.color !== placas && x.q.every(inSalon));
    // cada junta, por su recta: a lo largo de U (fina en V) o de V (fina en U), con su largo total
    const lines = new Map<string, number>();
    for (const x of pieces) {
      const q = x.q.map((c) => toLocal(frame, c)), us = q.map((c) => c[0]), vs = q.map((c) => c[1]);
      const [du, dv] = [Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)];
      const key = dv <= 0.05 ? `U ${(Math.min(...vs) + dv / 2).toFixed(2)}` : du <= 0.05 ? `V ${(Math.min(...us) + du / 2).toFixed(2)}` : null;
      if (key) lines.set(key, (lines.get(key) ?? 0) + Math.max(du, dv));
      const j = looks(x.look, avg);
      expect(Math.abs(luma(j) - luma(p)), `la junta ${x.look.color} se ve ${fmt(j)}; las placas, ${fmt(p)}`).toBeGreaterThanOrEqual(15);
    }
    const long = [...lines].filter(([, l]) => l > 3).map(([key]) => key[0]);
    expect(long.filter((d) => d === 'U').length, 'juntas a lo largo de U').toBeGreaterThanOrEqual(8);
    expect(long.filter((d) => d === 'V').length, 'juntas a lo largo de V').toBeGreaterThanOrEqual(8);
    // y los spots, que brillan
    expect(mcd.blocks.filter((x) => x.bottom?.mat === 'luz' && x.y0 > 2.5 && inSalon(x.polygon[0])).length).toBeGreaterThanOrEqual(12);
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
    // al sol o a la sombra (de sus propias paredes), siempre la luz de afuera: la del cielo por lo menos
    const mid = (r: Vec2[]): Vec3 => [r.reduce((a, q) => a + q[0], 0) / r.length, 0, r.reduce((a, q) => a + q[1], 0) / r.length];
    const tile = mcd.blocks.find((x) => x.top?.mat === 'baldosa' && Math.abs(x.y1 - GROUND_Y) < 1e-6 && inPatio(mid(x.polygon)))!;
    const t = tintColor(tile.top!.color).r;
    for (const v of floor) {
      const k = v.c[0] / t;
      expect(Math.min(Math.abs(k - outdoorLight([0, 1, 0])), Math.abs(k - outdoorLight([0, 1, 0], false))), `en ${fmt(v.p.map((x) => Math.round(x * 100)) as RGB)}: ${k.toFixed(3)}`).toBeLessThan(1e-4);
    }
  });

  /** El patio del McDonald's (mundo) y si un punto cae adentro. */
  const patio = mcd.patios[0];
  const inPatioXZ = (p: Vec3): boolean => pointInPolygon([p[0], p[2]], patio);
  const lumL = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  /** El promedio de la foto CC0 del ladrillo (public/textures/ladrillo_diff.jpg, a 16 × 16 con sips): ya es rojiza. */
  const FOTO: RGB = [99.7, 74.0, 59.3];
  const blend = photoBlend((0.2126 * FOTO[0] + 0.7152 * FOTO[1] + 0.0722 * FOTO[2]) / 255, PHOTO_LUMA.ladrillo);
  /** La foto aclarada, lineal: lo que la textura le multiplica en promedio al color por vértice. */
  const tex = FOTO.map((x) => linear((x * (1 - blend) + 255 * blend) / 255)) as Vec3;
  /** Que un ladrillo al sol se lea ladrillo y no bordó (ni salmón): R > G > B, G ≥ 0,45 · R y no oscuro. */
  const isBrick = (c: RGB): void => {
    expect(c[0], `se ve ${fmt(c)}`).toBeGreaterThan(c[1]);
    expect(c[1], `se ve ${fmt(c)}`).toBeGreaterThan(c[2]);
    expect(c[1] / c[0], `se ve ${fmt(c)}: G / R`).toBeGreaterThanOrEqual(0.45);
    expect(luma(c), `se ve ${fmt(c)}`).toBeGreaterThan(60);
  };

  test('el ladrillo del patio al sol se ve ladrillo, no bordó: R > G > B y G ≥ 0,45 · R (la foto ya trae el rojo)', () => {
    // las caras de las paredes; la más clara es la que da al sol
    const walls = vertices(mcd, (n) => n === 'in_ladrillo').filter((v) => Math.abs(v.n[1]) < 0.1 && inPatioXZ(v.p));
    expect(walls.length).toBeGreaterThan(0);
    const sol = walls.reduce((best, v) => (lumL(v.c) > lumL(best.c) ? v : best));
    isBrick(seenLinear(sol.c.map((x, k) => x * tex[k]) as RGB, OUTDOOR_EXPOSURE));
  });

  test('en baja (nivel 3, sin textura) el ladrillo lleva en el color por vértice el tono medio de su foto: se ve como en alta', () => {
    const tone = new THREE.Texture();
    tone.userData.tone = tex;
    const toned = { ...fake, in_ladrillo: new THREE.MeshBasicMaterial({ name: 'in_ladrillo', map: tone }) } as WorldMaterials;
    const colors = (mats: WorldMaterials): THREE.BufferAttribute => {
      const { group } = buildInterior3D({ ...mcd }, mats, 'baja');
      expect(group.userData.level, 'el McDonald\'s en baja se compacta al nivel 3').toBe(3);
      // la malla sin textura de cada parte (el edificio y el patio), una detrás de la otra
      const flats: THREE.Mesh[] = [];
      group.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o.name === 'in_mueble') flats.push(o); });
      expect(flats).toHaveLength(2);
      return new THREE.BufferAttribute(new Float32Array(flats.flatMap((f) => [...(f.geometry.getAttribute('color').array as Float32Array)])), 3);
    };
    const [plain, withTone] = [colors(fake), colors(toned)];
    expect(withTone.count).toBe(plain.count);
    const changed: number[] = [];
    for (let k = 0; k < plain.count; k++) if ([0, 1, 2].some((c) => Math.abs(withTone.getComponent(k, c) - plain.getComponent(k, c)) > 1e-6)) changed.push(k);
    expect(changed.length, 'vértices con el tono de la foto').toBeGreaterThan(0);
    for (const k of changed) for (const c of [0, 1, 2]) expect(withTone.getComponent(k, c)).toBeCloseTo(plain.getComponent(k, c) * tex[c], 5);
    const sol = changed.reduce((best, k) => (lumL([0, 1, 2].map((c) => withTone.getComponent(k, c)) as Vec3) > lumL([0, 1, 2].map((c) => withTone.getComponent(best, c)) as Vec3) ? k : best));
    isBrick(seenLinear([0, 1, 2].map((c) => withTone.getComponent(sol, c)) as RGB, OUTDOOR_EXPOSURE));
  });

  test('el sol: lo que el propio interior le tapa al piso del patio respecto de SUN_DIR (la pared de ladrillo, el local) queda a la sombra', () => {
    const sun: Vec3 = [SUN_DIR.x, SUN_DIR.y, SUN_DIR.z];
    // lo macizo del interior sin las cajas de los muebles (son gruesas: la sombra de los muebles queda para la T11)
    const own = new CollisionWorld(interiorPrisms({ ...mcd, blocks: mcd.blocks.filter((x) => x.role !== 'mueble') }), [], map.bounds);
    const toRing = (p: Vec3): number => Math.min(...patio.map((q, k) => distPointSegment([p[0], p[2]], q, patio[(k + 1) % patio.length])));
    // el piso a la vista: fuera de las paredes (0,2 m adentro del borde)
    const floor = vertices(mcd, (n) => n === 'in_baldosa').filter((v) => v.n[1] > 0.99 && v.p[1] < 0.05 && inPatioXZ(v.p) && toRing(v.p) > 0.25);
    const shade = floor.filter((v) => own.raycast([v.p[0], v.p[1] + 0.05, v.p[2]], sun, 100, true) !== null);
    const lit = floor.filter((v) => !shade.includes(v));
    expect(shade.length / floor.length, `${shade.length} de ${floor.length} a la sombra`).toBeGreaterThan(0.15);
    expect(lit.length).toBeGreaterThan(0);
    const dark = Math.max(...shade.map((v) => lumL(v.c))), light = Math.min(...lit.map((v) => lumL(v.c)));
    expect(dark, `a la sombra ${dark.toFixed(3)}; al sol ${light.toFixed(3)}`).toBeLessThan(0.6 * light);
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

  test('los toldos de La Veneciana, con letra script: fuentes del sistema (Snell Roundhand…) y sin el genérico cursive', () => {
    const l = ven.labels.find((x) => x.out && x.text === 'La Veneciana')!;
    const fonts: string[] = [];
    stubCanvas((prop, value) => { if (prop === 'font') fonts.push(String(value)); });
    signTexture(l.text, l.look, l.width, l.height);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) {
      expect(f).toMatch(/"Snell Roundhand"/);
      // en Windows, cursive es la Comic Sans
      expect(f).not.toMatch(/\bcursive\b/);
      expect(f, 'la script ya va inclinada').not.toMatch(/^italic/);
      expect(f, 'si no hay ninguna, una serif').toMatch(/, serif$/);
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
