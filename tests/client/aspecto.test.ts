// @vitest-environment jsdom
// El aspecto de los interiores (tarea 11c): el tono de las texturas en baja, las juntas sin brillos, la exposición de
// adentro y de afuera, la banda esmerilada de los bancos, las butacas, los techos y el horneado de afuera.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { INDOOR_EXPOSURE, INDOOR_GAIN, interiorGain, OUTDOOR_EXPOSURE } from '../../src/client/render/exposure.ts';
import { BALDOSA_TONO, extrudeBuilding, TECHO_LINEAL } from '../../src/client/world/geometry.ts';
import { SUN_DIR } from '../../src/client/render/sun.ts';
import { lightAt, outdoorLight, outdoorLightAt, outdoorRGB } from '../../src/client/world/interiors/bake.ts';
import { buildInterior3D, INTERIOR_EXPOSURE } from '../../src/client/world/interiors/build.ts';
import { exteriorGeometry, roofCut } from '../../src/client/world/interiors/exterior.ts';
import { FROST_ALPHA } from '../../src/client/world/interiors/glass.ts';
import { ITEM_MODELS } from '../../src/client/world/interiors/models.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { tintColor } from '../../src/client/world/wall-kit.ts';
import { pointInPolygon, signedAreaFromAbove } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import { interiorOf } from '../../src/shared/interiors/index.ts';
import type { Block, Interior, ItemModel, Mat } from '../../src/shared/interiors/types.ts';
import type { Building, MapData } from '../../src/shared/mapdata.ts';
import { hexRGB, linear, seenLinear } from './aces.ts';
import type { RGB } from './aces.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => vi.restoreAllMocks());

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const KEYS = ['in_liso', 'in_porcelanato', 'in_madera', 'in_machimbre', 'in_baldosa', 'in_ceramico', 'in_tela', 'in_metal',
  'in_ladrillo', 'in_vidrio', 'in_luz', 'in_mueble'] as const satisfies readonly InteriorKey[];
const fake = (tones: Partial<Record<Mat, Vec3>> = {}): Pick<WorldMaterials, InteriorKey> => Object.fromEntries(KEYS.map((k) => {
  const tone = tones[k.slice(3) as Mat];
  const map = tone ? Object.assign(new THREE.Texture(), { userData: { tone } }) : null;
  return [k, new THREE.MeshBasicMaterial({ name: k, map })];
})) as unknown as Pick<WorldMaterials, InteriorKey>;

describe('baja: lo que pierde la textura lleva su tono (item 8)', () => {
  /** Los colores por vértice de las mallas sin textura de nivel 3 (in_mueble), una detrás de la otra. */
  const flatColors = (id: string, mats: Pick<WorldMaterials, InteriorKey>): Float32Array => {
    const { group } = buildInterior3D({ ...interiorOf(map, id) }, mats, 'baja');
    expect(group.userData.level, `${id} en baja se compacta al nivel 3`).toBe(3);
    const out: number[] = [];
    group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o.name === 'in_mueble') out.push(...(o.geometry.getAttribute('color').array as Float32Array));
    });
    return new Float32Array(out);
  };

  test.each([['mcdonalds', 'liso'], ['estacion-adrogue', 'liso'], ['la-veneciana', 'ceramico'], ['la-veneciana', 'machimbre'],
    ['guernica-bar', 'metal'], ['guernica-bar', 'porcelanato'], ['mcdonalds', 'ladrillo']] as const)(
    '%s: el %s, sin su textura, se ve con el color medio de la foto (como en alta)', (id, mat) => {
      const tone: Vec3 = [0.6, 0.65, 0.7];
      const [plain, withTone] = [flatColors(id, fake()), flatColors(id, fake({ [mat]: tone }))];
      expect(withTone.length).toBe(plain.length);
      let changed = 0;
      for (let k = 0; k < plain.length; k += 3) {
        if ([0, 1, 2].every((c) => Math.abs(withTone[k + c] - plain[k + c]) < 1e-7)) continue;
        changed++;
        for (const c of [0, 1, 2]) expect(withTone[k + c]).toBeCloseTo(plain[k + c] * tone[c], 6);
      }
      expect(changed, `vértices de ${mat} con el tono de su foto`).toBeGreaterThan(0);
    });
});

/** Los triángulos de costado (normal horizontal) de `gs`, por plano: la recta (normal y distancia, al mm) y, de cada
 *  vértice, su (t, y), con t a lo largo de la recta (la dirección e = (nz, −nx)). */
type Plane = { n: Vec2; tris: [number, number][][] };
const planeKey = (n: Vec2, d: number): string => `${n[0].toFixed(3)},${n[1].toFixed(3)}|${d.toFixed(3)}`;
function sidePlanes(gs: THREE.BufferGeometry[]): Map<string, Plane> {
  const out = new Map<string, Plane>();
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const g of gs) {
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, k) => k);
    for (let k = 0; k < idx.length; k += 3) {
      a.fromBufferAttribute(pos, idx[k]); b.fromBufferAttribute(pos, idx[k + 1]); c.fromBufferAttribute(pos, idx[k + 2]);
      if (new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length() < 1e-9) continue;
      // la normal de la cara (la del atributo: la del triángulo, con vértices en float32, no alcanza para la distancia)
      const nv = new THREE.Vector3().fromBufferAttribute(nor, idx[k]).normalize();
      if (Math.abs(nv.y) > 1e-3) continue;
      const n: Vec2 = [nv.x, nv.z], e: Vec2 = [n[1], -n[0]];
      const key = planeKey(n, a.x * n[0] + a.z * n[1]);
      let pl = out.get(key);
      if (!pl) out.set(key, (pl = { n, tris: [] }));
      pl.tris.push([a, b, c].map((v): [number, number] => [v.x * e[0] + v.z * e[1], v.y]));
    }
  }
  return out;
}

/** Las juntas en T de un plano: un vértice en medio de una arista horizontal o vertical de otro triángulo (las diagonales
 *  quedan adentro de cada cuadrado). Devuelve cuántas hay y la primera. */
function tJunctions(pl: Plane): { count: number; first?: string } {
  const lines = new Map<string, number[]>();
  const edges: { key: string; lo: number; hi: number }[] = [];
  const hKey = (y: number): string => `h${y.toFixed(4)}`, vKey = (t: number): string => `v${t.toFixed(4)}`;
  const push = (k: string, x: number): void => void (lines.get(k) ?? lines.set(k, []).get(k)!).push(x);
  for (const tri of pl.tris) {
    for (const [t, y] of tri) {
      push(hKey(y), t);
      push(vKey(t), y);
    }
    for (let j = 0; j < 3; j++) {
      const [p, q] = [tri[j], tri[(j + 1) % 3]];
      if (Math.abs(p[1] - q[1]) < 1e-6) edges.push({ key: hKey(p[1]), lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]) });
      else if (Math.abs(p[0] - q[0]) < 1e-6) edges.push({ key: vKey(p[0]), lo: Math.min(p[1], q[1]), hi: Math.max(p[1], q[1]) });
    }
  }
  let count = 0, first: string | undefined;
  for (const { key, lo, hi } of edges) {
    const x = lines.get(key)!.find((v) => v > lo + 1e-4 && v < hi - 1e-4);
    if (x === undefined) continue;
    count++;
    first ??= `${key}: ${x.toFixed(3)} en (${lo.toFixed(3)}, ${hi.toFixed(3)})`;
  }
  return { count, first };
}

/** ¿Algún triángulo del plano cubre (t, y)? */
const covers = (pl: Plane | undefined, t: number, y: number): boolean => pl !== undefined && pl.tris.some(([p, q, r]) => {
  const s = (a: [number, number], b: [number, number]): number => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (t - a[0]);
  const [d1, d2, d3] = [s(p, q), s(q, r), s(r, p)];
  return !((d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9) && (d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9));
});

const ALL = map.interiors.map((x) => x.placeId);
const geometriesOf = (o: THREE.Object3D): THREE.BufferGeometry[] => {
  const out: THREE.BufferGeometry[] = [];
  o.traverse((m) => { if (m instanceof THREE.Mesh && !(m instanceof THREE.InstancedMesh) && !m.name.startsWith('labels') && m.name !== 'in_vidrio' && m.name !== 'in_mueble') out.push(m.geometry); });
  return out;
};

describe('las juntas, sin brillos (item 4)', () => {
  test.each(ALL)('%s: las paredes se meten en las losas y los techos (no terminan justo en el cielorraso ni en el piso de arriba)', (id) => {
    const i = interiorOf(map, id);
    const planes = sidePlanes(geometriesOf(buildInterior3D({ ...i }, fake(), 'alta').group));
    const bad: string[] = [];
    let seen = 0;
    const opaque = (b: Block): boolean => !b.out && b.role !== 'mueble';
    for (const o of i.blocks.filter(opaque)) {
      const poly = signedAreaFromAbove(o.polygon) > 0 ? o.polygon : [...o.polygon].reverse();
      // el cielorraso (la cara de abajo) y el piso de arriba (la de arriba de una losa), lejos del suelo
      const faces = [...(o.bottom && o.bottom.mat !== 'vidrio' && o.y0 > 0.5 ? [[o.y0, -1] as const] : []), ...(o.top && o.top.mat !== 'vidrio' && o.role === 'losa' && o.y1 > 0.5 ? [[o.y1, 1] as const] : [])];
      for (const [y, side] of faces) {
        poly.forEach((p, k) => {
          const q = poly[(k + 1) % poly.length];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len < 0.3) return;
          const e: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
          // la pared de abajo (o de arriba) de esa arista mira hacia adentro de la losa
          const n: Vec2 = [e[1], -e[0]];
          const pl = planes.get(planeKey(n, p[0] * n[0] + p[1] * n[1]));
          const ew: Vec2 = [n[1], -n[0]];
          for (let f = 0.1; f < 0.95; f += 0.2) {
            const c: Vec2 = [p[0] + e[0] * len * f, p[1] + e[1] * len * f];
            const t = c[0] * ew[0] + c[1] * ew[1];
            // solo donde hay pared contra la losa (5 cm del lado de la sala)
            if (!covers(pl, t, y + side * 0.05)) continue;
            seen++;
            if (!covers(pl, t, y - side * 0.008)) bad.push(`${o.role} y ${y.toFixed(2)} en (${c[0].toFixed(2)}, ${c[1].toFixed(2)})`);
          }
        });
      }
    }
    expect(seen, 'juntas de pared con losa o techo').toBeGreaterThan(0);
    expect(bad, `${bad.length} de ${seen}: ${bad.slice(0, 4).join('; ')}`).toEqual([]);
  });

  // las de los bloques (el kit: paredes, losas, dintels, tabiques); los paños (las varillas de una baranda, los perfiles de
  // una vitrina) van enteros, como antes
  test.each(ALL)('%s: las caras de costado de los bloques de adentro no tienen juntas en T (alta y baja)', (id) => {
    for (const q of ['alta', 'baja'] as const) {
      const planes = sidePlanes(geometriesOf(buildInterior3D({ ...interiorOf(map, id), panes: [] }, fake(), q).group));
      const found = [...planes.entries()].map(([key, pl]) => ({ key, ...tJunctions(pl) })).filter((x) => x.count > 0);
      expect(found.length, `${q}: ${found.reduce((s, x) => s + x.count, 0)} juntas en T; ${found.slice(0, 3).map((x) => `${x.key} ${x.first}`).join(' · ')}`).toBe(0);
    }
  });

  test.each(ALL)('%s: las paredes de su edificio (con las aberturas) y el pretil no tienen juntas en T', (id) => {
    const it = map.interiors.find((x) => x.placeId === id)!;
    const bd = map.buildings.find((x) => x.id === it.buildingId)!;
    const e = extrudeBuilding(bd, it.openings, roofCut(interiorOf(map, id)));
    const gs = [e.walls.ground, e.walls.upper, e.walls.front, ...e.walls.overrides.map((o) => o.geometry), e.parapet];
    const planes = sidePlanes(gs);
    const found = [...planes.entries()].map(([key, pl]) => ({ key, ...tJunctions(pl) })).filter((x) => x.count > 0);
    expect(found.length, `${found.reduce((s, x) => s + x.count, 0)} juntas en T; ${found.slice(0, 3).map((x) => `${x.key} ${x.first}`).join(' · ')}`).toBe(0);
  });

  test('la estación: el canto del vidrio oscuro de las ventanas de afuera no asoma del marco (la línea punteada del costado)', () => {
    const i = interiorOf(map, 'estacion-adrogue');
    const out = i.blocks.filter((b) => b.out);
    const vidrios = out.filter((b) => b.side?.color === '#3d4b55'), marcos = out.filter((b) => b.side?.color === '#e8e3d4');
    expect(vidrios.length).toBeGreaterThan(0);
    const tapado = (p: Vec2, y: number): boolean => marcos.some((m) => m.y0 <= y && m.y1 >= y && pointInPolygon(p, m.polygon));
    const asoman: string[] = [];
    for (const v of vidrios) {
      const c = v.polygon.reduce((s, p): Vec2 => [s[0] + p[0] / v.polygon.length, s[1] + p[1] / v.polygon.length], [0, 0]);
      v.polygon.forEach((p, k) => {
        const q = v.polygon[(k + 1) % v.polygon.length];
        if (v.hide?.includes(k) || Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.03) return; // los cantos que se dibujan (2 cm)
        const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const d = Math.hypot(mid[0] - c[0], mid[1] - c[1]);
        const at: Vec2 = [mid[0] + (mid[0] - c[0]) / d * 0.001, mid[1] + (mid[1] - c[1]) / d * 0.001];
        for (const y of [v.y0 + 0.01, (v.y0 + v.y1) / 2, v.y1 - 0.01]) if (!tapado(at, y)) asoman.push(`canto en (${at.map((x) => x.toFixed(2))}) a ${y.toFixed(2)}`);
      });
      if (v.top && !tapado(c, v.y1 + 0.001)) asoman.push(`arriba en (${c.map((x) => x.toFixed(2))}) a ${v.y1.toFixed(2)}`);
    }
    expect(asoman, asoman.slice(0, 3).join('; ')).toEqual([]);
  });
});

const luma = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** El tono (lineal) que la textura le da al color: el liso, la foto aclarada a 0,85 de luma (PHOTO_LUMA). */
const LISO = linear(0.85);
/** La luma con que se ve `hex` horneado con luz `L` y una textura de tono `tone`: adentro, ya adaptado (la exposición de
 *  adentro por la ganancia de lo horneado), o desde la calle (la de afuera, sin ganancia). */
const adentro = (hex: string, L: number, tone = LISO): number =>
  luma(seenLinear(hexRGB(hex).map((x) => linear(x / 255) * tone * L * INTERIOR_EXPOSURE * INDOOR_GAIN) as RGB, INDOOR_EXPOSURE));
const afuera = (hex: string, L: number, tone = LISO): number =>
  luma(seenLinear(hexRGB(hex).map((x) => linear(x / 255) * tone * L * INTERIOR_EXPOSURE) as RGB, OUTDOOR_EXPOSURE));
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** La luz horneada de las caras de adentro de las paredes de `i` (bloques con costado `color`, o liso y claro) a la altura
 *  `y`, cada 1 m: las que dan a la sala (a 0,3 m de la cara, adentro de la planta) y no tapa otro bloque. */
function wallLights(i: Interior, y: number, which: (b: Block) => boolean): number[] {
  const solid = i.blocks.filter((o) => !o.out && o.role !== 'mueble' && o.side && o.side.mat !== 'vidrio');
  const out: number[] = [];
  for (const b of i.blocks.filter((x) => !x.out && x.side && which(x) && x.y0 <= y && x.y1 >= y)) {
    const poly = signedAreaFromAbove(b.polygon) > 0 ? b.polygon : [...b.polygon].reverse();
    poly.forEach((p, k) => {
      const q = poly[(k + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const e: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len], n: Vec2 = [-e[1], e[0]];
      for (let s = 0.5; s < len; s += 1) {
        const at: Vec2 = [p[0] + e[0] * s, p[1] + e[1] * s];
        const room: Vec2 = [at[0] + n[0] * 0.3, at[1] + n[1] * 0.3], touch: Vec2 = [at[0] + n[0] * 0.03, at[1] + n[1] * 0.03];
        if (!pointInPolygon(room, i.footprint) || solid.some((o) => o !== b && o.y0 <= y && o.y1 >= y && pointInPolygon(touch, o.polygon))) continue;
        out.push(lightAt(i, [at[0] + n[0] * 0.01, y, at[1] + n[1] * 0.01], [n[0], 0, n[1]]));
      }
    });
  }
  return out;
}
const PARED_BANCO = '#f1f0ec';
const BANCOS = ['banco-nacion', 'galicia', 'bbva'] as const;

describe('la exposición de adentro y la de afuera (items 1, 1b y 2)', () => {
  test('la ganancia de lo horneado va de 1 (afuera) a INDOOR_GAIN (adentro, adaptado), sin saltos', () => {
    expect(interiorGain(OUTDOOR_EXPOSURE)).toBeCloseTo(1, 9);
    expect(interiorGain(INDOOR_EXPOSURE)).toBeCloseTo(INDOOR_GAIN, 9);
    expect(INDOOR_GAIN).toBeGreaterThan(1);
    let last = 1;
    for (let e = OUTDOOR_EXPOSURE; e <= INDOOR_EXPOSURE + 1e-9; e += 0.05) {
      const g = interiorGain(e);
      expect(g).toBeGreaterThanOrEqual(last - 1e-9);
      expect(g / last).toBeLessThan(1.06); // como un paso del ojo (0,05 de exposición a 0,7 es ×1,07)
      last = g;
    }
  });

  test.each(BANCOS)('%s: la pared blanca, adentro y adaptado, se lee 215–230 (la luz mediana de sus paredes a 1,5 m)', (id) => {
    const i = interiorOf(map, id);
    const L = median(wallLights(i, 1.5, (b) => b.side!.mat === 'liso' && b.side!.color === PARED_BANCO));
    const v = adentro(PARED_BANCO, L);
    expect(v, `luz ${L.toFixed(2)}: se lee ${v.toFixed(0)}`).toBeGreaterThanOrEqual(215);
    expect(v, `luz ${L.toFixed(2)}: se lee ${v.toFixed(0)}`).toBeLessThanOrEqual(230);
  });

  test.each([...BANCOS, 'casa-de-la-cultura'])('%s: desde la vereda, la pared de adentro por el vidrio queda en la planta baja de la foto (≤ 50 con el reflejo) y se lee (≥ 25)', (id) => {
    const i = interiorOf(map, id);
    const Ls = wallLights(i, 1.5, (b) => b.side!.mat === 'liso' && luma(hexRGB(b.side!.color)) > 200);
    // el vidrio de frente: el 8 % es el reflejo del cielo (glass.ts: GLASS_F0, GLASS_SKY) a la exposición de afuera
    const sky = luma(seenLinear(hexRGB('#a9bfcf').map((x) => linear(x / 255)) as RGB, OUTDOOR_EXPOSURE));
    const through = (L: number): number => 0.92 * afuera('#f1f0ec', L) + 0.08 * sky;
    const [mid, top] = [through(median(Ls)), through(Math.max(...Ls))];
    expect(mid, `la mediana se ve ${mid.toFixed(0)}`).toBeGreaterThanOrEqual(25);
    expect(top, `la más iluminada se ve ${top.toFixed(0)}`).toBeLessThanOrEqual(50);
  });

  test('el Guernica, adentro: el piso, la barra, las mesas y el ladrillo se leen (luma media ≥ 70, cada uno ≥ 35: la tapa es madera oscura) y queda más en penumbra que un local blanco', () => {
    const i = interiorOf(map, 'guernica-bar');
    const y0 = i.floors[0].y + 0.02;
    const solidAt = (p: Vec2, lo: number, hi: number): boolean => i.blocks.some((b) => !b.out && b.collide === 'solid' && b.y0 < hi && b.y1 > lo && pointInPolygon(p, b.polygon));
    const xs = i.footprint.map((p) => p[0]), zs = i.footprint.map((p) => p[1]);
    const piso: number[] = [];
    for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) {
      for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) {
        if (pointInPolygon([x, z], i.footprint) && !solidAt([x, z], 0.05, 0.5)) piso.push(adentro('#6e6a66', lightAt(i, [x, y0, z], [0, 1, 0]), linear(0.85)));
      }
    }
    // la tapa de la barra (la madera de arriba, a ~1,1 m), las mesas de la planta baja y el ladrillo a 1,5 m
    const tapa = i.blocks.find((b) => b.role === 'otro' && b.top?.mat === 'madera' && b.y1 > 1 && b.y1 < 1.2 && b.collide === 'none')!;
    const tx = tapa.polygon.map((p) => p[0]), tz = tapa.polygon.map((p) => p[1]);
    const barra: number[] = [];
    for (let f = 0.05; f < 1; f += 0.1) {
      const p: Vec2 = [tx[0] + (tx[2] - tx[0]) * f, tz[0] + (tz[2] - tz[0]) * f];
      barra.push(adentro(tapa.top!.color, lightAt(i, [p[0], tapa.y1, p[1]], [0, 1, 0]), linear(0.85)));
    }
    const mesas = i.items.filter((it) => it.model === 'mesa' && it.at[1] < 1).map((it) => adentro(it.color ?? '#ffffff', lightAt(i, [it.at[0], it.at[1] + 0.8, it.at[2]], [0, 1, 0]), linear(0.85)));
    const ladrillo = wallLights(i, 1.5, (b) => b.side!.mat === 'ladrillo').map((L) => adentro('#ffc2a8', L, linear(0.55)));
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const parts = { piso, barra, mesas, ladrillo };
    const say = Object.entries(parts).map(([k, v]) => `${k} ${mean(v).toFixed(0)} (${v.length})`).join(', ');
    for (const [k, v] of Object.entries(parts)) {
      expect(v.length, k).toBeGreaterThan(0);
      expect(mean(v), `${k}: ${say}`).toBeGreaterThanOrEqual(35);
    }
    const all = mean(Object.values(parts).map(mean));
    expect(all, say).toBeGreaterThanOrEqual(70);
    const banco = adentro(PARED_BANCO, median(wallLights(interiorOf(map, 'banco-nacion'), 1.5, (b) => b.side!.color === PARED_BANCO)));
    expect(all, `${say}; la pared del Nación ${banco.toFixed(0)}`).toBeLessThanOrEqual(banco - 60);
  });
});

describe('la banda esmerilada de los bancos (item 3)', () => {
  /** Los bloques de la banda: el vinilo esmerilado sobre los paños de la pared de vidrio, de 1,02 a 1,10 m. */
  const bandOf = (i: Interior): Block[] => i.blocks.filter((b) => b.side?.esmerilado === true);

  test.each(BANCOS)('%s: es un vidrio esmerilado: rol vidrio y sin colisión, así que no suma oclusión al horneado', (id) => {
    const i = interiorOf(map, id);
    const band = bandOf(i);
    expect(band.length).toBeGreaterThan(0);
    for (const b of band) {
      expect([b.role, b.collide, b.side!.mat]).toEqual(['vidrio', 'none', 'vidrio']);
      expect(b.y0).toBeGreaterThan(1);
      expect(b.y1).toBeLessThan(1.15);
    }
    // la luz justo arriba y abajo de la banda, sobre el vidrio, es la misma que sin la banda
    const sin = { ...i, blocks: i.blocks.filter((b) => !band.includes(b)) };
    for (const b of band.slice(0, 4)) {
      const c = b.polygon.reduce((s, p): Vec2 => [s[0] + p[0] / b.polygon.length, s[1] + p[1] / b.polygon.length], [0, 0]);
      const [p, q] = [b.polygon[0], b.polygon[1]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n: Vec3 = len > 0.1 ? [-(q[1] - p[1]) / len, 0, (q[0] - p[0]) / len] : [-(b.polygon[2][1] - q[1]), 0, b.polygon[2][0] - q[0]];
      for (const y of [b.y0 - 0.04, b.y1 + 0.04]) {
        const at: Vec3 = [c[0] + n[0] * 0.05, y, c[1] + n[2] * 0.05];
        expect(lightAt(i, at, n), `${id} a ${y.toFixed(2)} m`).toBeCloseTo(lightAt(sin, at, n), 6);
      }
    }
  });

  test.each(BANCOS)('%s: se ve blanquecina y translúcida: adentro, como una pared blanca; desde la vereda, sin brillar', (id) => {
    const i = interiorOf(map, id);
    const meshes: THREE.Mesh[] = [];
    buildInterior3D({ ...i }, fake(), 'alta').group.traverse((o) => { if (o instanceof THREE.Mesh && o.name === 'in_vidrio') meshes.push(o); });
    expect(meshes.length).toBe(1);
    // en in_vidrio (no suma mallas): el lado de la cara en r y, en b, la luz que deja pasar (negativa: la marca del esmerilado)
    const col = meshes[0].geometry.getAttribute('color');
    const frost: number[] = [];
    for (let k = 0; k < col.count; k++) if (col.getZ(k) < 0) frost.push(-col.getZ(k));
    expect(frost.length).toBeGreaterThanOrEqual(bandOf(i).length * 8);
    const v = median(frost);
    const adentroV = luma(seenLinear([v, v, v].map((x) => x * INDOOR_GAIN) as RGB, INDOOR_EXPOSURE));
    const afueraV = luma(seenLinear([v, v, v], OUTDOOR_EXPOSURE));
    expect(adentroV, `adentro se lee ${adentroV.toFixed(0)}`).toBeGreaterThanOrEqual(205);
    expect(adentroV, `adentro se lee ${adentroV.toFixed(0)}`).toBeLessThanOrEqual(240);
    expect(afueraV, `desde la vereda se lee ${afueraV.toFixed(0)}`).toBeLessThanOrEqual(60);
    // translúcida: deja ver algo de atrás (no es opaca) pero no deja ver (casi toda la luz es la suya)
    expect(FROST_ALPHA).toBeGreaterThanOrEqual(0.75);
    expect(FROST_ALPHA).toBeLessThan(0.95);
  });
});

describe('las butacas (item 7)', () => {
  /** Los vértices de un modelo con su color (lineal) y su posición. */
  const parts = (m: ItemModel): { p: Vec3; c: Vec3 }[] => {
    const g = ITEM_MODELS[m](), pos = g.getAttribute('position'), col = g.getAttribute('color');
    return Array.from({ length: pos.count }, (_, k) => ({ p: [pos.getX(k), pos.getY(k), pos.getZ(k)] as Vec3, c: [col.getX(k), col.getY(k), col.getZ(k)] as Vec3 }));
  };
  const lum = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const SEATS = [['butaca', 0.55], ['silla-auditorio', 0.55]] as const;

  test.each(SEATS)('%s: entre el asiento y el respaldo hay una ranura oscura', (m) => {
    const vs = parts(m);
    // la tela: la del respaldo (lo más alto); el asiento, su cara de arriba; el respaldo, lo que sube más de 0,2 m
    const tela = vs.reduce((a, v) => (v.p[1] > a.p[1] ? v : a)).c.join();
    const cloth = vs.filter((v) => v.c.join() === tela);
    const top = Math.max(...cloth.filter((v) => v.p[2] > 0).map((v) => v.p[1]));
    const front = Math.max(...cloth.filter((v) => v.p[1] > top + 0.2).map((v) => v.p[2]));
    const slot = vs.filter((v) => lum(v.c) < 0.01 && v.p[1] <= top + 1e-6 && v.p[1] > top - 0.2 && v.p[2] > front - 0.03 && v.p[2] < front + 0.06);
    expect(slot.length, `${m}: asiento a ${top.toFixed(2)} m, respaldo con el frente en z ${front.toFixed(2)}`).toBeGreaterThanOrEqual(8);
    // y la ranura queda un poco más baja que el asiento: se ve como un hueco, no como una raya pintada arriba
    expect(Math.max(...slot.map((v) => v.p[1]))).toBeLessThan(top - 0.005);
  });

  test.each(SEATS)('%s: cada butaca lleva medio costado de cada lado, así que la fila termina con costado en las dos puntas', (m, w) => {
    const vs = parts(m);
    const frame = vs.filter((v) => Math.abs(v.p[0]) > w / 2 - 0.06);
    const [lo, hi] = [Math.min(...vs.map((v) => v.p[0])), Math.max(...vs.map((v) => v.p[0]))];
    expect(lo).toBeCloseTo(-w / 2, 3);
    expect(hi).toBeCloseTo(w / 2, 3);
    // el costado de −x y el de +x: del mismo color y del mismo alto
    const side = (s: number): { p: Vec3; c: Vec3 }[] => frame.filter((v) => Math.sign(v.p[0]) === s);
    expect(side(-1).length).toBeGreaterThan(0);
    expect(side(1).length).toBe(side(-1).length);
    expect(Math.max(...side(1).map((v) => v.p[1]))).toBeCloseTo(Math.max(...side(-1).map((v) => v.p[1])), 6);
  });

  test.each(SEATS)('%s: 60 triángulos o menos (cinco cajas)', (m) => {
    const g = ITEM_MODELS[m]();
    expect((g.index ? g.index.count : g.getAttribute('position').count) / 3).toBeLessThanOrEqual(60);
  });
});

describe('lo de afuera, de cerca (items 7b y 7c)', () => {
  /** Los vértices de exteriorGeometry de `i` adentro de `poly` (con 1 cm de margen) y entre y0 e y1. */
  function verts(i: Interior, poly: Vec2[], y0: number, y1: number): { p: Vec3; n: Vec3; uv: [number, number]; c: Vec3 }[] {
    const H = map.buildings.find((b) => b.id === i.buildingId)!.height;
    const g = exteriorGeometry(i, H), [pos, nor, uv, col] = ['position', 'normal', 'uv', 'color'].map((a) => g.getAttribute(a));
    const near = (q: Vec2): boolean => pointInPolygon(q, poly) || poly.some((a, k) => {
      const b = poly[(k + 1) % poly.length], [dx, dz] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(q[0] - a[0] - dx * t, q[1] - a[1] - dz * t) < 0.01;
    });
    const out: { p: Vec3; n: Vec3; uv: [number, number]; c: Vec3 }[] = [];
    for (let k = 0; k < pos.count; k++) {
      const p: Vec3 = [pos.getX(k), pos.getY(k), pos.getZ(k)];
      if (p[1] < y0 - 1e-4 || p[1] > y1 + 1e-4 || !near([p[0], p[2]])) continue;
      out.push({ p, n: [nor.getX(k), nor.getY(k), nor.getZ(k)], uv: [uv.getX(k), uv.getY(k)], c: [col.getX(k), col.getY(k), col.getZ(k)] });
    }
    return out;
  }
  const lumaLin = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  test('el gabinete del molinete es acero inoxidable: liso (sin el grano del revoque), claro y frío, con el reflejo del piso abajo', () => {
    const i = interiorOf(map, 'estacion-adrogue');
    const gab = i.blocks.find((b) => b.out && b.collide === 'solid' && b.y0 === 0 && Math.abs(b.y1 - 0.92) < 1e-6)!;
    expect(gab.side!.mat).toBe('metal');
    // sus costados (armado solo: los caños de la baranda que lo tocan, no)
    const sides = verts({ ...i, blocks: [gab], panes: [], items: [] }, gab.polygon, 0, gab.y1).filter((v) => Math.abs(v.n[1]) < 0.1);
    expect(sides.length).toBeGreaterThanOrEqual(16);
    expect(new Set(sides.map((v) => v.uv.join())).size, 'un solo uv: sin grano').toBe(1);
    const [pie, tope] = [sides.filter((v) => v.p[1] < 0.01), sides.filter((v) => v.p[1] > gab.y1 - 0.01)];
    const k = lumaLin(pie[0].c) / lumaLin(tope[0].c);
    expect(k, 'el pie, más oscuro: refleja el piso').toBeGreaterThan(0.7);
    expect(k).toBeLessThan(0.9);
    expect(tope[0].c[2]).toBeGreaterThanOrEqual(tope[0].c[0]);
    expect(lumaLin(tope[0].c), 'claro, como el acero de los molinetes').toBeGreaterThanOrEqual(0.7);
  });

  test('el cordón del lucernario de la Casa, pintado como la estructura: liso, sin el grano del revoque', () => {
    const i = interiorOf(map, 'casa-de-la-cultura');
    const H = map.buildings.find((b) => b.id === i.buildingId)!.height;
    const cordon = i.blocks.filter((b) => b.out && b.collide === 'solid' && Math.abs(b.y0 - H) < 1e-6 && b.side?.mat === 'luz');
    expect(cordon.length).toBeGreaterThanOrEqual(4);
    for (const b of cordon) expect(new Set(verts(i, b.polygon, b.y0, b.y1).map((v) => v.uv.join())).size, 'un solo uv').toBe(1);
  });

  test('la tapa del muro del patio del McDonald\'s: de cerca se ve el ladrillo del muro (la tapa queda adentro, abajo de su tope); de lejos, la tapa', () => {
    const i = interiorOf(map, 'mcdonalds');
    const walls = i.blocks.filter((b) => !b.out && b.collide === 'solid' && b.side?.mat === 'ladrillo' && b.top?.mat === 'ladrillo');
    const caps = i.blocks.filter((b) => b.out && b.y1 - b.y0 <= 0.03 && b.y0 > 2);
    expect(walls.length).toBeGreaterThan(0);
    expect(caps.length).toBe(walls.length);
    for (const c of caps) {
      const m = c.polygon.reduce((s, p): Vec2 => [s[0] + p[0] / c.polygon.length, s[1] + p[1] / c.polygon.length], [0, 0]);
      const w = walls.find((x) => pointInPolygon(m, x.polygon))!;
      expect(w, 'arriba de un muro').toBeDefined();
      expect(c.y1, 'abajo del tope del ladrillo').toBeLessThanOrEqual(w.y1 - 0.005);
      expect(c.y1, 'pero a ras: de lejos es el tope del muro').toBeGreaterThanOrEqual(w.y1 - 0.03);
      // adentro del muro, a 5 mm o más de sus caras: de cerca no asoma
      for (const p of c.polygon) {
        expect(pointInPolygon(p, w.polygon)).toBe(true);
        const d = Math.min(...w.polygon.map((a, k) => {
          const b = w.polygon[(k + 1) % w.polygon.length], [dx, dz] = [b[0] - a[0], b[1] - a[1]];
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
          return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
        }));
        expect(d).toBeGreaterThanOrEqual(0.005);
      }
    }
  });
});

describe('los techos (item 5)', () => {
  const colorsOf = (g: THREE.BufferGeometry): Vec3[] => {
    const c = g.getAttribute('color');
    return Array.from({ length: c.count }, (_, k) => [c.getX(k), c.getY(k), c.getZ(k)] as Vec3);
  };

  test('van blancos (el color por vértice no tiñe la textura del techo) en todos los edificios, con o sin interior', () => {
    const own = new Set(map.interiors.map((x) => interiorOf(map, x.placeId).buildingId));
    const plain = map.buildings.filter((b) => !own.has(b.id)).slice(0, 40);
    for (const b of plain) for (const c of colorsOf(extrudeBuilding(b).roof)) expect(c, b.id).toEqual([1, 1, 1]);
    for (const id of ['casa-de-la-cultura', 'mcdonalds', 'banco-nacion']) {
      const i = interiorOf(map, id), b = map.buildings.find((x) => x.id === i.buildingId)!;
      const e = extrudeBuilding(b, [], roofCut(i));
      for (const c of [...colorsOf(e.roof), ...(e.tapas.roof ? colorsOf(e.tapas.roof) : [])]) expect(c, id).toEqual([1, 1, 1]);
    }
  });

  test('el de la terraza de La Veneciana, teñido como su baldosa terracota: de lejos se lee como de cerca', () => {
    const i = interiorOf(map, 'la-veneciana'), b = map.buildings.find((x) => x.id === i.buildingId)!;
    expect(i.terrace).toBe(true);
    const cs = colorsOf(extrudeBuilding(b, [], roofCut(i)).roof);
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) {
      expect(c).toEqual(cs[0]);
      // el techo (su promedio, lineal) por el tinte: la baldosa de cerca, el terracota por el tono de su textura
      const far = c.map((x, k) => x * TECHO_LINEAL[k]), near = hexRGB('#b8603e').map((x) => linear(x / 255) * BALDOSA_TONO);
      for (let k = 0; k < 3; k++) expect(far[k]).toBeCloseTo(near[k], 3);
    }
  });
});

describe('el horneado de afuera (item 6)', () => {
  const up: Vec3 = [0, 1, 0];
  const lumOf = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  /** ¿Un edificio del mapa que no es el del interior (de los que están a menos de 60 m) le tapa el sol a `p`? (el rayo
   *  hacia SUN_DIR, cada 0,2 m) */
  const near = (i: Interior): Building[] => {
    const [cx, cz] = [i.footprint[0][0], i.footprint[0][1]];
    return map.buildings.filter((b) => b.id !== i.buildingId && b.footprint.some((q) => Math.hypot(q[0] - cx, q[1] - cz) < 60));
  };
  const byNeighbor = (bs: Building[], p: Vec3): boolean => bs.some((b) => {
    if (p[1] >= b.height) return false;
    const top = (b.height - p[1]) / SUN_DIR.y; // hasta su alto, en 400 pasos (los cantos rozan)
    for (let k = 1; k <= 400; k++) if (pointInPolygon([p[0] + SUN_DIR.x * top * k / 400, p[2] + SUN_DIR.z * top * k / 400], b.footprint)) return true;
    return false;
  });
  /** Puntos del piso al aire libre: el de los patios y, con terraza, el de arriba del techo. */
  const outdoorFloor = (i: Interior): Vec3[] => {
    const H = map.buildings.find((b) => b.id === i.buildingId)!.height;
    const rings: [Vec2[], number][] = [...i.patios.map((r): [Vec2[], number] => [r, 0.03]), ...(i.terrace ? [[i.footprint, H + 0.03] as [Vec2[], number]] : [])];
    return rings.flatMap(([r, y]) => {
      const xs = r.map((q) => q[0]), zs = r.map((q) => q[1]), out: Vec3[] = [];
      for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.5) for (let z = Math.min(...zs) + 0.25; z < Math.max(...zs); z += 0.5) if (pointInPolygon([x, z], r)) out.push([x, y, z]);
      return out;
    });
  };

  test('los edificios vecinos le tapan el sol a los patios y a las terrazas', () => {
    let shaded = 0;
    for (const id of ['mcdonalds', 'la-veneciana', 'estacion-adrogue', 'guernica-bar']) {
      const i = interiorOf(map, id), bs = near(i);
      for (const p of outdoorFloor(i)) {
        if (!byNeighbor(bs, p)) continue;
        shaded++;
        expect(outdoorLightAt(i, p, up), `${id} en ${p.map((v) => v.toFixed(1)).join(', ')}`).toBeCloseTo(outdoorLight(up, false), 6);
      }
    }
    expect(shaded, 'algún punto a la sombra de un vecino').toBeGreaterThan(10);
  });

  test('la luz de afuera lleva el tono cálido del sol y el azulado del cielo (su luminancia es outdoorLight)', () => {
    for (const n of [up, [0, -1, 0], [1, 0, 0], [SUN_DIR.x, SUN_DIR.y, SUN_DIR.z]] as Vec3[]) {
      for (const sun of [true, false]) expect(lumOf(outdoorRGB(n, sun))).toBeCloseTo(outdoorLight(n, sun), 9);
    }
    const [sol, sombra] = [outdoorRGB(up, true), outdoorRGB(up, false)];
    expect(sol[0], 'al sol, cálida').toBeGreaterThan(sol[2]);
    expect(sombra[2], 'a la sombra, azulada').toBeGreaterThan(sombra[0]);
    // y el piso del patio del McDonald's la lleva así, canal por canal
    const i = interiorOf(map, 'mcdonalds');
    const meshes: THREE.Mesh[] = [];
    buildInterior3D({ ...i }, fake(), 'alta').group.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o.name === 'in_baldosa') meshes.push(o); });
    const mid = (r: Vec2[]): Vec2 => [r.reduce((a, q) => a + q[0], 0) / r.length, r.reduce((a, q) => a + q[1], 0) / r.length];
    const tile = i.blocks.find((b) => b.top?.mat === 'baldosa' && pointInPolygon(mid(b.polygon), i.patios[0]) && b.y1 < 0.1)!;
    const t = tintColor(tile.top!.color);
    let warm = 0, cool = 0;
    for (const m of meshes) {
      const [pos, nor, col] = ['position', 'normal', 'color'].map((a) => m.geometry.getAttribute(a));
      for (let k = 0; k < pos.count; k++) {
        if (nor.getY(k) < 0.99 || pos.getY(k) > 0.1 || !pointInPolygon([pos.getX(k), pos.getZ(k)], i.patios[0])) continue;
        const L = [col.getX(k) / t.r, col.getY(k) / t.g, col.getZ(k) / t.b];
        const which = [outdoorRGB(up, true), outdoorRGB(up, false)].find((w) => w.every((x, c) => Math.abs(x - L[c]) < 1e-4));
        expect(which, `(${L.map((x) => x.toFixed(3)).join(', ')})`).toBeDefined();
        if (which![0] > which![2]) warm++; else cool++;
      }
    }
    expect(warm).toBeGreaterThan(0);
    expect(cool).toBeGreaterThan(0);
  });

  test('la cara de abajo de la lona de la sombrilla, a la sombra de sí misma: más oscura que la de arriba', () => {
    const g = ITEM_MODELS.sombrilla(), [pos, nor, col] = ['position', 'normal', 'color'].map((a) => g.getAttribute(a));
    const lona = (s: 1 | -1): number[] => {
      const out: number[] = [];
      for (let k = 0; k < pos.count; k++) if (pos.getY(k) > 1.8 && nor.getY(k) * s > 0.5) out.push(lumOf([col.getX(k), col.getY(k), col.getZ(k)]));
      return out;
    };
    const [arriba, abajo] = [lona(1), lona(-1)];
    expect(arriba.length).toBeGreaterThan(0);
    expect(abajo.length).toBeGreaterThan(0);
    expect(Math.max(...abajo)).toBeLessThanOrEqual(0.4 * Math.min(...arriba));
  });
});
