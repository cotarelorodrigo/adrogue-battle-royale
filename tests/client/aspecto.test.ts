// @vitest-environment jsdom
// El aspecto de los interiores (tarea 11c): el tono de las texturas en baja, las juntas sin brillos, la exposición de
// adentro y de afuera, la banda esmerilada de los bancos, las butacas, los techos y el horneado de afuera.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { INDOOR_EXPOSURE, INDOOR_GAIN, interiorGain, OUTDOOR_EXPOSURE } from '../../src/client/render/exposure.ts';
import { BALDOSA_TONO, extrudeBuilding, TECHO_LINEAL } from '../../src/client/world/geometry.ts';
import { SUN_DIR } from '../../src/client/render/sun.ts';
import { lightAt, outdoorLight, outdoorLightAt, outdoorRGB, outdoorRGBAt, outdoors } from '../../src/client/world/interiors/bake.ts';
import { buildInterior3D, INTERIOR_EXPOSURE } from '../../src/client/world/interiors/build.ts';
import { exteriorGeometry, MEAN_UV, roofCut } from '../../src/client/world/interiors/exterior.ts';
import { PINTURA_MEDIA } from '../../src/client/world/front-atlas.ts';
import { FROST_ALPHA } from '../../src/client/world/interiors/glass.ts';
import { ITEM_FAR, ITEM_GLASS, ITEM_GLOW, ITEM_MODELS } from '../../src/client/world/interiors/models.ts';
import type { InteriorKey, WorldMaterials } from '../../src/client/world/types.ts';
import { BLANCO, marked, REVOQUE_MEDIA, surveyedColor, tintColor } from '../../src/client/world/wall-kit.ts';
import { distPointSegment, pointInPolygon, signedAreaFromAbove } from '../../src/shared/geo.ts';
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
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.name !== 'in_mueble') return;
      // el RGB de cada vértice (el color lleva además la ganancia en el alfa: M4)
      const col = o.geometry.getAttribute('color');
      for (let k = 0; k < col.count; k++) out.push(col.getX(k), col.getY(k), col.getZ(k));
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

  // M2 de la revisión, ronda 1: una marca va donde otro pedazo tiene una punta (para no dejarle una junta en T), y en
  // ningún otro lado (la de un hueco no pasa a los pisos que no lo tocan, ni de ahí al pretil)
  test.each(ALL)('%s: las paredes de su edificio no llevan marcas de más (cada vértice que no es una punta de su pedazo es la punta de otro)', (id) => {
    const it = map.interiors.find((x) => x.placeId === id)!;
    const bd = map.buildings.find((x) => x.id === it.buildingId)!;
    const e = extrudeBuilding(bd, it.openings, roofCut(interiorOf(map, id)));
    const gs = [e.walls.ground, e.walls.upper, e.walls.front, ...e.walls.overrides.map((o) => o.geometry), e.parapet, ...Object.values(e.tapas)];
    // los pedazos de costado: los triángulos que comparten vértices (cada pedazo lleva los suyos), con su normal horizontal
    const pieces: { pts: Vec3[]; corner: boolean[] }[] = [];
    for (const g of gs) {
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
      if (!pos || pos.count === 0) continue;
      const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, k) => k);
      const root = Array.from({ length: pos.count }, (_, k) => k);
      const find = (k: number): number => (root[k] === k ? k : (root[k] = find(root[k])));
      for (let k = 0; k < idx.length; k += 3) for (const j of [1, 2]) root[find(idx[k + j])] = find(idx[k]);
      const comps = new Map<number, number[]>();
      for (let v = 0; v < pos.count; v++) comps.set(find(v), [...(comps.get(find(v)) ?? []), v]);
      for (const vs of comps.values()) {
        if (Math.abs(nor.getY(vs[0])) > 1e-3) continue;
        const pts = vs.map((v): Vec3 => [pos.getX(v), pos.getY(v), pos.getZ(v)]);
        const [nx, nz] = [nor.getX(vs[0]), nor.getZ(vs[0])];
        const t = pts.map((p) => p[0] * nz - p[2] * nx), y = pts.map((p) => p[1]);
        const [t0, t1, y0, y1] = [Math.min(...t), Math.max(...t), Math.min(...y), Math.max(...y)];
        const corner = pts.map((_, k) => (Math.abs(t[k] - t0) < 1e-5 || Math.abs(t[k] - t1) < 1e-5) && (Math.abs(y[k] - y0) < 1e-5 || Math.abs(y[k] - y1) < 1e-5));
        // un rectángulo (con sus marcas): las cuatro puntas; lo demás (el tímpano de un lucernario, en la tapa) no se parte
        if (corner.filter(Boolean).length >= 4) pieces.push({ pts, corner });
      }
    }
    const key = (p: Vec3): string => p.map((x) => x.toFixed(3)).join(',');
    const corners = new Map<string, Set<number>>();
    pieces.forEach((pc, k) => pc.pts.forEach((p, j) => { if (pc.corner[j]) (corners.get(key(p)) ?? corners.set(key(p), new Set()).get(key(p))!).add(k); }));
    const extra = pieces.flatMap((pc, k) => pc.pts.filter((p, j) => !pc.corner[j] && ![...(corners.get(key(p)) ?? [])].some((o) => o !== k)).map(key));
    expect(extra.length, `${extra.length} marcas de más: ${extra.slice(0, 4).join(' · ')}`).toBe(0);
  });

  // M2 de la revisión: sin juntas en T no hace falta la grilla entera; alcanza con los vértices de las marcas en el borde
  test('un pedazo con marcas en las cuatro aristas va como polígono: n − 2 triángulos, sin vértices adentro ni triángulos chatos (no en grilla)', () => {
    const m = marked({ s0: 0, s1: 4, y0: 0, y1: 3 }, { bottom: [1, 2, 3, 7], top: [1, 2, 3], left: [1, 2, -1], right: [1, 2] });
    expect(m.pts.length, 'las 4 puntas y las 10 marcas que le caen adentro: ningún punto en el medio').toBe(14);
    expect(m.tris.length, 'n − 2').toBe(12);
    const areas = m.tris.map(([a, b, c]) => ((m.pts[b][0] - m.pts[a][0]) * (m.pts[c][1] - m.pts[a][1]) - (m.pts[c][0] - m.pts[a][0]) * (m.pts[b][1] - m.pts[a][1])) / 2);
    expect(Math.min(...areas), 'todos de frente y con área').toBeGreaterThan(1e-6);
    expect(areas.reduce((s, x) => s + x, 0), 'cubre el pedazo').toBeCloseTo(12, 9);
    for (const s of [1, 2, 3]) for (const y of [0, 3]) expect(m.pts.some((p) => p[0] === s && p[1] === y), `la marca ${s} en y ${y}`).toBe(true);
    for (const y of [1, 2]) for (const s of [0, 4]) expect(m.pts.some((p) => p[0] === s && p[1] === y), `la marca ${y} en s ${s}`).toBe(true);
    const tj = tJunctions({ n: [0, 1], tris: m.tris.map((t) => t.map((k) => m.pts[k])) });
    expect(tj.count, tj.first).toBe(0);
  });

  // M2, también adentro: las caras de costado de un plano iban todas en la grilla de las rectas de todo el plano; alcanza
  // con la grilla del horneado de cada una y, en sus aristas, los vértices de las de al lado (sin juntas en T igual: el
  // test de arriba)
  test.each([['estacion-adrogue', 3190, 2000], ['cine-pixel', 14694, 10000], ['la-veneciana', 6342, 5200]] as const)(
    '%s: los costados de adentro en alta, sin la grilla de todo su plano (eran %i triángulos en dfa611d)', (id, _antes, max) => {
      const planes = sidePlanes(geometriesOf(buildInterior3D({ ...interiorOf(map, id), panes: [] }, fake(), 'alta').group));
      expect([...planes.values()].reduce((s, pl) => s + pl.tris.length, 0)).toBeLessThanOrEqual(max);
    });

  test('con marcas solo a lo largo (o solo en alto) va en un cierre entre las dos aristas marcadas, sin vértices adentro; sin marcas, dos triángulos', () => {
    expect(marked({ s0: 0, s1: 4, y0: 0, y1: 3 }, { bottom: [1, 2, 3], top: [1, 2, 3] }).tris.length).toBe(8);
    expect(marked({ s0: 0, s1: 4, y0: 0, y1: 3 }, { left: [1, 2], right: [1, 2] }).tris.length).toBe(6);
    expect(marked({ s0: 0, s1: 4, y0: 0, y1: 3 }, {}).tris.length).toBe(2);
    expect(marked({ s0: 0, s1: 4, y0: 0, y1: 3 }, { bottom: [1, 2, 3] }).tris.length, 'abajo nomás: n − 2, sin vértices adentro').toBe(5);
    // cada costado con sus marcas (las de lo que lo toca): el cierre entre los dos, sin juntas en T
    const m = marked({ s0: 0, s1: 4, y0: 0, y1: 3 }, { left: [1, 2], right: [1.5] });
    expect(m.tris.length).toBe(5);
    const area = m.tris.reduce((s, [a, b, c]) => s + ((m.pts[b][0] - m.pts[a][0]) * (m.pts[c][1] - m.pts[a][1]) - (m.pts[c][0] - m.pts[a][0]) * (m.pts[b][1] - m.pts[a][1])) / 2, 0);
    expect(area, 'cubre el pedazo, todos de frente').toBeCloseTo(12, 9);
    const tj = tJunctions({ n: [0, 1], tris: m.tris.map((t) => t.map((k) => m.pts[k])) });
    expect(tj.count, tj.first).toBe(0);
  });

  test('las paredes del edificio de La Veneciana, sin juntas en T, sin la grilla entera (eran 1.320 triángulos en dfa611d; 534 con juntas en T, en 3f33c64)', () => {
    const it = map.interiors.find((x) => x.placeId === 'la-veneciana')!;
    const bd = map.buildings.find((x) => x.id === it.buildingId)!;
    const e = extrudeBuilding(bd, it.openings, roofCut(interiorOf(map, 'la-veneciana')));
    const tris = [e.walls.ground, e.walls.upper, e.walls.front, ...e.walls.overrides.map((o) => o.geometry), e.parapet]
      .reduce((s, g) => s + (g.index?.count ?? g.getAttribute('position').count) / 3, 0);
    expect(tris).toBeLessThanOrEqual(820);
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

  // con el I1 de la revisión la mediana va ~200–210 (era 215–230: lavado); la pared a luz plena, 212–228 (el contraste
  // adentro, más abajo)
  test.each(BANCOS)('%s: la pared blanca, adentro y adaptado, se lee ~200–210 (la luz mediana de sus paredes a 1,5 m)', (id) => {
    const i = interiorOf(map, id);
    const L = median(wallLights(i, 1.5, (b) => b.side!.mat === 'liso' && b.side!.color === PARED_BANCO));
    const v = adentro(PARED_BANCO, L);
    expect(v, `luz ${L.toFixed(2)}: se lee ${v.toFixed(0)}`).toBeGreaterThanOrEqual(198);
    expect(v, `luz ${L.toFixed(2)}: se lee ${v.toFixed(0)}`).toBeLessThanOrEqual(212);
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

// I1 de la revisión: con la ganancia, los interiores blancos quedaron lavados (pared, piso y cielorraso a 25 de luma
// entre sí, los muebles planos). Se devuelve el sombreado: paneles que no iluminan su cielorraso, menos ambiente, pisos de
// tono medio y los muebles sombreados por cara (sin mallas ni triángulos nuevos)
describe('el contraste adentro (I1)', () => {
  test('los muebles se sombrean por cara: la silla de espera muestra el asiento, el respaldo y el costado en tonos distintos, y abajo lo más oscuro', () => {
    const g = ITEM_MODELS['sillas-espera'](), [pos, nor, col] = ['position', 'normal', 'color'].map((a) => g.getAttribute(a));
    const lumOf = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const base = lumOf(hexRGB('#646a72').map((x) => linear(x / 255)) as Vec3);
    /** El tono (luma del color por vértice sobre la del color de la silla) de las caras que cumplen `pick`. */
    const tone = (pick: (p: Vec3, n: Vec3) => boolean): number[] => {
      const out = new Set<number>();
      for (let k = 0; k < pos.count; k++) {
        const [p, n]: Vec3[] = [[pos.getX(k), pos.getY(k), pos.getZ(k)], [nor.getX(k), nor.getY(k), nor.getZ(k)]];
        if (pick(p, n)) out.add(+(lumOf([col.getX(k), col.getY(k), col.getZ(k)]) / base).toFixed(3));
      }
      return [...out];
    };
    const asiento = tone((p, n) => n[1] > 0.99 && Math.abs(p[1] - 0.45) < 1e-3);
    const respaldo = tone((p, n) => n[2] > 0.99 && p[1] > 0.5 && p[2] < -0.1);
    // el costado del asiento de la punta (x −0,825 ± 0,24)
    const costado = tone((p, n) => Math.abs(n[0]) > 0.99 && Math.abs(p[1] - 0.425) < 0.03 && Math.abs(Math.abs(p[0] + 0.825) - 0.24) < 1e-3);
    const abajo = tone((p, n) => n[1] < -0.99 && Math.abs(p[1] - 0.4) < 1e-3);
    for (const [k, v] of Object.entries({ asiento, respaldo, costado, abajo })) expect(v.length, k).toBe(1);
    const say = `asiento ${asiento[0]}, respaldo ${respaldo[0]}, costado ${costado[0]}, abajo ${abajo[0]}`;
    expect(asiento[0], say).toBeCloseTo(1, 3);
    expect(respaldo[0], say).toBeLessThanOrEqual(0.9 * asiento[0]);
    expect(respaldo[0], say).toBeGreaterThanOrEqual(0.7);
    expect(costado[0], say).toBeLessThanOrEqual(0.9 * respaldo[0]);
    expect(costado[0], say).toBeGreaterThanOrEqual(0.55);
    expect(abajo[0], say).toBeLessThanOrEqual(0.45);
  });

  test.each([...BANCOS, 'casa-de-la-cultura'])('%s: cada panel del cielorraso es embutido: su lámpara alumbra para abajo y no su cielorraso', (id) => {
    const i = interiorOf(map, id);
    const paneles = i.blocks.filter((b) => b.bottom?.mat === 'luz' && b.y1 - b.y0 < 0.01);
    expect(paneles.length).toBeGreaterThan(0);
    let n = 0;
    for (const l of i.lamps) {
      const panel = paneles.find((b) => pointInPolygon([l.at[0], l.at[2]], b.polygon) && Math.abs(b.y1 - 0.1 - l.at[1]) < 1e-6);
      if (!panel) continue;
      n++;
      expect(l.down, 'la lámpara de un panel alumbra para abajo').toBe(true);
      // el cielorraso al lado del panel, justo arriba de la lámpara: lo mismo con ella que sin ella
      const p: Vec3 = [l.at[0] + 0.5, panel.y1 - 0.001, l.at[2] + 0.5];
      const without = { ...i, lamps: i.lamps.filter((x) => x !== l) };
      expect(lightAt(i, p, [0, -1, 0])).toBeCloseTo(lightAt(without, p, [0, -1, 0]), 9);
      // y lo de abajo, sí (sin ambiente, para que no tope en 1)
      const q: Vec3 = [l.at[0], l.at[1] - 1.5, l.at[2]];
      expect(lightAt({ ...i, ambient: 0 }, q, [0, 1, 0])).toBeGreaterThan(lightAt({ ...without, ambient: 0 }, q, [0, 1, 0]));
    }
    expect(n, 'lámparas de panel').toBe(paneles.length);
  });

  /** El tono del porcelanato (lineal): las baldosas de base 222 (textures.ts). */
  const PORCELANATO = linear(222 / 255);
  /** Los puntos de la planta baja, cada 1 m: el piso (sin nada sólido encima) con el color de lo que lo cubre, y el
   *  cielorraso blanco más bajo de arriba, con el suyo. */
  function surfaces(i: Interior): { floor: { p: Vec3; hex: string; mat: Mat }[]; ceil: { p: Vec3; hex: string }[] } {
    const f0 = i.floors.find((f) => f.level === 0)!;
    const xs = f0.polygon.map((p) => p[0]), zs = f0.polygon.map((p) => p[1]);
    const floor: { p: Vec3; hex: string; mat: Mat }[] = [], ceil: { p: Vec3; hex: string }[] = [];
    const solidAt = (q: Vec2): boolean => i.blocks.some((b) => !b.out && b.collide === 'solid' && b.y0 < 0.5 + f0.y && b.y1 > 0.05 + f0.y && pointInPolygon(q, b.polygon));
    for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) {
      for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) {
        if (!pointInPolygon([x, z], f0.polygon) || f0.holes.some((h) => pointInPolygon([x, z], h))) continue;
        const top = i.blocks.filter((b) => !b.out && b.top && Math.abs(b.y1 - f0.y) < 0.05 && pointInPolygon([x, z], b.polygon)).sort((a, b) => b.y1 - a.y1)[0];
        if (top && !solidAt([x, z])) floor.push({ p: [x, top.y1 + 0.01, z], hex: top.top!.color, mat: top.top!.mat });
        const over = i.blocks.filter((b) => !b.out && b.bottom?.mat === 'liso' && luma(hexRGB(b.bottom.color)) > 200 && b.y0 > f0.y + 2 && pointInPolygon([x, z], b.polygon)).sort((a, b) => a.y0 - b.y0)[0];
        if (over) ceil.push({ p: [x, over.y0 - 0.001, z], hex: over.bottom!.color });
      }
    }
    return { floor, ceil };
  }
  const WALL: Record<string, string> = { 'banco-nacion': PARED_BANCO, galicia: PARED_BANCO, bbva: PARED_BANCO, 'casa-de-la-cultura': '#f1eee7' };

  test.each([...BANCOS, 'casa-de-la-cultura'])('%s: la pared a luz plena 212–228 y su mediana ~200–210; el cielorraso, el piso y el panel se despegan; lo oscuro, oscuro; desde la vereda ≤ 46', (id) => {
    const i = interiorOf(map, id);
    const Ls = wallLights(i, 1.5, (b) => b.side!.mat === 'liso' && b.side!.color === WALL[id]);
    const [top, mid] = [adentro(WALL[id], Math.max(...Ls)), adentro(WALL[id], median(Ls))];
    const { floor, ceil } = surfaces(i);
    const piso = median(floor.map((f) => adentro(f.hex, lightAt(i, f.p, [0, 1, 0]), f.mat === 'porcelanato' ? PORCELANATO : LISO)));
    const cielo = median(ceil.map((c) => adentro(c.hex, lightAt(i, c.p, [0, -1, 0]))));
    const panel = Math.min(...i.blocks.filter((b) => b.bottom?.mat === 'luz' && b.y1 - b.y0 < 0.01).map((b) => luma(seenLinear(hexRGB(b.bottom!.color).map((x) => linear(x / 255)) as RGB))));
    // la silla de oficina (#3b3f45) y el monitor apagado, a la luz del puesto más iluminado (el escritorio o la caja: los
    // modelos que los llevan); el zócalo oscuro, a la suya (la del pie de la pared)
    const puestos = i.items.filter((it) => it.model === 'escritorio' || it.model === 'puesto-caja').map((it) => lightAt(i, [it.at[0], it.at[1] + 0.6, it.at[2]], [0, 1, 0]));
    const [silla, monitor] = puestos.length === 0 ? [0, 0] : [adentro('#3b3f45', Math.max(...puestos), 1), adentro('#1b1c1f', Math.max(...puestos), 1)];
    const zocalos = i.blocks.filter((b) => !b.out && b.side?.mat === 'liso' && luma(hexRGB(b.side.color)) < 60 && b.y1 - b.y0 <= 0.15 && b.y0 < 0.2);
    const zocalo = zocalos.length === 0 ? 0 : median(zocalos.flatMap((z) => wallLights(i, (z.y0 + z.y1) / 2, (b) => b === z).map((L) => adentro(z.side!.color, L))));
    const sky = luma(seenLinear(hexRGB('#a9bfcf').map((x) => linear(x / 255)) as RGB, OUTDOOR_EXPOSURE));
    const vereda = 0.92 * afuera(WALL[id], Math.max(...Ls)) + 0.08 * sky;
    const say = `pared ${top.toFixed(0)} (mediana ${mid.toFixed(0)}), cielorraso ${cielo.toFixed(0)}, piso ${piso.toFixed(0)}, panel ${panel.toFixed(0)}, silla ${silla.toFixed(0)}, monitor ${monitor.toFixed(0)}, zócalo ${zocalo.toFixed(0)}, vereda ${vereda.toFixed(1)}`;
    expect(top, say).toBeGreaterThanOrEqual(212);
    expect(top, say).toBeLessThanOrEqual(228);
    expect(mid, say).toBeGreaterThanOrEqual(198);
    expect(mid, say).toBeLessThanOrEqual(212);
    expect(cielo, say).toBeLessThanOrEqual(mid - 10);
    expect(piso, say).toBeLessThanOrEqual(mid - 15);
    expect(panel, say).toBeGreaterThanOrEqual(cielo + 20);
    expect(silla, say).toBeLessThanOrEqual(65);
    expect(Math.max(monitor, zocalo), say).toBeLessThanOrEqual(25);
    expect(vereda, say).toBeLessThanOrEqual(46);
  });
});

describe('la banda esmerilada de los bancos (item 3)', () => {
  const lumaLinOf = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
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

  // translúcida: el vinilo deja pasar la luz; cada cara lleva la del lado más iluminado (con el ambiente más bajo del I1,
  // la de su lado solo la dejaba más oscura que una pared blanca)
  test.each(BANCOS)('%s: cada cara de la banda lleva la luz del lado más iluminado', (id) => {
    const i = interiorOf(map, id);
    const meshes: THREE.Mesh[] = [];
    buildInterior3D({ ...i }, fake(), 'alta').group.traverse((o) => { if (o instanceof THREE.Mesh && o.name === 'in_vidrio') meshes.push(o); });
    const [pos, nor, col] = ['position', 'normal', 'color'].map((a) => meshes[0].geometry.getAttribute(a));
    const frost = lumaLinOf(tintColor(bandOf(i)[0].side!.color));
    let n = 0, ok = 0;
    for (let k = 0; k < col.count; k++) {
      if (col.getZ(k) >= 0) continue;
      const p: Vec3 = [pos.getX(k), pos.getY(k), pos.getZ(k)], q: Vec3 = [nor.getX(k), nor.getY(k), nor.getZ(k)];
      // lo que toca el borde de la planta lleva la luz de afuera (M4): no se mira
      if (outdoors(i, p) || i.footprint.some((a, j) => distPointSegment([p[0], p[2]], a, i.footprint[(j + 1) % i.footprint.length]) < 2e-3)) continue;
      const want = frost * Math.max(lightAt(i, p, q), lightAt(i, p, [-q[0], -q[1], -q[2]])) * INTERIOR_EXPOSURE;
      // las posiciones vuelven en float32: un vértice en una esquina pegada a otro bloque puede ver o no una lámpara según
      // el redondeo
      if (Math.abs(-col.getZ(k) - want) < 1e-5) ok++;
      n++;
    }
    expect(n).toBeGreaterThan(0);
    expect(ok / n, `${ok} de ${n}`).toBeGreaterThanOrEqual(0.9);
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

// M6 de la revisión: el signo de `horneado` solo tiene sentido en un mueble que brilla (su instancia va en positivo); en
// uno horneado, negativo por negativo, perdería la ganancia de adentro sin aviso
describe('horneado() solo en los muebles que brillan (M6)', () => {
  const negatives = (g: THREE.BufferGeometry): number => {
    const col = g.getAttribute('color');
    let n = 0;
    for (let k = 0; k < col.count; k++) if (col.getX(k) < 0 || col.getY(k) < 0 || col.getZ(k) < 0) n++;
    return n;
  };
  test('ningún modelo que no brilla (ni sus piezas de lejos ni su vidrio) lleva un color marcado', () => {
    const bad = (Object.keys(ITEM_MODELS) as ItemModel[]).filter((m) => !ITEM_GLOW[m] && negatives(ITEM_MODELS[m]()) > 0);
    expect(bad, 'modelos horneados con partes horneado()').toEqual([]);
    for (const [m, f] of Object.entries(ITEM_FAR)) for (const g of f!()) expect(negatives(g), `${m} de lejos`).toBe(0);
    for (const [m, f] of Object.entries(ITEM_GLASS)) expect(negatives(f!()), `${m}, el vidrio`).toBe(0);
  });
});

// M4 de la revisión: la esquina al aire libre de una cara bajo techo (el canto de afuera de una jamba, de un umbral o de
// un dintel) iba dividida por INDOOR_GAIN; desde la vereda, con ganancia 1, se veía 6,4 veces más oscura que la luz de
// afuera. Ahora la ganancia de cada vértice va en el alfa del color (baked.ts): esa esquina se ve igual con cualquiera.
describe('el canto de afuera de las aberturas, desde la vereda (M4)', () => {
  /** Lo que muestra bakedMaterial de un vértice (en luma, antes de la textura) con la ganancia `gain`: con alfa, la
   *  ganancia en esa proporción; sin, por el signo. */
  const shown = (col: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, k: number, gain: number): number => {
    const v = [col.getX(k), col.getY(k), col.getZ(k)];
    const w = col.itemSize === 4 ? col.getW(k) : v.some((x) => x < 0) ? 1 : 0;
    return Math.abs(0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) * (1 + (gain - 1) * w);
  };
  test.each(['banco-nacion', 'galicia', 'casa-de-la-cultura', 'la-veneciana', 'estacion-adrogue'])(
    '%s: la esquina al aire libre de una cara bajo techo se ve igual desde la vereda que desde adentro', (id) => {
      const i = interiorOf(map, id);
      const roof = i.terrace ? i.floors.find((f) => f.level === i.publicFloors)?.y : undefined;
      // la cara de afuera de la pared es el borde de la planta: lo que está sobre él (a menos de 1 mm) está al aire libre.
      // Las posiciones vuelven en float32: lo que está cerca de 1 mm del borde o del piso de la terraza no se mira
      const edge = (p: Vec3): number => Math.min(...i.footprint.map((a, k) => distPointSegment([p[0], p[2]], a, i.footprint[(k + 1) % i.footprint.length])));
      const sure = (p: Vec3): boolean => Math.abs(edge(p) - 1e-3) > 1e-4 && (roof === undefined || Math.abs(p[1] - (roof - 0.01)) > 1e-4);
      const open = (p: Vec3): boolean => edge(p) < 1e-3 || outdoors(i, p);
      const { group } = buildInterior3D({ ...i }, fake(), 'alta');
      let corners = 0, inner = 0;
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || ['in_vidrio', 'in_luz', 'in_mueble'].includes(o.name) || o.name.startsWith('labels')) return;
        const [pos, col] = [o.geometry.getAttribute('position'), o.geometry.getAttribute('color')];
        expect(col.itemSize, `${o.name}: la ganancia en el alfa`).toBe(4);
        for (let k = 0; k < pos.count; k++) {
          if (![col.getX(k), col.getY(k), col.getZ(k)].some((x) => x < 0)) continue; // solo las caras bajo techo
          const p: Vec3 = [pos.getX(k), pos.getY(k), pos.getZ(k)];
          const where = `${o.name} ${p.map((x) => x.toFixed(3))}`;
          if (!sure(p)) continue;
          if (open(p)) {
            corners++;
            expect(shown(col, k, 1), where).toBeCloseTo(shown(col, k, INDOOR_GAIN), 7);
          } else {
            inner++;
            expect(shown(col, k, INDOOR_GAIN), where).toBeCloseTo(shown(col, k, 1) * INDOOR_GAIN, 7);
          }
        }
      });
      expect(corners, 'esquinas al aire libre').toBeGreaterThan(0);
      expect(inner).toBeGreaterThan(corners);
    });

  test('en baja, compactado, lo de los bloques conserva su ganancia y los muebles la del signo', () => {
    const { group } = buildInterior3D({ ...interiorOf(map, 'mcdonalds') }, fake(), 'baja');
    expect(group.userData.level).toBe(3);
    let zero = 0, full = 0;
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.name !== 'in_mueble' || o instanceof THREE.InstancedMesh) return;
      const col = o.geometry.getAttribute('color');
      expect(col.itemSize).toBe(4);
      for (let k = 0; k < col.count; k++) {
        const neg = [col.getX(k), col.getY(k), col.getZ(k)].some((x) => x < 0);
        if (!neg) expect(col.getW(k)).toBe(0);
        else if (col.getW(k) === 0) zero++;
        else full++;
      }
    });
    expect(zero, 'esquinas al aire libre en baja').toBeGreaterThan(0);
    expect(full).toBeGreaterThan(zero);
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
    expect(slot.length, `${m}: asiento a ${top.toFixed(2)} m, respaldo con el frente en z ${front.toFixed(2)}`).toBeGreaterThanOrEqual(4);
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

  // M3 de la revisión: la ranura es un quad, no una caja
  test.each(SEATS)('%s: 50 triángulos o menos (cuatro cajas y la ranura, un quad de 2)', (m) => {
    const g = ITEM_MODELS[m]();
    expect((g.index ? g.index.count : g.getAttribute('position').count) / 3).toBeLessThanOrEqual(50);
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

  test('el gabinete del molinete es acero inoxidable: liso (sin el grano del revoque), frío, con el reflejo del piso abajo', () => {
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
    // el mismo acero que el cuerpo de los molinetes (M7 de la T11c; antes, #e4e8ec: más claro, para parecerse a ellos con
    // la luz de arriba)
    expect(gab.side!.color, 'el del cuerpo de los molinetes').toBe('#b7bbbf');
  });

  // M7 de la revisión (segunda parte): con el texel medido, el costado del gabinete a la sombra daba 118 en la captura y
  // los molinetes de al lado, 156–169. El gabinete (out) lo dibuja el chunk con el sol de verdad; los molinetes, con la
  // luz de arriba de su centro por el sombreado de cada cara (FACE): a la sombra o al sol, casi igual. Ahora las caras
  // verticales de un mueble al aire libre que nunca va instanciado llevan la luz de afuera de cada vértice, y el gabinete
  // es del mismo acero que el cuerpo de los molinetes
  test('el gabinete y los molinetes de al lado, el mismo acero: cada cara vertical se ve a ±20 de luma de la del otro que mira igual', () => {
    const i = interiorOf(map, 'estacion-adrogue');
    const gab = i.blocks.find((b) => b.out && b.collide === 'solid' && b.y0 === 0 && Math.abs(b.y1 - 0.92) < 1e-6)!;
    const seenOut = (c: Vec3): number => luma(seenLinear(c as RGB, OUTDOOR_EXPOSURE));
    /** ¿Le da el sol (o mira para el otro lado: entonces da igual)? Se comparan caras en la misma: el molinete de la
     *  punta tiene su cara al sol a la sombra de lo de al lado, y el gabinete no. */
    const alSol = (i: Interior, p: Vec3, n: Vec3): boolean => outdoorRGBAt(i, p, n).every((x, c) => Math.abs(x - outdoorRGB(n, true)[c]) < 1e-9);
    // el gabinete: su color (por la media del texel: el albedo) por la luz de afuera de verdad, arriba (sin el reflejo del pie)
    const caras = verts({ ...i, blocks: [gab], panes: [], items: [] }, gab.polygon, 0, gab.y1)
      .filter((v) => Math.abs(v.n[1]) < 0.1 && v.p[1] > gab.y1 - 0.01)
      .map((v) => {
        const L = outdoorRGBAt(i, v.p, v.n);
        return { n: v.n, sol: alSol(i, v.p, v.n), luma: seenOut(v.c.map((x, c) => x * REVOQUE_MEDIA[c] * L[c]) as Vec3) };
      });
    expect(caras.length).toBeGreaterThanOrEqual(4);
    // los molinetes: el cuerpo (la caja de 0,28 × 0,88 × 0,9 en x = 0,3 del modelo), horneado (in_mueble, sin textura;
    // el color por vértice es lo que se ve, a la exposición de afuera)
    const mols = i.items.filter((it) => it.model === 'molinete');
    expect(mols.length).toBe(2);
    const cuerpo: { n: Vec3; sol: boolean; luma: number }[] = [];
    buildInterior3D({ ...i }, fake(), 'alta').group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.name !== 'in_mueble') return;
      const [pos, nor, col] = ['position', 'normal', 'color'].map((a) => o.geometry.getAttribute(a));
      for (let k = 0; k < pos.count; k++) {
        const n: Vec3 = [nor.getX(k), nor.getY(k), nor.getZ(k)];
        if (Math.abs(n[1]) > 0.1) continue;
        const local = mols.map((it) => {
          const [dx, dz] = [pos.getX(k) - it.at[0], pos.getZ(k) - it.at[2]], [c, s] = [Math.cos(it.yaw), Math.sin(it.yaw)];
          return [c * dx - s * dz, pos.getY(k) - it.at[1], s * dx + c * dz];
        }).find(([x, y, z]) => (Math.abs(Math.abs(x - 0.3) - 0.14) < 1e-3 && Math.abs(z) < 0.45) || (Math.abs(Math.abs(z) - 0.45) < 1e-3 && Math.abs(x - 0.3) < 0.14));
        // los vértices de arriba del cuerpo (0,88; los de la tapa oscura, en la misma altura, no: su color es ~10 veces
        // menos), como los del gabinete: los de abajo pueden caer en la sombra del vecino
        const c: Vec3 = [col.getX(k), col.getY(k), col.getZ(k)];
        if (!local || Math.abs(local[1] - 0.88) > 1e-3 || lumaLin(c) < 0.05) continue;
        const p: Vec3 = [pos.getX(k), pos.getY(k), pos.getZ(k)];
        cuerpo.push({ n, sol: alSol(i, p, n), luma: seenOut(c) });
      }
    });
    expect(cuerpo.length).toBeGreaterThan(0);
    let pares = 0;
    for (const g of caras) {
      const mismas = cuerpo.filter((m) => m.n[0] * g.n[0] + m.n[2] * g.n[2] > 0.99 && m.sol === g.sol);
      for (const m of mismas) {
        pares++;
        expect(Math.abs(m.luma - g.luma), `normal ${g.n.map((x) => x.toFixed(2)).join(', ')}: gabinete ${g.luma.toFixed(0)}, molinete ${m.luma.toFixed(0)}`).toBeLessThanOrEqual(20);
      }
    }
    expect(pares, 'caras que miran igual').toBeGreaterThanOrEqual(4);
  });

  // M7 de la revisión: el uv liso era [0,5, 0,5], un texel cualquiera de la foto del revoque (y el color, el del Look por
  // ese texel). Ahora es uno medido, igual a la media de la foto en 512 y en 1024, y el color lleva la media compensada
  test('lo liso toma un texel igual a la media del revoque, en 512 y en 1024, y su color la compensa: se ve el del Look', () => {
    const { jpegjs } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle') as { jpegjs: { decode: (b: Buffer, o: object) => { width: number; height: number; data: Uint8Array } } };
    const img = jpegjs.decode(readFileSync('public/textures/revoque_diff.jpg'), { useTArray: true });
    const W = img.width;
    const lin = (v: number): number => linear(v / 255);
    const px = (x: number, y: number, c: number): number => lin(img.data[(((y + W) % W) * W + ((x + W) % W)) * 4 + c]);
    const mean = [0, 1, 2].map((c) => { let t = 0; for (let k = 0; k < W * W; k++) t += lin(img.data[k * 4 + c]); return t / (W * W); });
    for (const c of [0, 1, 2]) expect(REVOQUE_MEDIA[c], 'la media medida').toBeCloseTo(mean[c], 3);
    // lo que da la textura de `size` en MEAN_UV (flipY: v = 1 es la fila de arriba de la foto): la foto achicada con una
    // caja de W/size px (drawImage) y leída con el bilineal
    const sample = (size: number): number[] => {
      const k = W / size;
      const texel = (tx: number, ty: number, c: number): number => {
        let t = 0;
        for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) t += px(tx * k + x, ty * k + y, c);
        return t / (k * k);
      };
      const [fx, fy] = [MEAN_UV[0] * size - 0.5, (1 - MEAN_UV[1]) * size - 0.5];
      const [x0, y0] = [Math.floor(fx), Math.floor(fy)], [ax, ay] = [fx - x0, fy - y0];
      return [0, 1, 2].map((c) => (texel(x0, y0, c) * (1 - ax) + texel(x0 + 1, y0, c) * ax) * (1 - ay) + (texel(x0, y0 + 1, c) * (1 - ax) + texel(x0 + 1, y0 + 1, c) * ax) * ay);
    };
    for (const size of [512, 1024]) for (const c of [0, 1, 2]) expect(sample(size)[c] / mean[c], `${size}, canal ${c}`).toBeCloseTo(1, 1.7);
    // y el gabinete: su uv es ese, y su color por la media da el del Look
    const i = interiorOf(map, 'estacion-adrogue');
    const gab = i.blocks.find((b) => b.out && b.collide === 'solid' && b.y0 === 0 && Math.abs(b.y1 - 0.92) < 1e-6)!;
    const all = verts({ ...i, blocks: [gab], panes: [], items: [] }, gab.polygon, 0, gab.y1);
    const tope = all.filter((v) => Math.abs(v.n[1]) < 0.1 && v.p[1] > gab.y1 - 0.01);
    for (const v of all.filter((x) => Math.abs(x.n[1]) < 0.1)) expect(v.uv).toEqual(MEAN_UV.map((x) => Math.fround(x)));
    const want = tintColor(gab.side!.color);
    expect(tope[0].c[0] * REVOQUE_MEDIA[0]).toBeCloseTo(want.r, 5);
    expect(tope[0].c[1] * REVOQUE_MEDIA[1]).toBeCloseTo(want.g, 5);
    expect(tope[0].c[2] * REVOQUE_MEDIA[2]).toBeCloseTo(want.b, 5);
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

// I3 de la revisión de la T11c: el blanco #f4f4f1 de La Veneciana se veía gris medio de lejos. Medido, no es la
// exposición de afuera (OUTDOOR_EXPOSURE es de todo el mundo: no se toca) sino la textura por el tinte. Un lote relevado
// pinta sus medianeras, sus fondos y su pretil con la foto cruda del revoque (`parapet`, de media REVOQUE_MEDIA ≈ 0,65) y
// su frente con la pintura del atlas (el revoque aclarado a luminancia sRGB 0,9, de media PINTURA_MEDIA ≈ 0,79). Así, el
// blanco quedaba con un albedo de 0,59 y de 0,71. Con el modelo ACES de afuera (el color por outdoorRGB, a
// OUTDOOR_EXPOSURE), el frente (mira al oeste: siempre a la sombra) daba 114 de luma (107 en la captura) y la medianera
// al sol rasante, 135 (135 en la captura).
describe('el blanco de La Veneciana, afuera (I3)', () => {
  const bd = map.buildings.find((b) => b.id === 'pl-la-veneciana')!;
  const it = map.interiors.find((x) => x.placeId === 'la-veneciana')!;
  const e = extrudeBuilding(bd, it.openings, roofCut(interiorOf(map, 'la-veneciana')));
  const h = Math.hypot(SUN_DIR.x, SUN_DIR.z);
  /** La pared vertical que mira al sol (la que más sol recibe); a la sombra, la misma sin el sol. */
  const alSol: Vec3 = [SUN_DIR.x / h, 0, SUN_DIR.z / h];
  const afueraLuma = (alb: RGB, n: Vec3, sun: boolean): number =>
    luma(seenLinear(outdoorRGB(n, sun).map((L, c) => L * alb[c]) as RGB, OUTDOOR_EXPOSURE));
  /** Los colores por vértice (distintos) de las caras verticales de `gs` con el tono de `hex` (±6 %: la compensación va
   *  canal por canal): fuera el toldo. */
  const wallColors = (gs: THREE.BufferGeometry[], hex: string): RGB[] => {
    const t = tintColor(hex), out = new Map<string, RGB>();
    for (const g of gs) {
      const [nor, col] = ['normal', 'color'].map((a) => g.getAttribute(a));
      for (let k = 0; k < col.count; k++) {
        const c: RGB = [col.getX(k), col.getY(k), col.getZ(k)];
        if (Math.abs(nor.getY(k)) > 0.1 || Math.abs(c[0] / c[1] - t.r / t.g) > 0.06 || Math.abs(c[2] / c[1] - t.b / t.g) > 0.06) continue;
        out.set(c.join(), c);
      }
    }
    return [...out.values()];
  };

  test('las medianeras, el pretil y el frente se leen blancos: ≥ 200 de frente al sol, gris claro (≥ 140) a la sombra', () => {
    // el gris medio (18 %) es 118 de luma; 140 es L* 57
    const parts: [string, THREE.BufferGeometry[], readonly number[]][] = [
      ['las medianeras y los fondos (la foto cruda del revoque)', [e.walls.ground, e.walls.upper], REVOQUE_MEDIA],
      ['el pretil', [e.parapet], REVOQUE_MEDIA],
      ['el frente (la pintura del atlas)', [e.walls.front], PINTURA_MEDIA],
    ];
    for (const [name, gs, media] of parts) {
      const cols = wallColors(gs, bd.tint);
      expect(cols.length, name).toBeGreaterThan(0);
      for (const c of cols) {
        const alb = c.map((x, j) => x * media[j]) as RGB;
        const [sol, sombra] = [afueraLuma(alb, alSol, true), afueraLuma(alb, alSol, false)];
        expect(sol, `${name}: al sol`).toBeGreaterThanOrEqual(200);
        expect(sombra, `${name}: a la sombra`).toBeGreaterThanOrEqual(140);
        expect(Math.max(...alb) * Math.max(...outdoorRGB([0, 1, 0], true)), `${name}: ni lo más iluminado (arriba, al sol) se quema`)
          .toBeLessThan(1.5);
      }
    }
  });

  test('PINTURA_MEDIA es la media de la pintura del atlas: el revoque aclarado a luminancia sRGB 0,9 (front-atlas.ts)', () => {
    const { jpegjs } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle') as { jpegjs: { decode: (b: Buffer, o: object) => { width: number; height: number; data: Uint8Array } } };
    const img = jpegjs.decode(readFileSync('public/textures/revoque_diff.jpg'), { useTArray: true });
    const N = img.width * img.height;
    let l0 = 0;
    for (let k = 0; k < N; k++) l0 += (0.2126 * img.data[k * 4] + 0.7152 * img.data[k * 4 + 1] + 0.0722 * img.data[k * 4 + 2]) / 255 / N;
    const a = Math.min(0.9, Math.max(0, (0.9 - l0) / (1 - l0)));
    for (const c of [0, 1, 2]) {
      let t = 0;
      for (let k = 0; k < N; k++) t += linear((img.data[k * 4 + c] / 255) * (1 - a) + a) / N;
      expect(PINTURA_MEDIA[c], `canal ${c}`).toBeCloseTo(t, 2);
    }
  });

  test('solo cambian los blancos relevados: un color de abajo de BLANCO.desde queda como el tinte, y los edificios sin frente relevado también', () => {
    const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    let colored = 0, plain = 0;
    for (const b of map.buildings) {
      const t = tintColor(b.tint);
      if (b.front && lum(t) >= BLANCO.desde) continue;
      if (b.front) colored++; else if (++plain > 60) continue;
      const g = extrudeBuilding(b).walls;
      for (const geo of [g.ground, g.upper]) {
        const col = geo.getAttribute('color');
        for (let k = 0; k < col.count; k++) expect([col.getX(k), col.getY(k), col.getZ(k)], b.id).toEqual([t.r, t.g, t.b].map(Math.fround));
      }
    }
    expect(colored, 'los frentes relevados de color').toBeGreaterThan(80);
  });

  test('BLANCO va de a poco: dos blancos parecidos se compensan parecido (sin saltos)', () => {
    const k = (hex: string): number => surveyedColor(hex, REVOQUE_MEDIA).g / tintColor(hex).g;
    expect(k('#d5d1ca'), 'un color claro, no blanco').toBe(1);
    expect(k('#f4f4f1')).toBeCloseTo(BLANCO.k / REVOQUE_MEDIA[1], 6);
    for (let v = 0xd0; v < 0xff; v++) {
      const [a, b] = [`#${v.toString(16).repeat(3)}`, `#${(v + 1).toString(16).repeat(3)}`];
      expect(Math.abs(k(b) - k(a)), `${a} → ${b}`).toBeLessThan(0.12);
    }
  });
});
