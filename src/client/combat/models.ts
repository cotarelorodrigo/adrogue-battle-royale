// Modelos del combate armados en código con cajas y cilindros de color plano, sin archivos ni texturas: las 4 armas
// (en la mano y tiradas en el piso), el maniquí y los objetos del botín. El color va por vértice: cada modelo es una
// sola geometría y todos se dibujan con un MeshLambertMaterial({ vertexColors: true }).
//
// Las armas se arman con el origen en la mano derecha (la empuñadura), el cañón hacia −z, +y arriba y +x a la
// derecha, en metros. Cada una tiene silueta y color propios (spec 2a §4): pistola corta, negra y arena; escopeta
// larga con madera; rifle verde oliva con cargador curvo; francotirador gris azulado, largo y con mira.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WeaponId } from '../../shared/combat.ts';
import type { Vec3 } from '../../shared/geo.ts';

type Rot = [number, number, number];

const BLACK = '#1d1f22';
const STEEL = '#3b3e43';
const TAN = '#a88c5c';
const WOOD = '#7b4b29';
const OLIVE = '#56643f';
const OLIVE_DARK = '#414c31';
const SNIPER = '#3a4a5a';
const SNIPER_DARK = '#2c3946';
const BRASS = '#c9a24a';
const SHELL_RED = '#b3302a';
const SKIN = '#c4906c';
const SLEEVE = '#3a4250';

/** Le saca las uv (los modelos no tienen textura), la gira `rot` (orden XYZ) alrededor de su centro, la lleva a `at`
 *  y la pinta de `color`. */
function place(g: THREE.BufferGeometry, at: Vec3, color: string, rot?: Rot): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  g.translate(at[0], at[1], at[2]);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return g;
}

/** Caja de w × h × d con el centro en `at`. */
const box = (w: number, h: number, d: number, at: Vec3, color: string, rot?: Rot): THREE.BufferGeometry =>
  place(new THREE.BoxGeometry(w, h, d), at, color, rot);

/** Cilindro de radio r y largo len a lo largo de `axis`, con el centro en `at`. */
function cyl(r: number, len: number, at: Vec3, color: string, axis: 'y' | 'z' = 'z', segments = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, segments);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return place(g, at, color);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('models: mergeGeometries falló');
  for (const p of parts) p.dispose();
  return g;
}

export interface WeaponModel {
  /** El arma sin el cargador. */
  body: THREE.BufferGeometry;
  /** El cargador (en la escopeta, un cartucho): sale y vuelve en la recarga. */
  mag: THREE.BufferGeometry;
  /** La culata de la escopeta y del rifle, aparte: al apuntar queda a centímetros del ojo y taparía media pantalla, así
   *  que el arma en mano la esconde. Las otras dos no tienen (la pistola no tiene; el francotirador se esconde entero). */
  stock: THREE.BufferGeometry | null;
  /** Manos y antebrazos, para el arma en primera persona. */
  hands: THREE.BufferGeometry;
  /** Boca del cañón: ahí va el fogonazo. */
  muzzle: Vec3;
  /** Altura de la línea de mira sobre el origen: al apuntar queda en el centro de la pantalla. */
  sight: number;
  /** Hacia dónde sale el cargador en la recarga (unitario). */
  magOut: Vec3;
}

interface WeaponParts {
  body: THREE.BufferGeometry[]; mag: THREE.BufferGeometry[]; stock?: THREE.BufferGeometry[];
  /** dónde agarra la mano izquierda */
  left: Vec3;
  muzzle: Vec3; sight: number; magOut: Vec3;
}

/** Inclinación de las empuñaduras: la parte de abajo va hacia atrás. */
const GRIP_RAKE: Rot = [-0.28, 0, 0];

const PARTS: Record<WeaponId, () => WeaponParts> = {
  pistola: () => ({
    body: [
      box(0.032, 0.034, 0.19, [0, 0.055, -0.06], BLACK), // corredera
      box(0.028, 0.022, 0.15, [0, 0.028, -0.065], TAN), // armazón
      box(0.01, 0.022, 0.045, [0, 0.008, -0.045], TAN), // guardamonte
      box(0.03, 0.105, 0.046, [0, -0.025, 0.012], TAN, GRIP_RAKE), // empuñadura
      box(0.006, 0.008, 0.008, [0, 0.076, -0.145], BLACK), // mira delantera
      box(0.016, 0.008, 0.008, [0, 0.076, 0.025], BLACK), // mira trasera
    ],
    mag: [box(0.024, 0.11, 0.036, [0, -0.042, 0.017], STEEL, GRIP_RAKE)],
    left: [-0.03, -0.035, 0.012], // las dos manos en la empuñadura
    muzzle: [0, 0.055, -0.16],
    sight: 0.08,
    magOut: [0, -Math.cos(0.28), Math.sin(0.28)],
  }),
  escopeta: () => ({
    body: [
      box(0.044, 0.062, 0.2, [0, 0.04, -0.07], STEEL), // cajón
      cyl(0.011, 0.46, [0, 0.058, -0.4], BLACK), // caño
      cyl(0.0095, 0.36, [0, 0.03, -0.35], STEEL), // depósito tubular
      box(0.046, 0.042, 0.15, [0, 0.03, -0.33], WOOD), // corredera de bombeo
      box(0.006, 0.008, 0.008, [0, 0.073, -0.62], BRASS), // punto de mira
      box(0.01, 0.022, 0.05, [0, 0.0, -0.03], STEEL), // guardamonte
      box(0.036, 0.09, 0.05, [0, -0.015, 0.03], WOOD, [-0.35, 0, 0]), // garganta
    ],
    stock: [box(0.04, 0.085, 0.24, [0, 0.0, 0.17], WOOD, [0.12, 0, 0])],
    mag: [cyl(0.0095, 0.05, [0, 0.0, -0.085], SHELL_RED), cyl(0.0098, 0.015, [0, 0.0, -0.053], BRASS)], // un cartucho
    left: [0, 0.0, -0.33],
    muzzle: [0, 0.058, -0.63],
    sight: 0.075,
    magOut: [0, -0.944, 0.33],
  }),
  rifle: () => ({
    body: [
      box(0.046, 0.07, 0.3, [0, 0.035, -0.07], OLIVE), // cajón
      box(0.052, 0.054, 0.22, [0, 0.04, -0.33], OLIVE_DARK), // guardamanos
      cyl(0.009, 0.16, [0, 0.045, -0.52], BLACK), // caño
      cyl(0.014, 0.045, [0, 0.045, -0.615], BLACK), // freno de boca
      box(0.024, 0.016, 0.42, [0, 0.078, -0.17], BLACK), // riel
      box(0.022, 0.03, 0.03, [0, 0.1, 0.0], BLACK), // alza
      box(0.006, 0.034, 0.012, [0, 0.1, -0.4], BLACK), // guion
      box(0.03, 0.09, 0.044, [0, -0.03, 0.02], BLACK, GRIP_RAKE), // empuñadura
    ],
    stock: [box(0.044, 0.075, 0.24, [0, 0.025, 0.2], OLIVE_DARK)],
    mag: [ // curvo, hacia adelante
      box(0.026, 0.1, 0.055, [0, -0.04, -0.12], STEEL, [0.15, 0, 0]),
      box(0.026, 0.08, 0.055, [0, -0.125, -0.14], STEEL, [0.4, 0, 0]),
    ],
    left: [0, 0.0, -0.33],
    muzzle: [0, 0.045, -0.64],
    sight: 0.115,
    magOut: [0, -0.989, -0.148],
  }),
  francotirador: () => ({
    body: [
      box(0.046, 0.062, 0.28, [0, 0.035, -0.06], SNIPER), // cajón
      cyl(0.0105, 0.56, [0, 0.045, -0.48], BLACK), // caño
      cyl(0.016, 0.05, [0, 0.045, -0.78], BLACK), // freno de boca
      box(0.05, 0.05, 0.24, [0, 0.02, -0.3], SNIPER_DARK), // guardamanos
      box(0.046, 0.1, 0.3, [0, -0.005, 0.22], SNIPER_DARK), // culata
      box(0.04, 0.03, 0.14, [0, 0.055, 0.2], SNIPER_DARK), // apoyo de la mejilla
      box(0.03, 0.09, 0.045, [0, -0.03, 0.025], BLACK, GRIP_RAKE), // empuñadura
      cyl(0.016, 0.24, [0, 0.105, -0.05], BLACK, 'z', 12), // mira telescópica
      cyl(0.025, 0.06, [0, 0.105, -0.19], BLACK, 'z', 12), // objetivo
      cyl(0.021, 0.05, [0, 0.105, 0.085], BLACK, 'z', 12), // ocular
      box(0.014, 0.034, 0.02, [0, 0.077, -0.12], BLACK), // anillas
      box(0.014, 0.034, 0.02, [0, 0.077, 0.0], BLACK),
      box(0.05, 0.012, 0.012, [0.035, 0.045, 0.03], STEEL), // cerrojo
    ],
    mag: [box(0.03, 0.05, 0.075, [0, -0.008, -0.09], BLACK)],
    left: [0, -0.01, -0.3],
    muzzle: [0, 0.045, -0.81],
    sight: 0.105,
    magOut: [0, -1, 0],
  }),
};

/** Un brazo: caja de grosor t desde `from` hasta `to`. */
function limb(from: Vec3, to: Vec3, t: number, color: string): THREE.BufferGeometry {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const g = new THREE.BoxGeometry(t, t, a.distanceTo(b));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize()));
  const mid = a.add(b).multiplyScalar(0.5);
  return place(g, [mid.x, mid.y, mid.z], color);
}

/** Mano derecha en la empuñadura y mano izquierda en `left`; los antebrazos bajan hacia los codos, que quedan fuera de
 *  cuadro (abajo, atrás y afuera). */
function handsGeometry(left: Vec3): THREE.BufferGeometry {
  return merge([
    box(0.045, 0.08, 0.075, [0.004, -0.03, 0.02], SKIN, GRIP_RAKE),
    limb([0.01, -0.07, 0.05], [0.12, -0.32, 0.3], 0.062, SLEEVE),
    box(0.05, 0.045, 0.09, left, SKIN),
    limb([left[0], left[1] - 0.03, left[2] + 0.03], [left[0] - 0.18, left[1] - 0.28, left[2] + 0.25], 0.062, SLEEVE),
  ]);
}

/** Geometrías nuevas de un arma (quien las pide las libera). */
export function weaponModel(id: WeaponId): WeaponModel {
  const p = PARTS[id]();
  return {
    body: merge(p.body), mag: merge(p.mag), stock: p.stock ? merge(p.stock) : null, hands: handsGeometry(p.left),
    muzzle: p.muzzle, sight: p.sight, magOut: p.magOut,
  };
}

/** Maniquí de práctica con los pies en y = 0, mirando a +z: piernas de 0 a 0,8 m, torso hasta 1,45 y cabeza hasta 1,8,
 *  como las partes del hitscan, y todo adentro del cilindro de BODY_RADIUS (0,35 m). Torso naranja con un blanco en el
 *  pecho, para verlo de lejos. */
export function dummyGeometry(): THREE.BufferGeometry {
  const legs = '#3a4150', torso = '#d9692c', arms = '#bf5a24', head = '#e0cba8';
  return merge([
    box(0.18, 0.8, 0.22, [-0.11, 0.4, 0], legs),
    box(0.18, 0.8, 0.22, [0.11, 0.4, 0], legs),
    box(0.46, 0.65, 0.28, [0, 1.125, 0], torso),
    box(0.1, 0.58, 0.14, [-0.29, 1.13, 0], arms),
    box(0.1, 0.58, 0.14, [0.29, 1.13, 0], arms),
    box(0.18, 0.18, 0.01, [0, 1.18, 0.145], '#f2efe8'), // blanco en el pecho
    box(0.07, 0.07, 0.012, [0, 1.18, 0.146], '#c22a22'),
    box(0.12, 0.07, 0.12, [0, 1.485, 0], head), // cuello
    box(0.26, 0.28, 0.26, [0, 1.66, 0], head),
  ]);
}

/** Qué se dibuja tirado en el piso: cada arma, la caja de munición (una para los 3 tipos, teñida por instancia),
 *  el chaleco y el botiquín. */
export const DROP_KINDS = ['pistola', 'escopeta', 'rifle', 'francotirador', 'municion', 'chaleco', 'botiquin'] as const;
export type DropKind = (typeof DROP_KINDS)[number];

/** Las armas en el piso, un poco más grandes que en la mano: se ven de lejos. */
const DROP_WEAPON_SCALE = 1.25;

/** Geometría nueva del objeto, centrada en el origen: ahí cae el punto que se mira para juntarlo. La caja de munición
 *  es blanca donde va el color de su tipo (el de la instancia multiplica el del vértice). */
export function dropGeometry(kind: DropKind): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (kind) {
    case 'municion':
      g = merge([
        box(0.26, 0.15, 0.16, [0, 0, 0], '#ffffff'),
        box(0.27, 0.03, 0.17, [0, 0.06, 0], '#3a3a3a'), // tapa
        box(0.09, 0.02, 0.03, [0, 0.085, 0], '#3a3a3a'), // manija
      ]);
      break;
    case 'chaleco': {
      const vest = '#34425a', strap = '#222a36';
      g = merge([
        box(0.4, 0.38, 0.06, [0, -0.02, 0.07], vest), // pechera
        box(0.4, 0.38, 0.05, [0, -0.02, -0.075], vest), // espaldar
        box(0.08, 0.05, 0.2, [-0.12, 0.195, 0], strap), // hombreras
        box(0.08, 0.05, 0.2, [0.12, 0.195, 0], strap),
        box(0.42, 0.06, 0.2, [0, -0.12, 0], strap), // faja
        box(0.12, 0.08, 0.012, [0.08, 0.06, 0.105], '#c9b26b'), // parche
      ]);
      break;
    }
    case 'botiquin': {
      const red = '#d62828';
      g = merge([
        box(0.34, 0.22, 0.14, [0, 0, 0], '#f2f2f2'),
        // la cruz, de los dos lados
        ...[0.075, -0.075].flatMap((z) => [box(0.12, 0.035, 0.012, [0, 0, z], red), box(0.035, 0.12, 0.012, [0, 0, z], red)]),
        box(0.1, 0.025, 0.03, [0, 0.122, 0], '#8a8a8a'), // manija
      ]);
      break;
    }
    default: {
      const m = weaponModel(kind);
      m.hands.dispose();
      g = merge(m.stock ? [m.body, m.mag, m.stock] : [m.body, m.mag]);
      g.scale(DROP_WEAPON_SCALE, DROP_WEAPON_SCALE, DROP_WEAPON_SCALE);
    }
  }
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
