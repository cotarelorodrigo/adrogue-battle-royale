// @vitest-environment jsdom
import * as THREE from 'three';
import { OUTDOOR_EXPOSURE } from '../../src/client/render/exposure.ts';
import { SKY_LIGHT } from '../../src/client/render/sun.ts';
import { buildMonuments, buildStation } from '../../src/client/world/landmarks.ts';
import type { WorldMaterials } from '../../src/client/world/types.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { MapData, Prop } from '../../src/shared/mapdata.ts';
import { stationPosts } from '../../src/shared/station.ts';
import { linear, seenLinear } from './aces.ts';
import type { RGB } from './aces.ts';
import { canvasFill, canvasTextFills, stubCanvas } from './canvas-stub.ts';

// Las mallas se arman al recolectar los tests (fuera de beforeEach): el canvas falso se instala antes.
stubCanvas();
afterAll(() => vi.restoreAllMocks());

const KEYS = ['wallGroundHouse', 'wallGroundShop', 'wallUpper', 'brickGround', 'brickUpper', 'roof', 'parapet', 'asphalt', 'cobble',
  'sidewalk', 'grass', 'path', 'platform', 'rail', 'front'] as const;
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
  props: [], trees: [], randomSpawns: [], lootSpots: [], signs: [], interiors: [],
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
    // la franja mide 0,75 m (llega a x −2,45); la de la punta iría de x −5,7 a −1,7
    for (let i = 0; i < pos.count; i++) expect(pos.getX(i)).toBeGreaterThan(-2.5);
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

  test('los postes dibujados (alero y carteles) son los sólidos de la colisión: stationPosts', () => {
    const steel = meshes.find((m) => m.name === 'steel')!;
    const pos = steel.geometry.getAttribute('position');
    const posts = stationPosts(map);
    expect(posts).toHaveLength(18);
    for (const p of posts) {
      // el cilindro de 8 lados del poste: sus vértices a radio r del eje, abajo en y0 y arriba en y1
      let bottom = 0, top = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(Math.hypot(pos.getX(i) - p.at[0], pos.getZ(i) - p.at[1]) - p.r) > 1e-4) continue;
        if (Math.abs(pos.getY(i) - p.y0) < 1e-4) bottom++;
        if (Math.abs(pos.getY(i) - p.y1) < 1e-4) top++;
      }
      expect([bottom >= 8, top >= 8], `${p.at}`).toEqual([true, true]);
    }
  });

  test('a lo sumo 9 draw calls más los durmientes (uno por celda)', () => {
    expect(meshes.filter((m) => m.name !== 'sleepers').length).toBeLessThanOrEqual(9);
  });

  // §4.9: el alero pasa a verde, con columnas y chapa verdes, como el real. Verde ferroviario: oscuro y apagado, no flúo.
  test('el alero es verde: la chapa (canopy) y los postes y vigas (steel), con G > R y G > B, oscuros y apagados', () => {
    for (const name of ['canopy', 'steel']) {
      const m = meshes.find((x) => x.name === name)!;
      const c = (m.material as THREE.MeshLambertMaterial).color;
      const say = `${name}: #${c.getHexString()}`;
      expect(c.g > c.r && c.g > c.b, say).toBe(true);
      const hsl = c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace); // como se ve el hex, no en lineal
      expect(hsl.l, `${say}: oscuro`).toBeLessThan(0.45);
      expect(hsl.s, `${say}: apagado, no flúo`).toBeLessThan(0.5);
    }
  });

  // H8 de la revisión: el jugador lo ve casi siempre desde abajo, y la cara de abajo (sin sol: el suelo marrón de la
  // HemisphereLight por la chapa oscura) se veía negra
  test('la cara de abajo del alero se lee verde oscuro con la luz de sombra (seen, exposición de la calle), en la misma malla', () => {
    const canopy = meshes.filter((m) => m.name === 'canopy');
    expect(canopy, 'una sola malla: sin draw calls nuevos').toHaveLength(1);
    const g = canopy[0].geometry, mat = canopy[0].material as THREE.MeshLambertMaterial;
    const nor = g.getAttribute('normal'), col = g.getAttribute('color');
    expect(mat.vertexColors && col, 'color por vértice').toBeTruthy();
    // la textura acanalada: su promedio lineal (la pinta con columnas grises)
    const tex = mat.map!.image as HTMLCanvasElement;
    const T = Array.from({ length: tex.width }, (_, x) => linear(Number(/\d+/.exec(canvasFill(tex, x, 0)!)![0]) / 255)).reduce((a, b) => a + b, 0) / tex.width;
    const [sky, ground] = [new THREE.Color(SKY_LIGHT.sky), new THREE.Color(SKY_LIGHT.ground)];
    const under: number[] = [];
    for (let k = 0; k < nor.count; k++) {
      const ny = nor.getY(k);
      if (ny > 0) { expect([col.getX(k), col.getY(k), col.getZ(k)], 'la de arriba, sin tocar').toEqual([1, 1, 1]); continue; }
      under.push(k);
      // lo que le llega sin sol: la HemisphereLight en su normal, sobre π (Lambert), por el tinte, la textura y el vértice
      const w = 0.5 * ny + 0.5, light = (j: 'r' | 'g' | 'b'): number => ((ground[j] + (sky[j] - ground[j]) * w) * SKY_LIGHT.intensity) / Math.PI;
      const lin = (['r', 'g', 'b'] as const).map((j, n) => mat.color[j] * T * light(j) * col.getComponent(k, n)) as RGB;
      const [r, gg, b] = seenLinear(lin, OUTDOOR_EXPOSURE);
      const say = `visto (${r}, ${gg}, ${b})`, luma = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      expect(gg > r && gg > b, `${say}: verde`).toBe(true);
      expect(luma, `${say}: se lee (no negro)`).toBeGreaterThanOrEqual(40);
      expect(luma, `${say}: oscuro`).toBeLessThan(80);
      expect((Math.max(r, gg, b) - Math.min(r, gg, b)) / (Math.max(r, gg, b) + Math.min(r, gg, b)), `${say}: apagado, no flúo`).toBeLessThan(0.5);
    }
    expect(under.length, 'la cara de abajo de cada faldón').toBeGreaterThan(0);
  });

  // H6 de la revisión: se lee el canvas del cartel (el de la textura de su malla), no el orden de los fillStyle
  test('los carteles ADROGUÉ: fondo azul, marco azul y letras blancas', () => {
    const signs = meshes.find((m) => m.name === 'stationSigns')!;
    const canvas = ((signs.material as THREE.MeshLambertMaterial).map as THREE.CanvasTexture).image as HTMLCanvasElement;
    const azul = (hex: string | undefined): boolean => {
      const c = new THREE.Color(hex);
      return c.b > c.r && c.b > c.g && c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l < 0.45;
    };
    // el marco, en la punta; el fondo, al lado del borde del marco, a media altura (ahí no llegan las letras)
    const marco = canvasFill(canvas, 0, 0), fondo = canvasFill(canvas, Math.round(canvas.height * 0.2), Math.round(canvas.height / 2));
    expect(azul(marco), `marco ${marco}`).toBe(true);
    expect(azul(fondo), `fondo ${fondo}`).toBe(true);
    expect(fondo).not.toBe(marco);
    expect(canvasTextFills(canvas), 'las letras').toEqual(['#ffffff']);
  });

  test('la franja amarilla táctil del borde: una textura con los botones, recortada (alphaTest), sin draw calls nuevos', () => {
    const edge = meshes.find((m) => m.name === 'platformEdge')!;
    const mat = edge.material as THREE.MeshLambertMaterial;
    expect(mat.map, 'la textura de la franja').toBeTruthy();
    expect(mat.alphaTest).toBeGreaterThan(0);
    const c = mat.color;
    expect(c.r > c.b && c.g > c.b && c.r > 0.5, `amarilla: #${c.getHexString()}`).toBe(true);
    // del borde de la vía hacia adentro, entre 0,6 y 0,8 m (la línea del borde, el aire y las baldosas con botones)
    const pos = edge.geometry.getAttribute('position');
    const west: number[] = [];
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) < 2) west.push(pos.getX(i));
    const ancho = Math.max(...west) - Math.min(...west);
    expect(ancho).toBeGreaterThanOrEqual(0.6);
    expect(ancho).toBeLessThanOrEqual(0.8);
    // las uv a lo largo van en metros (la textura se repite, no se estira con el andén)
    const uv = edge.geometry.getAttribute('uv');
    let along = 0;
    for (let i = 0; i < uv.count; i++) along = Math.max(along, Math.abs(uv.getX(i)));
    expect(along).toBeGreaterThan(50);
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
