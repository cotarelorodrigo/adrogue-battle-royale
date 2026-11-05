// Los tres bancos (§4.1–4.3): no hay fotos de adentro, así que va la sucursal típica de cada uno con los colores de su
// marca, sobre las medidas del mapa (el lote y su puerta de calle). Solo la planta baja es pública: arriba, el bloque
// cerrado.
// - De la calle se entra al vestíbulo de los cajeros automáticos: al frente en el Nación y el BBVA, a un costado (contra
//   la medianera del lado de la puerta) en el Galicia. Paredes blancas, paneles de luz blanca fría y el cartel de los
//   cajeros en el color de la marca.
// - De ahí, por la pared de vidrio con su puerta (la hoja dibujada abierta, D10), al salón: la fila de espera mirando la
//   línea de cajas del fondo, el turnero colgado, los dos escritorios de atención y los carteles de la marca.
// - Cada caja: su tramo de mostrador sólido de 1,1 m, la mampara de vidrio (clase glass) de 1,1 a 2,4 m con la ventanilla
//   baja y su número arriba, en la franja del color de la marca. Detrás se entra por la puerta de servicio del tabique del
//   costado; en la pared del fondo está la puerta redonda del tesoro, que es un cartel dibujado: no se abre.
// Todo va en el marco local del Kit: U a lo largo del frente y V hacia adentro (0 mira a +V y π/2 a +U). Lo que va de un
// costado (los cajeros, las cajas) se mide desde la pared de ese costado, `lado`; los escritorios van del otro.
import { pointInPolygon, polygonArea } from '../geo.ts';
import type { Vec2 } from '../geo.ts';
import type { SignLook } from '../mapdata.ts';
import type { InteriorPlan } from './index.ts';
import { MODEL_BOX, WALL_IN, WALL_OUT } from './kit.ts';
import type { Kit } from './kit.ts';
import { MIRA, rect } from './plan-util.ts';
import type { Rect } from './plan-util.ts';
import type { ItemModel, Look } from './types.ts';

export type Marca = 'nacion' | 'galicia' | 'bbva';

// ---------- materiales ----------

/** Porcelanato gris claro, paredes y cielorraso blancos. */
const PARED: Look = { mat: 'liso', color: '#f1f0ec' };
const PISO: Look = { mat: 'porcelanato', color: '#c9cbcc' };
const TECHO: Look = { mat: 'liso', color: '#f6f6f3' };
const VIDRIO: Look = { mat: 'vidrio', color: '#b8d0d6' };
/** El aluminio de los parantes y el acero de la chapa del tesoro, lisos: son finos o los tapa el cartel, y así no suman
 *  la malla de in_metal (un draw call menos por banco). */
const ALUMINIO: Look = { mat: 'liso', color: '#c4c8cc' };
const ACERO: Look = { mat: 'liso', color: '#8e9398' };
/** Los paneles de luz del cielorraso, y los del vestíbulo, de luz blanca fría. Brillan (van sin hornear): adentro, con
 *  el ojo adaptado, se ven ~4 veces más fuertes que desde la vereda. */
const PANEL: Look = { mat: 'luz', color: '#dcdedc' };
const PANEL_FRIO: Look = { mat: 'luz', color: '#d2deec' };
/** La luz pareja del lugar; el resto lo ponen los paneles (una lámpara cada uno) y la vidriera. */
const AMBIENT = 0.45;
/** Lámpara de cada panel: alcance (m) y fuerza, en el salón y en el vestíbulo (más fuerte: la luz blanca fría). */
const LAMP_R = 5.5, LAMP_P = 0.55, LAMP_P_FRIO = 0.7;
/** Lado (m) de la grilla de los paneles. */
const PASO = 2.6;

/** El número llamado del turnero: LED rojo sobre negro. Brilla, así que el rojo va oscurecido: '#aa1503' se ve
 *  #ff3b1c adentro (ver franjaLuz en Estilo). */
const TURNO: SignLook = { fondo: '#070707', letra: '#aa1503', marco: '#070707', fuente: 'condensada' };
/** La franja esmerilada de la pared de vidrio (el vinilo que la hace ver, a la altura de la vista de un chico). */
const ESMERILADO: Look = { mat: 'liso', color: '#eceeee' };
/** La puerta del tesoro: el acero de la puerta, los bulones y el volante, y la chapa del marco. */
const BOVEDA: SignLook = { fondo: '#b3b8bd', letra: '#5c6166', marco: '#7c8186', fuente: 'sans' };

/** Lo de cada marca: sus colores y textos (tal cual, sin logos) y cómo es su sucursal. */
interface Estilo {
  /** El nombre de la marca, tal cual va en sus carteles. */
  nombre: string;
  /**
   * Lo que va iluminado de atrás, como en una sucursal: la franja de arriba de las cajas (su frente; abajo, `franja`) y
   * los carteles (el nombre de la marca, los números de las cajas y el de los cajeros), que son cajas de luz. Brillan
   * (van sin hornear), así que sus colores están oscurecidos para que adentro, con INDOOR_EXPOSURE y ACES, se vean los
   * de la marca: '#883010' se ve #e1561f, '#003860' #005ba4, '#1068ac' #59b7e6, '#1c2c60' #1e44a8 y '#e8e8e8' blanco.
   * Si cambian la exposición o el tone mapping, tests/client/bancos-luz.test.ts dice qué recalibrar.
   */
  franjaLuz: Look;
  luminoso: SignLook;
  /** La parte de abajo de la franja, del color de la marca, y el zócalo, de uno oscuro de la misma familia. */
  franja: Look;
  zocalo: Look;
  /** El cartel de arriba de los cajeros automáticos. */
  cajeros: string;
  /** El vestíbulo: al frente (de lado a lado) o a un costado (contra la medianera del lado de la puerta). */
  vestibulo: 'frente' | 'costado';
  cajas: number;
  /** Al frente, de qué medianera van los cajeros (y las cajas) si la puerta de calle queda en el medio: −1, la de U0. */
  lado: -1 | 1;
}

const ESTILOS: Record<Marca, Estilo> = {
  nacion: {
    nombre: 'BANCO NACIÓN',
    franjaLuz: { mat: 'luz', color: '#003860' }, luminoso: { fondo: '#003860', letra: '#e8e8e8', marco: '#1068ac', fuente: 'sans' },
    franja: { mat: 'liso', color: '#005ba4' }, zocalo: { mat: 'liso', color: '#123d68' }, cajeros: 'Cajeros automáticos',
    vestibulo: 'frente', cajas: 3, lado: -1,
  },
  galicia: {
    nombre: 'Galicia',
    franjaLuz: { mat: 'luz', color: '#883010' }, luminoso: { fondo: '#883010', letra: '#e8e8e8', marco: '#883010', fuente: 'sans' },
    franja: { mat: 'liso', color: '#e1561f' }, zocalo: { mat: 'liso', color: '#4b4a4a' }, cajeros: 'Autoservicio',
    vestibulo: 'costado', cajas: 4, lado: -1,
  },
  bbva: {
    nombre: 'BBVA',
    franjaLuz: { mat: 'luz', color: '#1c2c60' }, luminoso: { fondo: '#1c2c60', letra: '#e8e8e8', marco: '#1c2c60', fuente: 'sans' },
    franja: { mat: 'liso', color: '#1e44a8' }, zocalo: { mat: 'liso', color: '#13285e' }, cajeros: 'Cajeros automáticos',
    vestibulo: 'frente', cajas: 3, lado: 1,
  },
};

// ---------- medidas ----------

const box = (m: ItemModel): { w: number; d: number; h: number } => MODEL_BOX[m]!;
/** Un puesto de caja (su tramo de mostrador) y la mampara de arriba, de 1,1 a 2,4 m. */
const PUESTO = box('puesto-caja'), MAMPARA_Y1 = 2.4;
/** La ventanilla baja de cada mampara (el pasa-valores): ancho y alto sobre el mostrador. */
const VENTANILLA_W = 0.45, VENTANILLA_H = 0.12;
/** Espesor de la mampara y de la pared de vidrio del vestíbulo. */
const MAMPARA_T = 0.02, VIDRIO_T = 0.04;
/** La puerta de la pared de vidrio y la de servicio de las cajas (D10: ≥ 1,0 × 2,2). */
const PUERTA_W = 1.2, SERVICIO_W = 1.0, PUERTA_H = 2.3;
/** Parantes de aluminio de la pared de vidrio: cada a lo sumo esto (m), de 5 × 6 cm. Los perfiles de piso y de techo,
 *  de 4 × 4 cm, y la franja esmerilada, de 1,02 a 1,10 m (envuelve al vidrio: 2 mm de cada lado). */
const PARANTE_CADA = 1.6, PARANTE_W = 0.05, PARANTE_D = 0.06, PERFIL = 0.04, ESMERILADO_Y = [1.02, 1.1] as const;
/** El zócalo: alto y espesor (fino: no hace rincón en la pared). */
const ZOCALO_H = 0.1, ZOCALO_T = 0.008;
/** Lo que se separa de la pared lo que se apoya en ella. */
const AIRE = 0.02;
/** El vestíbulo al frente: la pared de vidrio, a esto de la cara de afuera (§4.1: ~3,5 m de fondo). A un costado: el
 *  tabique de atrás de los cajeros, y la puerta del salón, a esto de él. */
const VESTIBULO_V = 3.7, COSTADO_V = 5.25, COSTADO_PUERTA = 1.85;
/** Detrás del mostrador, hasta la pared del fondo (donde trabajan los cajeros): en un lote hondo y en uno corto. */
const CAJEROS_FONDO = 2.6, CAJEROS_FONDO_CORTO = 1.9, LOTE_HONDO = 12;
/** Un cajero automático contra la pared: su medio, a esto de ella; uno de otro, a esto. */
const CAJERO_D = box('cajero').d / 2 + AIRE, CAJERO_PASO = 0.85;
/** Un escritorio con la silla del empleado contra una pared: su medio queda a esto de ella; uno de otro, a esto. Al
 *  primero del rincón lo separa del tabique de las cajas el paso a la puerta de servicio. */
const ESCRITORIO_AIRE = 1.05, ESCRITORIO_PASO = 2.4, PASO_SERVICIO = 0.9;
/** Una fila de 4 sillas de espera (sillas-espera: 2,2 × ~0,5 m) y lo que la separa de la otra y del mostrador. */
const FILA_W = 2.2, FILA_D = 0.5, FILA_PASO = 1.2, FILA_MOSTRADOR = 2.4;
/** El turnero cuelga delante de la franja de las cajas, a esto de ella, en el límite entre dos puestos: ahí no tapa
 *  ningún número (H4 de la revisión), y mira a la fila. */
const TURNERO_AIRE = 0.06;

/** El rectángulo entre dos u y dos v, en cualquier orden. */
const span = (ua: number, ub: number, va: number, vb: number): Rect => [Math.min(ua, ub), Math.min(va, vb), Math.max(ua, ub), Math.max(va, vb)];
/** Hacia dónde mira un ángulo local. */
const dir = (a: number): Vec2 => [Math.sin(a), Math.cos(a)];
const add = (p: Vec2, d: Vec2, k = 1): Vec2 => [p[0] + d[0] * k, p[1] + d[1] * k];
/** El ángulo local que mira hacia ±U. */
const miraU = (s: number): number => (s > 0 ? MIRA.U : MIRA.menosU);

/** Las caras de adentro de las paredes de afuera (la planta corrida del Kit): los lotes son casi rectángulos (se tuercen
 *  a lo sumo 1 cm), así que se toma lo más adentro de cada lado. */
interface Caras { U0: number; U1: number; V0: number; V1: number }
function caras(k: Kit): Caras {
  const us = k.inside.map((p) => p[0]).sort((a, b) => a - b), vs = k.inside.map((p) => p[1]).sort((a, b) => a - b);
  return { U0: us[1], U1: us[us.length - 2], V0: vs[1], V1: vs[vs.length - 2] };
}

// ---------- piezas ----------

/** El zócalo contra las paredes de afuera, salvo en el hueco de la puerta de la calle. */
function zocalo(k: Kit, look: Look): void {
  const r = k.inside, n = r.length;
  const mid: Vec2 = [r.reduce((s, p) => s + p[0], 0) / n, r.reduce((s, p) => s + p[1], 0) / n];
  const doors = k.openings.filter((o) => o.kind === 'puerta');
  for (let i = 0; i < n; i++) {
    const [p, q] = [r[i], r[(i + 1) % n]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const e: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    let nrm: Vec2 = [-e[1], e[0]];
    if ((mid[0] - p[0]) * nrm[0] + (mid[1] - p[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
    const along = (x: Vec2): number => (x[0] - p[0]) * e[0] + (x[1] - p[1]) * e[1];
    const across = (x: Vec2): number => Math.abs((x[0] - p[0]) * nrm[0] + (x[1] - p[1]) * nrm[1]);
    // los huecos de las puertas de esta pared (sus puntas, en la cara de afuera: a WALL_OUT de la de adentro)
    const gaps = doors.filter((o) => across(o.a) < WALL_OUT + 0.1 && across(o.c) < WALL_OUT + 0.1)
      .map((o) => [Math.min(along(o.a), along(o.c)), Math.max(along(o.a), along(o.c))]).sort((a, b) => a[0] - b[0]);
    let s = 0;
    for (const [g0, g1] of [...gaps, [len, len]]) {
      if (g0 - s > 0.05) k.block([add(p, e, s), add(p, e, g0), add(add(p, e, g0), nrm, ZOCALO_T), add(add(p, e, s), nrm, ZOCALO_T)], 0, ZOCALO_H, 'none', 'otro', { side: look, top: look });
      s = Math.max(s, g1);
    }
  }
}

/** Paneles de luz de 0,6 × 1,2 m en grilla de ~PASO m en el cielorraso de la zona, cada uno con su lámpara; los que no
 *  caen enteros en la planta, no van. */
function paneles(k: Kit, [u0, v0, u1, v1]: Rect, look: Look, power: number): void {
  const cielo = k.ceilingOver(0);
  if (u1 - u0 < 0.8 || v1 - v0 < 1.4) return;
  const nu = Math.max(1, Math.round((u1 - u0) / PASO)), nv = Math.max(1, Math.round((v1 - v0) / PASO));
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const c: Vec2 = [u0 + ((i + 0.5) * (u1 - u0)) / nu, v0 + ((j + 0.5) * (v1 - v0)) / nv];
      const r = rect([c[0] - 0.3, c[1] - 0.6, c[0] + 0.3, c[1] + 0.6]);
      if (!r.every((q) => pointInPolygon(q, k.inside))) continue;
      k.block(r, cielo - 0.005, cielo, 'none', 'otro', { bottom: look });
      k.lamp(c, cielo - 0.1, LAMP_R, power);
    }
  }
}

/** Una pieza de la pared de vidrio (un parante, un travesaño, un perfil o la franja esmerilada): de `a` a `b` a lo largo
 *  de ella, de y0 a y1 y de `ancho` de través, centrada en el vidrio. Sin colisión: el vidrio ya frena. */
function parante(k: Kit, a: Vec2, b: Vec2, y0: number, y1: number, ancho = PARANTE_D, look = ALUMINIO): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const e: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], s: Vec2 = [(-e[1] * ancho) / 2, (e[0] * ancho) / 2];
  k.block([add(a, s, -1), add(b, s, -1), add(b, s), add(a, s)], y0, y1, 'none', 'otro', { side: look, top: look, bottom: look });
}

/** La pared de vidrio de `from` a `to`, del piso al cielorraso, con su puerta a `at` m de `from` (la hoja dibujada
 *  abierta hacia la izquierda de from → to, D10), sus parantes de aluminio, el marco de la puerta, los perfiles de piso
 *  (en los paños) y de techo, y la franja esmerilada de los paños. Todo en liso: no suma mallas. */
function paredDeVidrio(k: Kit, from: Vec2, to: Vec2, at: number): void {
  const cielo = k.ceilingOver(0);
  k.wall(from, to, { t: VIDRIO_T, collide: 'glass', look: VIDRIO, gaps: [{ at, width: PUERTA_W, height: PUERTA_H, glassLeaf: true }] });
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const e: Vec2 = [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
  const p = (s: number): Vec2 => add(from, e, s);
  const [g0, g1] = [at - PUERTA_W / 2, at + PUERTA_W / 2];
  // los parantes: los dos del marco de la puerta y los de cada tramo de vidrio, parejos
  const posts = [g0 - PARANTE_W / 2, g1 + PARANTE_W / 2];
  for (const [s0, s1] of [[0, g0], [g1, len]]) {
    const m = Math.ceil((s1 - s0) / PARANTE_CADA - 1e-9);
    for (let j = 1; j < m; j++) posts.push(s0 + ((s1 - s0) * j) / m);
  }
  for (const s of posts) parante(k, p(s - PARANTE_W / 2), p(s + PARANTE_W / 2), 0, cielo);
  parante(k, p(g0), p(g1), PUERTA_H, PUERTA_H + PARANTE_W);
  // el perfil de techo, de punta a punta; el de piso y la franja esmerilada, en cada paño (no en el hueco de la puerta)
  parante(k, p(0), p(len), cielo - PERFIL, cielo, PERFIL);
  for (const [s0, s1] of [[0, g0], [g1, len]]) {
    if (s1 - s0 < 0.05) continue;
    parante(k, p(s0), p(s1), 0, PERFIL, PERFIL);
    parante(k, p(s0), p(s1), ESMERILADO_Y[0], ESMERILADO_Y[1], VIDRIO_T + 0.004, ESMERILADO);
  }
}

/** 1 si +U queda a la izquierda de quien mira hacia +V (desde el salón, a las cajas); −1 si a la derecha (un marco
 *  espejado). En three.js, quien mira hacia (dx, dz) tiene la izquierda en (dz, −dx). */
function izquierda(k: Kit): number {
  const [o, u, v] = [k.at([0, 0]), k.at([1, 0]), k.at([0, 1])];
  return (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]) > 0 ? 1 : -1;
}

/**
 * La línea de cajas: `n` puestos desde u = `desde` (una pared) hacia `hacia` (±1 sobre U), con el mostrador centrado en
 * v = `v` y mirando al salón (−V). Sobre cada uno, la mampara (con la ventanilla baja) y, en la franja de arriba
 * (iluminada), su número, de 1 a n de izquierda a derecha para quien las mira; al final de la línea, el tabique del
 * costado hasta `fondo` con la puerta de servicio. Devuelve el medio de cada puesto (por su número: el de la caja 1
 * primero) y la u del medio del tabique.
 */
function cajas(k: Kit, e: Estilo, o: { desde: number; hacia: number; n: number; v: number; fondo: number }): { puestos: Vec2[]; tabique: number } {
  const cielo = k.ceilingOver(0);
  const { desde, hacia, n, v } = o;
  const puestos: Vec2[] = [];
  // el número de cada puesto: si la línea sale de la pared hacia la izquierda, el primero (contra la pared) es el último
  const numero = (j: number): number => (hacia * izquierda(k) > 0 ? n - j : j + 1);
  const glass = (u0: number, u1: number, y0: number): void =>
    k.block(rect(span(u0, u1, v - MAMPARA_T / 2, v + MAMPARA_T / 2)), y0, MAMPARA_Y1, 'glass', 'vidrio', { side: VIDRIO });
  for (let j = 0; j < n; j++) {
    const c: Vec2 = [desde + hacia * (j + 0.5) * PUESTO.w, v];
    puestos[numero(j) - 1] = c;
    k.furniture('puesto-caja', c, 0, MIRA.menosV);
    glass(c[0] - PUESTO.w / 2, c[0] - VENTANILLA_W / 2, PUESTO.h);
    glass(c[0] - VENTANILLA_W / 2, c[0] + VENTANILLA_W / 2, PUESTO.h + VENTANILLA_H);
    glass(c[0] + VENTANILLA_W / 2, c[0] + PUESTO.w / 2, PUESTO.h);
    k.label(`CAJA ${numero(j)}`, [c[0], v - WALL_IN / 2], (MAMPARA_Y1 + cielo) / 2, [0, -1], 0.9, 0.3, e.luminoso, { glow: true });
  }
  const end = desde + hacia * n * PUESTO.w;
  // la franja de arriba, iluminada, del color de la marca: de la pared al tabique (un tabique de WALL_IN, de 2,4 m al
  // cielorraso)
  k.block(rect(span(desde - hacia * AIRE, end, v - WALL_IN / 2, v + WALL_IN / 2)), MAMPARA_Y1, cielo, 'solid', 'tabique', { side: e.franjaLuz, bottom: e.franja });
  const tabique = end + (hacia * WALL_IN) / 2;
  // el tabique del costado, del frente del mostrador a la pared del fondo, con la puerta de servicio en el medio de lo
  // que queda detrás del mostrador
  const [front, back] = [v - PUESTO.d / 2, v + PUESTO.d / 2];
  k.wall([tabique, front], [tabique, o.fondo + AIRE], { look: PARED, gaps: [{ at: back - front + (o.fondo - back) / 2, width: SERVICIO_W, height: PUERTA_H }] });
  return { puestos, tabique };
}

/** La puerta redonda del tesoro en la pared del fondo (v = `fondo`), con el medio en u: la chapa del marco (que no frena)
 *  y el cartel dibujado (drawings.ts). La marca `tesoro`, a 1 m de la pared. */
function tesoro(k: Kit, u: number, fondo: number): void {
  const d = 0.04;
  k.block(rect([u - 1.05, fondo - d, u + 1.05, fondo + 0.005]), 0.1, 2.3, 'none', 'otro', { side: ACERO, top: ACERO, bottom: ACERO });
  k.label('Tesoro', [u, fondo - d], 1.2, [0, -1], 1.9, 1.9, BOVEDA, { drawing: 'tesoro' });
  k.mark('tesoro', [u, fondo - 1], 0);
}

/** El turnero colgado en `p`, mirando a `mira`, con el número llamado que brilla en su pantalla. */
function turnero(k: Kit, p: Vec2, mira: number): void {
  k.furniture('turnero', p, 0, mira);
  k.label('C 042', add(p, dir(mira), 0.045), 2.53, dir(mira), 0.8, 0.36, TURNO, { glow: true });
}

/** Los cajeros automáticos de pie en fila, contra una pared, mirando a `mira`; el cartel de arriba (iluminado), en la
 *  pared. */
function cajeros(k: Kit, e: Estilo, at: Vec2[], mira: number): void {
  for (const p of at) k.furniture('cajero', p, 0, mira);
  const [a, b] = [at[0], at[at.length - 1]];
  const wall = add([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dir(mira), -CAJERO_D);
  k.label(e.cajeros, wall, 2.4, dir(mira), Math.max(2, Math.hypot(b[0] - a[0], b[1] - a[1]) + box('cajero').w), 0.34, e.luminoso, { glow: true });
}

// ---------- la sucursal ----------

/** Lo que ocupan los muebles del salón en planta, para no poner uno encima de otro (ni en un lote corto). */
class Planta {
  private readonly used: Rect[] = [];
  private readonly room: Rect;
  constructor(room: Rect) {
    this.room = room;
  }
  /** ¿Entra `r` en el salón sin pisar nada de lo ya puesto? Si entra, queda ocupado. */
  take(r: Rect): boolean {
    const [u0, v0, u1, v1] = this.room;
    if (r[0] < u0 - 1e-9 || r[1] < v0 - 1e-9 || r[2] > u1 + 1e-9 || r[3] > v1 + 1e-9) return false;
    if (this.used.some((x) => r[0] < x[2] && x[0] < r[2] && r[1] < x[3] && x[1] < r[3])) return false;
    this.used.push(r);
    return true;
  }
}

/** Las medidas de la sucursal en el lote: sus caras, la puerta de calle, el costado de las cajas y el fondo del salón. */
interface Medidas extends Caras {
  door: { u: number; w: number };
  /** −1: las cajas salen de la medianera de U0 (uw = U0); 1: de la de U1. `hacia` va de uw al salón (−lado). */
  lado: number; uw: number; uo: number; hacia: number;
  /** El medio del mostrador y la cara del salón contra él (v). */
  vc: number; salonFondo: number;
  /** A un costado: la u de la pared de vidrio y lo que la separa de uw. */
  ug: number; g: number;
}

/**
 * Las medidas de la sucursal, o null si el lote no es la caja de una (casi un rectángulo, los de la calle se tuercen a
 * lo sumo 1 cm, y con lugar para el vestíbulo, el salón y las cajas):
 * - `lado` es de donde salen los cajeros automáticos y las cajas. Al frente, la medianera más lejos de la puerta de calle
 *   (si la puerta queda en el medio, la del estilo); a un costado, la más cerca.
 * - La puerta de la calle es la primera puerta, y tiene que estar en el frente (v ≈ 0): si no, no hay sucursal.
 * - A un costado, la pared de vidrio corre a lo largo de V sobre el primer parante de la vidriera pasando la puerta (lo
 *   macizo entre dos aberturas de la arista de la puerta), a más de 0,5 m de ella; si no hay, a 0,8 m de la puerta.
 */
function medir(k: Kit, e: Estilo): Medidas | null {
  const c = caras(k);
  const { U0, U1, V0, V1 } = c;
  const calle = k.openings.find((o) => o.kind === 'puerta');
  if (!calle || Math.abs(calle.a[1]) > 0.05 || Math.abs(calle.c[1]) > 0.05) return null;
  if (!(U1 - U0 > 0 && V1 - V0 > 0) || polygonArea(k.inside) < 0.98 * (U1 - U0) * (V1 - V0)) return null;
  const door = { u: (calle.a[0] + calle.c[0]) / 2, w: Math.abs(calle.c[0] - calle.a[0]) };
  const [dU0, dU1] = [door.u - U0, U1 - door.u];
  const lado = e.vestibulo === 'costado' ? (dU0 <= dU1 ? -1 : 1) : Math.abs(dU0 - dU1) < 1 ? e.lado : dU0 > dU1 ? -1 : 1;
  const [uw, uo] = lado < 0 ? [U0, U1] : [U1, U0];
  const hacia = -lado;
  const vc = V1 - (V1 - V0 >= LOTE_HONDO ? CAJEROS_FONDO : CAJEROS_FONDO_CORTO) - PUESTO.d / 2;
  const salonFondo = vc - PUESTO.d / 2;
  if (U1 - U0 < WALL_IN + 1.2 + PUESTO.w + 1.2) return null;
  if (e.vestibulo === 'frente') return salonFondo - VESTIBULO_V < 2.4 ? null : { ...c, door, lado, uw, uo, hacia, vc, salonFondo, ug: uw, g: 0 };
  const far = Math.max(hacia * (calle.a[0] - uw), hacia * (calle.c[0] - uw));
  const cuts = k.openings.filter((o) => o.edge === calle.edge)
    .map((o) => [hacia * (o.a[0] - uw), hacia * (o.c[0] - uw)].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  let g = far + 0.8;
  for (let j = 0; j + 1 < cuts.length; j++) {
    const m = (cuts[j][1] + cuts[j + 1][0]) / 2;
    if (cuts[j + 1][0] > cuts[j][1] && m > far + 0.5) {
      g = Math.min(g, m);
      break;
    }
  }
  const ug = uw + hacia * g;
  if (salonFondo - COSTADO_V < 3 || Math.abs(uo - ug) < 3) return null;
  return { ...c, door, lado, uw, uo, hacia, vc, salonFondo, ug, g };
}

/**
 * La sucursal en el lote del Kit, con sus medidas:
 * - La línea de cajas va al fondo, a CAJEROS_FONDO de la pared; detrás del tabique del costado queda el rincón de los
 *   escritorios, abierto al salón. Los escritorios que no entran ahí van contra la otra medianera, en el salón.
 * - La fila de espera mira a las cajas, con el turnero colgado entre la fila y el mostrador.
 */
function sucursal(k: Kit, e: Estilo, m: Medidas): void {
  const { U0, U1, V0, V1, door, lado, uw, uo, hacia, vc, salonFondo, ug, g } = m;
  const at = (d: number): number => uw + hacia * d;

  // el vestíbulo: la pared de vidrio con su puerta, los cajeros y los carteles
  let salonFrente: number, salonU: number, vestibulo: Vec2, puerta: Vec2;
  /** Hacia dónde mira la vista del vestíbulo, si no es al medio del salón (a un costado, el tabique lo tapa). */
  let mira: Vec2 | undefined;
  if (e.vestibulo === 'frente') {
    const pu = Math.min(U1 - 0.9, Math.max(U0 + 0.9, (door.u + uo) / 2));
    paredDeVidrio(k, [U0 - AIRE, VESTIBULO_V], [U1 + AIRE, VESTIBULO_V], pu - (U0 - AIRE));
    const atm: Vec2[] = [];
    for (let v = V0 + 0.8; v + box('cajero').w / 2 <= VESTIBULO_V - 0.4 && atm.length < 3; v += CAJERO_PASO) atm.push([at(CAJERO_D), v]);
    cajeros(k, e, atm, miraU(hacia));
    k.label(e.nombre, [uo, (V0 + VESTIBULO_V) / 2], 1.9, [lado, 0], 2.4, 0.55, e.luminoso, { glow: true });
    paneles(k, [U0, V0, U1, VESTIBULO_V - VIDRIO_T], PANEL_FRIO, LAMP_P_FRIO);
    paneles(k, [U0, VESTIBULO_V + VIDRIO_T, U1, salonFondo], PANEL, LAMP_P);
    [salonFrente, salonU] = [VESTIBULO_V + 0.6, (U0 + U1) / 2];
    vestibulo = [door.u, (V0 + VESTIBULO_V) / 2 + 0.2];
    puerta = [pu, VESTIBULO_V];
  } else {
    // de atrás hacia la calle si las cajas salen de U0 (la hoja abre hacia +U, al salón), y al revés si salen de U1
    const [va, vb] = hacia > 0 ? [COSTADO_V, V0 - AIRE] : [V0 - AIRE, COSTADO_V];
    paredDeVidrio(k, [ug, va], [ug, vb], Math.abs(va - (COSTADO_V - COSTADO_PUERTA)));
    k.wall([uw - hacia * AIRE, COSTADO_V], [ug + (hacia * VIDRIO_T) / 2, COSTADO_V], { look: PARED });
    const atm: Vec2[] = [];
    for (let d = 0.75; d + box('cajero').w / 2 <= g - 0.15 && atm.length < 3; d += CAJERO_PASO) atm.push([at(d), COSTADO_V - WALL_IN / 2 - CAJERO_D]);
    cajeros(k, e, atm, MIRA.menosV);
    k.label(e.nombre, [uw, (V0 + COSTADO_V) / 2], 1.9, [hacia, 0], 2.6, 0.6, e.luminoso, { glow: true });
    paneles(k, span(uw, ug, V0, COSTADO_V), PANEL_FRIO, LAMP_P_FRIO);
    paneles(k, span(ug, uo, V0, COSTADO_V), PANEL, LAMP_P);
    paneles(k, [U0, COSTADO_V, U1, salonFondo], PANEL, LAMP_P);
    [salonFrente, salonU] = [COSTADO_V + 0.6, hacia > 0 ? Math.max((U0 + U1) / 2, ug + 0.8) : Math.min((U0 + U1) / 2, ug - 0.8)];
    vestibulo = [door.u, Math.min(2, COSTADO_V - 1.5)];
    puerta = [ug, COSTADO_V - COSTADO_PUERTA];
    mira = [ug + hacia * 3, puerta[1]];
    // del otro lado del vidrio, junto a la vidriera, una fila de espera más
    const w = new Planta(span(ug, uo, V0 + 0.4, COSTADO_V));
    const p: Vec2 = [(ug + uo) / 2, V0 + 2.4];
    if (w.take([p[0] - FILA_W / 2 - 0.3, p[1] - FILA_D, p[0] + FILA_W / 2 + 0.3, p[1] + FILA_D])) k.furniture('sillas-espera', p, 0, MIRA.V);
  }

  // las cajas al fondo, desde el mismo costado, y el tesoro detrás
  const n = Math.min(e.cajas, Math.floor((U1 - U0 - WALL_IN - 1.2) / PUESTO.w));
  const { puestos, tabique } = cajas(k, e, { desde: uw, hacia, n, v: vc, fondo: V1 });
  tesoro(k, (uw + tabique) / 2, V1);
  paneles(k, span(uw, tabique, vc + PUESTO.d / 2, V1), PANEL, LAMP_P);
  paneles(k, span(tabique, uo, salonFondo, V1), PANEL, LAMP_P);

  // los escritorios: en el rincón, detrás del tabique (dejando el paso a la puerta de servicio), y los que no entran,
  // contra la otra medianera en el salón; el nombre de la marca, en la pared del fondo del rincón
  const rincon = Math.abs(uo - tabique) - WALL_IN / 2;
  const salon = new Planta([U0, salonFrente, U1, salonFondo]);
  let desks = 0;
  for (let d = PASO_SERVICIO + box('escritorio').w / 2; desks < 2 && d + box('escritorio').w / 2 + 0.1 <= rincon; d += ESCRITORIO_PASO, desks++) {
    k.furniture('escritorio', [tabique + hacia * (WALL_IN / 2 + d), V1 - ESCRITORIO_AIRE], 0, MIRA.menosV);
  }
  k.label(e.nombre, [(tabique + uo) / 2 + (hacia * WALL_IN) / 4, V1], 2.3, [0, -1], 2.4, 0.5, e.luminoso, { glow: true });
  for (let v = salonFondo - 1.4; desks < 2 && v - 0.8 >= salonFrente; v -= ESCRITORIO_PASO) {
    // contra la pared, la silla del empleado; hacia el salón, la del cliente
    const p: Vec2 = [uo - hacia * ESCRITORIO_AIRE, v];
    if (!salon.take(span(uo, uo - hacia * 2.2, v - 0.8, v + 0.8))) continue;
    k.furniture('escritorio', p, 0, miraU(-hacia));
    desks++;
  }

  // la fila de espera frente a las cajas, mirándolas; el turnero, colgado delante de la franja en el límite entre dos
  // puestos (el más cerca del medio de la fila; con un solo puesto, pasando el tabique), mirando a la fila
  const ur = Math.min(U1 - FILA_W / 2 - 0.3, Math.max(U0 + FILA_W / 2 + 0.3, (uw + tabique) / 2));
  for (let j = 0; j < 2; j++) {
    const p: Vec2 = [ur, salonFondo - FILA_MOSTRADOR - j * FILA_PASO];
    if (salon.take([p[0] - FILA_W / 2, p[1] - FILA_D, p[0] + FILA_W / 2, p[1] + FILA_D])) k.furniture('sillas-espera', p, 0, MIRA.V);
  }
  const limites = [...Array(Math.max(0, n - 1)).keys()].map((j) => uw + hacia * (j + 1) * PUESTO.w);
  const ut = limites.length ? limites.reduce((a, x) => (Math.abs(x - ur) < Math.abs(a - ur) ? x : a)) : tabique + hacia * 0.6;
  turnero(k, [ut, vc - WALL_IN / 2 - TURNERO_AIRE - 0.04], MIRA.menosV);

  // las marcas (las cajas: donde se sienta el cajero de la caja 2) y las dos vistas
  const caja = puestos[Math.min(1, puestos.length - 1)];
  const centro: Vec2 = [salonU, (salonFrente - 0.6 + salonFondo) / 2];
  k.mark('vestibulo', vestibulo, 0);
  k.mark('puerta-salon', puerta, 0);
  k.mark('salon', centro, 0);
  k.mark('cajas', [caja[0], caja[1] + 0.8], 0);
  const toward = (a: Vec2, b: Vec2): number => Math.atan2(b[0] - a[0], b[1] - a[1]);
  k.view('vestibulo-salon', vestibulo, 0, toward(vestibulo, mira ?? centro));
  const lejos: Vec2 = [centro[0], centro[1] - 2];
  k.view('salon-cajas', lejos, 0, toward(lejos, caja));
}

/**
 * El plan de un banco: la cáscara (solo la planta baja pública), el zócalo y su sucursal. En un lote que no es la caja
 * de una sucursal (los lotes de prueba de los tests de mapgen: un triángulo, uno con una esquina cortada) queda el local
 * vacío, con su zócalo y los paneles que entran.
 *
 * Ese respaldo no avisa: build:map sigue con 0 avisos. La guarda es tests/shared/interiors/bancos.test.ts, que lee el
 * mapa real: si un banco cae al local vacío le faltan las marcas, y si pierde muebles (una fila, un escritorio, una
 * caja) lo dicen sus cuentas.
 */
export function bancoPlan(marca: Marca): InteriorPlan {
  return (k) => {
    const e = ESTILOS[marca];
    k.shell({ publicFloors: 1, wall: PARED, floor: PISO, ceiling: TECHO });
    zocalo(k, e.zocalo);
    const m = medir(k, e);
    if (m) sucursal(k, e, m);
    else {
      const us = k.inside.map((p) => p[0]), vs = k.inside.map((p) => p[1]);
      paneles(k, [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)], PANEL, LAMP_P);
    }
    return k.done(AMBIENT);
  };
}
