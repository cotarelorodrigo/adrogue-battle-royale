import * as THREE from 'three';
import { extrudeBuilding, ribbon, polygonGeometry, BAY_W } from '../../src/client/world/geometry.ts';
import { buildChunks, CHUNK } from '../../src/client/world/chunks.ts';
import type { WorldMaterials } from '../../src/client/world/types.ts';
import { heightFor, FLOOR_H } from '../../src/mapgen/buildings.ts';
import { polygonArea } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, MapData, Road } from '../../src/shared/mapdata.ts';

const mk = (id: string, footprint: Vec2[], over: Partial<Building> = {}): Building => ({
  id, footprint, floors: 2, height: heightFor(2), kind: 'house', wall: 'plaster', tint: '#d8c8a8', ...over,
});
// CCW desde arriba (shoelace sobre (x, −z) > 0)
const sq = (x: number, z: number, s = 10): Vec2[] => [[x, z], [x + s, z], [x + s, z - s], [x, z - s]];
const square10 = mk('sq', sq(0, 0));
const lShape = mk('L', [[0, 0], [20, 0], [20, -10], [10, -10], [10, -20], [0, -20]]);

const posOf = (g: THREE.BufferGeometry) => g.getAttribute('position') as THREE.BufferAttribute;
const triangles = (g: THREE.BufferGeometry) => {
  const p = posOf(g);
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i);
  const out: THREE.Vector3[][] = [];
  for (let i = 0; i < idx.length; i += 3) out.push([0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, idx[i + k])));
  return out;
};
const areaOf = (g: THREE.BufferGeometry) => triangles(g).reduce((s, [a, b, c]) => s + new THREE.Triangle(a, b, c).getArea(), 0);
const hasNaN = (g: THREE.BufferGeometry) => Object.values(g.attributes).some((a) => Array.from(a.array).some(Number.isNaN));
const maxOf = (g: THREE.BufferGeometry, attr: string, comp: number) => {
  const a = g.getAttribute(attr);
  let m = -Infinity;
  for (let i = 0; i < a.count; i++) m = Math.max(m, a.getComponent(i, comp));
  return m;
};
/** Para cada triángulo: normal geométrica (por winding), normal del atributo y punto medio. */
const faces = (g: THREE.BufferGeometry, cb: (geo: THREE.Vector3, attr: THREE.Vector3, mid: THREE.Vector3) => void) => {
  const n = g.getAttribute('normal');
  const idx = g.index!.array;
  triangles(g).forEach(([a, b, c], t) => {
    const geo = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
    const attr = new THREE.Vector3().fromBufferAttribute(n as THREE.BufferAttribute, idx[t * 3]);
    cb(geo, attr, new THREE.Vector3().add(a).add(b).add(c).divideScalar(3));
  });
};

const g = extrudeBuilding({ ...square10, height: heightFor(2), floors: 2 });

describe('extrudeBuilding', () => {
  test('normales de pared hacia afuera (atributo y winding)', () => {
    const centroid = new THREE.Vector3(5, 3, -5);
    for (const geo of [g.walls.ground, g.walls.upper]) {
      faces(geo, (n, an, mid) => {
        const out = new THREE.Vector3(mid.x - centroid.x, 0, mid.z - centroid.z);
        expect(n.dot(out)).toBeGreaterThan(0);
        expect(an.dot(out)).toBeGreaterThan(0);
        expect(n.y).toBeCloseTo(0);
      });
    }
  });

  test('UV en módulos de 3 m × 3,2 m', () => {
    expect(BAY_W).toBe(3);
    expect(maxOf(g.walls.ground, 'uv', 0)).toBeCloseTo(40 / 3);
    expect(maxOf(g.walls.ground, 'uv', 1)).toBeCloseTo(1);
    expect(maxOf(g.walls.upper, 'uv', 1)).toBeCloseTo(heightFor(2) / FLOOR_H);
  });

  test('techo de un cuadrado = 2 triángulos a la altura, normal +y', () => {
    expect(g.roof.index!.count).toBe(6);
    const ys = new Set(Array.from({ length: posOf(g.roof).count }, (_, i) => posOf(g.roof).getY(i)));
    expect([...ys]).toEqual([heightFor(2)]);
    faces(g.roof, (n, an) => { expect(n.y).toBeCloseTo(1); expect(an.y).toBeCloseTo(1); });
  });

  test('techo de un polígono cóncavo en L', () => {
    const r = extrudeBuilding(lShape).roof;
    expect(areaOf(r)).toBeCloseTo(polygonArea(lShape.footprint), 1);
    faces(r, (n) => expect(n.y).toBeCloseTo(1));
  });

  test('pared de L: normales hacia afuera en todas las caras', () => {
    const w = extrudeBuilding(lShape).walls.upper;
    faces(w, (n, an) => { expect(n.dot(an)).toBeCloseTo(1); });
  });

  test('colores = tint y atributos iguales en pared/techo/pretil', () => {
    const c = new THREE.Color().setStyle('#d8c8a8');
    const col = g.walls.ground.getAttribute('color');
    expect(col.getX(0)).toBeCloseTo(c.r);
    expect(col.getZ(0)).toBeCloseTo(c.b);
    for (const geo of [g.walls.ground, g.walls.upper, g.roof, g.parapet])
      expect(Object.keys(geo.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
  });

  test('pretil: techo en altura, tope a altura + 0,6, ancho 0,2 y sin NaN en ángulos agudos', () => {
    const h = heightFor(2);
    expect(maxOf(g.parapet, 'position', 1)).toBeCloseTo(h + 0.6);
    const tops = triangles(g.parapet).filter((t) => t.every((v) => Math.abs(v.y - (h + 0.6)) < 1e-4));
    // anillo cuadrado 10x10 con 0,2 de espesor: 100 - 9,6^2
    expect(tops.reduce((s, [a, b, c]) => s + new THREE.Triangle(a, b, c).getArea(), 0)).toBeCloseTo(100 - 9.6 * 9.6, 3);
    const acute = mk('ac', [[0, 0], [30, -1], [30, 1]].reverse().map(([x, z]) => [x, z] as Vec2));
    const e = extrudeBuilding(acute);
    for (const geo of [e.walls.ground, e.walls.upper, e.roof, e.parapet]) expect(hasNaN(geo)).toBe(false);
    expect(maxOf(e.parapet, 'position', 1)).toBeCloseTo(acute.height + 0.6);
  });
});

describe('ribbon / polygonGeometry', () => {
  test('cinta: área ≈ largo × ancho y sin NaN en giros cerrados', () => {
    expect(areaOf(ribbon([[0, 0], [100, 0]], 8, 0))).toBeCloseTo((100 + 8) * 8, 0);
    expect(hasNaN(ribbon([[0, 0], [10, 0], [0, 0.5]], 8, 0))).toBe(false);
    expect(hasNaN(ribbon([[0, 0], [10, 0], [10, 0], [0, 0]], 8, 0))).toBe(false);
  });

  test('cinta: normales +y, a la altura pedida, UV cada 4 m', () => {
    const r = ribbon([[0, 0], [50, 0], [50, 30]], 8, 0.02);
    faces(r, (n, an) => { expect(n.y).toBeCloseTo(1); expect(an.y).toBeCloseTo(1); });
    expect(maxOf(r, 'position', 1)).toBeCloseTo(0.02);
    expect(maxOf(r, 'uv', 0)).toBeCloseTo(8 / 4);
    expect(maxOf(r, 'uv', 1)).toBeGreaterThan(80 / 4);
    expect(Object.keys(r.attributes).sort()).toEqual(['normal', 'position', 'uv']);
  });

  test('polígono de suelo: normal +y, área y UV x/uvScale', () => {
    const p = polygonGeometry([[0, 0], [10, 0], [10, 10], [0, 10]], 0, 4);
    expect(areaOf(p)).toBeCloseTo(100);
    faces(p, (n, an) => { expect(n.y).toBeCloseTo(1); expect(an.y).toBeCloseTo(1); });
    expect(maxOf(p, 'uv', 0)).toBeCloseTo(2.5);
  });
});

const fake = (): WorldMaterials => {
  const m = () => new THREE.MeshBasicMaterial();
  return { wallGroundHouse: m(), wallGroundShop: m(), wallUpper: m(), brickGround: m(), brickUpper: m(), roof: m(),
    parapet: m(), asphalt: m(), sidewalk: m(), grass: m(), path: m(), platform: m(), rail: m() };
};
const road = (id: string, kind: Road['kind'], points: Vec2[], width = 8, sidewalk = 2): Road => ({ id, kind, width, sidewalk, points });
const baseMap = (over: Partial<MapData>): MapData => ({
  version: 1, origin: { lat: 0, lon: 0 }, bounds: { minX: 0, maxX: 400, minZ: 0, maxZ: 200 },
  buildings: [], outskirts: [], roads: [], railways: [], platforms: [], parks: [], places: [], props: [], trees: [],
  randomSpawns: [], ...over,
});
const meshes = (groups: THREE.Group[]) => groups.flatMap((gr) => gr.children as THREE.Mesh[]);
const namesIn = (groups: THREE.Group[], i: number, j: number) =>
  (groups.find((gr) => gr.userData.chunk[0] === i && gr.userData.chunk[1] === j)?.children ?? []).map((c) => c.name).sort();

describe('buildChunks', () => {
  // A: casa de revoque en chunk (0,0). B: local de ladrillo en chunk (1,0).
  const A = mk('A', sq(10, 20));
  const B = mk('B', sq(300, 20), { kind: 'shop', wall: 'brick', tint: '#a05a3a' });
  const park = { id: 'p', polygon: [[100, 150], [140, 150], [140, 190], [100, 190]] as Vec2[] };
  const mapFixture = baseMap({
    buildings: [A, B],
    // puntos medios de segmentos: x=220 (chunk 0), 250 y 280 (chunk 1) -> la ruta cruza el límite
    roads: [
      road('r', 'residential', [[200, 100], [240, 100], [260, 100], [300, 100]]),
      road('fw-in', 'footway', [[110, 160], [130, 180]], 2, 0),
      road('fw-out', 'footway', [[10, 60], [30, 60]], 2, 0),
    ],
    parks: [park],
  });
  const mats = fake();
  const groups = buildChunks(mapFixture, mats);

  test('cantidad de mallas = pares (chunk, material) no vacíos', () => {
    // Suelo: bounds expandidos 150 -> x∈[-150,550] (chunks -1..2), z∈[-150,350] (chunks -1..1) = 12 chunks con 'grass'.
    // Chunk (0,0): paredes planta+altas (casa), techo, pretil, asfalto, vereda = 6.
    // Chunk (1,0): idem con ladrillo = 6. Footway del parque no agrega nada; el de afuera usa 'sidewalk' (ya presente).
    expect(meshes(groups).length).toBe(12 + 6 + 6);
  });

  test('chunks: userData.chunk, nombre por material, sombras y esfera envolvente', () => {
    expect(CHUNK).toBe(250);
    expect(groups.map((gr) => gr.userData.chunk.join(',')).sort()).toContain('1,0');
    expect(namesIn(groups, 0, 0)).toEqual(['asphalt', 'grass', 'parapet', 'roof', 'sidewalk', 'wallGroundHouse', 'wallUpper']);
    expect(namesIn(groups, 1, 0)).toEqual(['asphalt', 'brickGround', 'brickUpper', 'grass', 'parapet', 'roof', 'sidewalk']);
    for (const m of meshes(groups)) {
      expect(m.receiveShadow).toBe(true);
      expect(m.castShadow).toBe(['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet'].includes(m.name));
      expect(m.material).toBe((mats as unknown as Record<string, THREE.Material>)[m.name]);
      expect(m.geometry.boundingSphere).not.toBeNull();
      expect(Number.isFinite(m.geometry.boundingSphere!.radius)).toBe(true);
    }
  });

  test('shop usa wallGroundShop si es revoque', () => {
    const gs = buildChunks(baseMap({ buildings: [mk('S', sq(10, 20), { kind: 'shop' }), mk('Ap', sq(50, 20), { kind: 'apartments' })] }), fake());
    expect(namesIn(gs, 0, 0)).toContain('wallGroundShop');
    expect(namesIn(gs, 0, 0)).not.toContain('wallGroundHouse');
  });

  test('ruta que cruza el límite de chunk deja cinta en ambos', () => {
    const sidewalkPos = (i: number) => {
      const m = groups.find((gr) => gr.userData.chunk[0] === i && gr.userData.chunk[1] === 0)!.children.find((c) => c.name === 'asphalt') as THREE.Mesh;
      return posOf(m.geometry);
    };
    expect(sidewalkPos(0).count).toBeGreaterThan(0);
    expect(sidewalkPos(1).count).toBeGreaterThan(0);
  });

  test('footway: dentro de un parque no se dibuja; afuera -> sidewalk; pedestrian -> sidewalk', () => {
    const only = (rs: Road[]) => buildChunks(baseMap({ roads: rs, parks: [park] }), fake()).flatMap((gr) => gr.children as THREE.Mesh[]).filter((m) => m.name !== 'grass');
    expect(only([road('a', 'footway', [[110, 160], [130, 180]], 2, 0)])).toHaveLength(0);
    expect(only([road('b', 'footway', [[10, 60], [30, 60]], 2, 0)]).map((m) => m.name)).toEqual(['sidewalk']);
    expect(only([road('c', 'pedestrian', [[10, 60], [30, 60]], 6, 0)]).map((m) => m.name)).toEqual(['sidewalk']);
    // calle sin vereda: solo asfalto
    expect(only([road('d', 'service', [[10, 60], [30, 60]], 4, 0)]).map((m) => m.name)).toEqual(['asphalt']);
  });

  test('geometría fusionada sin NaN', () => {
    for (const m of meshes(groups)) expect(hasNaN(m.geometry)).toBe(false);
  });
});
