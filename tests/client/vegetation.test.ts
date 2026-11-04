// @vitest-environment jsdom
import * as THREE from 'three';
import { buildChunks, isParkFootway } from '../../src/client/world/chunks.ts';
import { ribbon } from '../../src/client/world/geometry.ts';
import type { WorldMaterials } from '../../src/client/world/types.ts';
import { CELL } from '../../src/client/world/cells.ts';
import { buildParks, buildTrees, keepTree, setTreeDensity } from '../../src/client/world/vegetation.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { MapData, Prop, Road, Tree } from '../../src/shared/mapdata.ts';
import { stubCanvas } from './canvas-stub.ts';

beforeEach(() => stubCanvas());
afterEach(() => vi.restoreAllMocks());

const KEYS = ['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'asphalt', 'cobble',
  'sidewalk', 'grass', 'path', 'platform', 'rail', 'front'] as const;
const materials = Object.fromEntries(KEYS.map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as WorldMaterials;

const triArea = (g: THREE.BufferGeometry): number => {
  const p = g.getAttribute('position');
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i);
  let s = 0;
  const v = [0, 1, 2].map(() => new THREE.Vector3());
  for (let i = 0; i < idx.length; i += 3) {
    v.forEach((w, k) => w.fromBufferAttribute(p, idx[i + k]));
    s += new THREE.Triangle(v[0], v[1], v[2]).getArea();
  }
  return s;
};

// 40 × 50 árboles cada 12 m, repartidos en 8 celdas de 250 m (x −300…288, z −240…228)
const trees: Tree[] = Array.from({ length: 2000 }, (_, i) => ({
  position: [(i % 50) * 12 - 300, Math.floor(i / 50) * 12 - 240] as Vec2, variant: (i % 3) as 0 | 1 | 2, scale: 1 + (i % 7) * 0.05,
}));
const instances = (ms: THREE.InstancedMesh[], part: 'trunk' | 'crown') => ms.filter((m) => m.name === part).reduce((s, m) => s + m.count, 0);
const cellKey = (x: number, z: number): string => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const positionAt = (m: THREE.InstancedMesh, i: number): string => {
  const v = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(m.instanceMatrix.array, i * 16));
  return `${v.x},${v.z}`;
};
/** Posiciones de los árboles que se dibujan: las primeras `count` instancias de cada malla de esa parte. */
const drawn = (ms: THREE.InstancedMesh[], part: 'trunk' | 'crown'): Set<string> =>
  new Set(ms.filter((m) => m.name === part).flatMap((m) => Array.from({ length: m.count }, (_, i) => positionAt(m, i))));
const expected = (density: number): Set<string> =>
  new Set(trees.filter((_, i) => keepTree(i, density)).map((t) => `${t.position[0]},${t.position[1]}`));
/** Alto, ancho y base de la copa de cada variante (las de antes de juntarlas en una sola malla). */
const CROWN = [{ y: 2.8, w: 8.5, h: 5.5 }, { y: 2.6, w: 6.5, h: 6.8 }, { y: 2.9, w: 7, h: 5 }];
const TRUNK_H = [4.2, 4.6, 4.0];

describe('árboles', () => {
  test('todas las variantes juntas: un tronco y una copa por celda de 250 m', () => {
    const ms = buildTrees(trees, 1);
    expect(instances(ms, 'trunk')).toBe(2000);
    expect(instances(ms, 'crown')).toBe(2000);
    const cells = new Set(trees.map((t) => cellKey(...t.position)));
    expect(cells.size).toBe(8);
    for (const part of ['trunk', 'crown'] as const) {
      const meshes = ms.filter((m) => m.name === part);
      expect(meshes).toHaveLength(cells.size);
      // cada malla tiene los árboles de una sola celda
      const keys = meshes.map((m) => new Set(Array.from({ length: m.count }, (_, i) => cellKey(...(positionAt(m, i).split(',').map(Number) as Vec2)))));
      for (const k of keys) expect(k.size).toBe(1);
      expect(new Set(keys.map((k) => [...k][0])).size).toBe(cells.size);
    }
    expect(ms).toHaveLength(2 * cells.size);
  });

  test('densidad < 1: el mismo subconjunto determinista de antes de partir en celdas, y anidado', () => {
    const half = trees.filter((_, i) => keepTree(i, 0.5)).length;
    expect(half / trees.length).toBeGreaterThan(0.45);
    expect(half / trees.length).toBeLessThan(0.55);
    const a = buildTrees(trees, 0.5), b = buildTrees(trees, 0.5);
    expect(instances(a, 'trunk')).toBe(half);
    expect(instances(a, 'crown')).toBe(half);
    expect(drawn(a, 'trunk')).toEqual(expected(0.5));
    expect(drawn(a, 'crown')).toEqual(expected(0.5));
    const m = new THREE.Matrix4(), n = new THREE.Matrix4();
    a.forEach((mesh, k) => {
      expect(b[k].count).toBe(mesh.count);
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        b[k].getMatrixAt(i, n);
        expect(m.equals(n)).toBe(true);
      }
    });
    // densidad más alta conserva los mismos árboles y suma otros (no salta de un subconjunto a otro)
    for (let i = 0; i < trees.length; i++) if (keepTree(i, 0.3)) expect(keepTree(i, 0.6)).toBe(true);
    expect(trees.every((_, i) => keepTree(i, 1))).toBe(true);
    // setTreeDensity sobre las mismas mallas: 0,3 ⊂ 0,6 ⊂ 1, cada uno igual al de keepTree
    setTreeDensity(a, 0.3);
    const low = drawn(a, 'crown');
    expect(low).toEqual(expected(0.3));
    setTreeDensity(a, 0.6);
    const mid = drawn(a, 'crown');
    expect(mid).toEqual(expected(0.6));
    for (const p of low) expect(mid.has(p)).toBe(true);
    setTreeDensity(a, 1);
    expect(instances(a, 'trunk')).toBe(2000);
    for (const mesh of a) expect(mesh.boundingSphere).toBeNull(); // se recalcula con las instancias que quedan
  });

  test('cada copa tiene el tamaño de su variante y su tercio del atlas de hojas', () => {
    const ms = buildTrees(trees, 1);
    const byPos = new Map(trees.map((t) => [`${t.position[0]},${t.position[1]}`, t]));
    const crowns = ms.filter((m) => m.name === 'crown');
    const geo = crowns[0].geometry;
    geo.computeBoundingBox();
    // copa de 1 × 1: planos verticales de ±0,5 y de y 0 a 1 (las esquinas de los horizontales, girados, llegan a 0,5·√2)
    expect(geo.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(geo.boundingBox!.max.y).toBeCloseTo(1, 6);
    const { min, max } = geo.boundingBox!;
    expect(Math.max(max.x, max.z, -min.x, -min.z)).toBeLessThanOrEqual(0.5 * Math.SQRT2 + 1e-6);
    const mat = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const c of crowns) {
      const slot = c.geometry.getAttribute('leafSlot') as THREE.InstancedBufferAttribute;
      expect(slot).toBeInstanceOf(THREE.InstancedBufferAttribute);
      expect(c.geometry.getAttribute('position')).toBe(geo.getAttribute('position')); // misma geometría en la GPU
      for (let i = 0; i < c.count; i++) {
        c.getMatrixAt(i, mat);
        mat.decompose(p, q, s);
        const t = byPos.get(`${p.x},${p.z}`)!;
        const v = CROWN[t.variant];
        expect(slot.getX(i)).toBe(t.variant);
        expect(p.y).toBeCloseTo(v.y * t.scale, 5);
        expect(s.x).toBeCloseTo(v.w * t.scale, 5);
        expect(s.y).toBeCloseTo(v.h * t.scale, 5);
        expect(s.z).toBeCloseTo(v.w * t.scale, 5);
      }
    }
  });

  test('las copas leen su tercio del atlas también en la sombra (los shaders de three tienen dónde engancharse)', () => {
    const crown = buildTrees(trees, 1).find((m) => m.name === 'crown')!;
    const patch = (mat: THREE.Material, lib: { vertexShader: string; fragmentShader: string }): string => {
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} };
      mat.onBeforeCompile(shader as never, {} as never);
      return shader.vertexShader;
    };
    for (const vs of [patch(crown.material as THREE.Material, THREE.ShaderLib.lambert), patch(crown.customDepthMaterial!, THREE.ShaderLib.depth)]) {
      expect(vs).toContain('attribute float leafSlot;');
      expect(vs).toMatch(/vMapUv\.x = \( vMapUv\.x \+ leafSlot \) \/ 3\.0;/);
    }
  });

  test('tronco octogonal de radio 0,3 (como la colisión), en la posición del árbol', () => {
    const ms = buildTrees([{ position: [12, -7], variant: 1, scale: 1.2 }], 1);
    const trunk = ms.find((m) => m.name === 'trunk')!;
    expect(trunk.count).toBe(1);
    const mat = new THREE.Matrix4();
    trunk.getMatrixAt(0, mat);
    const p = new THREE.Vector3().setFromMatrixPosition(mat);
    expect([p.x, p.z]).toEqual([12, -7]);
    // radio exacto en la base: la escala del árbol no ensancha el tronco
    const pos = trunk.geometry.getAttribute('position');
    const sx = new THREE.Vector3().setFromMatrixColumn(mat, 0).length();
    let rMax = 0;
    for (let i = 0; i < pos.count; i++) rMax = Math.max(rMax, Math.hypot(pos.getX(i), pos.getZ(i)) * sx);
    expect(rMax).toBeCloseTo(0.3, 4);
    // alto del tronco de la variante (plátano: 4,6 m) por la escala del árbol
    trunk.geometry.computeBoundingBox();
    expect(trunk.geometry.boundingBox!.max.y - trunk.geometry.boundingBox!.min.y).toBeCloseTo(1, 6);
    expect(new THREE.Vector3().setFromMatrixColumn(mat, 1).length()).toBeCloseTo(TRUNK_H[1] * 1.2, 5);
  });

  test('las copas proyectan sombra recortada por alpha-test', () => {
    for (const m of buildTrees(trees, 1).filter((x) => x.name === 'crown')) {
      expect(m.castShadow).toBe(true);
      const depth = m.customDepthMaterial as THREE.MeshDepthMaterial;
      expect(depth).toBeInstanceOf(THREE.MeshDepthMaterial);
      expect(depth.alphaTest).toBeGreaterThan(0);
      expect(depth.map).toBe((m.material as THREE.MeshLambertMaterial).map);
    }
  });
});

describe('plazas', () => {
  const park: Vec2[] = [[0, 0], [40, 0], [40, -40], [0, -40]];
  const road = (id: string, points: Vec2[]): Road => ({ id, kind: 'footway', width: 2.5, sidewalk: 0, points });
  const roads: Road[] = [
    road('adentro', [[5, -5], [20, -20], [35, -30]]),
    road('afuera', [[60, -5], [80, -5]]),
    // empieza adentro pero el tramo del medio queda afuera: lo dibuja chunks como vereda
    road('cruza', [[30, -10], [50, -10], [70, -10], [90, -10]]),
    { id: 'calle', kind: 'residential', width: 8, sidewalk: 2, points: [[-20, 10], [100, 10]] },
  ];
  const props: Prop[] = [
    { kind: 'bench', position: [10, -10], rotation: 0.3 },
    { kind: 'bench', position: [20, -12], rotation: 2 },
    { kind: 'bench', position: [30, -25], rotation: -1 },
    { kind: 'fountain', position: [20, -20], radius: 2.5 },
    { kind: 'dumpster', position: [60, -20], rotation: 0 },
  ];
  const map = {
    version: 1, origin: { lat: 0, lon: 0 }, bounds: { minX: -50, maxX: 150, minZ: -100, maxZ: 50 },
    buildings: [], outskirts: [], roads, railways: [], platforms: [], parks: [{ id: 'p1', polygon: park }],
    places: [], props, trees: [], randomSpawns: [], lootSpots: [], signs: [], interiors: [],
  } satisfies MapData;

  const group = buildParks(map, materials);
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });

  test('un banco y una fuente por prop, en su lugar', () => {
    const benches = meshes.find((m) => m.name === 'bench') as THREE.InstancedMesh;
    expect(benches.count).toBe(3);
    const mat = new THREE.Matrix4();
    props.filter((p): p is Extract<Prop, { kind: 'bench' }> => p.kind === 'bench').forEach((b, i) => {
      benches.getMatrixAt(i, mat);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      mat.decompose(p, q, s);
      expect([p.x, p.z]).toBeCloseTo2D(b.position, 5);
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      expect([x.x, x.z]).toBeCloseTo2D([Math.cos(b.rotation), -Math.sin(b.rotation)], 5);
    });
    benches.geometry.computeBoundingBox();
    const size = benches.geometry.boundingBox!.getSize(new THREE.Vector3()).toArray().map((v) => Math.round(v * 1e4) / 1e4);
    expect(size).toEqual([1.8, 0.5, 0.6]);
    const fountains = meshes.filter((m) => m.name.startsWith('fountain')) as THREE.InstancedMesh[];
    expect(fountains.length).toBeGreaterThan(0);
    for (const f of fountains) expect(f.count).toBe(1);
    // borde de 0,6 m y octógono de radio 2,5 (la colisión de la fuente)
    const basin = fountains.find((m) => m.name === 'fountainBasin')!;
    basin.geometry.computeBoundingBox();
    expect(basin.geometry.boundingBox!.max.y).toBeCloseTo(0.6);
    basin.getMatrixAt(0, mat);
    const p = new THREE.Vector3().setFromMatrixPosition(mat);
    expect([p.x, p.z]).toBeCloseTo2D([20, -20], 5);
    const scale = new THREE.Vector3().setFromMatrixColumn(mat, 0).length();
    expect(basin.geometry.boundingBox!.max.x * scale).toBeCloseTo(2.5, 4);
  });

  test('senderos de la plaza: los mismos footway que chunks.ts deja afuera, ni uno más', () => {
    expect(roads.map((r) => isParkFootway(r, map.parks))).toEqual([true, false, false, false]);
    const paths = meshes.filter((m) => m.name === 'path');
    expect(paths).toHaveLength(1);
    expect(paths[0].material).toBe(materials.path);
    expect(triArea(paths[0].geometry)).toBeCloseTo(triArea(ribbon(roads[0].points, 2.5, 0.06)), 3);
    const y = paths[0].geometry.getAttribute('position').getY(0);
    expect(y).toBeCloseTo(0.06);

    // chunks.ts dibuja como vereda exactamente los footway que no son de la plaza
    const sidewalkArea = buildChunks({ ...map, roads: roads.filter((r) => r.kind === 'footway') }, materials)
      .flatMap((g) => g.children as THREE.Mesh[]).filter((m) => m.name === 'sidewalk').reduce((s, m) => s + triArea(m.geometry), 0);
    const outside = roads.filter((r) => r.kind === 'footway' && !isParkFootway(r, map.parks));
    expect(sidewalkArea).toBeCloseTo(outside.reduce((s, r) => s + triArea(ribbon(r.points, r.width, 0.06)), 0), 3);
  });

  test('las mallas con materiales de WorldMaterials se llaman como su clave', () => {
    for (const m of meshes) {
      const key = KEYS.find((k) => materials[k] === m.material);
      if (key) expect(m.name).toBe(key);
    }
  });
});
