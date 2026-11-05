// El Cine Pixel (§4.6), sobre la planta relevada (53,25 × 24,5 m, 8 m de alto, un piso: D9). Marco local: U a lo largo
// del frente (de la punta sur, 0, a la norte, 53,25) y V hacia adentro (del frente, sobre la calle, al fondo); 0 mira a
// +V y π/2 a +U.
// - En el medio, detrás del frente vidriado, el hall: porcelanato beige con bandas gris oscuro, paredes blancas y la del
//   lado de la sala 1 gris oscura, afiches enmarcados (dibujos propios, sin títulos ni marcas) y un cielorraso blanco
//   bajo con spots y, en el medio, un cajón con LED azul. Al fondo, el candy bar: el mostrador negro con la mesada blanca
//   y "CANDY BAR" en magenta, la máquina de pochoclo, las pantallas de menú que brillan y la heladera de bebidas.
// - A los costados, las dos salas, con la pantalla contra el frente y las butacas en gradas que suben hacia el fondo:
//   la sala 1 (la grande, al sur) y la sala 2 (la chica, al norte, más corta: detrás queda el depósito). Se entra por
//   una puerta del hall al lado de la pantalla y se sube por los dos pasillos de escalones contra las paredes (§2.1:
//   contrahuellas de 0,2, un escalón y un descanso por fila), con el pasamanos de caño del lado de la pared y una luz
//   ámbar en la nariz de cada escalón; las filas se entran por las dos puntas. Paredes y techo negros con tiras ámbar, la
//   pantalla gris apagada con su marco negro y, arriba al fondo, la cabina del proyector con su ventanita. Casi sin luz
//   (§2.4).
// - Afuera (`out`): la marquesina gris carbón sobre el frente vidriado, con spots abajo y "CINES PIXEL" en blanco con la
//   P en magenta (sin logo). Es el cartel del lugar: el del lote no se dibuja (placeSign).
// Si la planta no es la relevada, queda el hall vacío.
import type { Vec2 } from '../geo.ts';
import type { SignLook } from '../mapdata.ts';
import type { InteriorPlan } from './index.ts';
import { GROUND_Y, MODEL_BOX, RISER_MAX, TREAD } from './kit.ts';
import type { Kit } from './kit.ts';
import { MIRA, ngon, rect } from './plan-util.ts';
import type { Rect } from './plan-util.ts';
import type { Look } from './types.ts';

// ---------- materiales ----------

/** Las salas: paredes, techo y gradas negros (con la sala a oscuras, apenas se distinguen) y la alfombra gris oscura. */
const NEGRO: Look = { mat: 'liso', color: '#141416' };
const ALFOMBRA: Look = { mat: 'tela', color: '#2c2a2e' };
const CONTRAHUELLA: Look = { mat: 'liso', color: '#1a191b' };
/** El marco de la pantalla, negro mate, y la pantalla: un gris claro apagado que brilla poco (calibrado con la ACES a
 *  INDOOR_EXPOSURE: tests/client/interiors.test.ts, "el cine oscuro"). */
const MARCO: Look = { mat: 'liso', color: '#0c0c0d' };
const PANTALLA_SALA: Look = { mat: 'luz', color: '#2c2c2e' };
/** Las tiras ámbar de las paredes y las luces de los escalones (brillan), y la ventanita del proyector. */
const AMBAR: Look = { mat: 'luz', color: '#7a5218' };
const AMBAR_ESCALON: Look = { mat: 'luz', color: '#6e4a16' };
const PROYECTOR: Look = { mat: 'luz', color: '#3a3a3c' };
/** Los caños de los pasamanos. */
const CAÑO: Look = { mat: 'metal', color: '#2a2a2c' };
/** El hall: el porcelanato beige y sus bandas gris oscuro, las paredes blancas, la gris oscura y el cielorraso blanco.
 *  La gris oscura es la de los afiches (W1): con la luz que le llega (~0,6) se lee gris oscuro, luma ~60 (calibrada con
 *  la ACES a INDOOR_EXPOSURE: tests/client/interiors.test.ts, "la pared de los afiches"); más oscura se ve negra. */
const PORCELANATO: Look = { mat: 'porcelanato', color: '#d8ccb4' };
const BANDA: Look = { mat: 'porcelanato', color: '#4a4a4e' };
const BLANCO: Look = { mat: 'liso', color: '#ecebe8' };
const GRIS_OSCURO: Look = { mat: 'liso', color: '#8e8e94' };
const CIELO: Look = { mat: 'liso', color: '#f2f2f0' };
/** El cajón del cielorraso: el LED azul (brilla) y los spots. */
const LED_AZUL: Look = { mat: 'luz', color: '#1e64dc' };
const SPOT: Look = { mat: 'luz', color: '#fff2dc' };
/** El candy bar: el frente negro, la mesada blanca, el acero de la mesada de atrás y la heladera roja con su puerta de
 *  vidrio iluminada. */
const FRENTE_NEGRO: Look = { mat: 'liso', color: '#1d1d1f' };
const MESADA: Look = { mat: 'liso', color: '#f2f2f0' };
const ACERO: Look = { mat: 'metal', color: '#c4c8cc' };
const HELADERA: Look = { mat: 'liso', color: '#a01c24' };
const HELADERA_PUERTA: Look = { mat: 'luz', color: '#5c6c72' };
/** La marquesina (afuera): gris carbón, con los spots blancos abajo. */
const MARQUESINA: Look = { mat: 'liso', color: '#2f2f31' };
const MARQUESINA_TAPA: Look = { mat: 'liso', color: '#3a3a3c' };
const SPOT_AFUERA: Look = { mat: 'liso', color: '#f4efe4' };

/** "CINES PIXEL": letra blanca de palo seco sobre el gris de la marquesina, la P en magenta (el acento). */
const CARTEL: SignLook = { fondo: '#2f2f31', letra: '#ffffff', marco: '#2f2f31', fuente: 'sans', acento: { letra: '#e5007e', desde: 6, hasta: 7 } };
/** "CANDY BAR" en el frente del mostrador y "SALA 1/2" sobre las puertas: brillan. */
const CANDY: SignLook = { fondo: '#1d1d1f', letra: '#e5007e', marco: '#1d1d1f', fuente: 'sans' };
const SALA: SignLook = { fondo: '#1d1d1f', letra: '#ffffff', marco: '#1d1d1f', fuente: 'sans' };
const SALIDA: SignLook = { fondo: '#0f6b3a', letra: '#ffffff', marco: '#0f6b3a', fuente: 'sans' };
/** Las pantallas de menú (fondo negro, franja magenta) y los afiches (marco negro). */
const MENU: SignLook = { fondo: '#0a0a0b', letra: '#c8c8c8', marco: '#8a0c4c', fuente: 'redondeada' };
const AFICHE: SignLook = { fondo: '#1c1c1e', letra: '#ffffff', marco: '#1c1c1e', fuente: 'sans' };

/** La luz de afuera de los spots, que nunca llega a las salas: casi nada (§2.4; la exposición se adapta adentro). */
const AMBIENT = 0.04;
/** Las lámparas: los spots del hall y del candy bar, el cajón, las tiras de las salas y el techo de las salas. */
const SPOT_L = { r: 8.5, p: 0.75 } as const;
const CAJON_L = { r: 9, p: 1.1 } as const;
const TIRA_L = { r: 4, p: 0.22 } as const;
const SALA_L = { r: 7, p: 0.68 } as const;
/** Un cine es oscuro aunque el ojo se adapte: lo horneado bajo techo va a esto de lo de un local claro (Interior.dim; la
 *  ganancia de adentro, render/exposure.ts, aclara lo horneado ~4 veces; esto lo deja como se calibró sin ella). */
const PENUMBRA = 0.26;

// ---------- medidas (m, marco local) ----------

/** El techo (el del edificio: 8 m, 0,8 de losa) y el cielorraso bajo del hall. */
const TECHO = 7.2, CIELO_HALL = 4.0, CAJON_Y = 4.5;
/** El tabique (pared de 0,2) entre la sala 1 y el hall, el del hall y la sala 2, el fondo del hall (el depósito) y el de
 *  la sala 2. */
const W1 = 18.6, W2 = 37.9, FONDO_HALL = 16.0, FONDO_SALA2 = 17.0;
/** Las puertas de las salas: en W1 y W2, a PUERTA.v del frente. */
const PUERTA = { v: 2.6, ancho: 1.6, alto: 2.4 } as const;
/** Las gradas: cada fila sube FILA_H (dos contrahuellas) y mide FILA m (un escalón y un descanso del pasillo). La
 *  butaca va al fondo de su fila, a 2 cm de la grada de atrás: quedan ~0,86 m para pasar por delante. */
const FILA_H = 2 * RISER_MAX, DESCANSO = 1.2, FILA = TREAD + DESCANSO, PASILLO = 1.2;
const BUTACA = MODEL_BOX.butaca!;
/** El cajón del cielorraso del hall. */
const CAJON: Rect = [23.5, 4.0, 31.5, 10.0];
/** El mostrador del candy bar y la mesada de atrás. */
const MOSTRADOR = { u0: 22.6, u1: 32.4, v0: 12.4, v1: 13.1, h: 1.05 } as const;
const ATRAS = { u0: 22.6, u1: 32.0, v0: 15.3, v1: FONDO_HALL, h: 0.92 } as const;
/** Las pantallas de menú cuelgan con el borde de abajo a esta altura. */
const MENU_Y = 2.9, MENU_W = 1.0, MENU_H = 0.58, MENU_D = 0.05;
/** La marquesina, sobre los vidrios (que llegan a 3,0). */
const MARQ = { u0: 17.0, u1: 33.3, sale: 2.4, y0: 3.05, y1: 3.95 } as const;

const piso = (k: Kit, r: Rect, look: Look): void => k.block(rect(r), GROUND_Y, GROUND_Y + 0.006, 'none', 'otro', { top: look });
/** Un revestimiento de pared (sin sólido) de 1 cm. */
const revestir = (k: Kit, r: Rect, y0: number, y1: number, look: Look): void => k.block(rect(r), y0, y1, 'none', 'otro', { side: look, top: look, bottom: look });

/**
 * Una sala: la pantalla con su marco contra el frente, las gradas con sus butacas, los dos pasillos de escalones contra
 * las paredes de los costados (con el pasamanos del lado de la pared y la luz de cada nariz: las filas se entran por las
 * dos puntas), las tiras ámbar de las paredes, la cabina del proyector y sus lámparas. `u0`–`u1`: las caras de las
 * paredes de los costados; `fondo`: la del fondo. `filas`: cuántas (la última, en la plataforma de arriba); `pie`: dónde
 * arranca el primer escalón de los pasillos. Devuelve el medio de cada pasillo y la altura de arriba.
 */
function sala(k: Kit, o: { u0: number; u1: number; fondo: number; filas: number; pie: number;
  pantalla: { w: number; y0: number; y1: number }; tiras: number[]; cabina?: number }): { pasillos: [number, number]; arriba: number; plataforma: number } {
  const { u0, u1, fondo, filas, pie } = o;
  const c = (u0 + u1) / 2, bw = BUTACA.w;
  // los pasillos contra las paredes y, entre ellos, las butacas centradas
  const p1: [number, number] = [u0, u0 + PASILLO], p2: [number, number] = [u1 - PASILLO, u1];
  const n = Math.floor((p2[0] - p1[1] - 0.06) / bw), b0 = c - (n * bw) / 2;
  const arriba = filas * FILA_H;
  const S = (j: number): number => pie + TREAD + (j - 1) * FILA; // donde arranca la fila j (1 … filas)
  const plataforma = S(filas);
  // el piso de adelante, alfombrado
  piso(k, [u0, 0.2, u1, pie], ALFOMBRA);
  // las gradas: cada fila, entre los pasillos; la de arriba, de pared a pared hasta el fondo
  for (let j = 1; j < filas; j++) k.block(rect([p1[1], S(j), p2[0], S(j + 1)]), 0, j * FILA_H, 'solid', 'otro', { top: ALFOMBRA, side: CONTRAHUELLA });
  k.block(rect([u0, plataforma, u1, fondo]), 0, arriba, 'solid', 'otro', { top: ALFOMBRA, side: CONTRAHUELLA });
  // las butacas, al fondo de cada fila, mirando a la pantalla
  for (let j = 1; j <= filas; j++) {
    const v = S(j) + FILA - 0.02 - BUTACA.d / 2;
    for (let s = 0; s < n; s++) k.furniture('butaca', [b0 + (s + 0.5) * bw, v], j * FILA_H, MIRA.menosV);
  }
  // los pasillos: un escalón y un descanso por fila, con el pasamanos contra la pared (+U es la izquierda subiendo hacia
  // +V: el de la pared de −U va a la derecha) y una luz ámbar en la nariz de cada escalón
  const pasillos: [number, number] = [(p1[0] + p1[1]) / 2, (p2[0] + p2[1]) / 2];
  pasillos.forEach((pu, side) => {
    k.stair({ from: 0, to: 0, rise: arriba, landings: { every: 2, length: DESCANSO }, foot: [pu, pie], dir: [0, 1], width: PASILLO,
      look: ALFOMBRA, rail: CAÑO, railStyle: { caño: true }, handrail: side === 0 ? 'der' : 'izq', handrailLook: CAÑO });
    for (let i = 1, s = 0; i < 2 * filas; i++) {
      const y = i * RISER_MAX, v = pie + s;
      k.block(rect([pu - PASILLO / 2 + 0.08, v - 0.03, pu + PASILLO / 2 - 0.08, v]), y - 0.05, y, 'none', 'otro', { side: AMBAR_ESCALON, top: AMBAR_ESCALON });
      s += i % 2 === 0 ? DESCANSO : TREAD;
    }
  });
  // la pantalla y su marco negro, contra el frente
  const { w, y0, y1 } = o.pantalla;
  k.block(rect([c - w / 2 - 0.2, 0.2, c + w / 2 + 0.2, 0.32]), y0 - 0.3, Math.min(TECHO - 0.15, y1 + 0.25), 'none', 'otro', { side: MARCO, top: MARCO, bottom: MARCO });
  k.block(rect([c - w / 2, 0.32, c + w / 2, 0.36]), y0, y1, 'none', 'otro', { side: PANTALLA_SALA });
  // las tiras ámbar de las paredes de los costados (a 1,3 m de la grada) y la ventanita del proyector en el fondo
  const pisoEn = (v: number): number => (v < S(1) ? 0 : Math.min(filas, Math.floor((v - S(1)) / FILA) + 1) * FILA_H);
  for (const v of o.tiras) {
    const y = pisoEn(v) + 1.3;
    revestir(k, [u0, v - 0.06, u0 + 0.03, v + 0.06], y, y + 1.9, AMBAR);
    revestir(k, [u1 - 0.03, v - 0.06, u1, v + 0.06], y, y + 1.9, AMBAR);
    k.lamp([u0 + 0.4, v], y + 1.2, TIRA_L.r, TIRA_L.p);
    k.lamp([u1 - 0.4, v], y + 1.2, TIRA_L.r, TIRA_L.p);
  }
  // la cabina de proyección, maciza, detrás del pasillo de arriba (o la pared del fondo), con su ventanita
  const cab = o.cabina ?? fondo;
  if (cab < fondo) k.block(rect([u0, cab, u1, fondo]), arriba, TECHO, 'solid', 'otro', { side: NEGRO }, { hide: [1, 2, 3] });
  k.block(rect([c - 0.55, cab - 0.03, c + 0.55, cab]), TECHO - 1.3, TECHO - 0.8, 'none', 'otro', { side: PROYECTOR });
  // la luz que vuelve de la pantalla sobre las butacas: lámparas (no se ven) a 2,6 m de las gradas, cada tres filas y en
  // la última.
  // Las butacas se tapan entre ellas (la oclusión del horneado, ~0,3): sin esto quedarían negras
  const conLuz = [...Array(Math.floor((filas - 1) / 3) + 1).keys()].map((n) => 1 + 3 * n);
  if (filas - conLuz[conLuz.length - 1] > 1) conLuz.push(filas);
  for (const j of conLuz) for (const u of [c - (u1 - u0) / 3, c, c + (u1 - u0) / 3]) k.lamp([u, S(j) + FILA / 2], j * FILA_H + 2.6, SALA_L.r, SALA_L.p);
  return { pasillos, arriba, plataforma };
}

/** El hall: el piso con bandas, los revestimientos, el cielorraso bajo con el cajón y sus spots, y los afiches. */
function hall(k: Kit): void {
  const [u0, u1] = [W1 + 0.1, W2 - 0.1];
  // las bandas gris oscuro, paralelas al frente
  for (const v of [3.4, 7.0, 10.6]) piso(k, [u0, v, u1, v + 0.4], BANDA);
  piso(k, [27.0, 0.2, 27.4, 12.0], BANDA);
  // el frente, por adentro, blanco: entre los huecos y arriba de los vidrios hasta el cielorraso (el frente es la pared
  // de afuera, negra para las salas)
  for (const [a, b, y0, y1] of [[u0, u1, 3.0, CIELO_HALL], [u0, 18.75, 0, 3.0], [23.75, 23.95, 0, 3.0], [26.35, 26.55, 0, 3.0], [23.95, 26.35, 2.6, 3.0],
    [31.55, u1, 0, 3.0], [18.75, 23.75, 0, 0.1], [26.55, 31.55, 0, 0.1]] as const) revestir(k, [a, 0.2, b, 0.21], y0, y1, BLANCO);
  // el cielorraso bajo, blanco, con el hueco del cajón; el cajón, con sus costados, su fondo y el LED azul
  const [c0, d0, c1, d1] = CAJON;
  for (const r of [[u0, 0.2, u1, d0], [u0, d1, u1, FONDO_HALL], [u0, d0, c0, d1], [c1, d0, u1, d1]] as Rect[]) {
    k.block(rect(r), CIELO_HALL, CIELO_HALL + 0.02, 'none', 'otro', { bottom: CIELO, side: CIELO });
  }
  for (const r of [[c0, d0 - 0.02, c1, d0], [c0, d1, c1, d1 + 0.02], [c0 - 0.02, d0, c0, d1], [c1, d0, c1 + 0.02, d1]] as Rect[]) {
    k.block(rect(r), CIELO_HALL, CAJON_Y, 'none', 'otro', { side: CIELO });
  }
  k.block(rect(CAJON), CAJON_Y, CAJON_Y + 0.02, 'none', 'otro', { bottom: CIELO });
  for (const r of [[c0 + 0.02, d0, c1 - 0.02, d0 + 0.04], [c0 + 0.02, d1 - 0.04, c1 - 0.02, d1], [c0, d0 + 0.04, c0 + 0.04, d1 - 0.04], [c1 - 0.04, d0 + 0.04, c1, d1 - 0.04]] as Rect[]) {
    k.block(rect(r), CIELO_HALL + 0.02, CIELO_HALL + 0.07, 'none', 'otro', { side: LED_AZUL, bottom: LED_AZUL });
  }
  k.lamp([(c0 + c1) / 2 - 2, (d0 + d1) / 2], CAJON_Y - 0.1, CAJON_L.r, CAJON_L.p);
  k.lamp([(c0 + c1) / 2 + 2, (d0 + d1) / 2], CAJON_Y - 0.1, CAJON_L.r, CAJON_L.p);
  // los spots del cielorraso bajo
  for (const [u, v] of [[20.6, 2.0], [24.6, 2.0], [28.6, 2.0], [32.6, 2.0], [36.0, 2.0], [20.6, 7.0], [34.4, 7.0],
    [20.6, 11.8], [24.6, 11.8], [28.6, 11.8], [32.6, 11.8], [36.0, 11.8], [24.6, 14.4], [28.6, 14.4], [32.6, 14.4]] as Vec2[]) {
    k.block(ngon([u, v], 0.09, 8), CIELO_HALL - 0.01, CIELO_HALL, 'none', 'otro', { bottom: SPOT, side: SPOT });
    k.lamp([u, v], CIELO_HALL - 0.1, SPOT_L.r, SPOT_L.p);
  }
  // los afiches: tres en cada pared del costado, con su marco
  ([[W1 + 0.1, 1], [W2 - 0.1, -1]] as const).forEach(([u, s], side) => {
    [6.0, 8.2, 10.4].forEach((v, j) => {
      k.furniture('afiche', [u, v], 1.3, s > 0 ? MIRA.U : MIRA.menosU);
      k.label(`afiche ${side * 3 + j + 1}`, [u + s * 0.031, v], 1.3 + 0.04 + 0.53, [s, 0], 0.72, 1.06, AFICHE, { drawing: 'afiche' });
    });
  });
  // los carteles de las salas sobre sus puertas
  k.label('SALA 1', [W1 + 0.11, PUERTA.v], PUERTA.alto + 0.3, [1, 0], 1.0, 0.3, SALA, { glow: true });
  k.label('SALA 2', [W2 - 0.11, PUERTA.v], PUERTA.alto + 0.3, [-1, 0], 1.0, 0.3, SALA, { glow: true });
}

/** El candy bar contra el fondo del hall. */
function candyBar(k: Kit): void {
  const { u0, u1, v0, v1, h } = MOSTRADOR;
  k.block(rect([u0, v0, u1, v1]), 0, h, 'solid', 'mueble', { side: FRENTE_NEGRO });
  k.block(rect([u0 - 0.02, v0 - 0.03, u1 + 0.02, v1]), h - 0.04, h, 'none', 'otro', { side: MESADA, top: MESADA });
  k.label('CANDY BAR', [(u0 + u1) / 2, v0 - 0.01], 0.6, [0, -1], 2.6, 0.42, CANDY, { glow: true });
  // la mesada de atrás, de acero con el frente blanco, contra el fondo
  k.block(rect([ATRAS.u0, ATRAS.v0, ATRAS.u1, ATRAS.v1]), 0, ATRAS.h, 'solid', 'mueble', { side: MESADA, top: ACERO });
  // la máquina de pochoclo, detrás del mostrador, en la punta de la puerta
  k.furniture('pochoclera', [u0 + 0.9, 14.4], 0, MIRA.menosV);
  // las pantallas de menú, colgadas sobre la mesada de atrás, mirando al hall
  ['Combos', 'Pochoclos', 'Bebidas', 'Golosinas'].forEach((n, j) => {
    const u = 24.4 + j * 2.2, v = ATRAS.v1 - 0.08;
    k.furniture('pantalla', [u, v], MENU_Y, MIRA.menosV);
    k.label(`${n} #${j + 1}`, [u, v - MENU_D / 2 - 0.004], MENU_Y + MENU_H / 2, [0, -1], MENU_W - 0.06, MENU_H - 0.06, MENU, { glow: true, drawing: 'menu' });
  });
  // la heladera de bebidas con su puerta de vidrio iluminada
  k.block(rect([32.6, 15.25, 33.8, FONDO_HALL]), 0, 2.0, 'solid', 'mueble', { side: HELADERA, top: HELADERA });
  k.block(rect([32.7, 15.22, 33.7, 15.25]), 0.15, 1.85, 'none', 'otro', { side: HELADERA_PUERTA });
}

/** La marquesina (afuera): un cajón gris carbón sobre los vidrios, los spots abajo y "CINES PIXEL". */
function marquesina(k: Kit): void {
  const { u0, u1, sale, y0, y1 } = MARQ;
  // la cara de atrás (la arista 2, sobre el frente) no se dibuja: ahí está la fachada
  k.block(rect([u0, -sale, u1, 0]), y0, y1, 'solid', 'otro', { side: MARQUESINA, top: MARQUESINA_TAPA, bottom: MARQUESINA_TAPA }, { out: true, hide: [2] });
  for (let u = u0 + 1.0; u < u1 - 0.5; u += 2.0) {
    k.block(ngon([u, -sale / 2], 0.09, 8), y0 - 0.04, y0, 'none', 'otro', { side: MARQUESINA, bottom: SPOT_AFUERA }, true);
  }
  k.label('CINES PIXEL', [(u0 + u1) / 2, -sale - 0.01], (y0 + y1) / 2, [0, -1], 9.0, 0.7, CARTEL, { out: true, glow: true, placeSign: true });
}

export const cinePlan: InteriorPlan = (k) => {
  const inner = k.inside;
  const us = inner.map((p) => p[0]), vs = inner.map((p) => p[1]);
  const [U0, U1, V0, V1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  k.shell({ publicFloors: 1, wall: NEGRO, floor: PORCELANATO, ceiling: NEGRO });
  if (U1 - U0 < 52.5 || V1 - V0 < 24 || k.height < 7.9) return k.done(0.6);

  // los tabiques de las salas (paredes de 0,2: aíslan la luz) y los depósitos del fondo (macizos, sin huecos)
  const puerta = [{ at: PUERTA.v - V0, width: PUERTA.ancho, height: PUERTA.alto }];
  k.wall([W1, V0], [W1, V1], { t: 0.2, look: GRIS_OSCURO, gaps: puerta });
  k.wall([W2, V0], [W2, FONDO_SALA2], { t: 0.2, look: BLANCO, gaps: puerta });
  k.block(rect([W1 + 0.1, FONDO_HALL, W2 - 0.1, V1]), 0, TECHO, 'solid', 'otro', { side: BLANCO }, { hide: [1, 2, 3] });
  k.block(rect([W2 - 0.1, FONDO_SALA2, U1, V1]), 0, TECHO, 'solid', 'otro', { side: NEGRO }, { hide: [1, 2, 3] });
  // las salas, por adentro, negras: el revestimiento de los tabiques (el gris de W1 y el blanco de W2), alrededor de la
  // puerta
  const s1 = W1 - 0.1, s2 = W2 + 0.1;
  for (const [a, b, fondo] of [[s1 - 0.01, s1, V1], [s2, s2 + 0.01, FONDO_SALA2]] as const) {
    revestir(k, [a, V0, b, PUERTA.v - PUERTA.ancho / 2], 0, TECHO, NEGRO);
    revestir(k, [a, PUERTA.v + PUERTA.ancho / 2, b, fondo], 0, TECHO, NEGRO);
    revestir(k, [a, PUERTA.v - PUERTA.ancho / 2, b, PUERTA.v + PUERTA.ancho / 2], PUERTA.alto, TECHO, NEGRO);
  }

  const g = sala(k, { u0: U0, u1: W1 - 0.1, fondo: V1, filas: 10, pie: 4.4, pantalla: { w: 16.0, y0: 1.0, y1: 6.9 }, tiras: [6.5, 10, 13.5, 17, 20.5], cabina: 21.6 });
  const c = sala(k, { u0: s2 + 0.01, u1: U1, fondo: FONDO_SALA2, filas: 7, pie: 4.8, pantalla: { w: 11.0, y0: 1.2, y1: 5.8 }, tiras: [7, 10.5, 14] });
  k.label('SALIDA', [W1 - 0.11, PUERTA.v], PUERTA.alto + 0.25, [-1, 0], 0.6, 0.2, SALIDA, { glow: true });
  k.label('SALIDA', [s2 + 0.02, PUERTA.v], PUERTA.alto + 0.25, [1, 0], 0.6, 0.2, SALIDA, { glow: true });
  hall(k);
  candyBar(k);
  marquesina(k);

  k.mark('hall', [27.5, 7.0], 0);
  k.mark('sala-grande-puerta', [W1 + 0.7, PUERTA.v], 0);
  k.mark('sala-grande', [g.pasillos[1], 3.0], 0);
  k.mark('ultima-fila', [g.pasillos[1], g.plataforma + 0.45], g.arriba);
  k.mark('sala-chica-puerta', [W2 - 0.7, PUERTA.v], 0);
  k.mark('sala-chica', [c.pasillos[0], 3.0], 0);
  k.view('hall', [25.15, 1.4], 0, 0);
  k.view('sala', [g.pasillos[1], g.plataforma + 0.45], g.arriba, Math.PI);
  return k.done(AMBIENT, PENUMBRA);
};
