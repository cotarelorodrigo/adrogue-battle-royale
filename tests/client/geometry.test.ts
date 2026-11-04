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

describe('edificio bajo', () => {
  test('altura 3,0 (< FLOOR_H): paredes terminan en height y sin banda superior', () => {
    const e = extrudeBuilding({ ...square10, height: 3.0, floors: 1 });
    expect(maxOf(e.walls.ground, 'position', 1)).toBeCloseTo(3.0);
    expect(posOf(e.walls.upper).count).toBe(0);
    const gs = buildChunks(baseMap({ buildings: [{ ...square10, height: 3.0, floors: 1 }] }), fake());
    expect(namesIn(gs, 0, 0)).not.toContain('wallUpper');
  });
});

describe('relleno de un hueco', () => {
  test('techo y paredes como cualquier edificio, sin pretil', () => {
    const e = extrudeBuilding({ ...square10, fill: true });
    expect(posOf(e.parapet).count).toBe(0);
    expect(areaOf(e.roof)).toBeCloseTo(100);
    expect(posOf(e.walls.ground).count).toBeGreaterThan(0);
    expect(namesIn(buildChunks(baseMap({ buildings: [{ ...square10, fill: true }] }), fake()), 0, -1)).not.toContain('parapet');
  });
});

describe('lotes en buildChunks', () => {
  test('10 lotes en un chunk dan una sola malla front y sus medianeras van a parapet', () => {
    const lots = Array.from({ length: 10 }, (_, i) => mk(`l${i}`, [[10 + i * 10, 20], [19 + i * 10, 20], [19 + i * 10, 8], [10 + i * 10, 8]], {
      kind: 'shop', tint: i % 2 ? '#d9d2c3' : '#7a9e6b', front: { edges: [0], corner: [], pb: 'vidriera', arriba: 'ventanas', puerta: 'inicio' },
    }));
    const groups = buildChunks(baseMap({ buildings: lots }), fake());
    const names = namesIn(groups, 0, 0);
    expect(names.filter((n) => n === 'front')).toHaveLength(1);
    // el pretil de cada lote más sus medianeras y fondo (ground + upper): los muros laterales llegan a parapet
    const expected = lots.reduce((n, l) => { const e = extrudeBuilding(l); return n + [e.parapet, e.walls.ground, e.walls.upper].reduce((m, g) => m + posOf(g).count, 0); }, 0);
    expect(posOf(meshes(groups).find((m) => m.name === 'parapet')!.geometry).count).toBe(expected);
    expect(names).not.toContain('wallGroundShop');
    expect(names).not.toContain('wallUpper');
    const front = meshes(groups).find((m) => m.name === 'front')!;
    expect(front.castShadow).toBe(true);
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
    parapet: m(), asphalt: m(), cobble: m(), sidewalk: m(), grass: m(), path: m(), platform: m(), rail: m(), front: m() };
};
const road = (id: string, kind: Road['kind'], points: Vec2[], width = 8, sidewalk = 2): Road => ({ id, kind, width, sidewalk, points });
const baseMap = (over: Partial<MapData>): MapData => ({
  version: 1, origin: { lat: 0, lon: 0 }, bounds: { minX: 0, maxX: 400, minZ: 0, maxZ: 200 },
  buildings: [], outskirts: [], roads: [], railways: [], platforms: [], parks: [], places: [], props: [], trees: [],
  randomSpawns: [], lootSpots: [], signs: [], ...over,
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

  test('un edificio que cruza el borde del área con el centroide afuera va al chunk de adentro (sin merges nuevos)', () => {
    // x de −8 a 2: centroide en x = −3 (chunk −1), pero el área empieza en x = 0 (chunk 0)
    const gs = buildChunks(baseMap({ buildings: [mk('A', sq(10, 20)), mk('X', [[-8, 20], [2, 20], [2, 10], [-8, 10]])] }), fake());
    expect(namesIn(gs, -1, 0)).toEqual(['grass']);
    expect(namesIn(gs, 0, 0)).toEqual(['grass', 'parapet', 'roof', 'wallGroundHouse', 'wallUpper']);
  });

  test('shop usa wallGroundShop si es revoque', () => {
    const gs = buildChunks(baseMap({ buildings: [mk('S', sq(10, 20), { kind: 'shop' }), mk('Ap', sq(50, 20), { kind: 'apartments' })] }), fake());
    expect(namesIn(gs, 0, 0)).toContain('wallGroundShop');
    expect(namesIn(gs, 0, 0)).not.toContain('wallGroundHouse');
  });

  describe('fachada por lugar (facades): la banda baja de esa arista cambia de material y de tinte', () => {
    // casa de revoque 10 × 10 con la arista 0 ((10,20) → (20,20), z = 20) como local; mismo chunk (0,0)
    const shop = mk('L', sq(10, 20), { facades: [{ edge: 0, ground: 'shop', tint: '#ff0000' }] });
    const mesh = (gs: THREE.Group[], name: string) => meshes(gs).find((m) => m.name === name);
    const quadsOf = (m: THREE.Mesh | undefined) => {
      if (!m) return [];
      const out: { mid: THREE.Vector3; color: THREE.Color }[] = [];
      const col = m.geometry.getAttribute('color');
      faces(m.geometry, (_n, _a, mid) => out.push({ mid, color: new THREE.Color() }));
      triangles(m.geometry).forEach((_, t) => out[t].color.fromBufferAttribute(col as THREE.BufferAttribute, m.geometry.index!.array[t * 3]));
      return out;
    };
    test('la arista 0 va al merge de wallGroundShop con su tinte; las otras quedan en wallGroundHouse', () => {
      const gs = buildChunks(baseMap({ buildings: [shop] }), fake());
      const shopQuads = quadsOf(mesh(gs, 'wallGroundShop'));
      const houseQuads = quadsOf(mesh(gs, 'wallGroundHouse'));
      expect(shopQuads).toHaveLength(2); // un cuadrilátero = 2 triángulos
      for (const q of shopQuads) {
        expect(q.mid.z).toBeCloseTo(20);
        expect([q.color.r, q.color.g, q.color.b]).toEqual([1, 0, 0]);
      }
      expect(houseQuads).toHaveLength(6);
      for (const q of houseQuads) expect(q.mid.z).not.toBeCloseTo(20);
      // la banda alta no cambia: las 4 aristas en wallUpper
      expect(quadsOf(mesh(gs, 'wallUpper'))).toHaveLength(8);
      // mismos merges que dos edificios cualquiera: un mesh por material y chunk
      expect(namesIn(gs, 0, 0)).toEqual(['grass', 'parapet', 'roof', 'wallGroundHouse', 'wallGroundShop', 'wallUpper']);
    });
    test('sin tint usa el del edificio; brick en un local de revoque va a brickGround', () => {
      const gs = buildChunks(baseMap({ buildings: [mk('K', sq(10, 20), { kind: 'shop', facades: [{ edge: 2, ground: 'brick' }] })] }), fake());
      const brick = quadsOf(mesh(gs, 'brickGround'));
      expect(brick).toHaveLength(2);
      for (const q of brick) {
        expect(q.mid.z).toBeCloseTo(10); // arista 2: (20,10) → (10,10)
        expect(q.color.getHexString()).toBe(new THREE.Color('#d8c8a8').getHexString());
      }
      expect(quadsOf(mesh(gs, 'wallGroundShop'))).toHaveLength(6);
    });
    test('la arista se cuenta sobre el footprint guardado aunque esté en sentido horario', () => {
      const cw = [...sq(10, 20)].reverse(); // arista 0: (10,10) → (20,10)
      const gs = buildChunks(baseMap({ buildings: [mk('W', cw, { facades: [{ edge: 0, ground: 'shop' }] })] }), fake());
      const q = quadsOf(mesh(gs, 'wallGroundShop'));
      expect(q).toHaveLength(2);
      for (const f of q) expect(f.mid.z).toBeCloseTo(10);
    });
  });

  test('ruta que cruza el límite de chunk deja cinta en ambos', () => {
    const asphaltPos = (i: number) => {
      const m = groups.find((gr) => gr.userData.chunk[0] === i && gr.userData.chunk[1] === 0)!.children.find((c) => c.name === 'asphalt') as THREE.Mesh;
      return posOf(m.geometry);
    };
    expect(asphaltPos(0).count).toBeGreaterThan(0);
    expect(asphaltPos(1).count).toBeGreaterThan(0);
  });

  test('footway: dentro de un parque no se dibuja; afuera -> sidewalk; pedestrian -> sidewalk', () => {
    const only = (rs: Road[]) => buildChunks(baseMap({ roads: rs, parks: [park] }), fake()).flatMap((gr) => gr.children as THREE.Mesh[]).filter((m) => m.name !== 'grass');
    expect(only([road('a', 'footway', [[110, 160], [130, 180]], 2, 0)])).toHaveLength(0);
    expect(only([road('b', 'footway', [[10, 60], [30, 60]], 2, 0)]).map((m) => m.name)).toEqual(['sidewalk']);
    expect(only([road('c', 'pedestrian', [[10, 60], [30, 60]], 6, 0)]).map((m) => m.name)).toEqual(['sidewalk']);
    // calle sin vereda: solo asfalto
    expect(only([road('d', 'service', [[10, 60], [30, 60]], 4, 0)]).map((m) => m.name)).toEqual(['asphalt']);
  });

  test('calle con sett: malla cobble a la altura del asfalto y ninguna asphalt; footway con sett sigue en sidewalk', () => {
    const mk = (rs: Road[]) => buildChunks(baseMap({ roads: rs }), fake()).flatMap((gr) => gr.children as THREE.Mesh[]).filter((m) => m.name !== 'grass');
    const r = { ...road('a', 'residential', [[10, 60], [30, 60]], 8, 2), surface: 'sett' as const };
    const meshes = mk([r]);
    expect(meshes.map((m) => m.name).sort()).toEqual(['cobble', 'sidewalk']);
    expect(maxOf(meshes.find((m) => m.name === 'cobble')!.geometry, 'position', 1)).toBeCloseTo(0.04);
    const f = { ...road('b', 'footway', [[10, 60], [30, 60]], 2, 0), surface: 'sett' as const };
    expect(mk([f]).map((m) => m.name)).toEqual(['sidewalk']);
  });

  test('capas del suelo: vereda 0,02 < asfalto 0,04 < sendas 0,06', () => {
    const ys = (rs: Road[]) => Object.fromEntries(buildChunks(baseMap({ roads: rs }), fake()).flatMap((gr) => gr.children as THREE.Mesh[])
      .filter((m) => m.name !== 'grass').map((m) => [m.name, maxOf(m.geometry, 'position', 1)]));
    expect(ys([road('a', 'residential', [[10, 60], [30, 60]], 8, 2)])).toEqual({ asphalt: expect.closeTo(0.04), sidewalk: expect.closeTo(0.02) });
    expect(ys([road('b', 'pedestrian', [[10, 60], [30, 60]], 6, 0)]).sidewalk).toBeCloseTo(0.06);
    expect(ys([road('c', 'footway', [[10, 60], [30, 60]], 2, 0)]).sidewalk).toBeCloseTo(0.06);
  });

  test('calles se recortan al suelo: nada fuera de bounds + margen (+ extremo)', () => {
    const m = baseMap({ roads: [
      road('long', 'residential', [[-1000, 100], [200, 100], [1400, 100]], 8, 2),
      road('far', 'residential', [[-900, 900], [-800, 900]], 8, 2),
      road('farfoot', 'footway', [[900, 10], [1000, 10]], 2, 0),
      road('diag', 'service', [[-600, -600], [200, 100]], 4, 0),
    ] });
    const gs = buildChunks(m, fake());
    const [lo, hi] = [-150, 550], [zlo, zhi] = [-150, 350]; // bounds ± 150
    for (const mesh of meshes(gs).filter((x) => x.name !== 'grass')) {
      const p = posOf(mesh.geometry);
      for (let i = 0; i < p.count; i++) {
        const e = 4 + 2 + 1e-3; // semiancho + vereda (inglete) ; margen para el extremo extendido
        expect(p.getX(i)).toBeGreaterThanOrEqual(lo - e); expect(p.getX(i)).toBeLessThanOrEqual(hi + e);
        expect(p.getZ(i)).toBeGreaterThanOrEqual(zlo - e); expect(p.getZ(i)).toBeLessThanOrEqual(zhi + e);
      }
    }
    // los chunks son exactamente los tiles del suelo: i -1..2, j -1..1
    expect(gs).toHaveLength(12);
    for (const gr of gs) {
      expect(gr.userData.chunk[0]).toBeGreaterThanOrEqual(-1); expect(gr.userData.chunk[0]).toBeLessThanOrEqual(2);
      expect(gr.userData.chunk[1]).toBeGreaterThanOrEqual(-1); expect(gr.userData.chunk[1]).toBeLessThanOrEqual(1);
    }
    // 'far' y 'farfoot' quedan totalmente afuera: sin mallas extra en sus chunks
    expect(namesIn(gs, 2, 0).includes('sidewalk')).toBe(false);
  });

  test('textura continua entre tramos: v inicial del segundo tramo = metros previos / 4', () => {
    const r = ribbon([[0, 0], [10, 0]], 8, 0, 25);
    const uv = r.getAttribute('uv');
    expect(uv.getY(0)).toBeCloseTo(25 - 4 / 4, 5); // extremo extendido h=4 antes del punto
    expect(uv.getY(2)).toBeCloseTo(25 + (10 + 4) / 4, 5); // extremo final extendido h
  });

  test('geometría fusionada sin NaN', () => {
    for (const m of meshes(groups)) expect(hasNaN(m.geometry)).toBe(false);
  });
});
