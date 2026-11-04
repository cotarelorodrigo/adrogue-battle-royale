// Las mallas de un interior (§2.6): una por Mat usada, con la luz horneada en el color por vértice; los muebles, una
// InstancedMesh por modelo repetido y el resto juntos; los carteles, una malla por página de su atlas. Lo `out` no va
// acá: lo dibuja el chunk de su edificio (exterior.ts). Nada proyecta ni recibe sombra: adentro no pega el sol.
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clipSegment, pointInPolygon, signedAreaFromAbove } from '../../../shared/geo.ts';
import type { Vec2, Vec3 } from '../../../shared/geo.ts';
import type { Block, Interior, Item, Label, Look, Mat } from '../../../shared/interiors/types.ts';
import { SIGN_H } from '../../../shared/mapdata.ts';
import { QUALITY } from '../../render/quality.ts';
import type { Quality } from '../../render/quality.ts';
import { PAGE, packSigns, signTexture } from '../signs.ts';
import type { InteriorKey, WorldMaterials } from '../types.ts';
import { cutRect, newBuilder, tintColor, toGeometry, vert } from '../wall-kit.ts';
import type { Builder, Rect } from '../wall-kit.ts';
import { lightAt } from './bake.ts';
import { ITEM_GLOW, ITEM_MODELS } from './models.ts';
import { TILE_M } from './textures.ts';

/** A lo sumo esta cantidad de mallas (draw calls) por interior. */
export const MAX_MESHES = 20;
/** Un modelo con esta cantidad de copias o más va instanciado. */
const INSTANCE_MIN = 4;
/** Lado (m) de la grilla en que se parten las caras para hornear la luz, según el detalle de la calidad. */
const BAKE_STEP: Record<1 | 2, number> = { 1: 2, 2: 1 };
/** El cartel se separa esto (m) de lo que tenga detrás. */
const LABEL_LIFT = 0.02;
const LABEL_GUTTER = 4;
const EPS = 1e-6;

const unit = (x: number, z: number): Vec2 => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

/** El horneado de un interior: la luz de cada punto (con memoria: las celdas vecinas comparten vértices). */
function baker(i: Interior): (p: Vec3, n: Vec3) => number {
  const memo = new Map<string, number>();
  return (p, n) => {
    const key = `${p.map((v) => v.toFixed(3)).join(',')}|${n.map((v) => v.toFixed(2)).join(',')}`;
    let v = memo.get(key);
    if (v === undefined) memo.set(key, (v = lightAt(i, p, n)));
    return v;
  };
}

/** Lo que pinta una cara: su color y si se le hornea la luz (lo que brilla, no). */
interface Paint { look: Look; light: (p: Vec3, n: Vec3) => number }

/** Una cara de normal `n` con uv planas (metros / TILE_M): un rectángulo (`rect`, antihorario visto desde `n`) o un
 *  pedazo recortado de una cara horizontal, que se triangula. */
function emit(b: Builder, corners: Vec3[], n: Vec3, uvOf: (p: Vec3) => [number, number], paint: Paint, rect: boolean): void {
  const base = paint.look.mat === 'luz' ? null : paint;
  const color = tintColor(paint.look.color);
  const first = b.pos.length / 3;
  for (const p of corners) {
    const k = base ? base.light(p, n) : 1;
    vert(b, p, n, uvOf(p), new THREE.Color(color.r * k, color.g * k, color.b * k));
  }
  if (rect) {
    b.idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
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

/** Un bloque opaco tapa lo que se le pega: todo lo dibujado que no es vidrio (ni la caja invisible de un mueble). */
const opaque = (b: Block): boolean => {
  const l = b.side ?? b.top ?? b.bottom;
  return b.role !== 'mueble' && l !== undefined && l.mat !== 'vidrio';
};

/** Lo tapado de la cara de la arista p → q de un bloque (de y0 a y1): las caras de los opacos pegadas a ella (en la
 *  misma recta, recorridas al revés), como rectángulos en metros desde p. */
function covered(p: Vec2, q: Vec2, y0: number, y1: number, others: Block[]): Rect[] {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const e = unit(q[0] - p[0], q[1] - p[1]);
  const across = (r: Vec2): number => (r[0] - p[0]) * e[1] - (r[1] - p[1]) * e[0];
  const along = (r: Vec2): number => (r[0] - p[0]) * e[0] + (r[1] - p[1]) * e[1];
  const out: Rect[] = [];
  for (const o of others) {
    const [lo, hi] = [Math.max(y0, o.y0), Math.min(y1, o.y1)];
    if (hi - lo < EPS) continue;
    o.polygon.forEach((r, k) => {
      const s = o.polygon[(k + 1) % o.polygon.length];
      if (Math.abs(across(r)) > 1e-4 || Math.abs(across(s)) > 1e-4 || along(s) >= along(r)) return;
      const [s0, s1] = [Math.max(0, along(s)), Math.min(len, along(r))];
      if (s1 - s0 > EPS) out.push({ s0, s1, y0: lo, y1: hi });
    });
  }
  return out;
}

/** Las caras de los bloques que no son `out`, por Mat, partidas en la grilla de `step` m y horneadas. */
function blockGeometries(i: Interior, step: number): Map<Mat, THREE.BufferGeometry> {
  const light = baker(i);
  const builders = new Map<Mat, Builder>();
  const builder = (mat: Mat): Builder => {
    let b = builders.get(mat);
    if (!b) builders.set(mat, (b = newBuilder(true)));
    return b;
  };
  const blocks = i.blocks.filter((b) => !b.out);
  const boxOf = (b: Block): [number, number, number, number] => {
    const xs = b.polygon.map((p) => p[0]), zs = b.polygon.map((p) => p[1]);
    return [Math.min(...xs) - 1e-3, Math.max(...xs) + 1e-3, Math.min(...zs) - 1e-3, Math.max(...zs) + 1e-3];
  };
  const occluders = i.blocks.filter(opaque).map((b) => ({ b, box: boxOf(b) }));
  const flat = (p: Vec3): [number, number] => [p[0] / TILE_M, p[2] / TILE_M];
  for (const b of blocks) {
    for (const [look, y, n] of [[b.top, b.y1, [0, 1, 0]], [b.bottom, b.y0, [0, -1, 0]]] as const) {
      if (!look) continue;
      for (const c of cells(b.polygon, step)) {
        const ring = n[1] > 0 ? c.ring : [...c.ring].reverse();
        emit(builder(look.mat), ring.map((p): Vec3 => [p[0], y, p[1]]), [...n], flat, { look, light }, c.rect);
      }
    }
    if (!b.side) continue;
    const look = b.side;
    // las caras van hacia afuera de la planta antihoraria; `hide` cuenta las aristas del polígono guardado
    const flipped = signedAreaFromAbove(b.polygon) < 0;
    const poly = flipped ? [...b.polygon].reverse() : b.polygon, n = poly.length;
    const hidden = new Set(b.hide ?? []);
    const [x0, x1, z0, z1] = boxOf(b);
    const near = occluders.filter(({ b: o, box: [ox0, ox1, oz0, oz1] }) => o !== b && ox0 <= x1 && ox1 >= x0 && oz0 <= z1 && oz1 >= z0).map((o) => o.b);
    for (let k = 0; k < n; k++) {
      if (hidden.has(flipped ? (2 * n - 2 - k) % n : k)) continue;
      const [p, q] = [poly[k], poly[(k + 1) % poly.length]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < EPS) continue;
      const e = unit(q[0] - p[0], q[1] - p[1]);
      const normal: Vec3 = [-e[1], 0, e[0]];
      const at = (s: number, y: number): Vec3 => [p[0] + e[0] * s, y, p[1] + e[1] * s];
      const uv = (v: Vec3): [number, number] => [(v[0] * e[0] + v[2] * e[1]) / TILE_M, v[1] / TILE_M];
      for (const r of cutRect({ s0: 0, s1: len, y0: b.y0, y1: b.y1 }, covered(p, q, b.y0, b.y1, near)).solid) {
        const [ns, ny] = [Math.max(1, Math.ceil((r.s1 - r.s0) / step - 1e-9)), Math.max(1, Math.ceil((r.y1 - r.y0) / step - 1e-9))];
        for (let a = 0; a < ns; a++) {
          for (let c = 0; c < ny; c++) {
            const [s0, s1] = [r.s0 + ((r.s1 - r.s0) * a) / ns, r.s0 + ((r.s1 - r.s0) * (a + 1)) / ns];
            const [ya, yb] = [r.y0 + ((r.y1 - r.y0) * c) / ny, r.y0 + ((r.y1 - r.y0) * (c + 1)) / ny];
            emit(builder(look.mat), [at(s0, ya), at(s1, ya), at(s1, yb), at(s0, yb)], normal, uv, { look, light }, true);
          }
        }
      }
    }
  }
  return new Map([...builders].map(([mat, b]) => [mat, toGeometry(b)]));
}

/** La matriz de un mueble: en su `at`, girado `yaw` sobre +Y. */
const placeOf = (it: Item): THREE.Matrix4 =>
  new THREE.Matrix4().makeRotationY(it.yaw).setPosition(it.at[0], it.at[1], it.at[2]);

/** El color de un mueble: el suyo (o blanco) por la luz de donde está, salvo los que brillan. */
function itemColor(i: Interior, it: Item, light: (p: Vec3, n: Vec3) => number): THREE.Color {
  const c = new THREE.Color(it.color ?? '#ffffff');
  return ITEM_GLOW[it.model] ? c : c.multiplyScalar(light([it.at[0], it.at[1] + 0.6, it.at[2]], [0, 1, 0]));
}

/** Los muebles: una InstancedMesh por modelo con INSTANCE_MIN copias o más (los más repetidos, mientras entren en
 *  `room` mallas) y los demás juntos en una malla. */
function itemMeshes(i: Interior, items: Item[], material: THREE.Material, room: number): THREE.Mesh[] {
  const light = baker(i);
  const byModel = new Map<Item['model'], Item[]>();
  for (const it of items) byModel.set(it.model, [...(byModel.get(it.model) ?? []), it]);
  const repeated = [...byModel].filter(([, list]) => list.length >= INSTANCE_MIN).sort((a, b) => b[1].length - a[1].length);
  const rest = items.length - repeated.reduce((s, [, list]) => s + list.length, 0);
  const take = repeated.length + (rest > 0 ? 1 : 0) <= room ? repeated.length : Math.max(0, room - 1);
  const instanced = repeated.slice(0, take);
  const out: THREE.Mesh[] = [];
  for (const [model, list] of instanced) {
    const mesh = new THREE.InstancedMesh(ITEM_MODELS[model](), material, list.length);
    list.forEach((it, k) => {
      mesh.setMatrixAt(k, placeOf(it));
      mesh.setColorAt(k, itemColor(i, it, light));
    });
    mesh.computeBoundingSphere();
    out.push(mesh);
  }
  const done = new Set(instanced.map(([model]) => model));
  const loose = items.filter((it) => !done.has(it.model)).map((it) => {
    const g = ITEM_MODELS[it.model]().applyMatrix4(placeOf(it));
    const k = itemColor(i, it, light);
    const col = g.getAttribute('color');
    for (let v = 0; v < col.count; v++) col.setXYZ(v, col.getX(v) * k.r, col.getY(v) * k.g, col.getZ(v) * k.b);
    return g;
  });
  if (loose.length > 0) {
    const merged = mergeGeometries(loose, false);
    if (!merged) throw new Error(`${i.placeId}: no se pudieron juntar los muebles`);
    for (const g of loose) g.dispose();
    out.push(new THREE.Mesh(merged, material));
  }
  for (const mesh of out) mesh.name = 'in_mueble';
  return out;
}

/** Los carteles de adentro: los textos en páginas de atlas (signTexture), un cuadro por cartel y una malla por página. */
function labelMeshes(i: Interior, labels: Label[]): THREE.Mesh[] {
  if (labels.length === 0) return [];
  const light = baker(i);
  // signTexture dibuja con la proporción ancho × SIGN_H: el ancho que pide da la del cartel
  const canvases = labels.map((l) => signTexture(l.text, l.look, (l.width * SIGN_H) / l.height));
  const { rects, pages } = packSigns(canvases.map((c) => ({ w: c.width, h: c.height })), PAGE, LABEL_GUTTER);
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
    const n: Vec3 = [l.normal[0], 0, l.normal[1]];
    const right: Vec2 = [l.normal[1], -l.normal[0]]; // a la derecha de quien lo lee
    const c: Vec3 = [l.at[0] + n[0] * LABEL_LIFT, l.at[1], l.at[2] + n[2] * LABEL_LIFT];
    const at = (sx: number, sy: number): Vec3 => [c[0] + (right[0] * sx * l.width) / 2, c[1] + (sy * l.height) / 2, c[2] + (right[1] * sx * l.width) / 2];
    const [u0, u1] = [r.x / pg.w, (r.x + r.w) / pg.w];
    const [v0, v1] = [(pg.h - r.y - r.h) / pg.h, (pg.h - r.y) / pg.h];
    const corners: [Vec3, [number, number]][] = [[at(-1, -1), [u0, v0]], [at(1, -1), [u1, v0]], [at(1, 1), [u1, v1]], [at(-1, 1), [u0, v1]]];
    const b = builders[r.page], first = b.pos.length / 3;
    const k0 = l.glow ? 1 : light(c, n);
    for (const [p, uv] of corners) vert(b, p, n, uv, new THREE.Color(k0, k0, k0));
    b.idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
  });
  return builders.map((b, k) => {
    const map = new THREE.CanvasTexture(pageCanvases[k]);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const mesh = new THREE.Mesh(toGeometry(b), new THREE.MeshBasicMaterial({ map, vertexColors: true }));
    mesh.name = `labels:${k}`;
    return mesh;
  });
}

/** El interior para dibujar con los materiales `m` en la calidad `q`, y su caja (planta, patios y lo de adentro). */
export function buildInterior3D(i: Interior, m: Pick<WorldMaterials, InteriorKey>, q: Quality): { group: THREE.Group; box: THREE.Box3 } {
  const { detail } = QUALITY[q].interiors;
  const group = new THREE.Group();
  group.name = `interior:${i.placeId}`;
  const meshes: THREE.Mesh[] = [];
  for (const [mat, g] of blockGeometries(i, BAKE_STEP[detail])) {
    const key: InteriorKey = `in_${mat}`;
    const mesh = new THREE.Mesh(g, m[key]);
    mesh.name = key;
    meshes.push(mesh);
  }
  const labels = labelMeshes(i, i.labels.filter((l) => !l.out));
  const items = i.items.filter((it) => (it.detail ?? 1) <= detail);
  meshes.push(...itemMeshes(i, items, m.in_mueble, MAX_MESHES - meshes.length - labels.length), ...labels);
  for (const mesh of meshes) {
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.geometry.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  const box = new THREE.Box3();
  const top = Math.max(0, ...i.blocks.filter((b) => !b.out).map((b) => b.y1));
  for (const ring of [i.footprint, ...i.patios, ...i.blocks.filter((b) => !b.out).map((b) => b.polygon)]) {
    for (const [x, z] of ring) box.expandByPoint(new THREE.Vector3(x, 0, z)).expandByPoint(new THREE.Vector3(x, top, z));
  }
  for (const it of i.items) box.expandByPoint(new THREE.Vector3(...it.at));
  return { group, box };
}
