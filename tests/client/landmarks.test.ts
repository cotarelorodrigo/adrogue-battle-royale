// @vitest-environment jsdom
import * as THREE from 'three';
import { buildMonuments, buildStation } from '../../src/client/world/landmarks.ts';
import type { WorldMaterials } from '../../src/client/world/types.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { MapData, Prop } from '../../src/shared/mapdata.ts';
import { stubCanvas } from './canvas-stub.ts';

// Las mallas se arman al recolectar los tests (fuera de beforeEach): el canvas falso se instala antes.
stubCanvas();
afterAll(() => vi.restoreAllMocks());

const KEYS = ['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'asphalt', 'cobble',
  'sidewalk', 'grass', 'path', 'platform', 'rail'] as const;
const materials = Object.fromEntries(KEYS.map((k) => [k, new THREE.MeshBasicMaterial({ name: k })])) as unknown as WorldMaterials;

const meshesOf = (o: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if (c instanceof THREE.Mesh) out.push(c); });
  return out;
};
const worldBox = (m: THREE.Mesh): THREE.Box3 => {
  m.updateWorldMatrix(true, false);
  if (m instanceof THREE.InstancedMesh) {
    const box = new THREE.Box3(), mat = new THREE.Matrix4();
    m.geometry.computeBoundingBox();
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, mat);
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(mat));
    }
    return box;
  }
  return new THREE.Box3().setFromObject(m);
};

// Dos vías norte–sur en x = 0 y x = 4,2; andenes laterales de 4 m con el borde a 1,7 m del eje de la vía más cercana.
const track = (x: number): Vec2[] => [[x, -300], [x, 300]];
const westPlatform: Vec2[] = [[-5.7, -50], [-1.7, -50], [-1.7, 50], [-5.7, 50]];
const eastPlatform: Vec2[] = [[5.9, -50], [9.9, -50], [9.9, 50], [5.9, 50]];
const map = {
  version: 1, origin: { lat: 0, lon: 0 }, bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  buildings: [], outskirts: [], roads: [], railways: [track(0), track(4.2)], platforms: [westPlatform, eastPlatform], parks: [],
  places: [{ id: 'estacion-adrogue', name: 'Estación Adrogué', type: 'station', position: [12, 10], enterable: false, spawn: [12, 0, 10] }],
  props: [], trees: [], randomSpawns: [], signs: [],
} satisfies MapData;

describe('estación', () => {
  const g = buildStation(map, materials);
  const meshes = meshesOf(g);

  test('andenes: prismas de 1 m de alto con la planta del MapData', () => {
    const platform = meshes.filter((m) => m.material === materials.platform);
    expect(platform.length).toBeGreaterThan(0);
    for (const m of platform) expect(m.name).toBe('platform');
    const box = platform.reduce((b, m) => b.union(worldBox(m)), new THREE.Box3());
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(1);
    expect(box.min.x).toBeCloseTo(-5.7);
    expect(box.max.x).toBeCloseTo(9.9);
  });

  test('borde amarillo del lado de la vía, sobre el andén', () => {
    const edge = meshes.find((m) => m.name === 'platformEdge')!;
    const pos = edge.geometry.getAttribute('position');
    const xs: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThan(1);
      expect(pos.getY(i)).toBeLessThan(1.02);
      xs.push(pos.getX(i));
    }
    // andén oeste: franja pegada a x = −1,7 (hacia la vía), nunca en x = −5,7; andén este: pegada a x = 5,9
    const west = xs.filter((x) => x < 2), east = xs.filter((x) => x > 2);
    expect(Math.max(...west)).toBeCloseTo(-1.7);
    expect(Math.min(...west)).toBeGreaterThan(-2.5);
    expect(Math.min(...east)).toBeCloseTo(5.9);
    expect(Math.max(...east)).toBeLessThan(6.7);
  });

  test('la punta del andén no lleva borde aunque la vía la toque (datos de OSM)', () => {
    // un desvío termina a 30 cm de la punta sur del andén oeste: esa punta es lo más cercano a una vía
    const spur: Vec2[] = [[-3.7, 50.3], [-3.7, 120]];
    const g = buildStation({ ...map, railways: [track(0), spur], platforms: [westPlatform] }, materials);
    const edge = meshesOf(g).find((m) => m.name === 'platformEdge')!;
    const pos = edge.geometry.getAttribute('position');
    expect(pos.count).toBe(4); // un solo cuadrilátero: el lado largo que da a la vía
    for (let i = 0; i < pos.count; i++) expect(pos.getX(i)).toBeGreaterThan(-2.1);
  });

  test('vías con rieles y durmientes instanciados cada 0,6 m, partidos en celdas de 250 m', () => {
    const rails = meshes.filter((m) => m.material === materials.rail);
    expect(rails.length).toBe(1);
    expect(rails[0].name).toBe('rail');
    const sleepers = meshes.filter((m) => m.name === 'sleepers') as THREE.InstancedMesh[];
    // las vías van de z −250 a 250 (recortadas al suelo: bounds + 150 m de margen): al menos las celdas z < 0 y z ≥ 0
    expect(sleepers.length).toBeGreaterThanOrEqual(2);
    for (const m of sleepers) {
      expect(m).toBeInstanceOf(THREE.InstancedMesh);
      const cells = new Set(Array.from({ length: m.count }, (_, i) => {
        const e = m.instanceMatrix.array;
        return `${Math.floor(e[i * 16 + 12] / 250)},${Math.floor(e[i * 16 + 14] / 250)}`;
      }));
      expect(cells.size).toBe(1); // cada malla, los durmientes de una sola celda
    }
    // dos vías de 600 m recortadas a 500 m → ~833 durmientes cada una
    const total = sleepers.reduce((n, m) => n + m.count, 0);
    expect(total).toBeGreaterThan(2 * 800);
    expect(total).toBeLessThan(2 * 860);
  });

  test('dos carteles ADROGUÉ por andén', () => {
    const signs = meshes.filter((m) => m.name === 'stationSigns');
    expect(signs).toHaveLength(1); // los 4 carteles comparten textura: una sola malla
    expect(signs[0].geometry.getAttribute('position').count).toBe(4 * 24); // 4 cajas de 24 vértices
  });

  test('a lo sumo 9 draw calls más los durmientes (uno por celda)', () => {
    expect(meshes.filter((m) => m.name !== 'sleepers').length).toBeLessThanOrEqual(9);
  });
});

describe('monumentos', () => {
  const props: Prop[] = [
    { kind: 'monument', placeId: 'a', position: [10, 20], style: 'statue' },
    { kind: 'monument', placeId: 'b', position: [-40, 5], style: 'equestrian' },
    { kind: 'monument', placeId: 'c', position: [70, -30], style: 'column' },
    { kind: 'bench', position: [0, 0], rotation: 0 },
  ];
  const meshes = meshesOf(buildMonuments(props));

  test('pedestales con la medida de la colisión: 3 × 3 × 2,5 (estatua, ecuestre) y 2 × 2 × 6 (columna)', () => {
    const pedestals = meshes.find((m) => m.name === 'pedestals')!;
    const pos = pedestals.geometry.getAttribute('position');
    const boxes = [
      { c: [10, 20], half: 1.5, h: 2.5 },
      { c: [-40, 5], half: 1.5, h: 2.5 },
      { c: [70, -30], half: 1, h: 6 },
    ];
    for (const { c, half, h } of boxes) {
      const b = new THREE.Box3();
      for (let i = 0; i < pos.count; i++) {
        if (Math.hypot(pos.getX(i) - c[0], pos.getZ(i) - c[1]) < 5) b.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i));
      }
      expect(b.min.x).toBeCloseTo(c[0] - half, 4);
      expect(b.max.x).toBeCloseTo(c[0] + half, 4);
      expect(b.min.z).toBeCloseTo(c[1] - half, 4);
      expect(b.max.z).toBeCloseTo(c[1] + half, 4);
      expect(b.min.y).toBeCloseTo(0, 4);
      expect(b.max.y).toBeCloseTo(h, 4);
    }
  });

  test('figura de bronce arriba de cada pedestal', () => {
    const figures = meshes.find((m) => m.name === 'figures')!;
    const box = worldBox(figures);
    expect(box.min.y).toBeGreaterThanOrEqual(2.5 - 1e-6);
    expect(box.max.y).toBeGreaterThan(6 + 1.5);
  });
});
