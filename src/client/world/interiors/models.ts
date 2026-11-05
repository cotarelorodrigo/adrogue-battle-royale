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

/** Tronco de cono sin tapas (lo de arriba y lo de abajo no se ve): de radio rTop arriba y rBottom abajo, con la base en
 *  `at`. */
const tube = (rTop: number, rBottom: number, h: number, at: Vec3, color: string, segments: number): THREE.BufferGeometry =>
  paint(new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, true).translate(0, h / 2, 0), at, color);

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

// Cine Pixel y Guernica (tarea 9).
/** La tela de la butaca del cine: un gris vino que, con la sala a oscuras (la luz horneada ~0,1 y la ACES a
 *  INDOOR_EXPOSURE), apenas se lee (tests/client/interiors.test.ts, "el cine oscuro"). */
export const BUTACA_TELA = '#b4949c';
const BUTACA_ARMAZON = '#6a6a70', CASTER = '#2a2a2e';
const POP_RED = '#b3202a', POP_TRIM = '#e8c547', POPCORN = '#f3dc8a', POP_KETTLE = '#9aa0a6';
const POSTER_FRAME = '#1c1c1e';
const CHROME = '#c9ccd0', TAP_HANDLE = '#1c1c1c', DRIP = '#8d9196';
// la guirnalda y la lamparita brillan (ITEM_GLOW): el cable y el casquillo ya oscuros; el vidrio, un ámbar que la ACES
// no lleva al crema (a INDOOR_EXPOSURE se ve ~(241, 189, 87): tests/client/interiors.test.ts, "las lamparitas")
const GARLAND_CABLE = '#121212', BULB_GLASS = '#b06a20', BULB_SOCKET = '#121212';
const IRON = '#1e1e20', BAR_TOP = '#5a3a22';
/** La guirnalda: un tramo de GARLAND.len m hacia +x desde el origen (el gancho de la punta), que cuelga `sag` m en el
 *  medio, con `bulbs` lamparitas. */
export const GARLAND = { len: 3.0, sag: 0.35, bulbs: 6 } as const;
/** Una caja de w × h × d con el medio en `c`, girada `rz` sobre z, sin las tapas de las puntas (±x: las tapa el tramo
 *  de al lado o el gancho): un tramo del cable de la guirnalda, de 8 triángulos. */
const tilted = (w: number, h: number, d: number, c: Vec3, rz: number, color: string): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d).rotateZ(rz);
  g.setIndex([...g.getIndex()!.array].slice(12)); // las caras de BoxGeometry van +x, −x, +y, −y, +z, −z: seis índices cada una
  return paint(g, c, color);
};
/** El cable de la guirnalda, en `n` tramos rectos sobre la parábola (de 0 en las puntas a −sag en el medio). */
const garlandY = (x: number): number => -GARLAND.sag * (1 - ((2 * x) / GARLAND.len - 1) ** 2);
/**
 * Un sólido de revolución sin tapas, con el eje vertical por `at`: el perfil `[r, y]` (de arriba a abajo) girado en
 * `segments` lados, y cada tramo (de un punto del perfil al siguiente) del color `colors[k]`. Donde el radio es 0 cierra
 * en punta, sin triángulos degenerados; con índice, como las cajas (si no, no se juntan).
 */
function lathe(profile: readonly (readonly [number, number])[], colors: readonly string[], segments: number, at: Vec3): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (let k = 0; k + 1 < profile.length; k++) {
    const [[ra, ya], [rb, yb]] = [profile[k], profile[k + 1]];
    const c = new THREE.Color(colors[k]), first = pos.length / 3;
    for (let s = 0; s < segments; s++) {
      const a = (2 * Math.PI * s) / segments, [cx, sz] = [Math.cos(a), Math.sin(a)];
      for (const [r, y] of [[ra, ya], [rb, yb]]) {
        pos.push(at[0] + r * cx, at[1] + y, at[2] + r * sz);
        nor.push(cx, 0, sz);
        col.push(c.r, c.g, c.b);
      }
    }
    // a0, a1: arriba (en s y s + 1); b0, b1: abajo. Antihorarios vistos desde afuera
    for (let s = 0; s < segments; s++) {
      const [a0, b0, a1, b1] = [first + 2 * s, first + 2 * s + 1, first + 2 * ((s + 1) % segments), first + 2 * ((s + 1) % segments) + 1];
      if (ra > 0) idx.push(a0, a1, b0);
      if (rb > 0) idx.push(a1, b1, b0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
/** La lamparita (colgada y de la guirnalda), desde el gancho (y = 0) hacia abajo: el casquillo negro y la ampolla
 *  alargada, de 6 × 11 cm, que se angosta en punta. */
const BULB: readonly (readonly [number, number])[] = [[0.013, 0], [0.013, -0.025], [0.03, -0.07], [0, -0.11]];
/** 30 triángulos con seis lados (la colgada); 20 con cuatro (las de la guirnalda). */
const bulb = (at: Vec3, segments: number): THREE.BufferGeometry => lathe(BULB, [BULB_SOCKET, BULB_GLASS, BULB_GLASS], segments, at);
/** 152 triángulos por tramo (hay catorce en el Guernica): el cable en cuatro tramos rectos (32) y las seis lamparitas
 *  colgando (120). */
const garland = (): THREE.BufferGeometry[] => {
  const n = 4, parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const [x0, x1] = [(k * GARLAND.len) / n, ((k + 1) * GARLAND.len) / n];
    const [y0, y1] = [garlandY(x0), garlandY(x1)];
    const l = Math.hypot(x1 - x0, y1 - y0);
    parts.push(tilted(l + 0.01, 0.012, 0.012, [(x0 + x1) / 2, (y0 + y1) / 2 - 0.006, 0], Math.atan2(y1 - y0, x1 - x0), GARLAND_CABLE));
  }
  for (let k = 0; k < GARLAND.bulbs; k++) {
    const x = ((k + 0.5) * GARLAND.len) / GARLAND.bulbs, y = garlandY(x);
    parts.push(bulb([x, y - 0.012, 0], 4));
  }
  return parts;
};

// La estación (tarea 10). El molinete de trípode de acero inoxidable (el gabinete con su tapa oscura, el lector SUBE
// arriba y los tres brazos de caño hacia el paso), el banco de listones de madera barnizada sobre patas de hierro verde,
// la ventanilla de la boletería (marco de madera, repisa de mármol, reja de bronce, pasaplatos y la rejilla para hablar)
// y la terminal de carga SUBE. La terminal brilla (ITEM_GLOW): su cuerpo y su franja llevan ya lo oscuro que tendrían a
// la luz del hall (lo calibra tests/client/estacion.test.ts con la ACES y la luz horneada de donde está).
const INOX_M = '#b7bbbf', INOX_LID = '#3b3e42', ARM = '#d2d5d8', READER = '#2b2e33', READER_PAD = '#2f86c8', LED = '#2f9a4a';
const BENCH_WOOD = '#9a6a3c', BENCH_IRON = '#2a3a2f';
const WIN_FRAME = '#6b4a2e', MARBLE = '#dcd8cf', BRONZE = '#8a7444', GRILLE_DARK = '#55595d';
/** La terminal SUBE: la pintura de su cuerpo (gris claro) y de su franja (el celeste de la tarjeta), y lo que llevan
 *  ya oscurecido (brilla: va sin hornear); la pantalla prendida, el lector y la boca de billetes. */
export const SUBE_COLORES = { pintura: '#e2e4e6', cuerpo: '#48494a', franjaPintura: '#1e9bd7', franja: '#042f44', pantalla: '#8fb4d4', lector: '#1a1c1f' } as const;
/** Un caño de radio r de `a` a `b` (sin tapas). */
const rod = (a: Vec3, b: Vec3, r: number, color: string, segments = 6): THREE.BufferGeometry => {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, segments, 1, true).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return paint(g, a, color);
};
/** El molinete (MODEL_BOX 0,88 × 0,9 × 1,0): el gabinete en la punta de +x (0,28 de ancho), el paso hacia −x y los
 *  tres brazos desde el cubo, en el costado del gabinete: uno cruza el paso a 0,85 m y los otros dos bajan hacia los
 *  costados del paso. El frente (+z), hacia el que llega. */
const turnstile = (): THREE.BufferGeometry[] => {
  const hub: Vec3 = [0.12, 0.84, 0.05];
  return [
    box(0.28, 0.88, 0.9, [0.3, 0, 0], INOX_M), box(0.28, 0.08, 0.9, [0.3, 0.88, 0], INOX_LID),
    box(0.16, 0.035, 0.22, [0.3, 0.96, 0.2], READER), box(0.11, 0.005, 0.11, [0.3, 0.995, 0.2], READER_PAD),
    box(0.07, 0.05, 0.005, [0.3, 0.78, 0.45], LED),
    box(0.06, 0.12, 0.12, [0.13, 0.78, 0.05], INOX_LID),
    rod(hub, [-0.425, 0.84, 0.05], 0.018, ARM), rod(hub, [-0.3, 0.5, 0.36], 0.018, ARM), rod(hub, [-0.3, 0.5, -0.26], 0.018, ARM),
  ];
};
/** El banco (MODEL_BOX 1,8 × 0,56 × 0,8): cuatro listones de asiento a 0,45 m, tres de respaldo hasta 0,8 m y tres
 *  patas de hierro (la de cada punta y la del medio). Se sienta mirando a +z. */
const bench = (): THREE.BufferGeometry[] => [
  ...[-0.85, 0, 0.85].flatMap((x) => [
    box(0.05, 0.42, 0.05, [x, 0, 0.245], BENCH_IRON), box(0.05, 0.8, 0.05, [x, 0, -0.255], BENCH_IRON),
    box(0.05, 0.04, 0.52, [x, 0.38, -0.01], BENCH_IRON),
  ]),
  ...[0.215, 0.105, -0.005, -0.115].map((z) => box(1.8, 0.035, 0.09, [0, 0.415, z], BENCH_WOOD)),
  ...[0.5, 0.6, 0.7].map((y) => box(1.8, 0.075, 0.03, [0, y, -0.25], BENCH_WOOD)),
];
/** La ventanilla (origen: el medio del borde de abajo del hueco, en el plano del vidrio; el frente, +z, hacia el
 *  público): el hueco de 0,9 × 1,15 m con el marco sobre la cara del tabique (a 5 cm), la repisa de mármol, la reja de
 *  bronce (siete barrotes y un travesaño), el pasaplatos que atraviesa el vidrio y la rejilla redonda para hablar. */
const ticketWindow = (): THREE.BufferGeometry[] => [
  box(0.07, 1.26, 0.06, [-0.485, -0.04, 0.075], WIN_FRAME), box(0.07, 1.26, 0.06, [0.485, -0.04, 0.075], WIN_FRAME),
  box(1.04, 0.07, 0.06, [0, 1.15, 0.075], WIN_FRAME),
  box(1.06, 0.04, 0.28, [0, -0.04, 0.17], MARBLE),
  ...[-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36].map((x) => box(0.016, 1.15, 0.016, [x, 0, 0.12], BRONZE)),
  box(0.9, 0.02, 0.012, [0, 0.62, 0.12], BRONZE),
  box(0.32, 0.03, 0.24, [0, 0, 0], INOX_M),
  paint(new THREE.CylinderGeometry(0.06, 0.06, 0.006, 12).rotateX(Math.PI / 2), [0, 0.78, 0.013], GRILLE_DARK),
];
/** La terminal de carga SUBE (MODEL_BOX 0,56 × 0,42 × 1,62): el cuerpo gris claro, la franja celeste de arriba (su
 *  cartel, "CARGA SUBE", lo pone el plan), la pantalla, el lector de la tarjeta, la boca de billetes y la base. */
const subeTerminal = (): THREE.BufferGeometry[] => {
  const { cuerpo, franja, pantalla, lector } = SUBE_COLORES;
  return [
    box(0.56, 0.04, 0.42, [0, 0, 0], lector), box(0.54, 1.46, 0.4, [0, 0.04, 0], cuerpo), box(0.56, 0.12, 0.42, [0, 1.5, 0], franja),
    box(0.36, 0.27, 0.012, [0, 1.08, 0.2], lector), box(0.32, 0.23, 0.004, [0, 1.1, 0.207], pantalla),
    box(0.16, 0.12, 0.03, [0, 0.86, 0.2], lector), box(0.1, 0.07, 0.006, [0, 0.885, 0.215], franja),
    box(0.14, 0.03, 0.02, [0.13, 0.74, 0.2], lector), box(0.56, 0.05, 0.42, [0, 1.42, 0], franja),
  ];
};

/** Los muebles, en su marco: el frente mira a +z (Item.yaw lo gira) y, si no se dice otra cosa, el origen va en el piso,
 *  en el medio de su planta (la caja de MODEL_BOX, si la tiene, lo rodea). Los colgados lo dicen en su comentario:
 *  `lampara` (el borde de abajo de la campana), `pantalla` (el medio de su borde de abajo), `plafon` (el medio de su cara
 *  de abajo) y `turnero` (en el piso: la caja cuelga a 2,3 m). En los que se tiñen (Item.color), lo blanco (#ffffff) es lo
 *  que toma el color. Varios interiores comparten estos modelos: antes de poner uno, mirá acá qué dibuja y dónde tiene el
 *  origen (contexto-comun.md). */
export const ITEM_MODELS: Record<ItemModel, () => THREE.BufferGeometry> = {
  // la silla de cuatro patas negras (origen: el piso, bajo el medio del asiento; el respaldo, del lado de −z): el
  // asiento y el respaldo se tiñen (de madera, amarillos); sin color, blancos
  silla: () => model(box(0.42, 0.04, 0.42, [0, 0.43, 0], '#ffffff'), box(0.42, 0.3, 0.03, [0, 0.59, -0.195], '#ffffff'),
    box(0.03, 0.16, 0.03, [-0.195, 0.47, -0.195], FRAME_BLACK), box(0.03, 0.16, 0.03, [0.195, 0.47, -0.195], FRAME_BLACK),
    ...legs(0.42, 0.42, 0.43, 0.03, FRAME_BLACK)),
  // la banqueta alta de la barra (origen: el piso, en el medio de la base): el asiento se tiñe; el caño, el apoyapiés y
  // la base, negros
  banqueta: () => model(cyl(0.18, 0.05, [0, 0.7, 0], '#ffffff', 14), cyl(0.025, 0.7, [0, 0, 0], FRAME_BLACK, 6),
    cyl(0.2, 0.02, [0, 0, 0], FRAME_BLACK, 14), cyl(0.15, 0.02, [0, 0.32, 0], FRAME_BLACK, 10)),
  // la lámpara campana colgada (brilla; desde la tarea 8 ya no es la de pie): la campana blanca, el cable y el florón. El
  // origen es el medio del borde de abajo de la campana: Item.at[1] es el alto de ese borde (el cable sube BELL_DROP)
  lampara: () => model(cone(0.05, 0.17, 0.22, [0, 0, 0], BELL, 16), cyl(0.045, 0.05, [0, 0.22, 0], BELL, 10),
    cyl(0.006, BELL_DROP - 0.3, [0, 0.27, 0], BELL_CABLE, 4), cyl(0.06, 0.03, [0, BELL_DROP - 0.03, 0], BELL, 10)),
  // la mesa de cuatro patas de 1,2 × 0,8 (origen: el piso, bajo el medio de la tapa): la tapa se tiñe (de madera); sin
  // color, blanca
  mesa: () => model(box(1.2, 0.04, 0.8, [0, 0.71, 0], '#ffffff'), box(1.1, 0.08, 0.7, [0, 0.63, 0], '#d8d8d8'), ...legs(1.2, 0.8, 0.71, 0.05, FRAME_BLACK)),
  // un módulo de sillón corrido de 0,85 m (el del McDonald's; origen: el piso, en el medio del módulo; el respaldo, del
  // lado de −z): el zócalo negro, el almohadón y el respaldo (el zigzag del tapizado es un cartel del plan sobre el
  // respaldo y el frente). Se ponen en fila, uno al lado del otro
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
  // la mesa redonda blanca de 0,7 m con pie negro (MODEL_BOX; origen: el piso, bajo el medio de la tapa)
  'mesa-redonda': () => model(cyl(0.35, 0.03, [0, 0.72, 0], TOP_WHITE, 20), cyl(0.04, 0.69, [0, 0.03, 0], PEDESTAL, 8),
    cyl(0.25, 0.03, [0, 0, 0], PEDESTAL, 16)),
  // la freidora de una cuba (MODEL_BOX: 0,5 × 0,8 × 1,1): el gabinete de acero con su puerta, la cuba con el aceite, las
  // dos canastas colgadas y el respaldo de la campana
  freidora: () => model(box(0.5, 0.86, 0.8, [0, 0, 0], INOX), box(0.44, 0.6, 0.01, [0, 0.12, 0.4], INOX_DARK),
    box(0.3, 0.02, 0.02, [0, 0.66, 0.41], HANDLE), box(0.5, 0.04, 0.8, [0, 0.86, 0], INOX_DARK), box(0.38, 0.01, 0.46, [0, 0.9, 0.04], OIL),
    box(0.16, 0.12, 0.2, [-0.1, 0.92, 0.08], GRILLE), box(0.16, 0.12, 0.2, [0.1, 0.92, 0.08], GRILLE),
    box(0.02, 0.02, 0.18, [-0.1, 1.04, 0.27], HANDLE), box(0.02, 0.02, 0.18, [0.1, 1.04, 0.27], HANDLE),
    box(0.5, 0.2, 0.08, [0, 0.9, -0.36], INOX)),
  // la heladera de acero de dos puertas de cocina (MODEL_BOX: 1,3 × 0,8 × 2,0): el cuerpo, las dos puertas de 0,62 con
  // sus manijas en el medio, la rejilla del motor arriba y el zócalo
  heladera: () => model(box(1.3, 2.0, 0.78, [0, 0, -0.01], INOX), box(0.62, 1.72, 0.02, [-0.325, 0.1, 0.38], INOX),
    box(0.62, 1.72, 0.02, [0.325, 0.1, 0.38], INOX), box(0.025, 0.6, 0.03, [-0.045, 0.85, 0.39], HANDLE), box(0.025, 0.6, 0.03, [0.045, 0.85, 0.39], HANDLE),
    box(1.24, 0.14, 0.02, [0, 1.84, 0.38], GRILLE), box(1.3, 0.1, 0.02, [0, 0, 0.38], HANDLE)),
  // la pantalla de menú (brilla; origen: el medio de su borde de abajo, ver PANTALLA): el marco negro y las dos varillas
  // al cielorraso
  pantalla: () => model(box(PANTALLA.w, PANTALLA.h, PANTALLA.d, [0, 0, 0], BEZEL),
    box(0.02, PANTALLA.rod, 0.02, [-0.35, PANTALLA.h, 0], BEZEL), box(0.02, PANTALLA.rod, 0.02, [0.35, PANTALLA.h, 0], BEZEL)),
  // la mesa de picnic de madera (MODEL_BOX: 1,8 × 1,5 × 0,75): la tapa, los dos bancos y los caballetes en A
  'mesa-picnic': () => model(box(1.8, 0.05, 0.72, [0, 0.7, 0], PICNIC_WOOD), box(1.8, 0.04, 0.26, [0, 0.42, -0.62], PICNIC_WOOD),
    box(1.8, 0.04, 0.26, [0, 0.42, 0.62], PICNIC_WOOD),
    ...[-0.7, 0.7].flatMap((x) => [lean(0.06, 0.8, 0.06, [x, 0, -0.58], 0.52, PICNIC_WOOD), lean(0.06, 0.8, 0.06, [x, 0, 0.58], -0.52, PICNIC_WOOD),
      box(0.06, 0.05, 1.5, [x, 0.38, 0], PICNIC_WOOD)])),
  // la sombrilla (sin caja: se cruza; origen: el piso, en el medio de la base): la base, el mástil y la tela en ocho
  // paños, roja, de 1,3 m de radio con el borde a 1,86 m
  sombrilla: () => model(cyl(0.22, 0.06, [0, 0, 0], BASE, 12), cyl(0.022, 2.3, [0, 0.06, 0], POLE, 6),
    cone(0.04, 1.3, 0.38, [0, 1.98, 0], CANOPY, 8), cone(1.3, 1.3, 0.12, [0, 1.86, 0], CANOPY, 8)),
  // la silla director plegable (sin caja; origen: el piso, bajo el medio del asiento; el respaldo, del lado de −z): el
  // armazón y los apoyabrazos negros, la lona (asiento y respaldo) se tiñe
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
  // la butaca del cine (MODEL_BOX: 0,55 × 0,62 × 1,0; mira a +z, a la pantalla): el asiento y el respaldo alto de tela y
  // el costado de −x con su apoyabrazos (el de +x es el de la butaca de al lado). Son 434: tres cajas (36 triángulos)
  butaca: () => model(box(0.5, 0.14, 0.5, [0.02, 0.38, 0.04], BUTACA_TELA), box(0.5, 0.62, 0.12, [0.02, 0.38, -0.25], BUTACA_TELA),
    box(0.05, 0.68, 0.62, [-0.25, 0, 0], BUTACA_ARMAZON)),
  // la máquina de pochoclo (MODEL_BOX: 0,9 × 0,6 × 1,75): el carrito rojo con su guarda dorada, la vitrina (el vidrio va
  // en ITEM_GLASS) con los parantes, el pochoclo, la olla colgada y el techo rojo
  pochoclera: () => model(box(0.9, 0.82, 0.6, [0, 0.05, 0], POP_RED), box(0.92, 0.05, 0.62, [0, 0.82, 0], POP_TRIM),
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([sx, sz]) => [box(0.03, 0.7, 0.03, [sx * 0.435, 0.87, sz * 0.285], POP_TRIM), cyl(0.04, 0.05, [sx * 0.35, 0, sz * 0.22], CASTER, 6)]),
    box(0.84, 0.26, 0.54, [0, 0.87, 0], POPCORN), cyl(0.12, 0.12, [0, 1.3, 0], POP_KETTLE, 10), cyl(0.012, 0.18, [0, 1.42, 0], POP_KETTLE, 4),
    box(0.94, 0.16, 0.64, [0, 1.57, 0], POP_RED), box(0.96, 0.03, 0.66, [0, 1.72, 0], POP_TRIM)),
  // el marco de un afiche (origen: el medio de su borde de abajo, contra la pared; sale 0,03 m hacia +z): la imagen es
  // un cartel `afiche` del plan, de 0,72 × 1,06, delante del marco
  afiche: () => model(box(0.8, 0.04, 0.03, [0, 0, 0.015], POSTER_FRAME), box(0.8, 0.04, 0.03, [0, 1.1, 0.015], POSTER_FRAME),
    box(0.04, 1.06, 0.03, [-0.38, 0.04, 0.015], POSTER_FRAME), box(0.04, 1.06, 0.03, [0.38, 0.04, 0.015], POSTER_FRAME),
    box(0.72, 1.06, 0.005, [0, 0.04, 0.0025], POSTER_FRAME)),
  // una botella del estante (brilla: la ilumina el estante; origen: el piso del estante): el cuerpo y el cuello, del
  // color del vidrio (Item.color, ya oscuro), sin tapas (20 triángulos; hay 54): abajo está el estante y la boca no se ve
  botella: () => model(tube(0.036, 0.036, 0.2, [0, 0, 0], '#ffffff', 6), tube(0.013, 0.036, 0.085, [0, 0.2, 0], '#ffffff', 4)),
  // la torre de canillas cromada en arco, sobre la barra (origen: la tapa de la barra): las dos patas, el arco, cinco
  // canillas colgando del arco con sus manijas y la bandeja de goteo
  canillas: () => model(cyl(0.05, 0.02, [-0.3, 0, 0], CHROME, 10), cyl(0.05, 0.02, [0.3, 0, 0], CHROME, 10),
    cyl(0.03, 0.2, [-0.3, 0.02, 0], CHROME, 8), cyl(0.03, 0.2, [0.3, 0.02, 0], CHROME, 8),
    paint(new THREE.TorusGeometry(0.3, 0.032, 6, 12, Math.PI), [0, 0.22, 0], CHROME),
    ...[-0.24, -0.12, 0, 0.12, 0.24].flatMap((x) => {
      const y = 0.22 + Math.sqrt(Math.max(0, 0.09 - x * x));
      return [box(0.02, 0.06, 0.06, [x, y - 0.06, 0.03], CHROME), box(0.025, 0.12, 0.03, [x, y, 0.06], TAP_HANDLE)];
    }),
    box(0.7, 0.02, 0.16, [0, 0, 0.12], DRIP)),
  // un tramo de guirnalda de lamparitas (brilla; origen: el gancho de una punta): GARLAND.len m hacia +x, colgando
  guirnalda: () => model(...garland()),
  // una lamparita colgada de su cable (brilla; origen: el gancho, arriba del casquillo): cuelga 0,11 m
  lamparita: () => bulb([0, 0, 0], 6),
  // la mesa alta de bar (MODEL_BOX: 0,6 × 0,6 × 1,05): la tapa de madera, el pie de hierro, el apoyapiés y la base
  'mesa-alta': () => model(cyl(0.3, 0.04, [0, 1.01, 0], BAR_TOP, 12), cyl(0.035, 1.0, [0, 0.01, 0], IRON, 6),
    cyl(0.2, 0.02, [0, 0.3, 0], IRON, 8), cyl(0.24, 0.02, [0, 0, 0], IRON, 10)),
  // la estación (tarea 10): el molinete (el gabinete en +x, el paso hacia −x), la terminal SUBE (brilla), el banco con
  // respaldo y la ventanilla (origen: el medio del borde de abajo del hueco, sobre el vidrio)
  molinete: () => model(...turnstile()),
  sube: () => model(...subeTerminal()),
  'banco-respaldo': () => model(...bench()),
  ventanilla: () => model(...ticketWindow()),
};

/** Los que brillan: van con su color pleno, sin la luz horneada. */
export const ITEM_GLOW: Partial<Record<ItemModel, true>> = { lampara: true, cajero: true, turnero: true, pantalla: true, 'balde-helado': true,
  guirnalda: true, botella: true, lamparita: true, sube: true };

/** Las partes de vidrio de un modelo, en su marco: van en la malla de in_vidrio del interior (con su material
 *  transparente), no en la de los muebles. El color lo pone el interior (es el lado de la cara, glass.ts). */
export const ITEM_GLASS: Partial<Record<ItemModel, () => THREE.BufferGeometry>> = {
  'hoja-vidrio': () => box(0.8, 2.0, 0.01, [0, 0.05, 0], '#ffffff'),
  pochoclera: () => box(0.86, 0.68, 0.56, [0, 0.87, 0], '#ffffff'),
};
