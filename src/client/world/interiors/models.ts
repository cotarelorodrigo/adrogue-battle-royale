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

/** Tronco de cono vertical (radio rTop arriba, rBottom abajo) de alto h con la base en `at`. */
export const cone = (rTop: number, rBottom: number, h: number, at: Vec3, color: string, segments = 10): THREE.BufferGeometry =>
  paint(new THREE.CylinderGeometry(rTop, rBottom, h, segments).translate(0, h / 2, 0), at, color);

/** Caja de w × h × d con el medio de la base en `at`, inclinada `rx` sobre +x (por el medio de su base): una pata en A. */
const lean = (w: number, h: number, d: number, at: Vec3, rx: number, color: string): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateX(rx);
  g.translate(0, (d / 2) * Math.abs(Math.sin(rx)), 0); // la arista de abajo que bajó al inclinarla, otra vez en el piso
  return paint(g, at, color);
};

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

const ALUMINIUM = '#9aa0a6';

// Los muebles de los bancos (tarea 6). Laminado claro, aluminio, el negro de los monitores y el gris de las sillas.
const LAMINATE = '#e2ded6', LAMINATE_SIDE = '#cfcac1', COUNTER_FOOT = '#4a4d52', SCREEN_BACK = '#1b1c1f', KEYBOARD = '#2a2c30';
const CHAIR = '#3b3f45', CHAIR_BASE = '#26282c', SEAT = '#646a72';
// El cajero automático y el turnero brillan (ITEM_GLOW): van sin la luz horneada, así que su cuerpo lleva ya lo oscuro
// que tendría a la luz del salón (color · luz · INTERIOR_EXPOSURE: un gris metálico queda en ~#3a) y la pantalla, su
// brillo. Desde adentro, con el ojo adaptado, lo que brilla se ve ~4 veces más fuerte que desde la vereda.
const ATM_BODY = '#3a3e44', ATM_FRONT = '#1d1f23', ATM_SCREEN = '#3d76a8', ATM_KEYS = '#55595f', ATM_SLOT = '#0a0b0c';
const SIGN_BOX = '#121316', SIGN_SCREEN = '#050506', ROD = '#2c2e32';

/** Una silla de oficina giratoria en (x, z), con el respaldo hacia −z si `back` es −1 (mira a +z) o hacia +z si es 1. */
const officeChair = (x: number, z: number, back: 1 | -1): THREE.BufferGeometry[] => [
  box(0.6, 0.04, 0.07, [x, 0.03, z], CHAIR_BASE), box(0.07, 0.04, 0.6, [x, 0.03, z], CHAIR_BASE),
  box(0.06, 0.38, 0.06, [x, 0.07, z], CHAIR_BASE), box(0.48, 0.07, 0.46, [x, 0.45, z], CHAIR),
  box(0.44, 0.5, 0.06, [x, 0.56, z + back * 0.23], CHAIR),
];
/** Una silla fija de cuatro patas en (x, z), con el respaldo del lado de `back` (como en officeChair). */
const guestChair = (x: number, z: number, back: 1 | -1): THREE.BufferGeometry[] => [
  ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => box(0.03, 0.44, 0.03, [x + sx * 0.2, 0, z + sz * 0.19], ALUMINIUM)),
  box(0.46, 0.06, 0.44, [x, 0.42, z], CHAIR), box(0.44, 0.4, 0.05, [x, 0.48, z + back * 0.2], CHAIR),
];

// La Casa de la Cultura (tarea 7): el plafón, las butacas del auditorio y los paneles de las muestras.
const PLAFON_BACK = '#efeae0', PLAFON_RIM = '#3a3530', CABLE = '#2a2a2a';
const SEAT_FABRIC = '#b82a36', SEAT_FRAME = '#3a3a3e';
const PANEL_FACE = '#f3f1ec', PANEL_FOOT = '#3b3d40';
/** El plafón: un disco de 7 m (su cara de abajo, la pintada, es un cartel), con el aro del borde y los cuatro cables de
 *  los que cuelga, hasta el lucernario (2,6 m más arriba). */
const PLAFON_R = 3.5, PLAFON_T = 0.1, PLAFON_CABLE = 2.5;
/** La butaca: asiento, respaldo y el costado de −x con su apoyabrazos (el de +x es el de la butaca de al lado), de 0,55
 *  m de ancho; mira a +z (al escenario). Son ~200 en el auditorio: tres cajas cada una. */
const seat = (): THREE.BufferGeometry[] => [
  box(0.5, 0.1, 0.46, [0, 0.4, 0.02], SEAT_FABRIC), box(0.5, 0.56, 0.09, [0, 0.42, -0.23], SEAT_FABRIC),
  box(0.05, 0.62, 0.52, [-0.275, 0, -0.02], SEAT_FRAME),
];

// El McDonald's y La Veneciana (tarea 8). Lo que se tiñe con Item.color (el asiento de una silla, la tapa de una mesa, la
// lona de una silla director, el helado de un balde) va en blanco; el resto, de su color.
const FRAME_BLACK = '#232325', TOP_WHITE = '#f4f4f2', PEDESTAL = '#1c1c1e', CUSHION = '#efefed', PLINTH = '#1d1d1f';
const INOX = '#b9bdc1', INOX_DARK = '#8d9196', OIL = '#6b4a14', HANDLE = '#2a2b2e', GRILLE = '#5d6166';
const PICNIC_WOOD = '#9a6b3e', POLE = '#e8e8e6', CANOPY = '#c8202f', BASE = '#3a3a3c';
const CABINET = '#5a3a22', FIELD = '#2f8a3c', LINE = '#f2f2f2', ROD_CHROME = '#c9ccd0', TEAM_A = '#c8202f', TEAM_B = '#1f4fa8';
// lo que brilla (ITEM_GLOW) va sin hornear: el marco de la pantalla, ya oscuro
const BEZEL = '#0d0d0e', BELL = '#f2efe8', BELL_CABLE = '#1c1c1c';
/** La pantalla de menú: el origen en el medio del borde de abajo; las varillas suben hasta el cielorraso (PANTALLA.rod
 *  arriba del borde de arriba). La imagen es un cartel `menu` que brilla, delante del frente. */
export const PANTALLA = { w: 1.0, h: 0.58, d: 0.05, rod: 0.42 } as const;
/** La lámpara campana: el origen en el medio del borde de abajo de la campana; el cable sube BELL_DROP hasta el florón. */
export const BELL_DROP = 1.0;
/** Una fila de jugadores del metegol: la varilla a lo ancho (con su manija) y `n` muñecos del color del equipo. */
const foosRod = (z: number, n: number, team: string): THREE.BufferGeometry[] => [
  box(1.12, 0.016, 0.016, [0, 0.862, z], ROD_CHROME), box(0.11, 0.03, 0.03, [(z > 0 ? 1 : -1) * 0.6, 0.855, z], HANDLE),
  ...Array.from({ length: n }, (_, k) => box(0.03, 0.08, 0.025, [((k - (n - 1) / 2) * 0.6) / Math.max(1, n), 0.818, z], team)),
];

export const ITEM_MODELS: Record<ItemModel, () => THREE.BufferGeometry> = {
  // la silla de cuatro patas negras: el asiento y el respaldo se tiñen (de madera, amarillos)
  silla: () => model(box(0.42, 0.04, 0.42, [0, 0.43, 0], '#ffffff'), box(0.42, 0.3, 0.03, [0, 0.59, -0.195], '#ffffff'),
    box(0.03, 0.16, 0.03, [-0.195, 0.47, -0.195], FRAME_BLACK), box(0.03, 0.16, 0.03, [0.195, 0.47, -0.195], FRAME_BLACK),
    ...legs(0.42, 0.42, 0.43, 0.03, FRAME_BLACK)),
  // la banqueta alta de la barra: el asiento se tiñe; el caño, el apoyapiés y la base, negros
  banqueta: () => model(cyl(0.18, 0.05, [0, 0.7, 0], '#ffffff', 14), cyl(0.025, 0.7, [0, 0, 0], FRAME_BLACK, 6),
    cyl(0.2, 0.02, [0, 0, 0], FRAME_BLACK, 14), cyl(0.15, 0.02, [0, 0.32, 0], FRAME_BLACK, 10)),
  // la lámpara campana colgada (brilla): la campana blanca, el cable y el florón
  lampara: () => model(cone(0.05, 0.17, 0.22, [0, 0, 0], BELL, 16), cyl(0.045, 0.05, [0, 0.22, 0], BELL, 10),
    cyl(0.006, BELL_DROP - 0.3, [0, 0.27, 0], BELL_CABLE, 4), cyl(0.06, 0.03, [0, BELL_DROP - 0.03, 0], BELL, 10)),
  // la mesa de cuatro patas: la tapa se tiñe (de madera)
  mesa: () => model(box(1.2, 0.04, 0.8, [0, 0.71, 0], '#ffffff'), box(1.1, 0.08, 0.7, [0, 0.63, 0], '#d8d8d8'), ...legs(1.2, 0.8, 0.71, 0.05, FRAME_BLACK)),
  // un módulo de sillón corrido (el del McDonald's): el zócalo negro, el almohadón y el respaldo (el zigzag del tapizado
  // es un cartel del plan sobre el respaldo y el frente)
  sillon: () => model(box(0.85, 0.1, 0.8, [0, 0, 0.025], PLINTH), box(0.85, 0.34, 0.72, [0, 0.1, 0.065], CUSHION),
    box(0.85, 0.8, 0.13, [0, 0, -0.36], CUSHION), box(0.85, 0.03, 0.14, [0, 0.77, -0.355], PLINTH)),
  // la hoja de vidrio abierta (D10): acá, el marco; el paño va en ITEM_GLASS
  'hoja-vidrio': () => model(box(0.05, 2.1, 0.04, [-0.425, 0, 0], ALUMINIUM), box(0.05, 2.1, 0.04, [0.425, 0, 0], ALUMINIUM),
    box(0.8, 0.05, 0.04, [0, 0, 0], ALUMINIUM), box(0.8, 0.05, 0.04, [0, 2.05, 0], ALUMINIUM)),
  // el cajero automático de pie (0,7 × 0,6 × 1,6, MODEL_BOX): el gabinete, el frente salido con la pantalla y la ranura de
  // la tarjeta, la repisa con el teclado, la boca de los billetes y el cabezal
  cajero: () => model(box(0.7, 1.6, 0.6, [0, 0, 0], ATM_BODY), box(0.64, 0.62, 0.05, [0, 0.9, 0.325], ATM_FRONT),
    box(0.38, 0.29, 0.01, [0, 1.15, 0.355], ATM_SCREEN), box(0.09, 0.025, 0.01, [-0.2, 0.97, 0.355], ATM_SLOT),
    box(0.62, 0.05, 0.2, [0, 0.86, 0.4], ATM_BODY), box(0.2, 0.015, 0.12, [0.12, 0.91, 0.42], ATM_KEYS),
    box(0.3, 0.04, 0.01, [0, 0.68, 0.305], ATM_SLOT), box(0.72, 0.12, 0.64, [0, 1.49, 0.01], ATM_FRONT)),
  // el escritorio de atención (1,4 × 0,7 × 0,75, MODEL_BOX): tapa, costados, faldón del lado del cliente (+z), cajonera,
  // el monitor y el teclado del empleado y una silla de cada lado (la giratoria del empleado en −z)
  escritorio: () => model(box(1.4, 0.03, 0.7, [0, 0.72, 0], LAMINATE), box(0.03, 0.72, 0.66, [-0.685, 0, 0], LAMINATE_SIDE),
    box(0.03, 0.72, 0.66, [0.685, 0, 0], LAMINATE_SIDE), box(1.34, 0.42, 0.02, [0, 0.3, 0.32], LAMINATE_SIDE),
    box(0.4, 0.6, 0.55, [0.42, 0.08, -0.05], LAMINATE_SIDE),
    box(0.52, 0.32, 0.03, [-0.15, 0.84, 0.13], SCREEN_BACK), box(0.06, 0.09, 0.05, [-0.15, 0.75, 0.16], SCREEN_BACK),
    box(0.42, 0.02, 0.14, [-0.15, 0.75, -0.14], KEYBOARD), ...officeChair(0, -0.75, -1), ...guestChair(0, 0.72, 1)),
  // el turnero colgado del cielorraso (3 m): la caja con su pantalla (el número es un cartel que brilla) y dos varillas
  turnero: () => model(box(0.9, 0.46, 0.08, [0, 2.3, 0], SIGN_BOX), box(0.84, 0.4, 0.005, [0, 2.33, 0.0425], SIGN_SCREEN),
    box(0.02, 0.26, 0.02, [-0.32, 2.76, 0], ROD), box(0.02, 0.26, 0.02, [0.32, 2.76, 0], ROD)),
  // un puesto de caja (MODEL_BOX: el tramo de mostrador de 1,9 × 0,6 × 1,1): del lado del cliente (+z), el mostrador
  // alto con su tapa, el zócalo y la bandeja del pasa-valores; del lado del cajero (−z), su escritorio más bajo con el
  // monitor y la silla. Los parantes y el travesaño de aluminio enmarcan la mampara (el vidrio es un bloque del plan).
  'puesto-caja': () => model(box(1.9, 1.06, 0.32, [0, 0, 0.14], LAMINATE_SIDE), box(1.94, 0.04, 0.36, [0, 1.06, 0.14], LAMINATE),
    box(1.9, 0.1, 0.012, [0, 0, 0.306], COUNTER_FOOT), box(0.4, 0.02, 0.16, [0, 1.1, 0.13], ALUMINIUM),
    box(1.9, 0.76, 0.28, [0, 0, -0.16], LAMINATE_SIDE), box(1.9, 0.03, 0.3, [0, 0.76, -0.16], LAMINATE),
    box(0.04, 1.3, 0.05, [-0.93, 1.1, 0], ALUMINIUM), box(0.04, 1.3, 0.05, [0.93, 1.1, 0], ALUMINIUM),
    box(1.9, 0.04, 0.05, [0, 2.36, 0], ALUMINIUM), box(0.46, 0.3, 0.03, [0.4, 0.88, -0.12], SCREEN_BACK),
    box(0.06, 0.09, 0.05, [0.4, 0.79, -0.1], SCREEN_BACK), ...officeChair(0, -0.8, -1)),
  // una fila de 4 sillas de espera unidas por una viga, sobre dos patas en T (2,2 m de largo, miran a +z)
  'sillas-espera': () => model(box(2.2, 0.05, 0.06, [0, 0.35, -0.04], ALUMINIUM),
    ...[-0.8, 0.8].flatMap((x) => [box(0.05, 0.35, 0.05, [x, 0, -0.04], ALUMINIUM), box(0.07, 0.03, 0.5, [x, 0, -0.02], ALUMINIUM)]),
    ...[-0.825, -0.275, 0.275, 0.825].flatMap((x) => [box(0.48, 0.05, 0.44, [x, 0.4, 0.02], SEAT), box(0.46, 0.38, 0.04, [x, 0.48, -0.21], SEAT)])),
  // el plafón (sin caja: se atraviesa), con el origen en el medio de su cara de abajo
  plafon: () => model(cyl(PLAFON_R, PLAFON_T, [0, 0, 0], PLAFON_BACK, 48), cyl(PLAFON_R + 0.03, 0.04, [0, 0.03, 0], PLAFON_RIM, 48),
    ...[0, 1, 2, 3].map((k) => cyl(0.012, PLAFON_CABLE, [Math.cos(k * Math.PI / 2 + Math.PI / 4) * 2.6, PLAFON_T, Math.sin(k * Math.PI / 2 + Math.PI / 4) * 2.6], CABLE, 4))),
  // la butaca del auditorio (sin caja: las filas se cruzan caminando)
  'silla-auditorio': () => model(...seat()),
  // el panel de una muestra (MODEL_BOX: 1,6 × 0,12 × 2,2): el tablero blanco sobre dos pies; los cuadros son carteles
  'panel-muestra': () => model(box(1.6, 2.1, 0.08, [0, 0.1, 0], PANEL_FACE), box(1.62, 0.03, 0.1, [0, 2.17, 0], PANEL_FOOT),
    ...[-0.62, 0.62].flatMap((x) => [box(0.08, 0.12, 0.5, [x, 0, 0], PANEL_FOOT), box(0.05, 0.1, 0.05, [x, 0.08, 0], PANEL_FOOT)])),
  // la mesa redonda blanca de 0,7 m con pie negro (MODEL_BOX)
  'mesa-redonda': () => model(cyl(0.35, 0.03, [0, 0.72, 0], TOP_WHITE, 20), cyl(0.04, 0.69, [0, 0.03, 0], PEDESTAL, 8),
    cyl(0.25, 0.03, [0, 0, 0], PEDESTAL, 16)),
  // la freidora de una cuba (MODEL_BOX: 0,5 × 0,8 × 1,1): el gabinete de acero con su puerta, la cuba con el aceite, las
  // dos canastas colgadas y el respaldo de la campana
  freidora: () => model(box(0.5, 0.86, 0.8, [0, 0, 0], INOX), box(0.44, 0.6, 0.01, [0, 0.12, 0.4], INOX_DARK),
    box(0.3, 0.02, 0.02, [0, 0.66, 0.41], HANDLE), box(0.5, 0.04, 0.8, [0, 0.86, 0], INOX_DARK), box(0.38, 0.01, 0.46, [0, 0.9, 0.04], OIL),
    box(0.16, 0.12, 0.2, [-0.1, 0.92, 0.08], GRILLE), box(0.16, 0.12, 0.2, [0.1, 0.92, 0.08], GRILLE),
    box(0.02, 0.02, 0.18, [-0.1, 1.04, 0.27], HANDLE), box(0.02, 0.02, 0.18, [0.1, 1.04, 0.27], HANDLE),
    box(0.5, 0.2, 0.08, [0, 0.9, -0.36], INOX)),
  // la heladera de acero de dos puertas (MODEL_BOX: 0,75 × 0,8 × 2,0): el cuerpo, las puertas con sus manijas y la
  // rejilla del motor arriba
  heladera: () => model(box(0.75, 2.0, 0.78, [0, 0, -0.01], INOX), box(0.36, 1.72, 0.02, [-0.19, 0.1, 0.38], INOX),
    box(0.36, 1.72, 0.02, [0.19, 0.1, 0.38], INOX), box(0.02, 0.5, 0.03, [-0.03, 0.9, 0.39], HANDLE), box(0.02, 0.5, 0.03, [0.03, 0.9, 0.39], HANDLE),
    box(0.7, 0.14, 0.02, [0, 1.84, 0.38], GRILLE), box(0.75, 0.1, 0.02, [0, 0, 0.38], HANDLE)),
  // la pantalla de menú (brilla): el marco negro y las dos varillas al cielorraso
  pantalla: () => model(box(PANTALLA.w, PANTALLA.h, PANTALLA.d, [0, 0, 0], BEZEL),
    box(0.02, PANTALLA.rod, 0.02, [-0.35, PANTALLA.h, 0], BEZEL), box(0.02, PANTALLA.rod, 0.02, [0.35, PANTALLA.h, 0], BEZEL)),
  // la mesa de picnic de madera (MODEL_BOX: 1,8 × 1,5 × 0,75): la tapa, los dos bancos y los caballetes en A
  'mesa-picnic': () => model(box(1.8, 0.05, 0.72, [0, 0.7, 0], PICNIC_WOOD), box(1.8, 0.04, 0.26, [0, 0.42, -0.62], PICNIC_WOOD),
    box(1.8, 0.04, 0.26, [0, 0.42, 0.62], PICNIC_WOOD),
    ...[-0.7, 0.7].flatMap((x) => [lean(0.06, 0.8, 0.06, [x, 0, -0.58], 0.52, PICNIC_WOOD), lean(0.06, 0.8, 0.06, [x, 0, 0.58], -0.52, PICNIC_WOOD),
      box(0.06, 0.05, 1.5, [x, 0.38, 0], PICNIC_WOOD)])),
  // la sombrilla (sin caja: se cruza): la base, el mástil y la tela en ocho paños, roja
  sombrilla: () => model(cyl(0.22, 0.06, [0, 0, 0], BASE, 12), cyl(0.022, 2.3, [0, 0.06, 0], POLE, 6),
    cone(0.04, 1.3, 0.38, [0, 1.98, 0], CANOPY, 8), cone(1.3, 1.3, 0.12, [0, 1.86, 0], CANOPY, 8)),
  // la silla director plegable (sin caja): el armazón y los apoyabrazos negros, la lona (asiento y respaldo) se tiñe
  'silla-director': () => model(...[-1, 1].flatMap((sx) => [
    box(0.03, 0.48, 0.03, [sx * 0.26, 0.42, -0.2], FRAME_BLACK), box(0.03, 0.24, 0.03, [sx * 0.26, 0.42, 0.2], FRAME_BLACK),
    box(0.04, 0.03, 0.46, [sx * 0.26, 0.64, 0], FRAME_BLACK), box(0.03, 0.03, 0.42, [sx * 0.26, 0.42, 0], FRAME_BLACK),
    lean(0.03, 0.58, 0.03, [sx * 0.26, 0, -0.2], 0.76, FRAME_BLACK), lean(0.03, 0.58, 0.03, [sx * 0.26, 0, 0.2], -0.76, FRAME_BLACK)]),
  box(0.5, 0.02, 0.42, [0, 0.44, 0], '#ffffff'), box(0.5, 0.22, 0.015, [0, 0.64, -0.2], '#ffffff')),
  // el metegol (MODEL_BOX: 0,76 × 1,42 × 0,9, sin las varillas ni las manijas, que salen a los costados): el gabinete
  // sobre cuatro patas, la cancha verde con sus líneas y bandas, los arcos en las puntas y ocho varillas de muñecos
  metegol: () => model(box(0.76, 0.16, 1.2, [0, 0.68, 0], CABINET), box(0.68, 0.006, 1.12, [0, 0.84, 0], FIELD),
    box(0.68, 0.002, 0.012, [0, 0.846, 0], LINE), box(0.04, 0.06, 1.2, [-0.36, 0.84, 0], CABINET), box(0.04, 0.06, 1.2, [0.36, 0.84, 0], CABINET),
    box(0.76, 0.06, 0.04, [0, 0.84, -0.58], CABINET), box(0.76, 0.06, 0.04, [0, 0.84, 0.58], CABINET),
    box(0.22, 0.12, 0.11, [0, 0.72, -0.655], CABINET), box(0.22, 0.12, 0.11, [0, 0.72, 0.655], CABINET),
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => box(0.08, 0.68, 0.08, [sx * 0.32, 0, sz * 0.52], CABINET)),
    ...([[-0.49, 1, TEAM_A], [-0.35, 2, TEAM_A], [-0.21, 3, TEAM_B], [-0.07, 5, TEAM_A], [0.07, 5, TEAM_B], [0.21, 3, TEAM_A], [0.35, 2, TEAM_B], [0.49, 1, TEAM_B]] as const)
      .flatMap(([z, n, team]) => foosRod(z, n, team))),
  // un balde de helado de la vitrina (brilla, bajo el vidrio): la cubeta y el copete, del color del gusto
  'balde-helado': () => model(box(0.16, 0.1, 0.32, [0, 0, 0], '#ffffff'), box(0.13, 0.05, 0.26, [0, 0.1, 0.01], '#ffffff'),
    box(0.08, 0.03, 0.14, [0.01, 0.15, -0.02], '#ffffff')),
};

/** Los que brillan: van con su color pleno, sin la luz horneada. */
export const ITEM_GLOW: Partial<Record<ItemModel, true>> = { lampara: true, cajero: true, turnero: true, pantalla: true, 'balde-helado': true };

/** Las partes de vidrio de un modelo, en su marco: van en la malla de in_vidrio del interior (con su material
 *  transparente), no en la de los muebles. El color lo pone el interior (es el lado de la cara, glass.ts). */
export const ITEM_GLASS: Partial<Record<ItemModel, () => THREE.BufferGeometry>> = {
  'hoja-vidrio': () => box(0.8, 2.0, 0.01, [0, 0.05, 0], '#ffffff'),
};
