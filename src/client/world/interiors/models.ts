// Los muebles de los interiores (§2.3): cajas y cilindros con color por vértice, sin textura y con un solo material
// (in_mueble). Cada modelo tiene el origen en el piso, en su medio; +x es su ancho y +z su fondo (como MODEL_BOX), y
// mira hacia +z. `Item.color` multiplica sus colores. Cada tarea de interior suma sus modelos con una línea:
// `nombre: () => model(box(...), cyl(...))`, y en ITEM_GLOW los que brillan.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec3 } from '../../../shared/geo.ts';
import type { ItemModel } from '../../../shared/interiors/types.ts';

/** Sin uv (no hay textura), llevada a `at` y pintada de `color`. */
function paint(g: THREE.BufferGeometry, at: Vec3, color: string): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.translate(at[0], at[1], at[2]);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return g;
}

/** Caja de w (x) × h (y) × d (z) con la base en `at`. */
export const box = (w: number, h: number, d: number, at: Vec3, color: string): THREE.BufferGeometry =>
  paint(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), at, color);

/** Cilindro vertical de radio r y alto h con la base en `at`. */
export const cyl = (r: number, h: number, at: Vec3, color: string, segments = 10): THREE.BufferGeometry =>
  paint(new THREE.CylinderGeometry(r, r, h, segments).translate(0, h / 2, 0), at, color);

/** Las piezas en una sola geometría. */
export function model(...parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('muebles: mergeGeometries falló');
  for (const p of parts) p.dispose();
  return g;
}

/** Cuatro patas cuadradas de lado `t` y alto `h`, con el borde de afuera en las esquinas de w × d. */
const legs = (w: number, d: number, h: number, t: number, color: string): THREE.BufferGeometry[] =>
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => box(t, h, t, [(sx * (w - t)) / 2, 0, (sz * (d - t)) / 2], color));

const WOOD = '#a07c52', STEEL = '#3a3c40', FABRIC = '#8a6f5c', SHADE = '#fff0c8', ALUMINIUM = '#9aa0a6';

export const ITEM_MODELS: Record<ItemModel, () => THREE.BufferGeometry> = {
  silla: () => model(box(0.42, 0.04, 0.42, [0, 0.43, 0], WOOD), box(0.42, 0.42, 0.03, [0, 0.47, -0.195], WOOD), ...legs(0.42, 0.42, 0.43, 0.03, STEEL)),
  banqueta: () => model(cyl(0.18, 0.05, [0, 0.7, 0], WOOD), cyl(0.025, 0.7, [0, 0, 0], STEEL, 6), cyl(0.2, 0.02, [0, 0, 0], STEEL)),
  lampara: () => model(cyl(0.15, 0.03, [0, 0, 0], STEEL), cyl(0.015, 1.4, [0, 0.03, 0], STEEL, 6), cyl(0.2, 0.25, [0, 1.35, 0], SHADE)),
  mesa: () => model(box(1.2, 0.04, 0.8, [0, 0.71, 0], WOOD), ...legs(1.2, 0.8, 0.71, 0.05, STEEL)),
  sillon: () => model(box(0.85, 0.42, 0.85, [0, 0, 0], FABRIC), box(0.85, 0.38, 0.16, [0, 0.42, -0.345], FABRIC),
    box(0.12, 0.2, 0.69, [-0.365, 0.42, 0.08], FABRIC), box(0.12, 0.2, 0.69, [0.365, 0.42, 0.08], FABRIC)),
  // la hoja de vidrio abierta (D10): se dibuja el marco; el vidrio, que no frena, no se ve con un material opaco
  'hoja-vidrio': () => model(box(0.05, 2.1, 0.04, [-0.425, 0, 0], ALUMINIUM), box(0.05, 2.1, 0.04, [0.425, 0, 0], ALUMINIUM),
    box(0.8, 0.05, 0.04, [0, 0, 0], ALUMINIUM), box(0.8, 0.05, 0.04, [0, 2.05, 0], ALUMINIUM)),
};

/** Los que brillan: van con su color pleno, sin la luz horneada. */
export const ITEM_GLOW: Partial<Record<ItemModel, true>> = { lampara: true };
