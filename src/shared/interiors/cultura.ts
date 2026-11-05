// La Casa de la Cultura (§4.4), sobre el lote del mapa (20,5 × 45 m, 13,4 m de alto, 4 pisos): los tres de abajo son
// públicos alrededor del atrio y el 4 queda cerrado, atravesado por el hueco del atrio hasta el techo (D13).
// - De la calle se entra al hall, de lado a lado del frente, con la mesa de informes. Enfrente se abre el atrio: ~10 × 20
//   m, abierto hasta el lucernario a dos aguas de vidrio con su estructura blanca; debajo cuelga el plafón, un disco de
//   colores (diseño propio, abstracto: no copia el original), y en el piso, una guarda redonda.
// - Alrededor del atrio, los balcones de los pisos 1 y 2 con las esquinas curvas (tramos de ≤ 0,5 m), las columnas
//   blancas macizas con su capitel y las barandas de vidrio con pasamanos negro; en las curvas, reja negra (D4: todas
//   las barandas son de clase glass, la reja solo se ve).
// - La escalera central (3,5 m) sube del atrio al balcón del fondo del piso 1. En la realidad la central baja a un nivel
//   inferior; como no hay subsuelos (§1), acá sube. Del piso 1 al 2, la del costado, contra la pared de la derecha.
// - En la planta baja, a los costados del atrio, dos salas de muestras (paneles sueltos, cuadros abstractos y tarimas
//   bajas) detrás de la galería de las columnas; al fondo, el foyer y el auditorio de doble altura, con las filas de
//   butacas (se cruzan caminando) y el escenario, al que se sube por los escalones de los costados.
// - Arriba del auditorio, en el piso 2, la Sala 3. En los balcones, más cuadros y paneles; el frente de los pisos 1 y 2
//   es un ventanal (por adentro, la luz de día de su vidrio).
// - Lo inclinado (el vidrio y la estructura del lucernario, el pasamanos de las escaleras) se dibuja en pendiente, con
//   paños (Kit.pane); lo que se pisa o frena va aparte, en bloques escalonados (D13).
// Todo va en el marco local del Kit: U a lo largo del frente y V hacia adentro (0 mira a +V y π/2 a +U). Si el edificio
// no es el del mapa (si la planta no da para el atrio, las salas y el auditorio), queda la caja de un piso.
import { pointInPolygon } from '../geo.ts';
import type { Vec2, Vec3 } from '../geo.ts';
import type { SignLook } from '../mapdata.ts';
import type { InteriorPlan } from './index.ts';
import { RAIL_H, TREAD, WALL_IN } from './kit.ts';
import type { Kit } from './kit.ts';
import { LEVEL_H } from './openings.ts';
import { add, MIRA, rect } from './plan-util.ts';
import type { Rect } from './plan-util.ts';
import type { Collide, Look, Role } from './types.ts';

// ---------- materiales ----------

/** Paredes y cielorrasos blancos; el porcelanato blanco de la planta baja y el crema de los balcones. */
const PARED: Look = { mat: 'liso', color: '#f1eee7' };
const TECHO: Look = { mat: 'liso', color: '#f5f3ee' };
const PISO_PB: Look = { mat: 'porcelanato', color: '#efede8' };
const PISO_ALTO: Look = { mat: 'porcelanato', color: '#e6dcc6' };
/** Las guardas crema del porcelanato de la planta baja (el mismo crema de los balcones). */
const CREMA: Look = { mat: 'porcelanato', color: '#e6dcc6' };
/** La guarda redonda del piso del atrio, debajo del plafón, y su filete. */
const GUARDA: Look = { mat: 'porcelanato', color: '#d8c6a0' };
const FILETE: Look = { mat: 'porcelanato', color: '#8c7a5c' };
const VIDRIO: Look = { mat: 'vidrio', color: '#b8d0d6' };
/** Las columnas, de revoque blanco. */
const COLUMNA: Look = { mat: 'liso', color: '#f4f2ec' };
/** El pasamanos, la reja y los parantes, negros. */
const NEGRO: Look = { mat: 'liso', color: '#1b1b1c' };
/** La estructura del lucernario, blanca, al sol: brilla (sin hornear), como la vereda. */
const ESTRUCTURA: Look = { mat: 'luz', color: '#d9d9d4' };
/** El escenario: el piso de madera, el frente y los costados oscuros; el piso del auditorio, de madera clara. */
const ESCENARIO: Look = { mat: 'madera', color: '#6e4e34' };
const ESCENARIO_FRENTE: Look = { mat: 'liso', color: '#2a2422' };
const PISO_AUDITORIO: Look = { mat: 'madera', color: '#9a7652' };
/** El telón (rojo) y el fondo del escenario, gris pizarra (uno negro, sin luz de función, se ve como un agujero). */
const TELON: Look = { mat: 'tela', color: '#9c1c22' };
const FONDO: Look = { mat: 'tela', color: '#5a5d70' };
/** Las tarimas de las muestras y el pedestal de la escultura, blancos; la escultura, de bronce. */
const TARIMA: Look = { mat: 'liso', color: '#e9e6df' };
const BRONCE: Look = { mat: 'liso', color: '#7a5a3a' };
/** Los paneles de luz del cielorraso (brillan: van sin hornear). */
const PANEL_LUZ: Look = { mat: 'luz', color: '#dedcd4' };
/** El vidrio del ventanal del frente visto de adentro: luz de día por un vidrio con reflejo, un blanco azulado que no
 *  llega al blanco de los paneles de luz (sin hornear: a la exposición de adentro se ve ≈ (214, 226, 234)). */
const VENTANAL: Look = { mat: 'luz', color: '#83a1ba' };

/** El plafón: fondo crema y el aro oscuro del borde (drawings.ts pinta el resto). */
const PLAFON_LOOK: SignLook = { fondo: '#efe6d2', letra: '#3a3530', marco: '#3a3530', fuente: 'sans' };
/** Los cuadros: el marco negro (el resto lo pinta drawings.ts). */
const CUADRO_LOOK: SignLook = { fondo: '#f3f1ec', letra: '#1b1b1c', marco: '#1b1b1c', fuente: 'sans' };
/** Los nombres de las salas, en gris oscuro sobre la pared. */
const ROTULO: SignLook = { fondo: '#f1eee7', letra: '#3c3c3e', marco: '#f1eee7', fuente: 'sans' };

/** La luz pareja del lugar; el resto lo ponen el lucernario (el atrio), la vidriera y los paneles. */
const AMBIENT = 0.44;
/** Lámpara de cada panel del cielorraso: alcance (m) y fuerza; en el auditorio y el escenario, más alcance. */
const LAMP_R = 6.5, LAMP_P = 0.5, LAMP_R_ALTO = 8, LAMP_P_ALTO = 0.55;
/** Los reflectores del escenario (colgados de la vara, 3,4 m arriba de las tablas). */
const LAMP_R_ESCENARIO = 6, LAMP_P_ESCENARIO = 0.85;
/** Lado (m) de la grilla de los paneles de luz. */
const PASO = 4;

// ---------- medidas ----------

/** El atrio: ancho (U) y fondo (V), desde el frente; el radio de sus esquinas y en cuántos tramos va cada una. */
const ATRIO_W = 10, ATRIO_V0 = 6.5, ATRIO_V1 = 26.5, ATRIO_R = 1.5, ATRIO_SEG = 6;
/** Las columnas: a esto del borde del hueco; base cuadrada, fuste de 12 lados, equino y ábaco del capitel. */
const COL_AIRE = 0.25, COL_LADOS = 12, BASE = { half: 0.2, h: 0.1 }, FUSTE_R = 0.17, EQUINO = { r: 0.22, h: 0.12 }, ABACO = { half: 0.24, h: 0.18 };
/** La reja de las curvas: barrotes de 2 cm cada ≤ 0,12 m, el planchuelón de abajo y el pasamanos (de 7 cm). */
const BARROTE = 0.02, BARROTE_PASO = 0.12, PASAMANOS = { w: 0.07, y0: 0.97, y1: 1.03 }, PLANCHUELA = { y0: 0.05, y1: 0.09, w: 0.03 };
/** Los parantes negros de los paños de vidrio de los balcones: a lo sumo cada tanto (m). */
const PARANTE_CADA = 2.6, PARANTE = 0.04;
/** El espesor de una baranda (el de Kit.railing). */
const RAIL_T = 0.05;
/** La escalera central (del atrio al balcón del fondo del piso 1) y la del costado (del 1 al 2): anchos (m). */
const CENTRAL_W = 3.5, COSTADO_W = 1.5;
/** Las salas de los costados: el tabique, a esto de la pared de afuera (su medio). */
const SALA_W = 3.2;
/** El auditorio: su pared (el medio), el escenario (de dónde arranca y su alto), los escalones de los costados (u del
 *  medio, ancho) y las filas de butacas (la primera, el paso entre filas y entre butacas). */
const AUDITORIO_V = 29, ESCENARIO_V = 40.5, ESCENARIO_H = 0.8, ESCALON_W = 1.2, FILAS = 9, FILA_V0 = 31, FILA_PASO = 0.9, BUTACA_W = 0.55;
/** El plafón cuelga 2,6 m debajo del lucernario (sus cables, models.ts) y mide 7 m. */
const PLAFON_BAJA = 2.6, PLAFON_D = 7;
/** El lucernario: franjas de 0,2 m a lo largo del atrio, la cumbrera 1,6 m arriba del techo; el cordón de 0,15 m. */
const FRANJA = 0.2, CUMBRERA = 1.6, CORDON = { w: 0.15, h: 0.15 };
/** Los cabios blancos del lucernario (6 por agua, del borde a la cumbrera), las correas (a lo largo) y su sección; la
 *  estructura queda apenas debajo del vidrio. */
const CABIOS = 6, CABIO_W = 0.08, CABIO_H = 0.12, CORREA_W = 0.08, CORREA_H = 0.1, BAJO_VIDRIO = 0.004;
/** El ventanal del frente: los montantes, a lo sumo cada tanto (m), y la sección de los perfiles (de frente y de fondo);
 *  el travesaño, a 1,0 m del piso. */
const MONTANTE_CADA = 1.5, PERFIL = { w: 0.05, d: 0.06 }, TRAVESAÑO = 1.0;
/** Las guardas crema de la planta baja: la de la galería, centrada en la línea de las columnas, y el borde del hall, a
 *  tanto de las paredes. */
const GUARDA_GALERIA = 0.6, GUARDA_HALL = { w: 0.3, aire: 0.6 };
/** Puertas de adentro: ancho y alto. */
const PUERTA = { w: 1.6, h: 2.3 };

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
/** Polígono regular de `n` lados alrededor de `c`, de radio `r` (al vértice), girado `rot`. */
const ngon = (c: Vec2, r: number, n: number, rot = 0): Vec2[] =>
  Array.from({ length: n }, (_, k): Vec2 => [c[0] + r * Math.cos(rot + (2 * Math.PI * k) / n), c[1] + r * Math.sin(rot + (2 * Math.PI * k) / n)]);

/** Las caras de adentro de las paredes de afuera (la planta corrida del Kit): lo más adentro de cada lado. */
interface Caras { U0: number; U1: number; V0: number; V1: number }
function caras(k: Kit): Caras {
  const us = k.inside.map((p) => p[0]).sort((a, b) => a - b), vs = k.inside.map((p) => p[1]).sort((a, b) => a - b);
  return { U0: us[1], U1: us[us.length - 2], V0: vs[1], V1: vs[vs.length - 2] };
}

/** Un rectángulo de esquinas redondeadas (radio r, en `seg` tramos cada una), antihorario en el marco local: las cuatro
 *  curvas (de la de U1·V0 a la de U0·V0), cada una con sus seg + 1 puntos. */
function redondeado([u0, v0, u1, v1]: Rect, r: number, seg: number): Vec2[][] {
  const esquinas: [Vec2, number][] = [[[u1 - r, v0 + r], -Math.PI / 2], [[u1 - r, v1 - r], 0], [[u0 + r, v1 - r], Math.PI / 2], [[u0 + r, v0 + r], Math.PI]];
  return esquinas.map(([c, a0]) => Array.from({ length: seg + 1 }, (_, j): Vec2 => {
    const a = a0 + (Math.PI / 2) * (j / seg);
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  }));
}

/** Una pieza recta de `p` a `q` de `ancho` de través (alargada medio ancho en cada punta: cierra las esquinas). */
function tramo(k: Kit, p: Vec2, q: Vec2, y0: number, y1: number, ancho: number, collide: Collide, role: Role, look: Look | null): void {
  const l = len(sub(q, p));
  if (l < 1e-6) return;
  const e: Vec2 = [(q[0] - p[0]) / l, (q[1] - p[1]) / l], s: Vec2 = [-e[1], e[0]], h = ancho / 2;
  const [a, c] = [add(p, e, -h), add(q, e, h)];
  k.block([add(a, s, -h), add(c, s, -h), add(c, s, h), add(a, s, h)], y0, y1, collide, role, look ? { side: look, top: look, bottom: look } : {});
}

/** El punto a `s` m a lo largo de la poligonal `path`. */
function sobre(path: Vec2[], s: number): Vec2 {
  let rest = s;
  for (let j = 0; j + 1 < path.length; j++) {
    const d = sub(path[j + 1], path[j]), l = len(d);
    if (rest <= l || j + 2 === path.length) return add(path[j], d, Math.min(1, rest / l));
    rest -= l;
  }
  return path[path.length - 1];
}
const largo = (path: Vec2[]): number => path.slice(1).reduce((t, p, j) => t + len(sub(p, path[j])), 0);

/** Las caras `caras` de una caja que solo se dibuja (paños), de planta [u0, v0, u1, v1] (marco local) entre y0 e y1: las
 *  de los costados por el lado que miran (u0 mira a −U, v1 a +V…), el tope y el fondo. */
type Cara = 'u0' | 'u1' | 'v0' | 'v1' | 'tope' | 'fondo';
function caja(k: Kit, [u0, v0, u1, v1]: Rect, y0: number, y1: number, look: Look, caras: Cara[]): void {
  const quads: Record<Cara, [Vec3[], Vec3]> = {
    u0: [[[u0, y0, v0], [u0, y0, v1], [u0, y1, v1], [u0, y1, v0]], [-1, 0, 0]],
    u1: [[[u1, y0, v0], [u1, y1, v0], [u1, y1, v1], [u1, y0, v1]], [1, 0, 0]],
    v0: [[[u0, y0, v0], [u0, y1, v0], [u1, y1, v0], [u1, y0, v0]], [0, 0, -1]],
    v1: [[[u0, y0, v1], [u1, y0, v1], [u1, y1, v1], [u0, y1, v1]], [0, 0, 1]],
    tope: [[[u0, y1, v0], [u0, y1, v1], [u1, y1, v1], [u1, y1, v0]], [0, 1, 0]],
    fondo: [[[u0, y0, v0], [u1, y0, v0], [u1, y0, v1], [u0, y0, v1]], [0, -1, 0]],
  };
  for (const cara of caras) k.pane(quads[cara][0], quads[cara][1], look);
}

// ---------- piezas ----------

/** Una columna blanca de piso a cielorraso en `c`: base cuadrada, fuste de 12 lados y el capitel (equino y ábaco). */
function columna(k: Kit, c: Vec2, y: number, techo: number): void {
  // sin las caras que quedan tapadas: la de abajo de la base (en el piso), las de las juntas y la de arriba del ábaco
  // (contra el cielorraso)
  const cuadrado = (h: number): Vec2[] => rect([c[0] - h, c[1] - h, c[0] + h, c[1] + h]);
  const fuste = techo - ABACO.h - EQUINO.h;
  k.block(cuadrado(BASE.half), y, y + BASE.h, 'solid', 'otro', { side: COLUMNA, top: COLUMNA });
  k.block(ngon(c, FUSTE_R, COL_LADOS), y + BASE.h, fuste, 'solid', 'otro', { side: COLUMNA });
  k.block(ngon(c, EQUINO.r, COL_LADOS), fuste, fuste + EQUINO.h, 'solid', 'otro', { side: COLUMNA, bottom: COLUMNA });
  k.block(cuadrado(ABACO.half), fuste + EQUINO.h, techo, 'solid', 'otro', { side: COLUMNA, bottom: COLUMNA });
}

/** El pasamanos negro sobre una baranda de `p` a `q` que arranca en y. */
const pasamanos = (k: Kit, p: Vec2, q: Vec2, y: number): void => tramo(k, p, q, y + PASAMANOS.y0, y + PASAMANOS.y1, PASAMANOS.w, 'none', 'otro', NEGRO);

/** Un paño recto de la baranda de un balcón: vidrio (clase glass), los parantes negros y el pasamanos. */
function pañoDeVidrio(k: Kit, p: Vec2, q: Vec2, level: number): void {
  const y = level * LEVEL_H;
  k.railing([p, q], level, VIDRIO);
  pasamanos(k, p, q, y);
  const l = len(sub(q, p)), n = Math.max(1, Math.ceil(l / PARANTE_CADA - 1e-9));
  for (let j = 0; j <= n; j++) {
    const m = add(p, sub(q, p), j / n), h = PARANTE / 2;
    k.block(rect([m[0] - h, m[1] - h, m[0] + h, m[1] + h]), y, y + PASAMANOS.y0, 'none', 'otro', { side: NEGRO });
  }
}

/** La curva de la baranda de un balcón: frena como las demás (un tramo glass que no se ve, D4) y se ve la reja negra:
 *  los barrotes, el planchuelón de abajo y el pasamanos. */
function curvaDeReja(k: Kit, arco: Vec2[], level: number): void {
  const y = level * LEVEL_H;
  for (let j = 0; j + 1 < arco.length; j++) {
    tramo(k, arco[j], arco[j + 1], y, y + RAIL_H, RAIL_T, 'glass', 'baranda', null);
    pasamanos(k, arco[j], arco[j + 1], y);
    tramo(k, arco[j], arco[j + 1], y + PLANCHUELA.y0, y + PLANCHUELA.y1, PLANCHUELA.w, 'none', 'otro', NEGRO);
  }
  const l = largo(arco), n = Math.ceil(l / BARROTE_PASO - 1e-9), h = BARROTE / 2;
  for (let j = 1; j < n; j++) {
    const m = sobre(arco, (l * j) / n);
    k.block(rect([m[0] - h, m[1] - h, m[0] + h, m[1] + h]), y, y + PASAMANOS.y0, 'none', 'otro', { side: NEGRO });
  }
}

/** Un cuadro abstracto colgado en `p` (marco local), a la altura `y`, mirando a `normal`. drawings.ts lo pinta con el
 *  texto de semilla, que sale del lugar: agregar o sacar un cuadro no cambia los demás. (Se exporta para los tests.) */
export function cuadro(k: Kit, p: Vec2, y: number, normal: Vec2, w = 1.3, h = 1.0): void {
  k.label(`Cuadro ${y.toFixed(2)} · ${p[0].toFixed(2)}, ${p[1].toFixed(2)}`, p, y, normal, w, h, CUADRO_LOOK, { drawing: 'cuadro' });
}

/** Un panel de muestra en `c` mirando a ±`yaw` con un cuadro en cada cara. */
function panel(k: Kit, c: Vec2, y: number, yaw: number): void {
  k.furniture('panel-muestra', c, y, yaw);
  const n: Vec2 = [Math.sin(yaw), Math.cos(yaw)];
  for (const s of [1, -1]) cuadro(k, add(c, n, s * 0.06), y + 1.35, [n[0] * s, n[1] * s], 1.0, 0.8);
}

/** Paneles de luz de 0,6 × 0,6 m en grilla de ~PASO m en el cielorraso `techo` de la zona, cada uno con su lámpara; los
 *  que no caen enteros en la planta o caen sobre un hueco (`huecos`), no van. */
function luces(k: Kit, [u0, v0, u1, v1]: Rect, techo: number, huecos: Vec2[][], r = LAMP_R, p = LAMP_P): void {
  const nu = Math.max(1, Math.round((u1 - u0) / PASO)), nv = Math.max(1, Math.round((v1 - v0) / PASO));
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const c: Vec2 = [u0 + ((i + 0.5) * (u1 - u0)) / nu, v0 + ((j + 0.5) * (v1 - v0)) / nv];
      const q = rect([c[0] - 0.3, c[1] - 0.3, c[0] + 0.3, c[1] + 0.3]);
      if (!q.every((x) => pointInPolygon(x, k.inside)) || [...q, c].some((x) => huecos.some((h) => pointInPolygon(x, h)))) continue;
      k.block(q, techo - 0.005, techo, 'none', 'otro', { bottom: PANEL_LUZ });
      k.lamp(c, techo - 0.1, r, p);
    }
  }
}

/** El lucernario a dos aguas sobre el hueco del techo (D13), arriba de `H`. Lo que se pisa son franjas de vidrio de
 *  FRANJA m a lo largo del atrio (clase glass, cada una al alto de las aguas en su medio), que no se dibujan: lo que se
 *  ve es el vidrio en pendiente, las dos aguas y los dos tímpanos (de los dos lados), y debajo la estructura blanca,
 *  también en pendiente: los cabios de cada agua, las correas y la cumbrera. Alrededor, el cordón, que se pisa. Todo
 *  `sky`. Lo que se ve y lo que se pisa difieren a lo sumo media franja de pendiente (0,03 m). */
function lucernario(k: Kit, [u0, v0, u1, v1]: Rect, H: number): void {
  const n = Math.round((u1 - u0) / FRANJA), mid = (u0 + u1) / 2, half = (u1 - u0) / 2, top = H + CUMBRERA;
  const aguas = (u: number): number => H + CUMBRERA * (1 - Math.abs(u - mid) / half);
  for (let s = 0; s < n; s++) {
    const [a, b] = [u0 + s * FRANJA, s === n - 1 ? u1 : u0 + (s + 1) * FRANJA];
    k.block(rect([a, v0, b, v1]), H, aguas((a + b) / 2), 'glass', 'vidrio', {}, { sky: true });
  }
  const o = { back: true, sky: true } as const;
  k.pane([[u0, H, v0], [mid, top, v0], [mid, top, v1], [u0, H, v1]], [-CUMBRERA, half, 0], VIDRIO, o);
  k.pane([[mid, top, v0], [u1, H, v0], [u1, H, v1], [mid, top, v1]], [CUMBRERA, half, 0], VIDRIO, o);
  k.pane([[u0, H, v0], [u1, H, v0], [mid, top, v0]], [0, 0, -1], VIDRIO, o);
  k.pane([[u0, H, v1], [mid, top, v1], [u1, H, v1]], [0, 0, 1], VIDRIO, o);
  // los cabios, del borde del hueco a la cumbrera, con su cara de arriba pegada al vidrio
  const sky = { sky: true } as const, y = (u: number): number => aguas(u) - BAJO_VIDRIO;
  for (let j = 0; j < CABIOS; j++) {
    const v = v0 + CABIO_W / 2 + 0.01 + ((v1 - v0 - CABIO_W - 0.02) * j) / (CABIOS - 1);
    k.bar([u0, y(u0), v], [mid, y(mid), v], CABIO_W, CABIO_H, ESTRUCTURA, sky);
    k.bar([mid, y(mid), v], [u1, y(u1), v], CABIO_W, CABIO_H, ESTRUCTURA, sky);
  }
  // las correas, a lo largo, a un sexto y a un tercio de cada borde: su tope es plano y el vidrio sube de través, así
  // que van un poco más abajo; la cumbrera, en el medio, más ancha
  for (const f of [0.17, 0.33, 0.67, 0.83]) {
    const u = u0 + (u1 - u0) * f, yc = aguas(u) - BAJO_VIDRIO - (CORREA_W / 2) * (CUMBRERA / half) - 0.004;
    k.bar([u, yc, v0], [u, yc, v1], CORREA_W, CORREA_H, ESTRUCTURA, sky);
  }
  const yr = top - BAJO_VIDRIO - CORREA_W * (CUMBRERA / half) - 0.004;
  k.bar([mid, yr, v0], [mid, yr, v1], 2 * CORREA_W, CABIO_H, ESTRUCTURA, sky);
  // el cordón alrededor del hueco, sobre el techo: se pisa (un escalón). Es `out` (T11b, H2 de su revisión): sólido y a
  // cielo abierto, se ve desde los techos de lejos, con el edificio
  const w = CORDON.w;
  for (const r of [[u0 - w, v0 - w, u0, v1 + w], [u1, v0 - w, u1 + w, v1 + w], [u0, v0 - w, u1, v0], [u0, v1, u1, v1 + w]] as Rect[]) {
    k.block(rect(r), H, H + CORDON.h, 'solid', 'otro', { top: ESTRUCTURA, side: ESTRUCTURA }, { sky: true, out: true });
  }
}

/** El ventanal del frente de un piso de arriba, de `y` al cielorraso (H2). En la realidad el frente de los pisos 1 y 2
 *  es un muro cortina con un bow-window; acá no tiene aberturas (la foto de la fachada lo dibuja de afuera), así que por
 *  adentro se ve su vidrio como luz de día: un paño de luz contra la cara de adentro del frente, de lado a lado, con los
 *  montantes negros cada ≤ MONTANTE_CADA, el travesaño y los perfiles de piso y de techo. Solo dibujo. */
function ventanal(k: Kit, c: Caras, y: number, cielo: number): void {
  const v = c.V0 + 0.01, f = v + PERFIL.d; // el vidrio, a 1 cm de la pared; el frente de los perfiles
  k.pane([[c.U0, y, v], [c.U1, y, v], [c.U1, cielo, v], [c.U0, cielo, v]], [0, 0, 1], VENTANAL);
  const n = Math.ceil((c.U1 - c.U0) / MONTANTE_CADA - 1e-9), h = PERFIL.w / 2;
  for (let j = 1; j < n; j++) {
    const u = c.U0 + ((c.U1 - c.U0) * j) / n;
    caja(k, [u - h, v, u + h, f], y, cielo, NEGRO, ['v1', 'u0', 'u1']);
  }
  caja(k, [c.U0, v, c.U1, f], y + TRAVESAÑO - h, y + TRAVESAÑO + h, NEGRO, ['v1', 'tope', 'fondo']);
  caja(k, [c.U0, v, c.U1, f], y, y + 0.08, NEGRO, ['v1', 'tope']);
  caja(k, [c.U0, v, c.U1, f], cielo - 0.08, cielo, NEGRO, ['v1', 'fondo']);
}

/** Las guardas crema del porcelanato blanco de la planta baja (§4.4: blanco y crema): una banda bajo las columnas de la
 *  galería, alrededor del atrio (cortada donde pisa la escalera central), y el borde del hall, a lo largo del frente y
 *  de los costados. Bloques finos, como la guarda redonda. */
function guardas(k: Kit, c: Caras, [A0, V0, A1, V1]: Rect, escalera: [number, number]): void {
  const y0 = 0.02, y1 = 0.026, g = GUARDA_GALERIA / 2, [o0, o1] = [COL_AIRE - g, COL_AIRE + g];
  const banda = (r: Rect): void => k.block(rect(r), y0, y1, 'none', 'otro', { top: CREMA });
  banda([A0 - o1, V0 - o1, A0 - o0, V1 + o1]);
  banda([A1 + o0, V0 - o1, A1 + o1, V1 + o1]);
  banda([A0 - o0, V0 - o1, A1 + o0, V0 - o0]);
  banda([A0 - o0, V1 + o0, escalera[0], V1 + o1]);
  banda([escalera[1], V1 + o0, A1 + o0, V1 + o1]);
  const { w, aire } = GUARDA_HALL, [a, b] = [c.V0 + aire, c.V0 + aire + w];
  banda([c.U0 + aire, a, c.U1 - aire, b]);
  banda([c.U0 + aire, b, c.U0 + aire + w, ATRIO_V0 - 0.1]);
  banda([c.U1 - aire - w, b, c.U1 - aire, ATRIO_V0 - 0.1]);
}

/** Una sala de muestras de la planta baja, entre la pared de afuera (en `pared`) y el tabique de la galería: `s` (±1) es
 *  hacia dónde queda el atrio desde la pared. Con tarimas, cuadros, dos paneles y la escultura. Devuelve el medio de la
 *  sala (en u) y su primera tarima. */
function sala(k: Kit, c: Caras, pared: number, s: 1 | -1, nombre: string): { u: number; tarima: Rect } {
  const u = (d: number): number => pared + s * d; // a d m de la pared de afuera
  const tab = u(SALA_W), centro = u(SALA_W / 2), techo = k.ceilingOver(0);
  const cara = tab - s * (WALL_IN / 2); // la cara del tabique del lado de la sala
  // el tabique de la galería, con dos pasos; el del frente, con la puerta del hall; el del fondo, cerrado
  k.wall([tab, ATRIO_V0], [tab, ATRIO_V1], { look: PARED, gaps: [{ at: 3.0, width: 1.8, height: PUERTA.h }, { at: 18.0, width: 1.8, height: PUERTA.h }] });
  const desde = s > 0 ? c.U0 : c.U1;
  k.wall([desde, ATRIO_V0], [tab + s * (WALL_IN / 2), ATRIO_V0], { look: PARED, gaps: [{ at: Math.abs(centro - desde), width: PUERTA.w, height: PUERTA.h }] });
  k.wall([desde, ATRIO_V1], [tab + s * (WALL_IN / 2), ATRIO_V1], { look: PARED });
  k.label(nombre, [centro, ATRIO_V0 - WALL_IN / 2], PUERTA.h + 0.35, [0, -1], 0.9, 0.24, ROTULO);
  // la tarima de la instalación y la de la escultura
  const r = (d0: number, d1: number, v0: number, v1: number): Rect => [Math.min(u(d0), u(d1)), v0, Math.max(u(d0), u(d1)), v1];
  const tarima = r(SALA_W / 2 - 0.9, SALA_W / 2 + 0.9, 11.5, 13.5);
  k.block(rect(tarima), 0, 0.3, 'solid', 'otro', { top: TARIMA, side: TARIMA });
  k.block(rect(r(SALA_W / 2 - 0.7, SALA_W / 2 + 0.7, 18.9, 20.3)), 0, 0.25, 'solid', 'otro', { top: TARIMA, side: TARIMA });
  const pie: Vec2 = [centro, 19.6];
  k.block(rect([pie[0] - 0.25, pie[1] - 0.25, pie[0] + 0.25, pie[1] + 0.25]), 0.25, 1.15, 'solid', 'otro', { top: TARIMA, side: TARIMA });
  // la escultura: tres prismas girados, uno sobre otro
  [[0.2, 0, 1.15, 1.45], [0.17, Math.PI / 6, 1.45, 1.8], [0.12, Math.PI / 3, 1.8, 2.15]].forEach(([h, rot, y0, y1]) =>
    k.block(ngon(pie, h * Math.SQRT2, 4, rot + Math.PI / 4), y0, y1, 'solid', 'otro', { top: BRONCE, side: BRONCE }));
  // la instalación del fondo de la primera tarima: tres prismas de colores (el medio queda libre: ahí se sube)
  ([[-0.5, 13.05, 0.32, 1.7, '#b8322a'], [0.05, 13.15, 0.26, 1.2, '#f2efe8'], [0.55, 12.95, 0.22, 0.75, '#2f5f8a']] as const).forEach(([du, v, w, h, color]) => {
    const look: Look = { mat: 'liso', color };
    k.block(rect([centro + du - w / 2, v - w / 2, centro + du + w / 2, v + w / 2]), 0.3, 0.3 + h, 'solid', 'otro', { top: look, side: look });
  });
  // los paneles, de través desde la pared de afuera (cuadros de los dos lados), y los cuadros de las paredes
  for (const v of [16.2, 23.0]) panel(k, [u(0.95), v], 0, MIRA.V);
  for (const v of [8.9, 14.4, 21.6, 25.4]) cuadro(k, [pared, v], 1.5, [s, 0]);
  for (const v of [13.2, 17.6, 21.0]) cuadro(k, [cara, v], 1.5, [-s, 0]);
  luces(k, [Math.min(pared, cara), ATRIO_V0, Math.max(pared, cara), ATRIO_V1], techo, []);
  return { u: centro, tarima };
}

/** El auditorio, del fondo del foyer a la pared del fondo: la pared con sus dos puertas, las filas de butacas, el
 *  escenario con los escalones de los costados, la boca, el telón y el fondo. Devuelve el medio (en u) de su puerta de
 *  la izquierda (la del lado de U0). */
function auditorio(k: Kit, c: Caras): { puerta: number } {
  const techo = k.ceilingOver(LEVEL_H); // la losa del piso 2: el auditorio es de doble altura
  const mid = (c.U0 + c.U1) / 2, puerta = c.U0 + 2.6;
  k.wall([c.U0, AUDITORIO_V], [c.U1, AUDITORIO_V], { y1: techo, look: PARED,
    gaps: [{ at: puerta - c.U0, width: PUERTA.w, height: PUERTA.h }, { at: c.U1 - 2.6 - c.U0, width: PUERTA.w, height: PUERTA.h }] });
  k.label('Auditorio', [mid, AUDITORIO_V - WALL_IN / 2], PUERTA.h + 0.45, [0, -1], 1.4, 0.3, ROTULO);
  // el piso de madera
  k.block(rect([c.U0, AUDITORIO_V + WALL_IN / 2, c.U1, ESCENARIO_V]), 0.02, 0.03, 'none', 'otro', { top: PISO_AUDITORIO });
  // las butacas: dos bloques de 11 por fila, con el pasillo del medio
  for (let f = 0; f < FILAS; f++) {
    const v = FILA_V0 + f * FILA_PASO;
    for (let j = 0; j < 11; j++) {
      k.furniture('silla-auditorio', [mid - 1.45 - (10 - j) * BUTACA_W, v], 0, MIRA.V);
      k.furniture('silla-auditorio', [mid + 1.45 + j * BUTACA_W, v], 0, MIRA.V);
    }
  }
  // el escenario y los tres escalones de cada costado (de 0,2: el último sube a 0,8)
  k.block(rect([c.U0, ESCENARIO_V, c.U1, c.V1]), 0, ESCENARIO_H, 'solid', 'otro', { top: ESCENARIO, side: ESCENARIO_FRENTE });
  for (const e of [c.U0 + 3.0, c.U1 - 3.0]) {
    for (let j = 1; j <= 3; j++) {
      const v1 = ESCENARIO_V - (3 - j) * TREAD;
      k.block(rect([e - ESCALON_W / 2, v1 - TREAD, e + ESCALON_W / 2, v1]), 0, j * 0.2, 'solid', 'otro', { top: ESCENARIO, side: ESCENARIO_FRENTE });
    }
  }
  // la boca del escenario: los costados y el dintel, macizos; el telón recogido, la bambalina y el fondo
  const [b0, b1] = [c.U0 + 2.0, c.U1 - 2.0], bv: [number, number] = [ESCENARIO_V + 0.1, ESCENARIO_V + 0.3];
  for (const r of [[c.U0, bv[0], b0, bv[1]], [b1, bv[0], c.U1, bv[1]]] as Rect[]) k.block(rect(r), ESCENARIO_H, techo, 'solid', 'otro', { side: PARED });
  k.block(rect([b0, bv[0], b1, bv[1]]), 5.0, techo, 'solid', 'otro', { side: PARED, bottom: PARED });
  for (const r of [[b0, bv[1], b0 + 0.9, bv[1] + 0.2], [b1 - 0.9, bv[1], b1, bv[1] + 0.2]] as Rect[]) {
    k.block(rect(r), ESCENARIO_H, 5.0, 'none', 'otro', { side: TELON, top: TELON });
  }
  k.block(rect([b0, bv[1], b1, bv[1] + 0.2]), 4.3, 5.0, 'none', 'otro', { side: TELON, bottom: TELON });
  k.block(rect([c.U0, c.V1 - 0.25, c.U1, c.V1 - 0.1]), ESCENARIO_H, techo, 'none', 'otro', { side: FONDO });
  // las luces de la sala y las del escenario
  luces(k, [c.U0, AUDITORIO_V + WALL_IN / 2, c.U1, ESCENARIO_V], techo, [], LAMP_R_ALTO, LAMP_P_ALTO);
  for (const u of [b0 + 2.5, mid, b1 - 2.5]) k.lamp([u, ESCENARIO_V + 1.8], ESCENARIO_H + 3.4, LAMP_R_ESCENARIO, LAMP_P_ESCENARIO);
  return { puerta };
}

export const culturaPlan: InteriorPlan = (k) => {
  const c = caras(k);
  if (c.U1 - c.U0 < 19 || c.V1 - c.V0 < 40) {
    k.shell({ publicFloors: 1, wall: PARED, floor: PISO_PB, ceiling: TECHO });
    return k.done(AMBIENT);
  }
  const mid = (c.U0 + c.U1) / 2;
  const atrio: Rect = [mid - ATRIO_W / 2, ATRIO_V0, mid + ATRIO_W / 2, ATRIO_V1];
  const [A0, , A1] = atrio;
  const hueco = redondeado(atrio, ATRIO_R, ATRIO_SEG).flat();
  // el auditorio es de doble altura: su planta no tiene losa en el piso 1
  const auditorioSinLosa = rect([c.U0 - 0.1, AUDITORIO_V, c.U1 + 0.1, c.V1 + 0.1]);
  k.shell({ publicFloors: 3, wall: PARED, floor: [PISO_PB, PISO_ALTO], ceiling: TECHO, holes: [
    { level: 1, polygon: hueco }, { level: 1, polygon: auditorioSinLosa }, { level: 2, polygon: hueco }, { level: 3, polygon: rect(atrio) },
  ] });
  const techo = [k.ceilingOver(0), k.ceilingOver(LEVEL_H), k.ceilingOver(2 * LEVEL_H)];
  const H = k.ceilingOver(techo[2]); // el techo del edificio, arriba del bloque cerrado

  // ---- las escaleras: la central, del atrio al balcón del fondo del piso 1 (llega al borde del hueco), y la del
  // costado, del 1 al 2, contra la pared de +U
  const corrida = (Math.ceil(LEVEL_H / 0.2 - 1e-9) - 1) * TREAD;
  const pieCentral: Vec2 = [mid, ATRIO_V1 - corrida];
  k.stair({ from: 0, to: 1, foot: pieCentral, dir: [0, 1], width: CENTRAL_W, look: PISO_PB, rail: VIDRIO, handrail: 'ambos', handrailLook: NEGRO });
  const pieCostado: Vec2 = [c.U1 - 0.05 - COSTADO_W / 2, 10];
  // el pasamanos, del lado del balcón (−U)
  k.stair({ from: 1, to: 2, foot: pieCostado, dir: [0, 1], width: COSTADO_W, look: PISO_ALTO, rail: VIDRIO, handrail: 'der', handrailLook: NEGRO });
  const huecoCostado = rect([pieCostado[0] - COSTADO_W / 2, pieCostado[1], pieCostado[0] + COSTADO_W / 2, pieCostado[1] + corrida]);

  // ---- las columnas, en los tres pisos: en los lados largos del hueco y donde empiezan las curvas
  const colV = [ATRIO_V0 + ATRIO_R, 12.25, (ATRIO_V0 + ATRIO_V1) / 2, 20.75, ATRIO_V1 - ATRIO_R];
  const cols: Vec2[] = [
    ...[A0 - COL_AIRE, A1 + COL_AIRE].flatMap((u) => colV.map((v): Vec2 => [u, v])),
    ...[A0 + ATRIO_R, A1 - ATRIO_R].flatMap((u) => [ATRIO_V0 - COL_AIRE, ATRIO_V1 + COL_AIRE].map((v): Vec2 => [u, v])),
  ];
  for (let level = 0; level < 3; level++) for (const p of cols) columna(k, p, level * LEVEL_H, techo[level]);

  // ---- las barandas de los balcones: paños rectos de vidrio y la reja en las curvas; la del fondo del piso 1 se corta
  // donde llega la escalera central
  const o = RAIL_T / 2;
  const anillo = redondeado([A0 - o, ATRIO_V0 - o, A1 + o, ATRIO_V1 + o], ATRIO_R + o, ATRIO_SEG);
  const llegada = CENTRAL_W / 2 + RAIL_T;
  for (const level of [1, 2]) {
    for (let j = 0; j < 4; j++) {
      curvaDeReja(k, anillo[j], level);
      const [p, q] = [anillo[j][ATRIO_SEG], anillo[(j + 1) % 4][0]];
      if (level === 1 && j === 1) {
        pañoDeVidrio(k, p, [mid + llegada, p[1]], level);
        pañoDeVidrio(k, [mid - llegada, q[1]], q, level);
      } else pañoDeVidrio(k, p, q, level);
    }
  }

  // ---- el lucernario, el plafón colgado debajo y la guarda redonda del piso
  lucernario(k, atrio, H);
  const centro: Vec2 = [mid, (ATRIO_V0 + ATRIO_V1) / 2];
  const yPlafon = H - PLAFON_BAJA;
  k.furniture('plafon', centro, yPlafon, MIRA.V);
  k.label('Plafón del atrio', centro, yPlafon, [0, 1], PLAFON_D, PLAFON_D, PLAFON_LOOK, { drawing: 'plafon', down: true, round: true });
  k.block(ngon(centro, 3.3, 40), 0.02, 0.026, 'none', 'otro', { top: FILETE });
  k.block(ngon(centro, 3.15, 40), 0.026, 0.03, 'none', 'otro', { top: GUARDA });
  guardas(k, c, atrio, [mid - CENTRAL_W / 2, mid + CENTRAL_W / 2]);

  // ---- planta baja: el hall con la mesa de informes, las salas, las galerías, el foyer y el auditorio
  k.furniture('escritorio', [A0 - 0.6, 3.6], 0, MIRA.menosU);
  luces(k, [c.U0, c.V0, c.U1, ATRIO_V0], techo[0], []);
  const s1 = sala(k, c, c.U0, 1, 'Sala 1');
  const s2 = sala(k, c, c.U1, -1, 'Sala 2');
  luces(k, [s1.u + SALA_W / 2 + WALL_IN / 2, ATRIO_V0, A0, ATRIO_V1], techo[0], [hueco]);
  luces(k, [A1, ATRIO_V0, s2.u - SALA_W / 2 - WALL_IN / 2, ATRIO_V1], techo[0], [hueco]);
  luces(k, [c.U0, ATRIO_V1 + WALL_IN / 2, c.U1, AUDITORIO_V - WALL_IN / 2], techo[0], []);
  const aud = auditorio(k, c);

  // ---- pisos 1 y 2: los balcones del frente (sobre el hall, contra el ventanal), de los costados y del fondo, con
  // cuadros en las paredes de afuera; en el 1, además, dos paneles en el del frente y cuadros en la pared del auditorio
  for (const level of [1, 2]) {
    const y = level * LEVEL_H, ver = y + 1.5, cielo = techo[level];
    ventanal(k, c, y, cielo);
    for (const v of [2.4, 4.8]) {
      cuadro(k, [c.U0, v], ver, [1, 0]);
      cuadro(k, [c.U1, v], ver, [-1, 0]);
    }
    for (const v of [9.0, 13.2, 17.4, 21.6, 25.6]) cuadro(k, [c.U0, v], ver, [1, 0]);
    for (const v of [17.8, 21.8, 25.6]) cuadro(k, [c.U1, v], ver, [-1, 0]);
    const fondo = AUDITORIO_V - WALL_IN / 2;
    // los huecos del cielorraso: los de la losa de arriba (la del 2 o el bloque cerrado)
    const huecosArriba = level === 1 ? [hueco, huecoCostado] : [rect(atrio)];
    luces(k, [c.U0, c.V0, c.U1, ATRIO_V0], cielo, huecosArriba);
    luces(k, [c.U0, ATRIO_V0, A0 - 0.3, ATRIO_V1], cielo, huecosArriba);
    luces(k, [A1 + 0.3, ATRIO_V0, c.U1, ATRIO_V1], cielo, huecosArriba);
    luces(k, [c.U0, ATRIO_V1, c.U1, fondo], cielo, huecosArriba);
    if (level === 1) {
      for (const u of [c.U0 + 2.6, c.U1 - 2.6]) cuadro(k, [u, fondo], ver, [0, -1]);
      panel(k, [mid - 4.6, 3.2], y, MIRA.V);
      panel(k, [mid + 4.6, 3.2], y, MIRA.V);
    }
  }

  // ---- piso 2: la Sala 3, arriba del auditorio, con su tabique de dos pasos, cuatro paneles y cuadros
  const y2 = 2 * LEVEL_H;
  k.wall([c.U0, AUDITORIO_V], [c.U1, AUDITORIO_V], { y0: y2, look: PARED,
    gaps: [{ at: A0 - c.U0, width: 2.0, height: 2.4 }, { at: A1 - c.U0, width: 2.0, height: 2.4 }] });
  k.label('Sala 3', [mid, AUDITORIO_V - WALL_IN / 2], y2 + 2.0, [0, -1], 0.9, 0.24, ROTULO);
  for (const u of [mid - 6.6, mid - 2.2, mid + 2.2, mid + 6.6]) panel(k, [u, 37.0], y2, MIRA.V);
  for (const u of [c.U0 + 2.4, mid - 4.4, mid, mid + 4.4, c.U1 - 2.4]) cuadro(k, [u, c.V1], y2 + 1.5, [0, -1]);
  for (const v of [32.0, 36.0, 40.5]) {
    cuadro(k, [c.U0, v], y2 + 1.5, [1, 0]);
    cuadro(k, [c.U1, v], y2 + 1.5, [-1, 0]);
  }
  luces(k, [c.U0, AUDITORIO_V + WALL_IN / 2, c.U1, c.V1], techo[2], []);

  // ---- los puntos con nombre y la vista
  k.view('atrio', [mid, 2.6], 0, MIRA.V);
  k.mark('atrio', centro, 0);
  k.mark('balcon-1', [A0 - RAIL_T - 1.0, 14.4], LEVEL_H);
  k.mark('balcon-2-enfrente', [A1 + RAIL_T + 1.0, 14.4], y2);
  k.mark('auditorio', [aud.puerta + 0.4, AUDITORIO_V + 1.0], 0);
  k.mark('escenario', [aud.puerta + 0.4, ESCENARIO_V + 1.1], ESCENARIO_H);
  k.mark('techo-lucernario', [A0 - 1.0, centro[1]], H);
  k.mark('sala', [s1.u, 8.8], 0);
  k.mark('tarima', [s1.u, (s1.tarima[1] + s1.tarima[3]) / 2], 0.3);
  return k.done(AMBIENT);
};
