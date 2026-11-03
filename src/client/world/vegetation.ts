// Árboles (tres variantes instanciadas: ≤ 6 draw calls) y plazas (senderos, bancos y fuentes). El pasto de las plazas
// es el suelo base de chunks.ts: acá no se vuelve a dibujar.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BENCH, FOUNTAIN_H, TRUNK_R } from '../../shared/collision.ts';
import { hashIndex } from '../../shared/geo.ts';
import type { MapData, Prop, Tree } from '../../shared/mapdata.ts';
import { isParkFootway, Y_PATH } from './chunks.ts';
import { ribbon } from './geometry.ts';
import type { WorldMaterials } from './types.ts';

// ─── Árboles ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Variant {
  /** Alto del tronco visible (llega hasta adentro de la copa) y radio arriba (abajo es TRUNK_R, como la colisión). */
  trunkH: number;
  trunkTop: number;
  /** La copa: base, ancho y alto. */
  crownY: number;
  crownW: number;
  crownH: number;
  /** Racimos de hojas: verdes (oscuro → claro) y cuántos. */
  leaves: string[];
  clusters: number;
  /** Flores: una parte de los racimos en otros colores. */
  bloom?: { colors: string[]; share: number };
}

/** 0: tipa (copa ancha y baja), 1: plátano (copa redonda y alta), 2: jacarandá (copa aireada, florecida en noviembre). */
const VARIANTS: Variant[] = [
  { trunkH: 4.2, trunkTop: 0.2, crownY: 2.8, crownW: 8.5, crownH: 5.5, clusters: 1500,
    leaves: ['#263f1a', '#34522a', '#43642f', '#557837', '#6a8c40'] },
  { trunkH: 4.6, trunkTop: 0.18, crownY: 2.6, crownW: 6.5, crownH: 6.8, clusters: 1500,
    leaves: ['#1f3818', '#2c4a22', '#3a5c2a', '#4b6f33', '#5d823c'] },
  { trunkH: 4.0, trunkTop: 0.16, crownY: 2.9, crownW: 7, crownH: 5, clusters: 1200,
    leaves: ['#2c4220', '#3b5629', '#4b6a31', '#5c7c3a'], bloom: { colors: ['#7f73ad', '#968ac2', '#aa9fcf'], share: 0.3 } },
];
const LEAF_TEX = 512;
const ALPHA_TEST = 0.5;

/** ¿Se dibuja el árbol i con esta densidad? Determinista y anidado: con más densidad están los mismos y algunos más. */
export const keepTree = (i: number, density: number): boolean => density >= 1 || hashIndex(i) < density;

/** Racimos de hojas en una copa más o menos elíptica, sobre fondo transparente. Determinista (sin Math.random): los
 *  de adentro y abajo más oscuros, los del borde de arriba más claros (donde da el sol). */
function leafCanvas(v: Variant, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = LEAF_TEX;
  const ctx = c.getContext('2d')!;
  const h = (k: number): number => hashIndex(seed * 104729 + k);
  const R = LEAF_TEX / 2;
  for (let i = 0; i < v.clusters; i++) {
    const a = h(i * 7) * Math.PI * 2;
    const r = Math.sqrt(h(i * 7 + 1)) * (0.82 + 0.1 * Math.sin(a * 5 + seed) + 0.05 * Math.sin(a * 13)) * R;
    const x = R + Math.cos(a) * r, y = R + Math.sin(a) * r;
    const size = LEAF_TEX * (0.008 + 0.016 * h(i * 7 + 2));
    const light = Math.min(0.999, Math.max(0, 0.45 * (1 - y / LEAF_TEX) + 0.3 * (r / R) + 0.45 * h(i * 7 + 3) - 0.1));
    const bloom = v.bloom && h(i * 7 + 5) < v.bloom.share ? v.bloom.colors : null;
    const pal = bloom ?? v.leaves;
    ctx.fillStyle = pal[Math.floor(light * pal.length)];
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * (0.55 + 0.35 * h(i * 7 + 6)), h(i * 7 + 4) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Tronco octogonal abierto, de TRUNK_R en la base (los vértices coinciden con el octógono de la colisión). */
function trunkGeometry(v: Variant): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(v.trunkTop, TRUNK_R, v.trunkH, 8, 1, true);
  g.translate(0, v.trunkH / 2, 0);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) * v.trunkH) / 1.6); // la corteza repite cada 1,6 m
  return g;
}

/** Copa: 3 planos verticales a 60° y 3 horizontales escalonados (se ve con volumen desde la calle y desde los techos).
 *  Normales "redondas", hacia afuera y arriba; el material es de dos caras y las ilumina igual de los dos lados. */
function crownGeometry(v: Variant): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const cy = v.crownY + v.crownH / 2;
  const quad = (corners: [number, number, number][]): void => {
    const base = pos.length / 3;
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    corners.forEach(([x, y, z], k) => {
      pos.push(x, y, z);
      const n = new THREE.Vector3(x * 0.6, (y - cy) * 0.4, z * 0.6).add(new THREE.Vector3(0, 0.9 * Math.max(v.crownW, v.crownH) / 2, 0)).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(uvs[k][0], uvs[k][1]);
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const w = v.crownW / 2;
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3, ca = Math.cos(a) * w, sa = Math.sin(a) * w;
    quad([[-ca, v.crownY, sa], [ca, v.crownY, -sa], [ca, v.crownY + v.crownH, -sa], [-ca, v.crownY + v.crownH, sa]]);
  }
  // horizontales: cuadrados de lado 2·w·s a la altura t de la copa, girados rot para que no se alineen
  ([[0.3, 0.85, 0.2], [0.55, 1, 0.9], [0.8, 0.7, 0.5]] as const).forEach(([t, s, rot]) => {
    const y = v.crownY + v.crownH * t, r = w * s, c = Math.cos(rot), sn = Math.sin(rot);
    quad(([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, b]) => [(a * c - b * sn) * r, y, (a * sn + b * c) * r]));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Con DoubleSide three da vuelta la normal en la cara de atrás; las normales de la copa ya miran "hacia afuera" de
 *  todo el árbol, así que se usan tal cual de los dos lados (si no, la mitad de los planos se ve oscura). */
function sameNormalBothSides(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
    THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
}

/** Corteza para los troncos: se reduce a size² (los troncos ocupan poco en pantalla). */
export async function loadBarkTexture(url: string, size = 256): Promise<THREE.Texture> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
    im.src = url;
  });
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')!.drawImage(img, 0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Una InstancedMesh por variante y parte. Las instancias van ordenadas por su hash: con densidad d se dibujan las
 *  primeras (las de hash < d), así setTreeDensity cambia la cantidad sin rehacer nada. */
export function buildTrees(trees: Tree[], density: number, barkMap?: THREE.Texture): THREE.InstancedMesh[] {
  const trunkMat = new THREE.MeshLambertMaterial(barkMap ? { map: barkMap } : { color: '#5b4636' });
  const out: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  VARIANTS.forEach((v, vi) => {
    const list = trees.map((t, i) => ({ t, h: hashIndex(i) })).filter(({ t }) => t.variant === vi).sort((a, b) => a.h - b.h);
    if (list.length === 0) return;
    const leaf = new THREE.CanvasTexture(leafCanvas(v, vi + 1));
    leaf.colorSpace = THREE.SRGBColorSpace;
    const crownMat = new THREE.MeshLambertMaterial({ map: leaf, alphaTest: ALPHA_TEST, side: THREE.DoubleSide });
    crownMat.onBeforeCompile = sameNormalBothSides;
    const trunk = new THREE.InstancedMesh(trunkGeometry(v), trunkMat, list.length);
    const crown = new THREE.InstancedMesh(crownGeometry(v), crownMat, list.length);
    trunk.name = `trunk${vi}`;
    crown.name = `crown${vi}`;
    crown.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leaf, alphaTest: ALPHA_TEST });
    list.forEach(({ t, h }, i) => {
      p.set(t.position[0], 0, t.position[1]);
      // el tronco no se ensancha ni se gira: su octógono es el de la colisión
      trunk.setMatrixAt(i, m.compose(p, q.identity(), s.set(1, t.scale, 1)));
      crown.setMatrixAt(i, m.compose(p, q.setFromAxisAngle(UP, h * Math.PI * 2), s.setScalar(t.scale)));
    });
    for (const mesh of [trunk, crown]) {
      mesh.userData.hashes = Float64Array.from(list, (e) => e.h); // float64: el mismo corte que keepTree
      mesh.castShadow = mesh === crown; // la sombra del tronco casi no se ve y duplica sus triángulos
      mesh.receiveShadow = true;
      out.push(mesh);
    }
  });
  setTreeDensity(out, density);
  return out;
}

/** Cambia cuántos árboles se dibujan (QUALITY.treeDensity) sin rehacer las mallas. */
export function setTreeDensity(meshes: THREE.InstancedMesh[], density: number): void {
  for (const mesh of meshes) {
    const hashes = mesh.userData.hashes as Float64Array;
    let n = 0;
    while (n < hashes.length && (density >= 1 || hashes[n] < density)) n++;
    mesh.count = n;
    mesh.boundingSphere = null; // se recalcula con las instancias que quedan
  }
}

// ─── Plazas ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type Bench = Extract<Prop, { kind: 'bench' }>;
type Fountain = Extract<Prop, { kind: 'fountain' }>;

/** Radio de la fuente modelada; cada instancia se escala a su radio en x/z. */
const FOUNTAIN_R = 2.5;
const RIM_W = 0.32;
const WATER_Y = 0.5;

function colored(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const g = mergeGeometries(flat, false);
  if (!g) throw new Error('mergeGeometries falló');
  for (const p of [...parts, ...flat]) if (p !== g) p.dispose();
  return g;
}

/** Banco sin respaldo del tamaño exacto de la colisión: dos patas de hormigón y cuatro listones de madera. */
function benchGeometry(): THREE.BufferGeometry {
  const { length: l, depth: d, height: h } = BENCH;
  const seatT = 0.08, legW = 0.16, gap = 0.02, slats = 4;
  const slatD = (d - gap * (slats - 1)) / slats;
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.BoxGeometry(legW, h - seatT, d);
    leg.translate(side * (l / 2 - 0.2), (h - seatT) / 2, 0);
    parts.push(colored(leg, '#9c978c'));
  }
  for (let k = 0; k < slats; k++) {
    const slat = new THREE.BoxGeometry(l, seatT, slatD);
    slat.translate(0, h - seatT / 2, -d / 2 + slatD / 2 + k * (slatD + gap));
    parts.push(colored(slat, '#8a5a32'));
  }
  return merge(parts);
}

/** Cilindro de 8 lados con un vértice en +x, como el octágono de la colisión (CylinderGeometry arranca en +z: el
 *  octágono es el mismo conjunto de puntos). `inward` da vuelta las caras para verlas desde adentro. */
function octoWall(r: number, y0: number, y1: number, inward = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, 8, 1, true);
  g.translate(0, (y0 + y1) / 2, 0);
  if (inward) {
    const idx = Array.from(g.index!.array);
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  }
  return g;
}

/** Corona plana (r0…r1) u octógono lleno (r0 = 0) a la altura y, mirando hacia arriba. */
function octoRing(r0: number, r1: number, y: number): THREE.BufferGeometry {
  const g = r0 > 0 ? new THREE.RingGeometry(r0, r1, 8) : new THREE.CircleGeometry(r1, 8);
  g.rotateX(-Math.PI / 2); // +z → +y; los vértices quedan en (r cos θ, −r sin θ), los del octógono de la colisión
  g.translate(0, y, 0);
  return g;
}

/** Pileta octogonal de piedra con borde de 0,6 m: la caja de colisión, nada sobresale. */
function basinGeometry(): THREE.BufferGeometry {
  const stone = '#c9c0ac';
  return merge([
    colored(octoWall(FOUNTAIN_R, 0, FOUNTAIN_H), stone),
    colored(octoRing(FOUNTAIN_R - RIM_W, FOUNTAIN_R, FOUNTAIN_H), '#d8d0bd'),
    colored(octoWall(FOUNTAIN_R - RIM_W, WATER_Y, FOUNTAIN_H, true), stone),
  ]);
}

/** Agua de la pileta y un chorro central que sale del agua (sin colisión, como el agua). */
function waterGeometry(): THREE.BufferGeometry {
  const JET_H = 1.5;
  const jet = new THREE.CylinderGeometry(0.04, 0.16, JET_H, 8, 1, false);
  jet.translate(0, WATER_Y + JET_H / 2, 0);
  return merge([colored(octoRing(0, FOUNTAIN_R - RIM_W, WATER_Y), '#3f6f86'), colored(jet, '#dfeef5')]);
}

export function buildParks(map: MapData, materials: WorldMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'parks';

  const paths = map.roads.filter((r) => isParkFootway(r, map.parks)).map((r) => ribbon(r.points, r.width, Y_PATH));
  if (paths.length > 0) {
    const g = paths.length === 1 ? paths[0] : mergeGeometries(paths, false);
    if (!g) throw new Error('mergeGeometries falló para los senderos');
    if (g !== paths[0]) for (const p of paths) p.dispose();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, materials.path);
    mesh.name = 'path'; // = clave de WorldMaterials: el cambio de calidad le cambia el material
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const benches = map.props.filter((x): x is Bench => x.kind === 'bench');
  if (benches.length > 0) {
    const mesh = new THREE.InstancedMesh(benchGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), benches.length);
    mesh.name = 'bench';
    benches.forEach((b, i) => mesh.setMatrixAt(i, m.compose(p.set(b.position[0], 0, b.position[1]), q.setFromAxisAngle(UP, b.rotation), s.set(1, 1, 1))));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const fountains = map.props.filter((x): x is Fountain => x.kind === 'fountain');
  if (fountains.length > 0) {
    const parts: [string, THREE.BufferGeometry, THREE.Material][] = [
      ['fountainBasin', basinGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true })],
      ['fountainWater', waterGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0 })],
    ];
    for (const [name, geometry, material] of parts) {
      const mesh = new THREE.InstancedMesh(geometry, material, fountains.length);
      mesh.name = name;
      fountains.forEach((f, i) => {
        const k = f.radius / FOUNTAIN_R;
        mesh.setMatrixAt(i, m.compose(p.set(f.position[0], 0, f.position[1]), q.identity(), s.set(k, 1, k)));
      });
      mesh.castShadow = name === 'fountainBasin';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
