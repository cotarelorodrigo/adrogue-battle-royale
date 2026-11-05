// La estación Adrogué (§4.9): el edificio de la boletería sobre la planta relevada (10 × 6,4 m, 4,6 m de alto, un piso
// público) y su patio del lado del andén (D12, U 10–17), el paso a los andenes. Marco local: U a lo largo del frente
// (de la punta de la escalera de mano, 0, a la del patio, 10) y V hacia adentro (de la calle, 0, al andén, 6,4); 0 mira
// a +V y π/2 a +U. Lo de los ferrocarriles de acá (Roca): paredes crema con zócalo celeste, piso de mosaico, tubos
// fluorescentes colgados, herrería verde y carteles azules con letras blancas.
// - El hall: se entra por la puerta de la calle. Al fondo, el tabique de la boletería con dos ventanillas (vidrio, reja
//   de bronce, repisa de mármol y pasaplatos) y el cartel "BOLETERÍA"; detrás, la oficina (cerrada: se la ve por las
//   ventanillas, y un vidrio sin dibujar la llena para que no sea suelo; el baño, macizo). A la izquierda de las ventanillas, la terminal de carga SUBE, y en la punta, la puerta del baño,
//   cerrada, con su cartel en relieve. Contra la pared del costado, un mural de azulejos de patrón propio (de la
//   posición sale la semilla); bancos de listones con respaldo bajo las ventanas del frente y bajo el mural. Por adentro
//   el frente no tiene aberturas de verdad (el relevamiento no tiene vidrios): sus dos ventanas son luz de día en la
//   pared, con su marco y la reja recortada contra el vidrio.
// - El patio: de la puerta del costado se sale derecho al molinete ancho, abierto (D3), en la punta de la línea de
//   molinetes de trípode (de acero, con el lector SUBE arriba); la línea corre de la calle hacia el andén y la cierran,
//   del lado del hall, una baranda hasta la pared y, del lado de la calle y del fondo, una baranda de caño. Pasando el
//   molinete ancho, a la izquierda, la escalera al andén (out: se ve siempre), de baldosas rojas con las narices
//   amarillas, alineada con el paso: el camino hall → paso → andén es recto por tramos.
// - Afuera (out): el zócalo celeste de 1,2 m alrededor (contra el andén, de su piso para arriba) y ventanas con marco,
//   vidrio oscuro y reja verde: dos en el frente, justo donde el atlas pinta las de 'ventana-pb' (las tapan); sobre el
//   andén, la de la oficina y una alta del baño; al patio, la de la oficina, y al costado de U 0, una alta del baño.
// Si la planta no es la relevada, o falta el patio, la puerta del patio o un andén adonde llegue la escalera, tira un
// error que dice qué falta.
import { hashIndex } from '../geo.ts';
import type { Vec2 } from '../geo.ts';
import type { SignLook } from '../mapdata.ts';
import { PLATFORM_H } from '../station.ts';
import type { InteriorPlan } from './index.ts';
import { GROUND_Y, WALL_OUT } from './kit.ts';
import type { Kit } from './kit.ts';
import { add, franja, MIRA, puertas, rect } from './plan-util.ts';
import type { Look } from './types.ts';

// ---------- materiales ----------

/** Las paredes crema, el cielorraso blanco y el piso de mosaico granítico gris. */
const PARED: Look = { mat: 'liso', color: '#efe7d3' };
const CIELORRASO: Look = { mat: 'liso', color: '#f3f1eb' };
const MOSAICO: Look = { mat: 'baldosa', color: '#bab3a6' };
/** El zócalo celeste de adentro (pintura) y el de afuera (revoque pintado, con sol). */
const ZOCALO_IN: Look = { mat: 'liso', color: '#8fc2e6' };
const ZOCALO_OUT: Look = { mat: 'liso', color: '#86bbe2' };
/** La herrería verde (rejas, baranda, pasamanos, el marco de las ventanas de afuera) y el acero inoxidable de los
 *  molinetes y de la hoja del molinete ancho. */
const VERDE: Look = { mat: 'liso', color: '#2c4a36' };
const INOX: Look = { mat: 'liso', color: '#b7bbbf' };
/** El acero inoxidable de lo que es `out` (el gabinete del molinete, la hoja abierta): lo dibuja el chunk con el revoque,
 *  liso y con el reflejo del piso (exterior.ts); claro y frío, como el de los molinetes al sol. */
const INOX_AFUERA: Look = { mat: 'metal', color: '#e4e8ec' };
const INOX_TAPA: Look = { mat: 'liso', color: '#3b3e42' };
/** Las ventanas de afuera: el marco, el vidrio oscuro (de día, de afuera, no se ve el interior) y el alféizar. */
const MARCO_OUT: Look = { mat: 'liso', color: '#e8e3d4' };
const VIDRIO_OUT: Look = { mat: 'liso', color: '#3d4b55' };
const ALFEIZAR: Look = { mat: 'liso', color: '#c9c3b6' };
/** Las ventanas del frente desde adentro: la luz de día por el vidrio (in_luz, calibrada como el ventanal de la Casa
 *  de la Cultura: más clara que la pared, más oscura que los tubos y azulada), su marco y la reja a contraluz. */
const LUZ_DIA: Look = { mat: 'luz', color: '#a0bcd2' };
const MARCO_IN: Look = { mat: 'liso', color: '#f2efe6' };
const REJA_IN: Look = { mat: 'liso', color: '#26302a' };
/** Los tubos fluorescentes (brillan: blancos fríos) y su artefacto de chapa blanca. */
const TUBO: Look = { mat: 'luz', color: '#d6e0ea' };
const ARTEFACTO: Look = { mat: 'liso', color: '#ecebe6' };
/** La boletería: el vidrio de las ventanillas y lo de adentro de la oficina. */
const VIDRIO: Look = { mat: 'vidrio', color: '#b8d0d6' };
const MOSTRADOR: Look = { mat: 'madera', color: '#7a5636' };
const MONITOR: Look = { mat: 'liso', color: '#1d1f22' };
/** La puerta del baño (madera pintada de verde), su contramarco y la placa del cartel. */
const PUERTA: Look = { mat: 'liso', color: '#4d7458' };
const CONTRAMARCO: Look = { mat: 'liso', color: '#d9d2bf' };
const PLACA: Look = { mat: 'liso', color: '#1c3f8f' };
/** El patio (baldosas grises de vereda), la escalera (baldosas rojas, out) y sus narices amarillas. */
const PATIO: Look = { mat: 'baldosa', color: '#a9a59c' };
const ESCALON: Look = { mat: 'baldosa', color: '#b0452e' };
const NARIZ: Look = { mat: 'liso', color: '#e8b923' };

/** Los carteles de la estación: azul con letras blancas, como los nomencladores del andén. "CARGA SUBE", en el celeste
 *  de la tarjeta con letras blancas (solo texto: sin el logo), pegado en la franja de la terminal; no brilla: se hornea
 *  con la luz del hall, como la pintura de la terminal (que brilla por la pantalla y va oscurecida: ver SUBE_COLORES). */
const AZUL: SignLook = { fondo: '#1c3f8f', letra: '#ffffff', marco: '#1c3f8f', fuente: 'sans' };
const CARGA_SUBE: SignLook = { fondo: '#1e9bd7', letra: '#ffffff', marco: '#1e9bd7', fuente: 'sans' };

/** La paleta del mural: azul cobalto, celeste, blanco, amarillo, verde y terracota (azulejos de color, sin figuras). */
const AZULEJOS = ['#f1ede2', '#7fb2de', '#2d55a0', '#e9b93a', '#4d8a5c', '#c3643f'] as const;

const ID = 'estacion-adrogue';
const AMBIENT = 0.35;
/** Cada tubo (dos por artefacto) con su lámpara: alcance (m) y fuerza; el de la oficina, más chico. */
const TUBO_LAMP = { r: 5.5, p: 0.5 } as const, OFICINA_LAMP = { r: 4.0, p: 0.45 } as const;

// ---------- medidas (m, marco local) ----------

/** El tabique de la boletería (centrado en V 4,5) y el de entre el baño y la oficina (centrado en U 2,45). */
const BOLETERIA_V = 4.5, BAÑO_U = 2.45, T = 0.1;
/** Las ventanillas: su medio a lo largo, el ancho del hueco, el antepecho (la repisa) y el alto del hueco (el dintel a
 *  LINTEL_MIN). */
const VENTANILLAS = [5.6, 7.6], VENTANILLA = { w: 0.9, sill: 1.05, top: 2.2 } as const;
/** La terminal SUBE contra el tabique, y la puerta del baño (su medio, la hoja de 0,8 × 2,05). */
const SUBE_U = 3.5, SUBE_D = 0.42, BAÑO_PUERTA = { u: 1.3, w: 0.84, h: 2.05 } as const;
/** El zócalo: alto y espesor (fino: no hace rincón en la pared); el de afuera sale 2 cm, menos que la espalda de los
 *  largueros de la escalera de mano de la cara de U 0 (a 2,5 cm de la pared). */
const ZOCALO_H = 1.2, ZOCALO_T = 0.008, ZOCALO_OUT_T = 0.02;
/** Las ventanas del frente: sobre las bahías 'ventana-pb' del atlas (el frente de 10 m va en 3 bahías de 3,33 y la
 *  puerta 'fin' en la última): lo pintado (x 0,6–2,4 de la celda de 3 m, y 0,4–1,94) queda detrás del zócalo y de la
 *  ventana. Del alféizar (1,2) al dintel (2,3): abajo del cartel del lugar (2,35). */
const VENTANAS: [number, number][] = [[0.62, 2.72], [3.95, 6.05]], VENTANA = { y0: 1.2, y1: 2.3, marco: 0.08 } as const;
/** Las de las otras caras (H4), del alto de las del frente salvo las del baño (altas, de 0,6 m): sobre el andén, la de
 *  la oficina (al medio de su tubo) y la del baño; al patio, la de la oficina (de V 4,85 a 6,05: entre la puerta del
 *  patio y el fondo); al costado de U 0, la del baño (la escalera de mano va a V 3,2, el mural por adentro hasta ~4). */
const VENTANA_OFICINA = { u0: 5.55, u1: 7.65 } as const, VENTANA_BAÑO = { u0: 0.8, u1: 1.6, y0: 1.7, y1: 2.3 } as const;
const VENTANA_PATIO = { v0: 4.85, v1: 6.05 } as const, VENTANA_COSTADO = { v0: 4.9, v1: 5.7 } as const;
/** La hoja que el atlas pinta al lado de la puerta de la calle (el hueco va de U 8,05 a 9,45: la puerta de k.openings),
 *  de U 7,5 a 8,05: el zócalo de afuera tampoco la tapa. */
const HOJA_PINTADA = { u0: 7.45, u1: 8.05 } as const;
/** El mural: desde la primera junta pasando V 0,4 sobre la pared de U 0,2 (llega a ~4,3: antes del tabique de la
 *  boletería), de 1,2 a 3,3 m, en azulejos de AZULEJO m (los del cerámico: cada paño, una pieza de la textura). */
const MURAL = { v: 0.4, y: 1.2, cols: 12, rows: 7 } as const, AZULEJO = 0.3;
/** Los tubos: el medio de cada artefacto en el hall y en la oficina, y su alto (cuelgan del cielorraso). */
const ARTEFACTOS: Vec2[] = [[2.6, 1.35], [2.6, 3.3], [7.1, 1.35], [7.1, 3.3]], ARTEFACTO_OFICINA: Vec2 = [6.6, 5.4], ARTEFACTO_Y = 3.2;

/** El patio: la línea de molinetes (su eje en U; la punta de la línea, del lado del andén, en V 2,65), el paso abierto
 *  delante de la puerta del costado (V 3,2), la baranda del lado del hall (V 3,95) y la escalera (al medio del paso,
 *  2 m de ancho, hasta el andén). */
const LINEA_U = 12.5, LINEA_PUNTA = 2.65, MOLINETE = { w: 0.88, d: 0.9 } as const, GABINETE = 0.28;
/** La escalera: el pie (el borde del primer escalón) y el ancho. Cuatro huellas de 0,3 m llevan arriba a v 6,36: los
 *  pasamanos terminan a RAIL_T/2 de ahí, adentro del patio (que llega a v 6,395). De ahí al andén, el descanso de arriba
 *  (out): llega hasta el borde del andén que da al edificio (andenV, de los andenes del mapa), ANDEN_AIRE antes. */
const PASO_V = 3.2, BARANDA_V = 3.95, ESCALERA = { pie: 5.16, ancho: 2.0 } as const, ANDEN_AIRE = 0.002;
/** Hasta dónde busca un andén la escalera, pasando su último escalón (m). */
const ANDEN_HASTA = 1.0;

// ---------- ayudas ----------

/** Las caras de adentro de las paredes de afuera (la planta corrida del Kit): la planta es casi un rectángulo, pero se
 *  tuerce ~1 cm, así que lo que se apoya en una pared va sobre su recta: `oeste(v)` y `este(v)` dan la U de la cara de
 *  U 0 y la de U 10 en cada V, y `frente(u)`, la V de la de la calle en cada U. */
interface Caras { U0: number; U1: number; V0: number; oeste: (v: number) => number; este: (v: number) => number; frente: (u: number) => number;
  /** Las esquinas de adentro: la de U 0 y V 0 (so), la de U 0 y V 6,4 (no) y las de U 10 (se, ne). */
  so: Vec2; no: Vec2; se: Vec2; ne: Vec2 }
function caras(k: Kit): Caras {
  const r = k.inside;
  const cerca = (u: number, v: number): Vec2 => r.reduce((m, p) => (Math.hypot(p[0] - u, p[1] - v) < Math.hypot(m[0] - u, m[1] - v) ? p : m));
  const [so, no, se, ne] = [cerca(0, 0), cerca(0, 6.4), cerca(10, 0), cerca(10, 6.4)];
  const enV = (a: Vec2, b: Vec2) => (v: number): number => a[0] + ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]);
  const enU = (a: Vec2, b: Vec2) => (u: number): number => a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]);
  return { U0: Math.max(so[0], no[0]), U1: Math.min(se[0], ne[0]), V0: Math.max(so[1], se[1]), oeste: enV(so, no), este: enV(se, ne), frente: enU(so, se), so, no, se, ne };
}

/** Un artefacto de dos tubos colgado del cielorraso en `c` (a lo largo de U), con sus dos varillas y su lámpara. */
function artefacto(k: Kit, c: Vec2, techo: number, lamp: { r: number; p: number }): void {
  const [u, v] = c, y = ARTEFACTO_Y;
  k.block(rect([u - 0.64, v - 0.09, u + 0.64, v + 0.09]), y + 0.04, y + 0.1, 'none', 'otro', { side: ARTEFACTO, top: ARTEFACTO, bottom: ARTEFACTO });
  for (const s of [-1, 1]) {
    k.block(rect([u - 0.6, v + s * 0.045 - 0.016, u + 0.6, v + s * 0.045 + 0.016]), y, y + 0.04, 'none', 'otro', { side: TUBO, bottom: TUBO });
    k.block(rect([u + s * 0.45 - 0.004, v - 0.004, u + s * 0.45 + 0.004, v + 0.004]), y + 0.1, techo, 'none', 'otro', { side: ARTEFACTO });
  }
  k.lamp(c, y - 0.05, lamp.r, lamp.p);
}

/** Cuánto le falta a `x` para el próximo múltiplo de `m` (en [0, m)). */
const resto = (x: number, m: number): number => ((x % m) + m) % m;

/**
 * El mural de azulejos sobre la pared de U = u (la cara mira a +U): MURAL.cols × MURAL.rows paños de cerámico de
 * AZULEJO m, cada uno de un color, alineados con las juntas de la textura (van en metros del mundo: el borde de cada paño
 * cae en una junta). El patrón, un panel pensado y no ruido: la guarda azul cobalto con las esquinas amarillas y, en el
 * paño, rombos concéntricos desde el medio (amarillo, cobalto, blanco, celeste, blanco, el color de la semilla…),
 * simétrico a lo ancho y a lo alto. La semilla, de la posición del mural en el mundo, elige el color del anillo de
 * afuera (verde o terracota) y el del medio.
 */
function mural(k: Kit, c: Caras): void {
  const v0 = muralV0(k);
  const colores = muralColors(muralSeed(k.at([c.oeste(v0), v0])));
  for (let j = 0; j < MURAL.cols; j++) {
    const [va, vb] = [v0 + j * AZULEJO, v0 + (j + 1) * AZULEJO];
    const [xa, xb] = [c.oeste(va) + 0.004, c.oeste(vb) + 0.004];
    for (let r = 0; r < MURAL.rows; r++) {
      const [ya, yb] = [MURAL.y + r * AZULEJO, MURAL.y + (r + 1) * AZULEJO];
      k.pane([[xa, ya, va], [xb, ya, vb], [xb, yb, vb], [xa, yb, va]], [1, 0, 0], { mat: 'ceramico', color: colores[j][r] });
    }
  }
}

/** La semilla del mural de la esquina de abajo de su primer azulejo `p` (mundo), al decímetro: depende solo de dónde
 *  está. */
export const muralSeed = (p: Vec2): number => Math.round(p[0] * 10) * 7919 + Math.round(p[1] * 10) * 104729;

/** Los colores del mural de semilla `seed`, por columna (a lo largo de la pared) y fila (de abajo arriba): la guarda, las
 *  esquinas y los rombos concéntricos; la semilla elige el anillo de afuera y el del medio. */
export function muralColors(seed: number): string[][] {
  const { cols, rows } = MURAL, mc = (cols - 1) / 2, mr = (rows - 1) / 2;
  const [blanco, celeste, cobalto, amarillo, verde, terracota] = AZULEJOS;
  const afuera = hashIndex(seed) < 0.5 ? verde : terracota, medio = hashIndex(seed + 1) < 0.5 ? amarillo : terracota;
  const anillos = [medio, cobalto, blanco, celeste, blanco, afuera, blanco, celeste];
  return Array.from({ length: cols }, (_, j) => Array.from({ length: rows }, (_, r) => {
    const guarda = j === 0 || j === cols - 1 || r === 0 || r === rows - 1;
    const esquina = (j === 0 || j === cols - 1) && (r === 0 || r === rows - 1);
    // el anillo: la distancia "de rombo" al medio (las dos columnas del medio son el centro)
    const d = Math.round(Math.abs(j - mc) - 0.5) + Math.round(Math.abs(r - mr));
    return esquina ? amarillo : guarda ? cobalto : anillos[d % anillos.length];
  }));
}

/** Donde arranca el mural: la primera junta de la textura del cerámico desde MURAL.v (las uv van en metros del mundo:
 *  las juntas caen donde los metros a lo largo de la cara, el mundo · V, son múltiplos de AZULEJO). */
function muralV0(k: Kit): number {
  const o = k.at([0, 0]), w = k.at([0, 1]), V: Vec2 = [w[0] - o[0], w[1] - o[1]];
  return MURAL.v + resto(-(o[0] * V[0] + o[1] * V[1]) - MURAL.v, AZULEJO);
}

// ---------- el hall ----------

/** El hall: la boletería (con la oficina detrás), la terminal SUBE, la puerta del baño, el mural y los bancos, las
 *  ventanas del frente vistas de adentro, los tubos y el zócalo. */
function hall(k: Kit, c: Caras, techo: number): void {
  boleteria(k, c, techo);
  sube(k);
  baño(k);
  mural(k, c);
  bancos(k, c);
  ventanasAdentro(k, c);
  for (const p of ARTEFACTOS) artefacto(k, p, techo, TUBO_LAMP);
  zocaloAdentro(k, c);
}

/** La cara del hall del tabique de la boletería. */
const HALL_V1 = BOLETERIA_V - T / 2;

/** El tabique de la boletería con sus ventanillas y el cartel, el de entre el baño y la oficina, lo que cierra detrás
 *  (el baño macizo, la oficina de vidrio sin dibujar) y lo de adentro de la oficina. */
function boleteria(k: Kit, c: Caras, techo: number): void {
  // el tabique de la boletería (metido 5 cm en las paredes: la planta se tuerce), con los huecos de las ventanillas (el
  // dintel a LINTEL_MIN) y su antepecho; el de entre la oficina y el baño, y el vidrio de cada ventanilla
  const t0 = c.oeste(BOLETERIA_V) - 0.05;
  k.wall([t0, BOLETERIA_V], [c.este(BOLETERIA_V) + 0.05, BOLETERIA_V], { look: PARED, gaps: VENTANILLAS.map((u) => ({ at: u - t0, width: VENTANILLA.w, height: VENTANILLA.top })) });
  k.wall([BAÑO_U, BOLETERIA_V + T / 2], [BAÑO_U, 6.25], { look: PARED });
  // detrás del tabique no se entra (como en la realidad: el baño está cerrado y la oficina es del personal): el baño,
  // macizo y sin caras (lo tapan el tabique y su puerta); la oficina se ve por las ventanillas, así que va de vidrio sin
  // dibujar: frena al jugador (y deja de ser suelo: no es un hueco sin salida) y no a las balas
  const fondo = Math.min(c.no[1], c.ne[1]);
  k.block(rect([c.U0, BOLETERIA_V + T / 2, BAÑO_U - T / 2, fondo]), 0, techo, 'solid', 'otro', {});
  k.block(rect([BAÑO_U + T / 2, BOLETERIA_V + T / 2, c.U1, fondo]), 0, techo, 'glass', 'otro', {});
  for (const u of VENTANILLAS) {
    const [u0, u1] = [u - VENTANILLA.w / 2, u + VENTANILLA.w / 2];
    k.block(rect([u0, BOLETERIA_V - T / 2, u1, BOLETERIA_V + T / 2]), 0, VENTANILLA.sill, 'solid', 'tabique', { side: PARED, top: PARED });
    k.block(rect([u0, BOLETERIA_V - 0.01, u1, BOLETERIA_V + 0.01]), VENTANILLA.sill, VENTANILLA.top, 'glass', 'vidrio', { side: VIDRIO });
    k.furniture('ventanilla', [u, BOLETERIA_V], VENTANILLA.sill, MIRA.menosV);
  }
  k.label('BOLETERÍA', [(VENTANILLAS[0] + VENTANILLAS[1]) / 2, HALL_V1 - 0.012], 2.62, [0, -1], 2.3, 0.38, AZUL);
  // adentro de la oficina: el mostrador bajo las ventanillas, un monitor y una silla por puesto, y su tubo
  k.block(rect([4.9, BOLETERIA_V + T / 2, 8.3, 5.15]), 0, 0.95, 'none', 'otro', { top: MOSTRADOR, side: MOSTRADOR });
  for (const u of VENTANILLAS) {
    k.block(rect([u - 0.22, 4.82, u + 0.22, 4.86]), 1.0, 1.3, 'none', 'otro', { side: MONITOR, top: MONITOR });
    k.block(rect([u - 0.05, 4.84, u + 0.05, 4.9]), 0.95, 1.0, 'none', 'otro', { side: MONITOR, top: MONITOR });
    k.furniture('silla', [u, 5.55], 0, MIRA.menosV, '#3b3f45', 2);
  }
  artefacto(k, ARTEFACTO_OFICINA, techo, OFICINA_LAMP);
}

/** La terminal SUBE contra el tabique, mirando al hall, con su cartel en la franja de arriba. */
function sube(k: Kit): void {
  const subeV = HALL_V1 - SUBE_D / 2 - 0.03;
  k.furniture('sube', [SUBE_U, subeV], 0, MIRA.menosV);
  k.label('CARGA SUBE', [SUBE_U, subeV - SUBE_D / 2 - 0.004], 1.56, [0, -1], 0.5, 0.09, CARGA_SUBE);
}

/** La puerta del baño, cerrada: la hoja verde sobre el tabique, el contramarco, el picaporte y la placa en relieve. */
function baño(k: Kit): void {
  const { u: bu, w: bw, h: bh } = BAÑO_PUERTA, v = HALL_V1;
  k.block(rect([bu - bw / 2, v - 0.03, bu + bw / 2, v]), 0, bh, 'none', 'otro', { side: PUERTA, top: PUERTA });
  for (const s of [-1, 1]) k.block(rect([bu + s * (bw / 2 + 0.03) - 0.03, v - 0.02, bu + s * (bw / 2 + 0.03) + 0.03, v]), 0, bh + 0.06, 'none', 'otro', { side: CONTRAMARCO, top: CONTRAMARCO });
  k.block(rect([bu - bw / 2 - 0.06, v - 0.02, bu + bw / 2 + 0.06, v]), bh, bh + 0.06, 'none', 'otro', { side: CONTRAMARCO, top: CONTRAMARCO, bottom: CONTRAMARCO });
  k.block(rect([bu + bw / 2 - 0.12, v - 0.09, bu + bw / 2 - 0.08, v - 0.03]), 0.98, 1.02, 'none', 'otro', { side: INOX, top: INOX, bottom: INOX });
  k.block(rect([bu - 0.17, v - 0.045, bu + 0.17, v - 0.03]), 1.52, 1.68, 'none', 'otro', { side: PLACA, top: PLACA, bottom: PLACA });
  k.label('BAÑO', [bu, v - 0.047], 1.6, [0, -1], 0.3, 0.12, AZUL);
}

/** Los bancos con respaldo: dos bajo las ventanas del frente y uno bajo el mural. */
function bancos(k: Kit, c: Caras): void {
  for (const [a, b] of VENTANAS) k.furniture('banco-respaldo', [(a + b) / 2, c.frente((a + b) / 2) + 0.28 + 0.04], 0, MIRA.V);
  const vm = muralV0(k) + (MURAL.cols * AZULEJO) / 2;
  k.furniture('banco-respaldo', [c.oeste(vm) + 0.28 + 0.04, vm], 0, MIRA.U);
}

/** Las ventanas del frente vistas de adentro: la luz de día, el marco con su parteluz y el travesaño, el alféizar que
 *  sale de la pared y la reja a contraluz. */
function ventanasAdentro(k: Kit, c: Caras): void {
  for (const [a, b] of VENTANAS) {
    const { y0, y1, marco: m } = VENTANA, v = c.frente((a + b) / 2);
    k.pane([[a + m, y0 + m, v + 0.004], [b - m, y0 + m, v + 0.004], [b - m, y1 - m, v + 0.004], [a + m, y1 - m, v + 0.004]], [0, 0, 1], LUZ_DIA);
    const pieza = (u0: number, u1: number, ya: number, yb: number, look: Look, d = 0.04): void =>
      k.block(rect([u0, v - 0.01, u1, v + d]), ya, yb, 'none', 'otro', { side: look, top: look, bottom: look });
    pieza(a, a + m, y0, y1, MARCO_IN);
    pieza(b - m, b, y0, y1, MARCO_IN);
    pieza(a, b, y1 - m, y1, MARCO_IN);
    pieza((a + b) / 2 - 0.03, (a + b) / 2 + 0.03, y0, y1, MARCO_IN);
    pieza(a + m, b - m, 1.98, 2.03, MARCO_IN);
    pieza(a - 0.04, b + 0.04, y0 - 0.04, y0 + m, MARCO_IN, 0.12);
    for (let u = a + 0.17; u < b - 0.12; u += 0.13) pieza(u - 0.008, u + 0.008, y0 + m, y1 - m, REJA_IN, 0.012);
  }
}

/** El zócalo celeste de adentro: en el frente y en el costado del patio (menos sus puertas, de k.openings), en el del
 *  mural y en el tabique de la boletería (menos la puerta del baño y, de la repisa para arriba, las ventanillas). */
function zocaloAdentro(k: Kit, c: Caras): void {
  const so: Vec2 = [c.oeste(c.V0), c.V0], se: Vec2 = [c.este(c.V0), c.frente(c.este(c.V0))];
  const no: Vec2 = [c.oeste(HALL_V1), HALL_V1], ne: Vec2 = [c.este(HALL_V1), HALL_V1];
  const t = { t: ZOCALO_T };
  franja(k, so, se, [0, 1], 0, ZOCALO_H, ZOCALO_IN, puertas(k, so, se), t);
  franja(k, so, no, [1, 0], 0, ZOCALO_H, ZOCALO_IN, puertas(k, so, no), t);
  franja(k, se, ne, [-1, 0], 0, ZOCALO_H, ZOCALO_IN, puertas(k, se, ne), t);
  const { u: bu, w: bw } = BAÑO_PUERTA;
  franja(k, no, ne, [0, -1], 0, ZOCALO_H, ZOCALO_IN, [
    [bu - bw / 2 - 0.06 - no[0], bu + bw / 2 + 0.06 - no[0], 0, 3],
    ...VENTANILLAS.map((u): [number, number, number, number] => [u - VENTANILLA.w / 2 - 0.07 - no[0], u + VENTANILLA.w / 2 + 0.07 - no[0], VENTANILLA.sill - 0.05, 3]),
  ], t);
}

// ---------- el patio ----------

/** Dónde empieza el andén que alcanza la escalera (la V del borde de un andén del mapa, el más cercano pasando su pie,
 *  en el medio y en las dos puntas de su ancho), o null si ninguno está a ANDEN_HASTA de su último escalón. */
function andenV(k: Kit): number | null {
  const { pie, ancho: w } = ESCALERA, n = Math.ceil(PLATFORM_H / 0.2 - 1e-9), ultimo = pie + n * 0.3;
  const cruces = k.platforms.flatMap((r) => [LINEA_U - w / 2, LINEA_U, LINEA_U + w / 2].flatMap((u) => r.flatMap((q, j) => {
    const p = r[(j + 1) % r.length];
    if ((q[0] - u) * (p[0] - u) > 0 || q[0] === p[0]) return [];
    return [q[1] + ((p[1] - q[1]) * (u - q[0])) / (p[0] - q[0])];
  }))).filter((v) => v > pie);
  const v = Math.min(...cruces);
  return Number.isFinite(v) && v <= ultimo + ANDEN_HASTA ? v : null;
}

function patio(k: Kit, ring: Vec2[], hasta: number): void {
  k.block(ring, 0, GROUND_Y, 'none', 'otro', { top: PATIO });
  // la línea de molinetes: de la punta (contra el paso abierto) hacia la calle, dos molinetes y el gabinete que cierra
  // el último paso; cada molinete mira al lado sin pagar (−U) y su ancho (+x) va hacia la punta (+V)
  let v = LINEA_PUNTA;
  for (let j = 0; j < 2; j++, v -= MOLINETE.w) k.furniture('molinete', [LINEA_U, v - MOLINETE.w / 2], 0, MIRA.menosU);
  // el gabinete es out (T11b): frena balas y está a cielo abierto, así que se ve de lejos, con el edificio
  const h = MOLINETE.d / 2;
  k.block(rect([LINEA_U - h, v - GABINETE, LINEA_U + h, v]), 0, 0.92, 'solid', 'otro', { side: INOX_AFUERA, top: INOX_TAPA }, true);
  // del lado de la calle y del fondo, la baranda de caño verde que cierra lo pagado; los caños, la hoja abierta y los
  // pasamanos de la escalera son out (se ven de lejos, con el edificio), como el balcón del Guernica
  const fin = v - GABINETE;
  k.railing([[LINEA_U, fin], [LINEA_U, 0.15], [16.9, 0.15], [16.9, 6.35]], 0, VERDE, { caño: true, out: true });
  // del lado del hall, la baranda de la pared al molinete ancho, y su hoja abierta, plegada contra ella
  const ancho = LINEA_U - h - 0.1;
  k.railing([[10.0, BARANDA_V], [ancho, BARANDA_V]], 0, VERDE, { caño: true, out: true });
  const hv = BARANDA_V - 0.07, hoja = (u0: number, u1: number, y0: number, y1: number): void =>
    k.block(rect([u0, hv - 0.015, u1, hv + 0.015]), y0, y1, 'none', 'otro', { side: INOX_AFUERA, top: INOX_AFUERA, bottom: INOX_AFUERA }, true);
  const h0 = ancho - 1.15, h1 = ancho - 0.05;
  hoja(h0, h1, 0.95, 1.0);
  hoja(h0, h1, 0.15, 0.2);
  for (const u of [h0, h1 - 0.04]) hoja(u, u + 0.04, 0.15, 1.0);
  for (let u = h0 + 0.2; u < h1 - 0.1; u += 0.18) hoja(u - 0.01, u + 0.01, 0.2, 0.95);
  // la escalera al andén (out), alineada con el paso: baldosas rojas, una nariz amarilla en cada escalón y pasamanos
  const { pie, ancho: w } = ESCALERA, anden = hasta - ANDEN_AIRE;
  k.stair({ from: 0, to: 0, rise: PLATFORM_H, foot: [LINEA_U, pie], dir: [0, 1], width: w, look: ESCALON, rail: VERDE, railStyle: { caño: true },
    handrail: 'ambos', handrailLook: VERDE, out: true });
  const n = Math.ceil(PLATFORM_H / 0.2 - 1e-9), r = PLATFORM_H / n, arriba = pie + (n - 1) * 0.3;
  k.block(rect([LINEA_U - w / 2, arriba, LINEA_U + w / 2, anden]), 0, PLATFORM_H, 'solid', 'otro', { top: ESCALON, side: ESCALON }, true);
  // la nariz amarilla de cada escalón, y la del descanso de arriba (el último escalón)
  for (let j = 1; j <= n; j++) {
    const v0 = pie + (j - 1) * 0.3;
    k.block(rect([LINEA_U - w / 2, v0, LINEA_U + w / 2, v0 + 0.05]), j * r, j * r + 0.006, 'none', 'otro', { top: NARIZ, side: NARIZ }, true);
  }
}

// ---------- afuera ----------

function afuera(k: Kit, c: Caras): void {
  const t = ZOCALO_OUT_T, out = { t, out: true as const };
  // las caras de afuera: las de adentro corridas WALL_OUT (la planta es casi un rectángulo), alargadas `t` en cada
  // punta para doblar las esquinas
  const fuera = (p: Vec2, du: number, dv: number): Vec2 => [p[0] + du * WALL_OUT, p[1] + dv * WALL_OUT];
  const [SO, SE, NO, NE] = [fuera(c.so, -1, -1), fuera(c.se, 1, -1), fuera(c.no, -1, 1), fuera(c.ne, 1, 1)];
  const largo = (p: Vec2, q: Vec2, x: number): [Vec2, Vec2] => {
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]), e: Vec2 = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
    return [add(p, e, -x), add(q, e, x)];
  };
  // el zócalo celeste: el frente (de la punta del patio a la otra, menos la puerta y la hoja que pinta el atlas al lado),
  // los dos costados (menos la puerta del patio) y, contra el andén, de su piso para arriba
  const [f0, f1] = largo(SE, SO, t);
  franja(k, f0, f1, [0, -1], 0, ZOCALO_H, ZOCALO_OUT, [...puertas(k, f0, f1), [f0[0] - HOJA_PINTADA.u1, f0[0] - HOJA_PINTADA.u0, 0, 3]], out);
  franja(k, SO, NO, [-1, 0], 0, ZOCALO_H, ZOCALO_OUT, puertas(k, SO, NO), out);
  franja(k, SE, NE, [1, 0], 0, ZOCALO_H, ZOCALO_OUT, puertas(k, SE, NE), out);
  const [b0, b1] = largo(NO, NE, 0.02);
  franja(k, b0, b1, [0, 1], PLATFORM_H, PLATFORM_H + ZOCALO_H, ZOCALO_OUT, [], { t: 0.02, out: true });
  // las ventanas: las dos del frente (sobre las del atlas), y las que dan al andén y a los costados (H4): la de la
  // oficina y una alta del baño sobre el andén (arriba de su zócalo), la de la oficina al patio y la del baño al costado
  // de la escalera de mano (lejos de ella: la escalera va a V 3,2)
  const frente = cara(SO, SE, 0, [0, -1]), anden = cara(NO, NE, 0, [0, 1]), oeste = cara(SO, NO, 1, [-1, 0]), este = cara(SE, NE, 1, [1, 0]);
  for (const [a, b] of VENTANAS) ventana(k, frente, a, b, VENTANA.y0, VENTANA.y1);
  const sobreAnden = PLATFORM_H + ZOCALO_H;
  ventana(k, anden, VENTANA_OFICINA.u0, VENTANA_OFICINA.u1, sobreAnden, sobreAnden + VENTANA.y1 - VENTANA.y0);
  ventana(k, anden, VENTANA_BAÑO.u0, VENTANA_BAÑO.u1, PLATFORM_H + VENTANA_BAÑO.y0, PLATFORM_H + VENTANA_BAÑO.y1);
  ventana(k, este, VENTANA_PATIO.v0, VENTANA_PATIO.v1, VENTANA.y0, VENTANA.y1);
  ventana(k, oeste, VENTANA_COSTADO.v0, VENTANA_COSTADO.v1, VENTANA_BAÑO.y0, VENTANA_BAÑO.y1);
}

/** Una cara de afuera: el punto de la recta de `p` a `q` en la coordenada `s` (`eje` 0: U, en el frente y el fondo; 1: V,
 *  en los costados), corrido `d` hacia afuera (`n`). */
type Cara = (s: number, d: number) => Vec2;
const cara = (p: Vec2, q: Vec2, eje: 0 | 1, n: Vec2): Cara => (s, d) => {
  const f = (s - p[eje]) / (q[eje] - p[eje]);
  return [p[0] + (q[0] - p[0]) * f + n[0] * d, p[1] + (q[1] - p[1]) * f + n[1] * d];
};

/** Una ventana de afuera (out) sobre la cara `c`, de `a` a `b` y de `y0` a `y1`: el vidrio oscuro, el marco (con su
 *  parteluz si es ancha y el travesaño si es alta), el alféizar y la reja verde (barrotes cada 13 cm y sus planchuelas). */
function ventana(k: Kit, c: Cara, a: number, b: number, y0: number, y1: number): void {
  const m = VENTANA.marco, alta = y1 - y0 > 0.9;
  // de `d0` (contra la pared) a `d1` hacia afuera; la arista 2 (sobre la pared) no se ve
  const pieza = (s0: number, s1: number, d0: number, d1: number, ya: number, yb: number, look: Look): void =>
    k.block([c(s0, d1), c(s1, d1), c(s1, d0), c(s0, d0)], ya, yb, 'none', 'otro', { side: look, top: look, bottom: look }, { out: true, hide: [2] });
  // el vidrio entre los marcos, solo su cara de afuera, y el marco desde la pared: el canto oscuro del vidrio no asoma
  // (era la línea punteada al costado de la ventana, T11c); arriba lo tapa el dintel del marco y abajo, el alféizar
  k.block([c(a + m, 0.02), c(b - m, 0.02), c(b - m, 0), c(a + m, 0)], y0, y1, 'none', 'otro', { side: VIDRIO_OUT }, { out: true, hide: [1, 2, 3] });
  pieza(a, a + m, 0, 0.05, y0, y1, MARCO_OUT);
  pieza(b - m, b, 0, 0.05, y0, y1, MARCO_OUT);
  pieza(a + m, b - m, 0, 0.05, y1 - m, y1, MARCO_OUT);
  if (b - a > 1.5) pieza((a + b) / 2 - 0.03, (a + b) / 2 + 0.03, 0.02, 0.05, y0, y1 - m, MARCO_OUT);
  if (alta) pieza(a + m, b - m, 0.02, 0.05, y1 - 0.32, y1 - 0.27, MARCO_OUT);
  pieza(a - 0.05, b + 0.05, 0, 0.09, y0 - 0.05, y0 + 0.015, ALFEIZAR);
  for (let s = a + 0.17; s < b - 0.12; s += 0.13) pieza(s - 0.008, s + 0.008, 0.069, 0.085, y0 + 0.02, y1 - 0.02, VERDE);
  for (const y of alta ? [y0 + 0.3, y1 - 0.18] : [(y0 + y1) / 2]) pieza(a + 0.1, b - 0.1, 0.061, 0.069, y, y + 0.03, VERDE);
}

export const estacionPlan: InteriorPlan = (k) => {
  const c = caras(k);
  const ring = k.patios[0];
  k.shell({ publicFloors: 1, wall: PARED, floor: MOSAICO, ceiling: CIELORRASO });
  // lo que el plan necesita para ubicar todo (H11 de la revisión de la T10): si algo falta, se dice qué, en vez de
  // dejar un hall vacío
  const m = (x: number): string => x.toFixed(2).replace('.', ',');
  if (Math.abs(c.U1 - c.U0 - 9.6) > 0.1 || Math.abs(BOLETERIA_V - c.V0 - 4.3) > 0.1 || k.height < 4.5) {
    throw new Error(`${ID}: la planta no es la relevada: el hall va de cara a cara ${m(c.U1 - c.U0)} m (9,6), del frente al tabique de `
      + `la boletería ${m(BOLETERIA_V - c.V0)} m (4,3) y el edificio tiene ${m(k.height)} m de alto (≥ 4,5)`);
  }
  if (!ring) throw new Error(`${ID}: falta el patio del lado del andén (InteriorInput.patios): ahí van los molinetes y la escalera`);
  const paso = puertas(k, c.se, c.ne).some(([s0, s1]) => s0 + 0.5 <= PASO_V - c.se[1] && PASO_V - c.se[1] <= s1 - 0.5);
  if (!paso) throw new Error(`${ID}: falta la puerta del patio en la cara de U 10 (con V ${m(PASO_V)} a ≥ 0,5 m de sus jambas): por ahí va el paso a los molinetes`);
  const anden = andenV(k);
  if (anden === null) throw new Error(`${ID}: ningún andén del mapa llega a la escalera (U ${m(LINEA_U)}, desde V ${m(ESCALERA.pie)}): no tiene adónde subir`);
  const arriba = ESCALERA.pie + (Math.ceil(PLATFORM_H / 0.2 - 1e-9) - 1) * 0.3;
  if (anden - ANDEN_AIRE < arriba + 0.05) {
    throw new Error(`${ID}: la escalera no entra: su último escalón arranca en V ${m(arriba)} y el andén, en V ${m(anden)}`);
  }
  hall(k, c, k.ceilingOver(0));
  patio(k, ring, anden);
  afuera(k, c);

  k.mark('hall', [6.0, PASO_V], 0);
  k.mark('paso-molinetes', [LINEA_U, PASO_V], 0);
  k.mark('anden', [LINEA_U, 7.8], PLATFORM_H);
  k.view('hall', [8.9, 1.0], 0, -Math.PI / 4);
  k.view('molinetes', [10.6, 1.0], 0, Math.PI / 3);
  return k.done(AMBIENT);
};
