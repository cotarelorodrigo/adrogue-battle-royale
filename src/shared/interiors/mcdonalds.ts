// El McDonald's de Espora (§4.5), sobre la planta relevada (13,2 × 23,6 m, 3,8 m de alto, un piso) y su patio del fondo
// (D12). Marco local: U a lo largo del frente (de la esquina sur, 0, a la norte, 13,2) y V hacia adentro (del frente, en
// Espora, al fondo); 0 mira a +V y π/2 a +U.
// - Salón detrás del frente vidriado: del lado norte, el piso de tablas de madera clara, la barra contra la vidriera
//   con banquetas amarillas, los sillones corridos en zigzag blanco y negro contra la medianera y mesas redondas blancas
//   de pie negro con sillas negras de asiento de madera; del lado sur (el de la puerta), el porcelanato gris claro con
//   mesas y sillas amarillas. Entre los dos, un tabique de listones de madera (sólido) y columnas revestidas en madera.
//   Cielorraso de placas oscuras con spots y, sobre las mesas, lámparas campana blancas.
// - El mostrador de 1,1 m (frente negro y mesada blanca) de lado a lado, con "CAJA KIOSCO" y el "1" y las pantallas de
//   menú que brillan; el paso a la cocina, de 1,2 m, en la punta norte. Detrás, la zona de atención y, tras un tabique, la
//   cocina: freidoras, la plancha con su campana, mesadas y heladeras de acero.
// - Del lado sur, el pasillo a los baños y al pasillo del fondo, que sale por la puerta de atrás al patio: pared de
//   ladrillo, mesas de picnic y sombrillas rojas, a cielo abierto.
// - Afuera (`out`): la torre gris oscura en la esquina del frente con la "M" amarilla (una letra, sin logo) y la franja
//   roja vertical, y "McDonald's" en blanco sobre el costado que da al AutoMac. El revestimiento gris oscuro de la
//   fachada ya lo pone el lote (tinte #2e2e30), y el cartel del frente, el lugar.
// Si la planta no es la relevada (sin el patio o más chica), queda el salón vacío.
import { distPointSegment } from '../geo.ts';
import type { Vec2, Vec3 } from '../geo.ts';
import type { SignLook } from '../mapdata.ts';
import type { InteriorPlan } from './index.ts';
import { GROUND_Y, MODEL_BOX, WALL_OUT } from './kit.ts';
import type { Kit } from './kit.ts';
import type { Look } from './types.ts';

// ---------- materiales ----------

/** Las paredes: el gris claro de adentro; el cielorraso de placas gris oscuro con las juntas más claras. Calibrados con
 *  la luz horneada, a INDOOR_EXPOSURE (tests/client/mcd-veneciana.test.ts): las placas se ven ~(45, 47, 50), la mitad
 *  que las paredes; más oscuras, la ACES las aplasta a negro y el cielorraso se lee como un hueco. */
const PARED: Look = { mat: 'liso', color: '#d9d8d4' };
const PLACAS: Look = { mat: 'liso', color: '#808388' };
const JUNTA: Look = { mat: 'liso', color: '#a9abaf' };
/** El porcelanato gris claro del salón y las tablas de madera clara del lado norte. */
const PORCELANATO: Look = { mat: 'porcelanato', color: '#cfcfcb' };
const TABLAS: Look = { mat: 'madera', color: '#d2ad7e' };
/** La madera de las barras; la de los listones y las tablas de las columnas va lisa (la veta de `madera` corre a lo
 *  ancho: en una pieza parada se ve como tablitas apiladas), en dos tonos y con la junta oscura. */
const LISTON: Look = { mat: 'madera', color: '#b98a58' };
const LISTON_PARADO: Look = { mat: 'liso', color: '#b98a58' };
const TABLA_OSCURA: Look = { mat: 'liso', color: '#a6784b' };
const JUNTA_MADERA: Look = { mat: 'liso', color: '#5a3e26' };
/** El mostrador: el frente negro y la mesada blanca. */
const FRENTE_NEGRO: Look = { mat: 'liso', color: '#1d1d1f' };
const MESADA: Look = { mat: 'liso', color: '#f2f2f0' };
/** El acero de la cocina, sus baldosas rojas y su cielorraso blanco. */
const ACERO: Look = { mat: 'metal', color: '#c4c8cc' };
const BALDOSA_COCINA: Look = { mat: 'baldosa', color: '#9a4434' };
const TECHO_COCINA: Look = { mat: 'liso', color: '#eeeeec' };
/** Las puertas de los baños, de madera oscura. */
const PUERTA: Look = { mat: 'madera', color: '#5e4634' };
/** El patio: el piso de baldosones grises y la pared de ladrillo; de lejos (`out`), el revoque del color del ladrillo.
 *  La foto del ladrillo ya es rojiza: el tinte apenas la calienta (uno rojo la deja bordó, casi negra a la sombra; tests/
 *  client/mcd-veneciana.test.ts). El de lejos va sobre el revoque crudo del chunk: es el tono de la foto por el tinte. */
const PATIO_PISO: Look = { mat: 'baldosa', color: '#a39f98' };
const LADRILLO: Look = { mat: 'ladrillo', color: '#ffc2a8' };
const LADRILLO_LEJOS: Look = { mat: 'liso', color: '#b87e67' };
/** Los spots del cielorraso y los paneles de la cocina (brillan). */
const SPOT: Look = { mat: 'luz', color: '#fff2dc' };
const PANEL: Look = { mat: 'luz', color: '#e8ecee' };
/** La torre y la franja de afuera (`out`): el gris del revestimiento y el rojo de la marca. */
const TORRE: Look = { mat: 'liso', color: '#2e2e30' };
const FRANJA: Look = { mat: 'liso', color: '#c8102e' };

/** Los colores que tiñen los muebles (Item.color): la madera del asiento de las sillas negras y el amarillo; el blanco
 *  deja la sombrilla del rojo de su modelo. */
const ASIENTO_MADERA = '#c08a55', AMARILLO = '#f5b400', SOMBRILLA_ROJA = '#ffffff';

/** "CAJA KIOSCO" y el "1": rojo de la marca con letra blanca. Brillan (sin hornear): calibrados para que adentro, a
 *  INDOOR_EXPOSURE, se vean del rojo de la marca (tests/client/mcd-veneciana.test.ts). */
const CAJA: SignLook = { fondo: '#801c0f', letra: '#ffffff', marco: '#801c0f', fuente: 'redondeada' };
/** Las pantallas de menú: el fondo casi negro, la franja de título roja y los precios en blanco. */
const MENU: SignLook = { fondo: '#0a0a0b', letra: '#c8c8c8', marco: '#801c0f', fuente: 'redondeada' };
/** El tapizado en zigzag de los sillones. */
const ZIGZAG: SignLook = { fondo: '#f0efeb', letra: '#1c1c1e', marco: '#f0efeb', fuente: 'sans' };
/** Los carteles de los baños. */
const ROTULO: SignLook = { fondo: '#d9d8d4', letra: '#2b2b2d', marco: '#d9d8d4', fuente: 'redondeada' };
/** La "M" amarilla de la torre y "McDonald's" en blanco, sobre el gris del revestimiento (afuera: los dibuja el mapa). */
const M_TORRE: SignLook = { fondo: '#2e2e30', letra: '#ffc72c', marco: '#2e2e30', fuente: 'redondeada' };
const NOMBRE: SignLook = { fondo: '#2e2e30', letra: '#ffffff', marco: '#2e2e30', fuente: 'redondeada' };

/** La luz pareja del salón (el frente es todo vidrio); el resto, los spots, las campanas y los paneles de la cocina. */
const AMBIENT = 0.4;
const SPOT_R = 3.6, SPOT_P = 0.3, CAMPANA_R = 2.6, CAMPANA_P = 0.3, PANEL_R = 4.5, PANEL_P = 0.45;

// ---------- medidas (m, marco local) ----------

/** El cielorraso (el techo del chunk, 0,8 m de losa). */
const TECHO = 3.0;
/** El mostrador: de U 2,0 a 11,8, de V 10,8 a 11,6, de 1,1 m; el paso a la cocina, de 11,8 a la medianera (13,0). */
const MOSTRADOR = { u0: 2.0, u1: 11.8, v0: 10.8, v1: 11.6, h: 1.1 } as const;
/** El tabique de la cocina (V 14) y el del pasillo de los baños (U 1,95), y el del fondo (V 21). */
const COCINA_V = 14.0, PASILLO_U = 1.95, FONDO_V = 21.0;
/** La puerta del personal, del pasillo del fondo a la cocina: en el tabique del fondo, `at` m desde su punta del pasillo. */
const PUERTA_PERSONAL = { at: 8.6, ancho: 1.0, alto: 2.2 } as const;
/** El cielorraso del salón, del frente al mostrador: las placas de PLACA m, centradas en los spots (cada SPOTS.paso,
 *  desde SPOTS.u, SPOTS.v), con juntas de JUNTA_W. */
const SALON_CIELO: Rect = [0.2, 0.2, 13.0, 10.8];
const SPOTS = { u: 1.2, v: 1.4, paso: 2.4, nu: 5, nv: 4 } as const;
const PLACA = 0.6, JUNTA_W = 0.03;
/** Las columnas revestidas en madera: el lado, las tablas por cara, la junta entre tablas y lo que salen del núcleo. */
const COLUMNA = { lado: 0.44, tablas: 4, junta: 0.008, sale: 0.012 } as const;
/** El tabique de listones entre el porcelanato y la madera. */
const LISTONES = { u: 6.4, v0: 1.4, v1: 5.6 } as const;
/** La zona de tablas de madera. */
const MADERA: Rect = [6.6, 0.2, 13.0, 7.6];
/** La lámpara campana cuelga con el borde de abajo a esta altura. */
const CAMPANA_Y = 2.0;
/** Las pantallas de menú: el borde de abajo a esta altura, sobre el medio del mostrador. */
const PANTALLA_Y = 2.0, PANTALLA = { w: 1.0, h: 0.58, d: 0.05 } as const;
/** La torre (afuera), en la esquina del frente y el costado sur, sobre el techo. */
const TORRE_TOP = 7.4;

type Rect = [number, number, number, number];
const rect = ([u0, v0, u1, v1]: Rect): Vec2[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const MIRA = { V: 0, U: Math.PI / 2, menosV: Math.PI, menosU: -Math.PI / 2 } as const;
/** Polígono regular de `n` lados alrededor de `c`, de radio `r`. */
const ngon = (c: Vec2, r: number, n: number): Vec2[] =>
  Array.from({ length: n }, (_, k): Vec2 => [c[0] + r * Math.cos((2 * Math.PI * k) / n), c[1] + r * Math.sin((2 * Math.PI * k) / n)]);

/** Un revestimiento del piso (sin sólido), apenas arriba de la planta baja (que va a GROUND_Y). */
const piso = (k: Kit, r: Rect, look: Look): void => k.block(rect(r), GROUND_Y, GROUND_Y + 0.006, 'none', 'otro', { top: look });
/** Un revestimiento del cielorraso (sin sólido), apenas abajo de la losa. */
const cielo = (k: Kit, r: Rect, look: Look): void => k.block(rect(r), TECHO - 0.015, TECHO - 0.005, 'none', 'otro', { bottom: look });

/** Un spot embutido en `p` (un cuadrado de luz en el cielorraso) con su lámpara. */
function spot(k: Kit, p: Vec2): void {
  k.block(ngon(p, 0.09, 8), TECHO - 0.025, TECHO - 0.015, 'none', 'otro', { bottom: SPOT, side: SPOT });
  k.lamp(p, TECHO - 0.1, SPOT_R, SPOT_P);
}
/** Una lámpara campana sobre `p`, con su lámpara (en el medio de la campana). */
function campana(k: Kit, p: Vec2): void {
  k.furniture('lampara', p, CAMPANA_Y, 0);
  k.lamp(p, CAMPANA_Y + 0.08, CAMPANA_R, CAMPANA_P);
}
/** Una mesa redonda con dos sillas enfrentadas a lo largo de `eje` (V o U) y el color de las sillas. */
function mesaRedonda(k: Kit, c: Vec2, eje: 'U' | 'V', sillas: string): void {
  k.furniture('mesa-redonda', c, 0, 0);
  const d: Vec2 = eje === 'V' ? [0, 0.6] : [0.6, 0];
  k.furniture('silla', add(c, d, -1), 0, eje === 'V' ? MIRA.V : MIRA.U, sillas);
  k.furniture('silla', add(c, d), 0, eje === 'V' ? MIRA.menosV : MIRA.menosU, sillas);
}
/** Un bloque sólido de acero de planta `r` y alto `h` (una mesada, la plancha). */
const acero = (k: Kit, r: Rect, h: number): void => k.block(rect(r), 0, h, 'solid', 'mueble', { side: ACERO, top: ACERO });

/** El salón: los pisos, el tabique de listones, las columnas, la barra, los sillones, las mesas y las luces. */
function salon(k: Kit): void {
  piso(k, MADERA, TABLAS);
  // el tabique de listones: lo sólido no se ve (un tabique de 0,1); se ven los listones, de piso a cielorraso
  k.block(rect([LISTONES.u - 0.05, LISTONES.v0, LISTONES.u + 0.05, LISTONES.v1]), 0, TECHO, 'solid', 'otro', {});
  for (let v = LISTONES.v0 + 0.03; v < LISTONES.v1 - 0.02; v += 0.12) {
    k.block(rect([LISTONES.u - 0.04, v, LISTONES.u + 0.04, v + 0.05]), 0, TECHO, 'none', 'otro', { side: LISTON_PARADO });
  }
  k.block(rect([LISTONES.u - 0.05, LISTONES.v0, LISTONES.u + 0.05, LISTONES.v1]), TECHO - 0.08, TECHO - 0.005, 'none', 'otro', { side: LISTON_PARADO, bottom: LISTON_PARADO });
  // las columnas revestidas en madera
  for (const c of [[3.2, 8.6], [9.4, 8.6]] as Vec2[]) columna(k, c);
  // las barras contra la vidriera (de 1,05 m, mesada de madera) con banquetas amarillas mirando a la calle
  for (const [u0, u1] of [[0.5, 3.6], [6.7, 10.5]] as const) {
    k.block(rect([u0, 0.2, u1, 0.6]), 0, 1.05, 'solid', 'mueble', { side: FRENTE_NEGRO, top: LISTON });
    for (let u = u0 + 0.45; u < u1 - 0.2; u += 0.8) k.furniture('banqueta', [u, 1.0], 0, MIRA.menosV, AMARILLO);
  }
  // los sillones corridos en zigzag contra la medianera norte, con sus mesas y sillas negras de asiento de madera
  const sillones = 6, s0 = 1.2;
  for (let j = 0; j < sillones; j++) k.furniture('sillon', [12.555, s0 + 0.425 + j * 0.85], 0, MIRA.menosU);
  const largo = sillones * 0.85, vm = s0 + largo / 2;
  k.label('zigzag respaldo', [12.84, vm], 0.62, [-1, 0], largo, 0.32, ZIGZAG, { drawing: 'zigzag' });
  k.label('zigzag asiento', [12.125, vm], 0.27, [-1, 0], largo, 0.3, ZIGZAG, { drawing: 'zigzag' });
  for (const v of [s0 + 0.85, s0 + largo / 2, s0 + largo - 0.85]) {
    k.furniture('mesa-redonda', [11.68, v], 0, 0);
    k.furniture('silla', [11.06, v], 0, MIRA.U, ASIENTO_MADERA);
    campana(k, [11.68, v]);
  }
  // en la madera, cuatro mesas redondas con sillas negras
  for (const c of [[7.7, 2.5], [9.6, 2.5], [7.7, 5.0], [9.6, 5.0]] as Vec2[]) {
    mesaRedonda(k, c, 'V', ASIENTO_MADERA);
    campana(k, c);
  }
  // en el porcelanato, seis mesas redondas con sillas amarillas (sin tapar la puerta: U 4–6,2 queda libre)
  for (const u of [1.4, 3.1]) for (const v of [2.6, 4.6, 6.6]) mesaRedonda(k, [u, v], 'V', AMARILLO);
  // el cielorraso de placas oscuras: las juntas y los spots, cada uno en el medio de una placa
  juntas(k);
  for (let a = 0; a < SPOTS.nu; a++) for (let b = 0; b < SPOTS.nv; b++) spot(k, [SPOTS.u + a * SPOTS.paso, SPOTS.v + b * SPOTS.paso]);
}

/** Las juntas de las placas del cielorraso del salón: perfiles de JUNTA_W, 4 mm bajo el revestimiento, a lo largo de U y
 *  de V, a media placa de los spots. Son paños (Pane: no tapan la luz; como bloques, cada junta le haría sombra de
 *  contacto al cielorraso de alrededor) del `liso` de las paredes, sin mallas nuevas. Van en tramos de dos placas: un
 *  paño se hornea en sus puntas (build.ts). */
function juntas(k: Kit): void {
  const [u0, v0, u1, v1] = SALON_CIELO, w = JUNTA_W / 2, y = TECHO - 0.004, down: Vec3 = [0, -1, 0];
  // de lo a hi, cada PLACA: la primera, la de un spot corrida media placa y llevada hacia atrás hasta el borde
  const lines = (spot: number, lo: number, hi: number): number[] => {
    const start = spot - PLACA / 2 - PLACA * Math.floor((spot - PLACA / 2 - lo) / PLACA);
    return Array.from({ length: Math.ceil((hi - start) / PLACA) }, (_, j) => start + j * PLACA);
  };
  const tramos = (lo: number, hi: number): [number, number][] => {
    const n = Math.ceil((hi - lo) / (2 * PLACA));
    return Array.from({ length: n }, (_, j) => [lo + (j * (hi - lo)) / n, lo + ((j + 1) * (hi - lo)) / n]);
  };
  for (const u of lines(SPOTS.u, u0, u1)) for (const [a, b] of tramos(v0, v1)) k.pane([[u - w, y, a], [u + w, y, a], [u + w, y, b], [u - w, y, b]], down, JUNTA);
  // las de través, 1 mm más abajo: en los cruces no se pisan con las otras
  for (const v of lines(SPOTS.v, v0, v1)) for (const [a, b] of tramos(u0, u1)) k.pane([[a, y - 0.001, v - w], [b, y - 0.001, v - w], [b, y - 0.001, v + w], [a, y - 0.001, v + w]], down, JUNTA);
}

/** Una columna revestida en madera, de COLUMNA.lado, en `c`: el núcleo sólido (se ve en las juntas) y, en cada cara,
 *  tablas paradas en dos tonos. La última tabla de cada cara sale hasta tapar la punta de la cara siguiente. */
function columna(k: Kit, c: Vec2): void {
  const { lado, tablas, junta, sale } = COLUMNA, h = lado / 2, w = (lado - junta * (tablas - 1)) / tablas;
  k.block(rect([c[0] - h, c[1] - h, c[0] + h, c[1] + h]), 0, TECHO, 'solid', 'otro', { side: JUNTA_MADERA });
  for (const n of [[0, -1], [1, 0], [0, 1], [-1, 0]] as Vec2[]) {
    const t: Vec2 = [-n[1], n[0]], f = add(c, n, h);
    for (let j = 0; j < tablas; j++) {
      const s0 = -h + j * (w + junta), s1 = j === tablas - 1 ? h + sale : s0 + w;
      const [a, b] = [add(f, t, s0), add(f, t, s1)];
      k.block([a, b, add(b, n, sale), add(a, n, sale)], 0, TECHO, 'none', 'otro', { side: j % 2 === 0 ? LISTON_PARADO : TABLA_OSCURA });
    }
  }
}

/** El mostrador, sus carteles, las pantallas, la zona de atención y la cocina. */
function mostradorYCocina(k: Kit): void {
  const { u0, u1, v0, v1, h } = MOSTRADOR;
  // lo sólido, de 1,1 m y frente negro; la mesada blanca (sin sólido) lo tapa arriba y sale 2 cm hacia el salón
  k.block(rect([u0, v0, u1, v1]), 0, h, 'solid', 'mueble', { side: FRENTE_NEGRO });
  k.block(rect([u0 - 0.02, v0 - 0.03, u1 + 0.02, v1]), h - 0.04, h, 'none', 'otro', { side: MESADA, top: MESADA });
  // las cajas: tres pantallitas negras sobre la mesada
  for (const u of [4.0, 6.4, 8.8]) k.block(rect([u - 0.17, v0 + 0.2, u + 0.17, v0 + 0.26]), h, h + 0.28, 'none', 'otro', { side: FRENTE_NEGRO, top: FRENTE_NEGRO });
  // las pantallas de menú, colgadas sobre el mostrador mirando al salón
  const nombres = ['Hamburguesas', 'Combos', 'Postres', 'Cafetería'];
  nombres.forEach((n, j) => {
    const u = 3.6 + j * 1.15, v = (v0 + v1) / 2;
    k.furniture('pantalla', [u, v], PANTALLA_Y, MIRA.menosV);
    k.label(`${n} #${j + 1}`, [u, v - PANTALLA.d / 2 - 0.004], PANTALLA_Y + PANTALLA.h / 2, [0, -1], PANTALLA.w - 0.06, PANTALLA.h - 0.06, MENU, { glow: true, drawing: 'menu' });
  });
  // "CAJA KIOSCO" con el "1", colgado sobre la punta norte, donde se retira
  k.label('CAJA KIOSCO', [9.75, v0 + 0.3], 2.35, [0, -1], 1.7, 0.34, CAJA, { glow: true });
  k.label('1', [10.85, v0 + 0.3], 2.35, [0, -1], 0.34, 0.34, CAJA, { glow: true });
  // la zona de atención: la mesada de acero del fondo (bebidas, papas) y sus luces
  acero(k, [2.6, 13.3, 11.0, 13.9], 0.92);
  piso(k, [2.0, 11.6, 13.0, FONDO_V - 0.05], BALDOSA_COCINA);
  cielo(k, [2.0, 11.6, 13.0, FONDO_V - 0.05], TECHO_COCINA);
  for (const u of [3.8, 6.4, 9.0, 11.6]) spot(k, [u, 12.6]);
  // el tabique de la cocina, con el paso del lado norte
  k.wall([2.0, COCINA_V], [11.7, COCINA_V], { look: PARED });
  // la cocina: las freidoras contra el pasillo, con su campana; la plancha y la mesada del medio; las mesadas del lado
  // del tabique; las heladeras contra el fondo. Del lado norte queda libre el pasillo hasta la cocina (U 11,8–12,9).
  for (const v of [14.9, 15.45, 16.0, 16.55]) k.furniture('freidora', [2.45, v], 0, MIRA.U);
  acero(k, [2.05, 16.85, 2.85, 18.4], 0.92);
  k.block(rect([2.05, 14.6, 3.1, 18.4]), 2.15, TECHO - 0.015, 'none', 'otro', { side: ACERO, bottom: ACERO });
  acero(k, [5.2, 16.2, 9.6, 16.95], 0.92);
  k.block(rect([5.4, 16.3, 7.2, 16.85]), 0.92, 0.96, 'none', 'otro', { top: { mat: 'metal', color: '#3a3c40' }, side: ACERO });
  acero(k, [4.0, 14.05, 10.6, 14.75], 0.92);
  acero(k, [5.2, 18.6, 9.6, 19.3], 0.92);
  // las heladeras de dos puertas contra el fondo: tres del lado del pasillo y una pasando la puerta del personal, que
  // queda libre
  const hw = MODEL_BOX.heladera!.w, hv = FONDO_V - 0.05 - MODEL_BOX.heladera!.d / 2;
  for (let j = 0; j < 3; j++) k.furniture('heladera', [PASILLO_U + 0.2 + hw / 2 + j * (hw + 0.05), hv], 0, MIRA.menosV);
  k.furniture('heladera', [PASILLO_U + 0.05 + PUERTA_PERSONAL.at + PUERTA_PERSONAL.ancho / 2 + 0.1 + hw / 2, hv], 0, MIRA.menosV);
  for (const [u, v] of [[4.0, 15.6], [8.0, 15.6], [4.0, 19.8], [8.0, 19.8], [11.4, 17.5]] as Vec2[]) {
    k.block(rect([u - 0.6, v - 0.3, u + 0.6, v + 0.3]), TECHO - 0.03, TECHO - 0.02, 'none', 'otro', { bottom: PANEL, side: PANEL });
    k.lamp([u, v], TECHO - 0.2, PANEL_R, PANEL_P);
  }
}

/** El pasillo de los baños y el del fondo, con la puerta del personal a la cocina. */
function pasillos(k: Kit, U0: number): void {
  k.wall([PASILLO_U, MOSTRADOR.v0], [PASILLO_U, FONDO_V + 0.05], { look: PARED });
  k.wall([PASILLO_U + 0.05, FONDO_V], [13.0, FONDO_V], { look: PARED, gaps: [{ at: PUERTA_PERSONAL.at, width: PUERTA_PERSONAL.ancho, height: PUERTA_PERSONAL.alto }] });
  // las puertas de los baños (cerradas: un paño de madera contra la pared de afuera) y su cartel
  for (const [v, n] of [[13.4, 'DAMAS'], [16.4, 'CABALLEROS']] as const) {
    k.block(rect([U0, v, U0 + 0.03, v + 0.9]), 0, 2.1, 'none', 'otro', { side: PUERTA, top: PUERTA });
    k.label(n, [U0 + 0.04, v + 0.45], 2.3, [1, 0], 0.9, 0.18, ROTULO);
  }
  k.label('BAÑOS', [PASILLO_U - 0.06, MOSTRADOR.v0 + 0.6], 2.3, [-1, 0], 0.7, 0.18, ROTULO);
  for (const v of [12.0, 15.0, 18.0, 20.8]) spot(k, [1.05, v]);
  for (const u of [4.0, 8.0, 11.5]) spot(k, [u, 22.5]);
}

/** El patio del fondo (D12): el piso, la pared de ladrillo en los lados que no son del local (por afuera, un revoque del
 *  color del ladrillo que se ve de lejos), las mesas de picnic y las sombrillas. */
function patio(k: Kit, ring: Vec2[]): void {
  k.block(ring, 0, GROUND_Y, 'none', 'otro', { top: PATIO_PISO });
  // la pared, 0,2 m adentro de cada lado salvo el del local; en las puntas contra el local, recta. El lado del local va
  // sobre la planta: su medio queda a WALL_OUT de la cara de adentro de las paredes del local (k.inside)
  const n = ring.length, T = 0.2, H = 2.4, inside = k.inside;
  const toInside = (p: Vec2): number => Math.min(...inside.map((q, j) => distPointSegment(p, q, inside[(j + 1) % inside.length])));
  const local = (k2: number): boolean => {
    const [a, b] = [ring[k2], ring[(k2 + 1) % n]];
    return Math.abs(toInside([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) - WALL_OUT) < 0.01;
  };
  const inward = (a: Vec2, b: Vec2): Vec2 => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  const ccw = ring.reduce((s, p, j) => s + p[0] * ring[(j + 1) % n][1] - ring[(j + 1) % n][0] * p[1], 0) > 0;
  const side = (a: Vec2, b: Vec2): Vec2 => (ccw ? inward(a, b) : [-inward(a, b)[0], -inward(a, b)[1]]);
  // el vértice corrido: donde se cortan las dos aristas corridas (o, junto al local, corrido solo por la arista propia)
  const corner = (j: number): Vec2 => {
    const prev = (j + n - 1) % n, [a, b, c] = [ring[prev], ring[j], ring[(j + 1) % n]];
    if (local(prev)) return add(b, side(b, c), T);
    if (local(j)) return add(b, side(a, b), T);
    const [m1, m2] = [side(a, b), side(b, c)];
    const bis: Vec2 = [m1[0] + m2[0], m1[1] + m2[1]], dot = m1[0] * bis[0] + m1[1] * bis[1];
    return add(b, bis, T / dot);
  };
  for (let j = 0; j < n; j++) {
    if (local(j)) continue;
    const [a, b] = [ring[j], ring[(j + 1) % n]];
    const wall = [a, b, corner((j + 1) % n), corner(j)];
    // la cara de afuera (la primera arista) no se dibuja: la tapa el revoque de afuera, 3 cm más allá. Va en todos los
    // lados: donde da a la calle se ve de lejos; donde hay un vecino más alto, queda adentro de su pared
    k.block(wall, 0, H, 'solid', 'otro', { side: LADRILLO, top: LADRILLO }, { hide: [0] });
    const o = side(a, b);
    k.block([add(a, o, -0.03), add(b, o, -0.03), b, a], 0, H, 'none', 'otro', { side: LADRILLO_LEJOS, top: LADRILLO_LEJOS }, { out: true, hide: [2] });
  }
  for (const u of [3.2, 6.6, 10.0]) {
    k.furniture('mesa-picnic', [u, 26.35], 0, 0);
    k.furniture('sombrilla', [u, 26.35], 0, 0, SOMBRILLA_ROJA);
  }
}

/** Lo de afuera (`out`): la torre con la "M" amarilla y la franja roja, y "McDonald's" en el costado sur. */
function afuera(k: Kit, H: number): void {
  // la torre, 5 cm afuera de la planta (tapa las caras del pretil), con su tapa
  const t: Rect = [-0.05, -0.05, 2.6, 2.6];
  k.block(rect(t), H, TORRE_TOP, 'solid', 'otro', { side: TORRE, top: TORRE }, true);
  k.block(rect([t[0] - 0.04, t[1] - 0.04, t[2] + 0.04, t[3] + 0.04]), TORRE_TOP, TORRE_TOP + 0.12, 'none', 'otro', { side: TORRE, top: TORRE, bottom: TORRE }, true);
  // la "M" en las dos caras que dan a la calle
  k.label('M', [1.3, t[1]], 5.75, [0, -1], 1.75, 1.55, M_TORRE, { out: true });
  k.label('M', [t[0], 1.3], 5.75, [-1, 0], 1.75, 1.55, M_TORRE, { out: true });
  // la franja roja vertical en el costado sur: de la vereda a la punta de la torre, en la cara del local y en la de la
  // torre (que sale 5 cm)
  k.block(rect([-0.04, 0.35, 0, 0.95]), 0, H, 'none', 'otro', { side: FRANJA, top: FRANJA }, true);
  k.block(rect([-0.09, 0.35, -0.05, 0.95]), H, TORRE_TOP, 'none', 'otro', { side: FRANJA, bottom: FRANJA }, true);
  k.label("McDonald's", [-0.0, 8.0], 2.75, [-1, 0], 5.2, 0.8, NOMBRE, { out: true });
}

export const mcdonaldsPlan: InteriorPlan = (k) => {
  const inner = k.inside;
  const us = inner.map((p) => p[0]), vs = inner.map((p) => p[1]);
  const [U0, U1, V0, V1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const ring = k.patios[0];
  if (U1 - U0 < 12.5 || V1 - V0 < 22.5 || !ring) {
    k.shell({ publicFloors: 1, wall: PARED, floor: PORCELANATO, ceiling: PLACAS });
    return k.done(AMBIENT);
  }
  k.shell({ publicFloors: 1, wall: PARED, floor: PORCELANATO, ceiling: PLACAS });
  salon(k);
  mostradorYCocina(k);
  pasillos(k, U0);
  patio(k, ring);
  afuera(k, k.height);

  k.mark('salon', [5.4, 6.4], 0);
  k.mark('paso-cocina', [12.4, (MOSTRADOR.v0 + MOSTRADOR.v1) / 2], 0);
  k.mark('cocina', [12.3, 17.4], 0);
  k.mark('pasillo', [1.05, 10.2], 0);
  k.mark('fondo', [1.05, 22.5], 0);
  k.mark('salida', [6.6, 22.5], 0);
  k.mark('patio', [6.6, 24.9], 0);
  k.view('salon', [4.4, 0.9], 0, -0.2);
  return k.done(AMBIENT);
};
