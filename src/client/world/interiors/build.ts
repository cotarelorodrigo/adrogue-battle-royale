// Las mallas de un interior (§2.6): una por Mat usada, con la luz horneada en el color por vértice; los muebles, una
// InstancedMesh por modelo repetido y el resto juntos; los carteles, una malla por página de su atlas. Lo `out` no va
// acá: lo dibuja el chunk de su edificio (exterior.ts). Nada proyecta ni recibe sombra: adentro no pega el sol. Con un
// patio, lo de la planta (el edificio) y lo del patio van en dos grupos, cada uno con sus mallas y su caja.
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clipSegment, distPointSegment, pointInPolygon, signedAreaFromAbove } from '../../../shared/geo.ts';
import type { Vec2, Vec3 } from '../../../shared/geo.ts';
import type { Block, Interior, Item, ItemModel, Label, Look, Mat, Pane } from '../../../shared/interiors/types.ts';
import { SIGN_H } from '../../../shared/mapdata.ts';
import { INDOOR_GAIN } from '../../render/exposure.ts';
import { QUALITY } from '../../render/quality.ts';
import type { Quality } from '../../render/quality.ts';
import { PAGE, packSigns, signTexture } from '../signs.ts';
import type { InteriorKey, WorldMaterials } from '../types.ts';
import { facing, newBuilder, tintColor, toGeometry, vert } from '../wall-kit.ts';
import type { Builder } from '../wall-kit.ts';
import { lightAt, outdoorRGBAt, outdoors } from './bake.ts';
import { adentro, bakedMaterial, withGain } from './baked.ts';
import { LABEL_DRAWINGS } from './drawings.ts';
import { GLASS_INSIDE, GLASS_OUTSIDE, glassTone } from './glass.ts';
import { sideFaces } from './joints.ts';
import type { SideFace } from './joints.ts';
import { faceShade, ITEM_GLASS, ITEM_GLOW, ITEM_MODELS } from './models.ts';
import { TILE_M } from './textures.ts';

/** Multiplica la luz horneada de los bloques, los muebles y los carteles que no brillan (H2a); lo que brilla (in_luz,
 *  ITEM_GLOW y los carteles `glow`) va en 1. Con la exposición de la calle, un interior visto por la vidriera queda en la
 *  planta baja de las fotos (luma sRGB 11–46: la pared blanca de un banco, ~40 con el reflejo del vidrio; I1 de la
 *  T11c); adentro lo aclara la adaptación del ojo (render/exposure.ts: la exposición de adentro y la ganancia de lo
 *  horneado). */
export const INTERIOR_EXPOSURE = 0.078;
/** A lo sumo esta cantidad de mallas (draw calls) por interior. */
export const MAX_MESHES = 20;
/** Un modelo con esta cantidad de copias o más va instanciado. */
const INSTANCE_MIN = 4;
/** Lado (m) de la grilla en que se parten las caras para hornear la luz, según el detalle de la calidad. */
const BAKE_STEP: Record<1 | 2, number> = { 1: 2, 2: 1 };
/** El cartel se separa esto (m) de lo que tenga detrás. */
const LABEL_LIFT = 0.02;
/** Un cartel redondo (`round`) es un disco de tantos lados. */
const DISC_SIDES = 48;
const LABEL_GUTTER = 4;
const EPS = 1e-6;

const unit = (x: number, z: number): Vec2 => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

/** La luz horneada de cada punto (`p`, normal `n`) y su tono: el color (de luminancia 1) por el que va la de afuera
 *  (cálida al sol, azulada a la sombra); adentro, null (gris). */
interface Light { (p: Vec3, n: Vec3): number; tone: (p: Vec3, n: Vec3) => THREE.Color | null }

/** Al aire libre, para lo horneado de los bloques: afuera de la planta (outdoors: la terraza, el patio, la vereda) o
 *  sobre su borde, a menos de EDGE_M. El canto de afuera de una jamba, de un umbral o de un dintel está en la cara de
 *  afuera de la pared, que es el borde de la planta: sin la tolerancia caía de un lado o del otro según el redondeo, y
 *  desde la vereda se veía con la luz de adentro (M4 de la T11c). */
function openAir(i: Interior, p: Vec3): boolean {
  if (outdoors(i, p)) return true;
  const fp = i.footprint;
  return fp.some((a, k) => distPointSegment([p[0], p[2]], a, fp[(k + 1) % fp.length]) < EDGE_M);
}
const EDGE_M = 1e-3;

/** Por cuánto va la luz horneada bajo techo de `i`: 1 en un local claro; en uno oscuro aunque el ojo se adapte (el cine,
 *  Interior.adaptedExposure), lo que lo deja, adaptado, a esa exposición en vez de INTERIOR_EXPOSURE · INDOOR_GAIN (M8 de
 *  la T11c: sale de las constantes, no es un número a mano). */
export const dimOf = (i: Interior): number => (i.adaptedExposure === undefined ? 1 : i.adaptedExposure / (INTERIOR_EXPOSURE * INDOOR_GAIN));

/** El horneado de un interior: la luz de cada punto (con memoria: las celdas vecinas comparten vértices), por dimOf
 *  bajo techo. Lo que está al aire libre (outdoors: la terraza, el patio, la vereda) lleva la luz de afuera, con la
 *  sombra de lo macizo del propio interior y de los vecinos (outdoorRGBAt), su luminancia dividida por
 *  INTERIOR_EXPOSURE, que después la multiplica, y su tono. */
function baker(i: Interior): Light {
  const dim = dimOf(i);
  const memo = new Map<string, { v: number; tone: THREE.Color | null }>();
  const at = (p: Vec3, n: Vec3): { v: number; tone: THREE.Color | null } => {
    const key = `${p.map((v) => v.toFixed(3)).join(',')}|${n.map((v) => v.toFixed(2)).join(',')}`;
    let e = memo.get(key);
    if (e === undefined) {
      if (openAir(i, p)) {
        const c = outdoorRGBAt(i, p, n), l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        e = { v: l / INTERIOR_EXPOSURE, tone: l > 0 ? new THREE.Color(c[0] / l, c[1] / l, c[2] / l) : null };
      } else e = { v: lightAt(i, p, n) * dim, tone: null };
      memo.set(key, e);
    }
    return e;
  };
  const light = ((p: Vec3, n: Vec3): number => at(p, n).v) as Light;
  light.tone = (p, n) => at(p, n).tone;
  return light;
}

/** Lo que pinta una cara: su color, la luz horneada, el lado de las de vidrio y si un punto está bajo techo (lo que no,
 *  outdoors, lleva la luz de afuera y va sin la ganancia de adentro). */
interface Paint { look: Look; light: Light; glass: (p: Vec3, n: Vec3) => number; inside: (p: Vec3) => boolean }

/** Un Builder de lo horneado: con la ganancia de cada vértice (de 0 a 1), que va al alfa del color (baked.ts). El del
 *  vidrio y el de lo que brilla no la llevan. */
type BakedBuilder = Builder & { gain?: number[] };

/** La geometría de `b`, con la ganancia en el alfa del color si la lleva. */
function bakedGeometry(b: BakedBuilder): THREE.BufferGeometry {
  const g = toGeometry(b);
  if (!b.gain || !b.col) return g;
  const out = new Float32Array(b.gain.length * 4);
  b.gain.forEach((w, k) => out.set([b.col![k * 3], b.col![k * 3 + 1], b.col![k * 3 + 2], w], k * 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out, 4));
  return g;
}

/** Una cara de normal `n` con uv planas (metros / TILE_M): un polígono convexo (`rect`: un rectángulo o un paño,
 *  antihorario visto desde `n`, en abanico) o un pedazo recortado de una cara horizontal, que se triangula. Lo que
 *  brilla va con su color pleno; el vidrio no se hornea: su color es el lado de la cara (glass.ts), uno por cara (el
 *  esmerilado lleva además, en el azul, la luz que deja pasar); lo
 *  demás, su color por la luz y INTERIOR_EXPOSURE, y la cara bajo techo (por su centro) va marcada para la ganancia de
 *  adentro (baked.ts). Una esquina al aire libre de una cara bajo techo (el canto de afuera de una jamba, de un umbral o
 *  de un dintel) lleva la luz de afuera con ganancia 0 (M4): se ve igual desde la vereda que desde adentro. */
function emit(b: BakedBuilder, corners: Vec3[], n: Vec3, uvOf: (p: Vec3) => [number, number], paint: Paint, rect: boolean, tris?: readonly (readonly [number, number, number])[]): void {
  const { mat } = paint.look;
  const color = tintColor(paint.look.color);
  const first = b.pos.length / 3;
  const mid = (): Vec3 => corners.reduce((s, p): Vec3 => [s[0] + p[0] / corners.length, s[1] + p[1] / corners.length, s[2] + p[2] / corners.length], [0, 0, 0]);
  const side = mat === 'vidrio' ? paint.glass(mid(), n) : 0;
  const inside = mat !== 'vidrio' && mat !== 'luz' && paint.inside(mid());
  // el esmerilado: la luz que deja pasar (su color por la horneada del lado más iluminado), en el azul y negativa (glass.ts)
  const frost = paint.look.esmerilado ? 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b : 0;
  for (const p of corners) {
    // el esmerilado es translúcido: cada cara lleva la luz del lado más iluminado (la que pasa por el vinilo)
    if (mat === 'vidrio') vert(b, p, n, uvOf(p), new THREE.Color(side, side, frost > 0 ? -frost * Math.max(paint.light(p, n), paint.light(p, [-n[0], -n[1], -n[2]])) * INTERIOR_EXPOSURE : side));
    else if (mat === 'luz') vert(b, p, n, uvOf(p), color.clone());
    else {
      const k = paint.light(p, n) * INTERIOR_EXPOSURE;
      const c = new THREE.Color(color.r * k, color.g * k, color.b * k);
      const tone = paint.light.tone(p, n);
      if (tone) c.multiply(tone);
      vert(b, p, n, uvOf(p), inside ? adentro(c) : c);
      b.gain?.push(inside && paint.inside(p) ? 1 : 0);
    }
  }
  if (tris) {
    for (const [a, c, d] of tris) b.idx.push(first + a, first + c, first + d);
    return;
  }
  if (rect) {
    for (let k = 1; k + 1 < corners.length; k++) b.idx.push(first, first + k, first + k + 1);
    return;
  }
  const up = n[1] > 0;
  const contour = corners.map((p) => new THREE.Vector2(p[0], -p[2]));
  for (const [a, c, d] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const cross = (corners[c][0] - corners[a][0]) * (corners[d][2] - corners[a][2]) - (corners[c][2] - corners[a][2]) * (corners[d][0] - corners[a][0]);
    // normal.y = −cross: el triángulo va derecho si mira para el lado de n
    if ((cross < 0) === up) b.idx.push(first + a, first + c, first + d);
    else b.idx.push(first + a, first + d, first + c);
  }
}

/** La planta en celdas de la grilla de `step` m, antihorarias vistas desde arriba: las enteras (`rect`) y los pedazos
 *  del borde, recortados. Una planta más chica que una celda va entera. */
function cells(poly: Vec2[], step: number): { ring: Vec2[]; rect: boolean }[] {
  const ccw = (r: Vec2[]): Vec2[] => (signedAreaFromAbove(r) > 0 ? r : [...r].reverse());
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  if (x1 - x0 <= step && z1 - z0 <= step) return [{ ring: ccw(poly), rect: false }];
  const ring: polygonClipping.Polygon = [[...poly, poly[0]]];
  const out: { ring: Vec2[]; rect: boolean }[] = [];
  for (let i = Math.floor(x0 / step); i * step < x1; i++) {
    for (let j = Math.floor(z0 / step); j * step < z1; j++) {
      const [ax, az, bx, bz] = [i * step, j * step, (i + 1) * step, (j + 1) * step];
      // ¿alguna arista de la planta pasa por adentro de la celda? Entonces se recorta; si no, va entera o no va
      const crossed = poly.some((p, k) => {
        const s = clipSegment(p, poly[(k + 1) % poly.length], ax, az, bx, bz);
        if (!s) return false;
        const [mx, mz] = [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2];
        return mx > ax + EPS && mx < bx - EPS && mz > az + EPS && mz < bz - EPS;
      });
      const cell: Vec2[] = [[ax, az], [ax, bz], [bx, bz], [bx, az]]; // antihoraria vista desde arriba
      if (!crossed) {
        if (pointInPolygon([(ax + bx) / 2, (az + bz) / 2], poly)) out.push({ ring: cell, rect: true });
        continue;
      }
      for (const pg of polygonClipping.intersection(ring, [[...cell, cell[0]]])) {
        out.push({ ring: ccw(pg[0].slice(0, -1).map((p): Vec2 => [p[0], p[1]])), rect: false });
      }
    }
  }
  return out;
}

/** El lado de una cara del vidrio de un lucernario (`sky`, D13): está arriba del techo, así que el tope y los costados
 *  dan al cielo (GLASS_OUTSIDE) y la de abajo, al atrio (GLASS_INSIDE). */
const skyTone = (_p: Vec3, n: Vec3): number => (n[1] < -0.5 ? GLASS_INSIDE : GLASS_OUTSIDE);

/** Uv planas de un paño de normal `n`: las de arriba si es casi horizontal; si no, a lo largo de su recta en planta y
 *  en alto. */
function paneUv(n: Vec3): (p: Vec3) => [number, number] {
  if (Math.abs(n[1]) > 0.7) return (p) => [p[0] / TILE_M, p[2] / TILE_M];
  const e = unit(-n[2], n[0]);
  return (p) => [(p[0] * e[0] + p[2] * e[1]) / TILE_M, p[1] / TILE_M];
}

/** Los paños (Pane): cada uno entero, sin partir (lo inclinado: el vidrio, la estructura blanca y los pasamanos, que no
 *  piden más horneado que en sus esquinas). El vidrio de un lucernario (`sky`) da al cielo por el frente (GLASS_OUTSIDE)
 *  y al interior por atrás (GLASS_INSIDE); otro vidrio, según de qué lado queda (glassTone). */
function paneFaces(i: Interior, panes: Pane[], builder: (mat: Mat) => BakedBuilder, light: Light): void {
  const inside = (p: Vec3): boolean => !openAir(i, p);
  for (const pn of panes) {
    const front = facing(pn.corners, pn.normal);
    const sides: [Vec3[], Vec3, number | null][] = [[front, pn.normal, pn.sky ? GLASS_OUTSIDE : null]];
    if (pn.back) sides.push([[...front].reverse(), [-pn.normal[0], -pn.normal[1], -pn.normal[2]], pn.sky ? GLASS_INSIDE : null]);
    for (const [corners, n, tone] of sides) {
      const glass = (p: Vec3, m: Vec3): number => tone ?? glassTone(i, p, m);
      emit(builder(pn.look.mat), corners, n, paneUv(n), { look: pn.look, light, glass, inside }, true);
    }
  }
}

/** Las caras de los bloques `blocks` (ninguno `out`) y los paños `panes` de una parte del interior, por Mat: los bloques
 *  partidos en la grilla de `step` m (los costados, además, en las marcas de su plano: `sides`); todo horneado con
 *  `light`. */
function blockGeometries(i: Interior, blocks: Block[], panes: Pane[], step: number, light: Light, sides: Map<Block, SideFace[]>): Map<Mat, THREE.BufferGeometry> {
  const inGlass = (p: Vec3, n: Vec3): number => glassTone(i, p, n);
  const inside = (p: Vec3): boolean => !openAir(i, p);
  const builders = new Map<Mat, BakedBuilder>();
  const builder = (mat: Mat): BakedBuilder => {
    let b = builders.get(mat);
    if (!b) builders.set(mat, (b = mat === 'vidrio' || mat === 'luz' ? newBuilder(true) : { ...newBuilder(true), gain: [] }));
    return b;
  };
  const flat = (p: Vec3): [number, number] => [p[0] / TILE_M, p[2] / TILE_M];
  // el vidrio y lo que brilla no se hornean (su color es uno por cara): van enteros, sin partir en la grilla
  const stepOf = (mat: Mat): number => (mat === 'vidrio' || mat === 'luz' ? Infinity : step);
  for (const b of blocks) {
    const glass = b.sky ? skyTone : inGlass;
    for (const [look, y, n] of [[b.top, b.y1, [0, 1, 0]], [b.bottom, b.y0, [0, -1, 0]]] as const) {
      if (!look) continue;
      for (const c of cells(b.polygon, stepOf(look.mat))) {
        const ring = n[1] > 0 ? c.ring : [...c.ring].reverse();
        emit(builder(look.mat), ring.map((p): Vec3 => [p[0], y, p[1]]), [...n], flat, { look, light, glass, inside }, c.rect);
      }
    }
    // los costados, en sus pedazos (joints.ts: la grilla del horneado, sin juntas en T); (t, y) antihorario mira a la normal
    for (const { look, p, e, t0, normal, pieces } of sides.get(b) ?? []) {
      const at = (t: number, y: number): Vec3 => [p[0] + e[0] * (t - t0), y, p[1] + e[1] * (t - t0)];
      const uv = (v: Vec3): [number, number] => [(v[0] * e[0] + v[2] * e[1]) / TILE_M, v[1] / TILE_M];
      for (const m of pieces) emit(builder(look.mat), m.pts.map(([t, y]) => at(t, y)), normal, uv, { look, light, glass, inside }, true, m.tris);
    }
  }
  paneFaces(i, panes, builder, light);
  return new Map([...builders].map(([mat, b]) => [mat, bakedGeometry(b)]));
}

/** La matriz de un mueble: en su `at`, girado `yaw` sobre +Y. */
const placeOf = (it: Item): THREE.Matrix4 =>
  new THREE.Matrix4().makeRotationY(it.yaw).setPosition(it.at[0], it.at[1], it.at[2]);

/** El color de un mueble: el suyo (o blanco) por la luz de donde está y INTERIOR_EXPOSURE, salvo los que brillan; bajo
 *  techo, marcado para la ganancia de adentro (baked.ts). */
function itemColor(i: Interior, it: Item, light: Light): THREE.Color {
  const c = new THREE.Color(it.color ?? '#ffffff');
  if (ITEM_GLOW[it.model]) return c;
  const p: Vec3 = [it.at[0], it.at[1] + 0.6, it.at[2]];
  c.multiplyScalar(light(p, [0, 1, 0]) * INTERIOR_EXPOSURE);
  const tone = light.tone(p, [0, 1, 0]);
  return tone ? c.multiply(tone) : outdoors(i, p) ? c : adentro(c);
}

/** Las partes de vidrio de los muebles (ITEM_GLASS), en su lugar, sin uv y con el lado de cada cara en el color: van en
 *  la malla de in_vidrio. */
function itemGlass(i: Interior, items: Item[]): THREE.BufferGeometry[] {
  return items.flatMap((it) => {
    const part = ITEM_GLASS[it.model];
    if (!part) return [];
    const g = part().applyMatrix4(placeOf(it));
    const [pos, nor, col] = [g.getAttribute('position'), g.getAttribute('normal'), g.getAttribute('color')];
    for (let v = 0; v < pos.count; v++) {
      const k = glassTone(i, [pos.getX(v), pos.getY(v), pos.getZ(v)], [nor.getX(v), nor.getY(v), nor.getZ(v)]);
      col.setXYZ(v, k, k, k);
    }
    return [g];
  });
}

/** Los muebles por modelo: los que tienen INSTANCE_MIN copias o más (de más a menos) y el resto. */
function itemPlan(items: Item[]): { repeated: [ItemModel, Item[]][]; rest: Item[] } {
  const byModel = new Map<ItemModel, Item[]>();
  for (const it of items) byModel.set(it.model, [...(byModel.get(it.model) ?? []), it]);
  const repeated = [...byModel].filter(([, list]) => list.length >= INSTANCE_MIN).sort((a, b) => b[1].length - a[1].length);
  const done = new Set(repeated.map(([model]) => model));
  return { repeated, rest: items.filter((it) => !done.has(it.model)) };
}

/** Una InstancedMesh por modelo repetido, con la luz de cada copia en su color. */
function instancedMeshes(i: Interior, repeated: [ItemModel, Item[]][], material: THREE.Material, light: Light): THREE.Mesh[] {
  return repeated.map(([model, list]) => {
    const mesh = new THREE.InstancedMesh(ITEM_MODELS[model](), material, list.length);
    list.forEach((it, k) => {
      mesh.setMatrixAt(k, placeOf(it));
      mesh.setColorAt(k, itemColor(i, it, light));
    });
    mesh.computeBoundingSphere();
    return mesh;
  });
}

/**
 * Cada mueble en su lugar, con su color ya multiplicado: para juntarlos en una sola geometría.
 * M7 de la T11c: un mueble al aire libre que nunca va instanciado (`single`, su modelo; en la T11c, los molinetes y las
 * mesas y sombrillas del patio del McDonald's) lleva en cada vértice la luz de afuera de ese punto, con el sol según
 * hacia dónde mira la cara (outdoorRGBAt), en vez de la de arriba de su centro por el sombreado de la cara (FACE). Así se
 * lee igual que lo que el chunk dibuja al lado con el sol de verdad (el gabinete del molinete). Las caras de abajo
 * quedan como estaban: llevan su propia sombra (la lona de la sombrilla, LONA_ABAJO). Uno instanciado lleva una sola luz
 * por copia: con eso, uno que se instancia en un nivel y no en otro cambiaría de aspecto según la calidad, así que
 * quedan como estaban.
 */
const looseGeometries = (i: Interior, items: Item[], light: Light, single: ReadonlySet<ItemModel> = new Set()): THREE.BufferGeometry[] => items.map((it) => {
  const g = ITEM_MODELS[it.model]().applyMatrix4(placeOf(it));
  const k = itemColor(i, it, light);
  const [pos, nor, col] = [g.getAttribute('position'), g.getAttribute('normal'), g.getAttribute('color')];
  const sunlit = single.has(it.model) && !ITEM_GLOW[it.model] && outdoors(i, [it.at[0], it.at[1] + 0.6, it.at[2]]);
  const own = new THREE.Color(it.color ?? '#ffffff');
  for (let v = 0; v < col.count; v++) {
    const [p, n]: Vec3[] = [[pos.getX(v), pos.getY(v), pos.getZ(v)], [nor.getX(v), nor.getY(v), nor.getZ(v)]];
    // lo que imita una luz (`horneado`, negativo) y lo que mira para abajo, como antes
    if (sunlit && n[1] > -0.5 && col.getX(v) >= 0 && outdoors(i, p)) {
      const L = outdoorRGBAt(i, p, n), f = faceShade(n);
      col.setXYZ(v, (col.getX(v) / f) * own.r * L[0], (col.getY(v) / f) * own.g * L[1], (col.getZ(v) / f) * own.b * L[2]);
    } else col.setXYZ(v, col.getX(v) * k.r, col.getY(v) * k.g, col.getZ(v) * k.b);
  }
  return g;
});

/** Las geometrías en una (y las libera), o null si no hay ninguna. */
function merged(i: Interior, parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error(`${i.placeId}: no se pudieron juntar las mallas`);
  for (const x of parts) x.dispose();
  return g;
}

/** Los textos de los carteles (signTexture dibuja con la proporción ancho × SIGN_H: el ancho que se pide da la del
 *  cartel), o su dibujo si lo tienen (drawings.ts), con el texto de semilla. */
const labelCanvases = (labels: Label[]): HTMLCanvasElement[] => labels.map((l) =>
  (l.drawing ? LABEL_DRAWINGS[l.drawing](l.look, l.width, l.height, l.text) : signTexture(l.text, l.look, (l.width * SIGN_H) / l.height)));

/** Las páginas de atlas de los carteles: con `onePage`, los textos se achican a la mitad hasta entrar en una. */
function packLabels(canvases: HTMLCanvasElement[], onePage: boolean): { canvases: HTMLCanvasElement[]; packed: ReturnType<typeof packSigns> } {
  let cs = canvases;
  for (;;) {
    const packed = packSigns(cs.map((c) => ({ w: c.width, h: c.height })), PAGE, LABEL_GUTTER);
    if (!onePage || packed.pages.length <= 1) return { canvases: cs, packed };
    cs = cs.map((c) => {
      const half = document.createElement('canvas');
      half.width = Math.max(1, Math.round(c.width / 2));
      half.height = Math.max(1, Math.round(c.height / 2));
      half.getContext('2d')!.drawImage(c, 0, 0, half.width, half.height);
      return half;
    });
  }
}

/** Los carteles de adentro: un cuadro por cartel y una malla por página de atlas. */
function labelMeshes(i: Interior, labels: Label[], canvases: HTMLCanvasElement[], packed: ReturnType<typeof packSigns>, light: Light): THREE.Mesh[] {
  const { rects, pages } = packed;
  const pageCanvases = pages.map((pg) => {
    const c = document.createElement('canvas');
    c.width = pg.w;
    c.height = pg.h;
    return c;
  });
  const builders = pages.map(() => newBuilder(true));
  labels.forEach((l, k) => {
    const r = rects[k], pg = pages[r.page];
    const ctx = pageCanvases[r.page].getContext('2d')!;
    ctx.fillStyle = l.look.marco;
    ctx.fillRect(r.x - LABEL_GUTTER, r.y - LABEL_GUTTER, r.w + 2 * LABEL_GUTTER, r.h + 2 * LABEL_GUTTER);
    ctx.drawImage(canvases[k], r.x, r.y);
    // de pie: mira hacia `normal` y su arriba es +y; acostado (`down`): mira hacia abajo y su arriba es `normal`. En los
    // dos, la derecha de quien lo lee es (nz, −nx) y la cara va hacia derecha × arriba
    const n: Vec3 = l.down ? [0, -1, 0] : [l.normal[0], 0, l.normal[1]];
    const up: Vec3 = l.down ? [l.normal[0], 0, l.normal[1]] : [0, 1, 0];
    const right: Vec3 = [l.normal[1], 0, -l.normal[0]];
    const c: Vec3 = [l.at[0] + n[0] * LABEL_LIFT, l.at[1] + n[1] * LABEL_LIFT, l.at[2] + n[2] * LABEL_LIFT];
    const at = (sx: number, sy: number): Vec3 => [0, 1, 2].map((a) => c[a] + (right[a] * sx * l.width) / 2 + (up[a] * sy * l.height) / 2) as Vec3;
    const [u0, u1] = [r.x / pg.w, (r.x + r.w) / pg.w];
    const [v0, v1] = [(pg.h - r.y - r.h) / pg.h, (pg.h - r.y) / pg.h];
    const uvAt = (sx: number, sy: number): [number, number] => [u0 + ((u1 - u0) * (sx + 1)) / 2, v0 + ((v1 - v0) * (sy + 1)) / 2];
    // un rectángulo, o un disco (en abanico desde el medio) que toma el círculo inscripto del dibujo
    const ring: [number, number][] = l.round
      ? Array.from({ length: DISC_SIDES }, (_, j) => [Math.cos((2 * Math.PI * j) / DISC_SIDES), Math.sin((2 * Math.PI * j) / DISC_SIDES)])
      : [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const b = builders[r.page], first = b.pos.length / 3;
    const k0 = l.glow ? 1 : light(c, n) * INTERIOR_EXPOSURE;
    const tone = new THREE.Color(k0, k0, k0);
    const sky = l.glow ? null : light.tone(c, n);
    if (sky) tone.multiply(sky);
    else if (!l.glow && !outdoors(i, c)) adentro(tone);
    if (l.round) vert(b, c, n, uvAt(0, 0), tone);
    for (const [sx, sy] of ring) vert(b, at(sx, sy), n, uvAt(sx, sy), tone);
    if (l.round) for (let j = 0; j < DISC_SIDES; j++) b.idx.push(first, first + 1 + j, first + 1 + ((j + 1) % DISC_SIDES));
    else b.idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
  });
  return builders.map((b, k) => {
    const map = new THREE.CanvasTexture(pageCanvases[k]);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const mesh = new THREE.Mesh(toGeometry(b), bakedMaterial(map));
    mesh.name = `labels:${k}`;
    return mesh;
  });
}

/**
 * Hasta dónde se compacta un interior para entrar en las mallas de su calidad (H3):
 * - 0: una malla por Mat, una InstancedMesh por modelo repetido, el resto de los muebles juntos y una por página;
 * - 1: además, todos los muebles en una malla, sin instancias (instanciar ahorra memoria, no draw calls);
 * - 2: además, los carteles en una página (achicados si hace falta);
 * - 3 (solo en baja): además, todo lo opaco (bloques sin su textura y muebles) en una malla con color por vértice.
 */
type Level = 0 | 1 | 2 | 3;

/** Multiplica el color por vértice de `g` por `tone` (el color medio, lineal, de la textura que se le saca). */
function toned(g: THREE.BufferGeometry, tone: Vec3 | undefined): void {
  if (!tone) return;
  const c = g.getAttribute('color') as THREE.BufferAttribute;
  for (let k = 0; k < c.count; k++) c.setXYZ(k, c.getX(k) * tone[0], c.getY(k) * tone[1], c.getZ(k) * tone[2]);
  c.needsUpdate = true;
}

/** Una parte del interior armado: el edificio (lo que cae en la planta) o el patio (lo que cae en un patio). `box`: su
 *  caja; `hull` (convexa, en planta) y `y0`–`y1`: el prisma que rodea lo que dibuja (con un patio, el de sus mallas; sin
 *  patio, el de la planta y la caja), que view.ts mira contra el frustum parado en el patio. */
export interface InteriorPart { name: Region; group: THREE.Group; box: THREE.Box3; hull: Vec2[]; y0: number; y1: number }
type Region = 'edificio' | 'patio';

/** A qué parte va lo que está en `p` (en planta): adentro de la planta, al edificio; en un patio, al patio; lo de los
 *  bordes (un poste o un cantero que sale de un patio), a la que tenga más cerca. */
function regionOf(i: Interior): (p: Vec2) => Region {
  const dist = (p: Vec2, ring: Vec2[]): number => Math.min(...ring.map((q, k) => distPointSegment(p, q, ring[(k + 1) % ring.length])));
  return (p) => {
    if (pointInPolygon(p, i.footprint)) return 'edificio';
    if (i.patios.some((r) => pointInPolygon(p, r))) return 'patio';
    return Math.min(...i.patios.map((r) => dist(p, r))) < dist(p, i.footprint) ? 'patio' : 'edificio';
  };
}
const middle = (ps: readonly (readonly number[])[], a: number, b: number): Vec2 =>
  [ps.reduce((t, p) => t + p[a], 0) / ps.length, ps.reduce((t, p) => t + p[b], 0) / ps.length];

/** La envolvente convexa de `ps` (cadena monótona), antihoraria vista con x a la derecha y z arriba. */
export function convexHull(ps: Vec2[]): Vec2[] {
  const pts = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** El prisma de lo que dibujan `meshes` (en el mundo): la envolvente de sus vértices en planta y sus altos (las copias
 *  de una InstancedMesh, por las esquinas de la caja de su modelo). */
function prismOf(meshes: THREE.Mesh[]): { hull: Vec2[]; y0: number; y1: number; box: THREE.Box3 } {
  const ps: Vec2[] = [];
  const box = new THREE.Box3();
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  const add = (p: THREE.Vector3): void => {
    ps.push([p.x, p.z]);
    box.expandByPoint(p);
  };
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    if (mesh instanceof THREE.InstancedMesh) {
      mesh.geometry.computeBoundingBox();
      const { min, max } = mesh.geometry.boundingBox!;
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, m);
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) add(v.set(x, y, z).applyMatrix4(m));
      }
    } else {
      for (let k = 0; k < pos.count; k++) add(v.fromBufferAttribute(pos, k));
    }
  }
  return { hull: convexHull(ps), y0: box.min.y, y1: box.max.y, box };
}

/** El interior para dibujar con los materiales `m` en la calidad `q`, y su caja (planta, patios y lo de adentro). Con
 *  un patio, en dos partes (dos grupos dentro del suyo, cada uno con su caja: view.ts los decide por separado parado en
 *  el patio); sin patio, una (el grupo mismo). Se compacta hasta que las mallas de todas las partes entren en
 *  min(MAX_MESHES, interiors.calls); si ni así entran, tira un error con el lugar. */
export function buildInterior3D(i: Interior, m: Pick<WorldMaterials, InteriorKey>, q: Quality): { group: THREE.Group; box: THREE.Box3; parts: InteriorPart[] } {
  const { detail, calls } = QUALITY[q].interiors;
  const cap = Math.min(MAX_MESHES, calls);
  const light = baker(i);
  const sides = sideFaces(i, BAKE_STEP[detail]);
  const region = regionOf(i);
  const xz = (p: Vec3): Vec2 => [p[0], p[2]];
  // lo de cada parte (la del patio, si tiene algo)
  const split = (['edificio', 'patio'] as const).map((name) => ({
    name,
    blocks: i.blocks.filter((b) => !b.out && region(middle(b.polygon, 0, 1)) === name),
    panes: i.panes.filter((pn) => !pn.out && region(middle(pn.corners, 0, 2)) === name),
    items: i.items.filter((it) => (it.detail ?? 1) <= detail && region(xz(it.at)) === name),
    labels: i.labels.filter((l) => !l.out && region(xz(l.at)) === name),
  })).filter((r) => r.name === 'edificio' || r.blocks.length + r.panes.length + r.items.length + r.labels.length > 0);
  const prep = split.map((r) => {
    const blocks = blockGeometries(i, r.blocks, r.panes, BAKE_STEP[detail], light, sides);
    const canvases = labelCanvases(r.labels);
    const fullPages = r.labels.length === 0 ? 0 : packSigns(canvases.map((c) => ({ w: c.width, h: c.height })), PAGE, LABEL_GUTTER).pages.length;
    const opaque = [...blocks.keys()].filter((mat) => mat !== 'vidrio');
    // el vidrio de los bloques y el de los muebles, en una malla sin uv (no tiene textura)
    const glassParts = [...(blocks.has('vidrio') ? [blocks.get('vidrio')!] : []), ...itemGlass(i, r.items)];
    for (const g of glassParts) if (g.getAttribute('uv')) g.deleteAttribute('uv');
    return { ...r, geometries: blocks, canvases, plan: itemPlan(r.items), fullPages, opaque, glassParts };
  });
  type Prep = (typeof prep)[number];
  const countOf = (p: Prep, level: Level): number => {
    const hasGlass = p.glassParts.length > 0 ? 1 : 0;
    const blockMeshes = level < 3 ? p.opaque.length + hasGlass : (p.opaque.length + p.items.length > 0 ? 1 : 0) + hasGlass;
    const itemMeshes = level === 3 ? 0 : level === 0 ? p.plan.repeated.length + (p.plan.rest.length > 0 ? 1 : 0) : p.items.length > 0 ? 1 : 0;
    const labelPages = level < 2 ? p.fullPages : p.labels.length > 0 ? 1 : 0;
    return blockMeshes + itemMeshes + labelPages;
  };
  const count = (level: Level): number => prep.reduce((t, p) => t + countOf(p, level), 0);
  const levels: Level[] = q === 'baja' ? [0, 1, 2, 3] : [0, 1, 2];
  const level = levels.find((l) => count(l) <= cap);
  if (level === undefined) {
    for (const p of prep) for (const g of [...p.geometries.values(), ...p.glassParts]) g.dispose();
    throw new Error(`${i.placeId}: no entra en ${cap} mallas en ${q}, ni compactado (${count(levels[levels.length - 1])})`);
  }

  /** Las mallas de una parte, compactada a `level`. */
  const meshesOf = (p: Prep): THREE.Mesh[] => {
    const meshes: THREE.Mesh[] = [];
    // los modelos que esta parte nunca instancia (en el nivel 0, el resto del plan): sueltos en todos los niveles
    const single = new Set(p.plan.rest.map((it) => it.model));
    const add = (g: THREE.BufferGeometry | null, key: InteriorKey): void => {
      if (!g) return;
      const mesh = new THREE.Mesh(g, m[key]);
      mesh.name = key;
      meshes.push(mesh);
    };
    add(merged(i, p.glassParts), 'in_vidrio');
    if (level < 3) {
      for (const mat of p.opaque) add(p.geometries.get(mat)!, `in_${mat}`);
    } else {
      // sin textura: el color por vértice ya lleva el Look y la luz, y además el color medio de la textura que se le saca
      // (userData.tone): sin él, el liso (0,69) o el ladrillo se verían más claros que en alta (item 8 de la T11c)
      const flat = p.opaque.map((mat) => {
        const g = p.geometries.get(mat)!;
        g.deleteAttribute('uv');
        toned(g, (m[`in_${mat}`] as THREE.MeshBasicMaterial).map?.userData.tone as Vec3 | undefined);
        return g;
      });
      add(merged(i, [...flat, ...looseGeometries(i, p.items, light, single)].map(withGain)), 'in_mueble');
    }
    if (level === 0) {
      for (const mesh of instancedMeshes(i, p.plan.repeated, m.in_mueble, light)) {
        mesh.name = 'in_mueble';
        meshes.push(mesh);
      }
      add(merged(i, looseGeometries(i, p.plan.rest, light, single)), 'in_mueble');
    } else if (level < 3) {
      add(merged(i, looseGeometries(i, p.items, light, single)), 'in_mueble');
    }
    if (p.labels.length > 0) {
      const { canvases: cs, packed } = packLabels(p.canvases, level >= 2);
      meshes.push(...labelMeshes(i, p.labels, cs, packed, light));
    }
    for (const mesh of meshes) {
      mesh.castShadow = mesh.receiveShadow = false;
      mesh.geometry.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
    }
    return meshes;
  };

  const group = new THREE.Group();
  group.name = `interior:${i.placeId}`;
  group.userData.level = level; // hasta dónde se compactó (para los tests: H8 de la tarea 7)
  const box = new THREE.Box3();
  const top = Math.max(0, ...i.blocks.filter((b) => !b.out).map((b) => b.y1));
  for (const ring of [i.footprint, ...i.patios, ...i.blocks.filter((b) => !b.out).map((b) => b.polygon)]) {
    for (const [x, z] of ring) box.expandByPoint(new THREE.Vector3(x, 0, z)).expandByPoint(new THREE.Vector3(x, top, z));
  }
  for (const pn of i.panes.filter((x) => !x.out)) for (const p of pn.corners) box.expandByPoint(new THREE.Vector3(...p));
  for (const it of i.items) box.expandByPoint(new THREE.Vector3(...it.at));
  if (prep.length === 1) {
    group.add(...meshesOf(prep[0]));
    return { group, box, parts: [{ name: 'edificio', group, box, hull: convexHull(i.footprint), y0: box.min.y, y1: box.max.y }] };
  }
  const parts = prep.map((p): InteriorPart => {
    const g = new THREE.Group();
    g.name = `${group.name}:${p.name}`;
    const meshes = meshesOf(p);
    g.add(...meshes);
    return { name: p.name, group: g, ...prismOf(meshes) };
  });
  group.add(...parts.map((p) => p.group));
  for (const p of parts) box.union(p.box);
  return { group, box, parts };
}
