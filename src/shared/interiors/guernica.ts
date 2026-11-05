// El Guernica Bar (§4.8), sobre la planta relevada (12 × 16 m, 7 m de alto, dos pisos públicos) y su patio de adelante
// (D12). Marco local: U a lo largo del frente (de la punta de la puerta, 0, a la otra, 12) y V hacia adentro (del
// frente, que da al patio, al fondo); 0 mira a +V y π/2 a +U. Estilo industrial: ladrillo a la vista, metal negro,
// madera y lamparitas.
// - Planta baja: se entra por la punta del frente; a la izquierda sube la escalera de chapa negra con escalones de madera
//   y pasamanos de caño; a la derecha, la barra larga de madera oscura con sus banquetas, la torre de canillas cromada en
//   arco y, detrás, los estantes iluminados con las botellas (que brillan desde el estante: van de detalle 2) y, contra
//   el fondo, la fila de atrás dibujada (un cartel `botellas`: en baja es la única). La barra de la vidriera con
//   banquetas, mesas bajas y, entre ellas y la barra, dos mesas altas; vigas negras a la vista, guirnaldas y lamparitas
//   colgadas (el modelo `lamparita`). Al fondo, los baños.
// - Planta alta (D14: techada): mesas, el rincón del escenario (una tarima con el fondo negro y sus parlantes) y, por la
//   puerta del frente, el balcón (afuera de la planta, sobre el patio) con la baranda de caño negra.
// - El patio de adelante (D12): baldosones, mesas bajo dos jacarandás propios (árboles del mapa, con su tronco) y guirnaldas
//   de lamparitas entre postes negros.
// - Afuera (`out`): el balcón y su baranda, y arriba de las ventanas la chapa acanalada con "GUERNICA" en letras que
//   brillan y una estrella a cada lado. Es el cartel del lugar: el del lote no se dibuja (placeSign).
// Si la planta no es la relevada (sin el patio o más chica), quedan los dos pisos vacíos.
import type { Vec2 } from '../geo.ts';
import type { SignLook } from '../mapdata.ts';
import type { InteriorPlan } from './index.ts';
import { GROUND_Y } from './kit.ts';
import type { Kit } from './kit.ts';
import { LEVEL_H } from './openings.ts';
import { MIRA, ngon, rect } from './plan-util.ts';
import type { Rect } from './plan-util.ts';
import type { Look } from './types.ts';

// ---------- materiales ----------

/** El ladrillo a la vista (la foto ya es rojiza: el tinte apenas la calienta, como el del patio del McDonald's). */
const LADRILLO: Look = { mat: 'ladrillo', color: '#ffc2a8' };
/** El piso de abajo (cemento alisado gris oscuro, en paños) y el de arriba (tablas); los techos, pintados de negro. */
const CEMENTO: Look = { mat: 'porcelanato', color: '#6e6a66' };
const TABLAS: Look = { mat: 'madera', color: '#8a5e3a' };
const TECHO_NEGRO: Look = { mat: 'liso', color: '#2e2e30' };
/** El metal negro (vigas, caños, la escalera) y la madera oscura de la barra. */
const NEGRO: Look = { mat: 'metal', color: '#1c1c1e' };
const BARRA_TAPA: Look = { mat: 'madera', color: '#4e3220' };
const BARRA_FRENTE: Look = { mat: 'madera', color: '#3e2818' };
const ESCALON: Look = { mat: 'madera', color: '#6a4628' };
/** Los estantes de atrás de la barra: la madera, la luz de abajo (brilla) y el fondo negro. */
const ESTANTE: Look = { mat: 'madera', color: '#5a3a22' };
const ESTANTE_LUZ: Look = { mat: 'luz', color: '#8a6a3a' };
const ACERO: Look = { mat: 'metal', color: '#9aa0a6' };
/** Las puertas de los baños y la tarima. */
const PUERTA: Look = { mat: 'madera', color: '#4a3020' };
const TARIMA: Look = { mat: 'madera', color: '#3a2618' };
/** El patio: baldosones grises. */
const PATIO: Look = { mat: 'baldosa', color: '#a39f98' };
/** Afuera: el balcón (losa de hormigón con el canto de chapa negra), la chapa acanalada y sus ondas. */
const BALCON_PISO: Look = { mat: 'liso', color: '#5a5a5c' };
const BALCON_BAJO: Look = { mat: 'liso', color: '#4a4a4c' };
const CHAPA: Look = { mat: 'liso', color: '#2a2d30' };
const ONDA: Look = { mat: 'liso', color: '#3a3e42' };

/** "GUERNICA" y las estrellas: la letra condensada ámbar del relevamiento, sobre el gris de la chapa. Brillan. */
const CARTEL: SignLook = { fondo: '#26292b', letra: '#f2c14e', marco: '#26292b', fuente: 'condensada' };
const ROTULO: SignLook = { fondo: '#2e2e30', letra: '#d8d0bc', marco: '#2e2e30', fuente: 'condensada' };
/** La fila de atrás de cada estante (un cartel `botellas`, que brilla): la luz cálida del fondo, que se apaga hacia el
 *  estante de arriba, y las siluetas de las botellas. */
const FILA_BOTELLAS: SignLook = { fondo: '#5a3a14', letra: '#0c0a08', marco: '#2a1a0c', fuente: 'sans' };

/** Los colores de los muebles (Item.color): la madera de las sillas y las banquetas, y el vidrio de las botellas (ya
 *  oscuro: brillan con el color que tendrían a la luz del estante). */
const MADERA = '#8a5e3a', BOTELLAS = ['#5a3c10', '#1e3a1a', '#5c5a50', '#3a1a10', '#22304a', '#4a4a20'] as const;

const AMBIENT = 0.3;
const FOCO = { r: 4.5, p: 0.35 } as const;

// ---------- medidas (m, marco local) ----------

/** El techo de cada piso: la losa del 1 (de 3,0 a 3,2) y el techo (de 6,2 a 7,0). */
const TECHO0 = LEVEL_H - 0.2, TECHO1 = 6.2;
/** La escalera, contra la pared de la izquierda (U 0,2), subiendo hacia el fondo. */
const ESCALERA = { u: 0.8, v: 5.0, ancho: 1.2 } as const;
/** La barra: lo sólido, de 1,1 m, de V 3,0 a 10,4; detrás, el pasillo del barman, la mesada baja y los estantes. */
const BARRA = { u0: 9.3, u1: 9.9, v0: 3.0, v1: 10.4, h: 1.1 } as const;
const ESTANTES = { u0: 11.45, v0: 3.6, v1: 9.8, ys: [1.35, 1.8, 2.25] } as const;
/** La fila de atrás de cada estante: el cartel, contra el fondo negro (U 11,78), de 1 cm sobre el estante a 4 cm del de
 *  arriba. */
const FILA = { u: 11.77, h: 0.4 } as const;
/** La barra de la vidriera, contra el frente (de la puerta para allá): la tabla de 1,05 m y su fondo, desde el frente. */
const VIDRIERA = { u0: 3.2, u1: 8.9, fondo: 0.55, h: 1.05 } as const;
/** Las mesas altas de planta baja, entre las mesas bajas (U 4,4 y 6,8, de 1,2 de ancho) y las banquetas de la barra
 *  (U 8,85). */
const MESAS_ALTAS: Vec2[] = [[7.8, 4.2], [7.8, 7.6]];
/** El balcón (afuera, sobre el patio), frente a la puerta del piso 1 (U 5,4–6,6). */
const BALCON = { u0: 2.6, u1: 9.4, sale: 1.8 } as const;
/** La chapa del cartel, arriba de las ventanas del piso 1 (llegan a 5,8): no llega a la escalera de mano de U 11,4. */
const CHAPA_R = { u0: 0.4, u1: 10.8, y0: 5.9, y1: 6.95 } as const;
/** El patio: los árboles (lejos del camino a la puerta y de los 2,5 m libres del spawn del lugar, en U 3,1, V −5,1; el
 *  tronco del mapa tiene 0,3 m de radio y mapgen lo ve: el mundo de prismas llenos donde ubica las apariciones y el
 *  botín de afuera suma los troncos de los patios, placementWorld) y los postes de las guirnaldas. Son jacarandás chicos,
 *  como los de la calle (en noviembre, florecidos): la copa, de 1,8 a 4,9 m y de 4,3 m de ancho, no llega a la baranda
 *  del balcón (V −1,75). */
const ARBOLES: Vec2[] = [[7.8, -3.7], [13.6, -2.6]];
const ARBOL = { variant: 2, scale: 0.62 } as const;
const POSTES_V = -4.2, POSTES_U = [0.4, 3.4, 6.4, 9.4, 12.4], GUIRNALDA_Y = 2.9;
/** El largo de un tramo de guirnalda (GARLAND.len de models.ts): de poste a poste. */
const GARLAND_L = 3.0;

/** Lo que cuelga una lamparita (el modelo de models.ts, que brilla): del gancho a la punta. */
const LAMPARITA_H = 0.11;
/** Una lamparita colgada en `p` con la punta a `y` (su cable sube hasta el techo `techo`) y su lámpara. */
function lamparita(k: Kit, p: Vec2, y: number, techo: number): void {
  k.furniture('lamparita', p, y + LAMPARITA_H, 0);
  k.block(rect([p[0] - 0.006, p[1] - 0.006, p[0] + 0.006, p[1] + 0.006]), y + LAMPARITA_H, techo, 'none', 'otro', { side: NEGRO });
  k.lamp(p, y, FOCO.r, FOCO.p);
}
/** Las vigas negras a la vista bajo el techo `techo`, a lo ancho (U), cada 2 m, menos sobre el hueco de la escalera. */
function vigas(k: Kit, techo: number, desde: number): void {
  for (let v = 2.0; v < 15.0; v += 2.0) k.block(rect([desde, v - 0.08, 11.8, v + 0.08]), techo - 0.22, techo - 0.005, 'none', 'otro', { side: NEGRO, bottom: NEGRO });
}
/** Una mesa baja con dos sillas enfrentadas a lo largo de V. */
function mesa(k: Kit, c: Vec2, y: number): void {
  k.furniture('mesa', c, y, 0, MADERA);
  k.furniture('silla', [c[0], c[1] - 0.65], y, MIRA.V, MADERA);
  k.furniture('silla', [c[0], c[1] + 0.65], y, MIRA.menosV, MADERA);
}
/** Una mesa alta con dos banquetas enfrentadas a lo largo de U (o de V, con `eje` 'V'). */
function mesaAlta(k: Kit, c: Vec2, y: number, eje: 'U' | 'V' = 'U'): void {
  k.furniture('mesa-alta', c, y, 0);
  const [du, dv] = eje === 'U' ? [0.55, 0] : [0, 0.55];
  k.furniture('banqueta', [c[0] - du, c[1] - dv], y, eje === 'U' ? MIRA.U : MIRA.V, MADERA);
  k.furniture('banqueta', [c[0] + du, c[1] + dv], y, eje === 'U' ? MIRA.menosU : MIRA.menosV, MADERA);
}

/** La planta baja: la barra con los estantes y las botellas, las mesas, los baños, las vigas y las luces. */
function plantaBaja(k: Kit): void {
  const { u0, u1, v0, v1, h } = BARRA;
  k.block(rect([u0, v0, u1, v1]), 0, h, 'solid', 'mueble', { top: BARRA_TAPA, side: BARRA_FRENTE });
  // la tapa sale 4 cm hacia los clientes; el apoyapiés de caño negro
  k.block(rect([u0 - 0.04, v0 - 0.04, u1, v1 + 0.04]), h - 0.05, h + 0.005, 'none', 'otro', { top: BARRA_TAPA, side: BARRA_TAPA, bottom: BARRA_TAPA });
  k.block(rect([u0 - 0.2, v0 + 0.1, u0 - 0.16, v1 - 0.1]), 0.2, 0.24, 'none', 'otro', { side: NEGRO, top: NEGRO });
  k.furniture('canillas', [(u0 + u1) / 2, (v0 + v1) / 2], h, MIRA.U);
  for (let v = v0 + 0.5; v < v1 - 0.2; v += 0.9) k.furniture('banqueta', [u0 - 0.45, v], 0, MIRA.U, MADERA);
  // detrás: la mesada baja de acero, los estantes con su luz abajo, el fondo negro y las botellas
  k.block(rect([11.15, v0 + 0.2, 11.8, v1 - 0.2]), 0, 0.95, 'solid', 'mueble', { top: ACERO, side: NEGRO });
  k.block(rect([11.78, ESTANTES.v0, 11.8, ESTANTES.v1]), 1.0, 2.7, 'none', 'otro', { side: NEGRO });
  ESTANTES.ys.forEach((y, j) => {
    k.block(rect([ESTANTES.u0, ESTANTES.v0, 11.78, ESTANTES.v1]), y - 0.03, y, 'none', 'otro', { top: ESTANTE, side: ESTANTE, bottom: ESTANTE_LUZ });
    for (let n = 0, v = ESTANTES.v0 + 0.15; v < ESTANTES.v1 - 0.1; v += 0.34, n++) {
      k.furniture('botella', [11.62, v], y, 0, BOTELLAS[(n * 5 + j * 2) % BOTELLAS.length], 2);
    }
    // detrás, la fila de atrás dibujada (en baja, la única: las botellas son de detalle 2)
    k.label(`botellas ${j + 1}`, [FILA.u, (ESTANTES.v0 + ESTANTES.v1) / 2], y + 0.01 + FILA.h / 2, [-1, 0], ESTANTES.v1 - ESTANTES.v0 - 0.1, FILA.h, FILA_BOTELLAS,
      { glow: true, drawing: 'botellas' });
  });
  // la barra de la vidriera (una tabla con su frente, a 1,05 m, con cuatro banquetas mirando a la calle) y las mesas
  // bajas en el medio
  const { u0: a0, u1: a1, fondo, h: ah } = VIDRIERA;
  k.block(rect([a0, 0.2, a1, fondo - 0.05]), 0, ah - 0.05, 'solid', 'mueble', { side: BARRA_FRENTE, top: BARRA_FRENTE });
  k.block(rect([a0, 0.2, a1, fondo]), ah - 0.05, ah, 'none', 'otro', { top: BARRA_TAPA, side: BARRA_TAPA, bottom: BARRA_TAPA });
  for (let u = a0 + 0.6; u < a1 - 0.3; u += 1.4) k.furniture('banqueta', [u, fondo + 0.4], 0, MIRA.menosV, MADERA);
  for (const c of [[4.4, 6.0], [6.8, 6.0], [4.4, 9.2], [6.8, 9.2], [5.6, 12.6]] as Vec2[]) mesa(k, c, 0);
  // entre las mesas bajas y las banquetas de la barra, dos mesas altas (en los huecos entre las filas de mesas), con
  // las banquetas a lo largo de la barra para no cerrar el paso
  for (const c of MESAS_ALTAS) mesaAlta(k, c, 0, 'V');
  // los baños, al fondo: dos puertas cerradas con su cartel
  for (const [u, n] of [[2.6, 'DAMAS'], [4.4, 'CABALLEROS']] as const) {
    k.block(rect([u - 0.45, 15.77, u + 0.45, 15.8]), 0, 2.1, 'none', 'otro', { side: PUERTA, top: PUERTA });
    k.label(n, [u, 15.76], 2.3, [0, -1], 0.9, 0.18, ROTULO);
  }
  vigas(k, TECHO0, 1.45);
  // las lamparitas: sobre la barra, sobre las mesas y al lado de la escalera
  for (const v of [4.2, 6.7, 9.2]) lamparita(k, [9.0, v], 2.2, TECHO0 - 0.2);
  for (const c of [[4.4, 6.0], [6.8, 6.0], [4.4, 9.2], [6.8, 9.2], [5.6, 12.6], [5.1, 1.3], [8.0, 1.3], [2.6, 13.6]] as Vec2[]) lamparita(k, c, 2.3, TECHO0 - 0.2);
  lamparita(k, [2.1, 7.6], 2.3, TECHO0 - 0.2); // la de la escalera, al costado del tramo
  // dos guirnaldas a lo ancho del salón (las cuelgan las vigas): cada tramo, de GARLAND_L hacia +U (yaw 0: el +x del
  // modelo va a +U)
  for (const v of [3.0, 11.0]) for (let u = 1.9; u + GARLAND_L < 11.0; u += GARLAND_L) k.furniture('guirnalda', [u, v], TECHO0 - 0.3, MIRA.V);
}

/** La planta alta: las mesas, la tarima del escenario con su fondo negro y sus parlantes, las vigas y las luces. */
function plantaAlta(k: Kit): void {
  const y = LEVEL_H;
  for (const c of [[2.8, 2.6], [9.2, 2.6], [3.6, 6.2], [6.8, 6.2], [3.6, 9.6], [6.8, 9.6]] as Vec2[]) mesa(k, c, y);
  for (const c of [[3.2, 13.6], [5.4, 13.6]] as Vec2[]) mesaAlta(k, c, y);
  // el escenario: una tarima de una contrahuella (0,2) en el rincón del fondo, el fondo negro y los parlantes
  k.block(rect([8.0, 12.4, 11.8, 15.8]), y, y + 0.2, 'solid', 'otro', { top: TARIMA, side: NEGRO });
  k.block(rect([8.0, 15.78, 11.8, 15.8]), y + 0.2, TECHO1, 'none', 'otro', { side: NEGRO });
  k.block(rect([11.78, 12.4, 11.8, 15.78]), y + 0.2, TECHO1, 'none', 'otro', { side: NEGRO });
  for (const u of [8.5, 11.2]) k.block(rect([u - 0.25, 15.2, u + 0.25, 15.6]), y + 0.2, y + 1.1, 'solid', 'mueble', { side: NEGRO, top: NEGRO });
  // el pie del micrófono
  k.block(rect([9.84, 13.6, 9.86, 13.62]), y + 0.2, y + 1.65, 'none', 'otro', { side: NEGRO });
  k.block(ngon([9.85, 13.61], 0.15, 6), y + 0.2, y + 0.23, 'none', 'otro', { side: NEGRO, top: NEGRO });
  vigas(k, TECHO1, 1.45);
  for (const c of [[2.8, 2.6], [9.2, 2.6], [3.6, 6.2], [6.8, 6.2], [3.6, 9.6], [6.8, 9.6], [9.0, 13.0], [10.6, 14.4], [4.3, 13.6]] as Vec2[]) lamparita(k, c, y + 2.2, TECHO1 - 0.2);
  for (const v of [4.4, 11.4]) for (let u = 2.2; u + GARLAND_L < 11.0; u += GARLAND_L) k.furniture('guirnalda', [u, v], TECHO1 - 0.3, MIRA.V);
}

/** El patio (D12): el piso, los árboles (del mapa: Kit.tree), las mesas y las guirnaldas entre postes negros. */
function patio(k: Kit, ring: Vec2[]): void {
  k.block(ring, 0, GROUND_Y, 'none', 'otro', { top: PATIO });
  for (const a of ARBOLES) k.tree(a, ARBOL.variant, ARBOL.scale);
  mesaAlta(k, [10.4, -1.2], 0);
  mesaAlta(k, [12.6, -1.2], 0);
  mesa(k, [11.6, -3.2], 0);
  mesaAlta(k, [4.0, -0.8], 0);
  for (const u of POSTES_U) k.block(rect([u - 0.03, POSTES_V - 0.03, u + 0.03, POSTES_V + 0.03]), 0, GUIRNALDA_Y + 0.1, 'none', 'otro', { side: NEGRO, top: NEGRO });
  for (let j = 0; j + 1 < POSTES_U.length; j++) k.furniture('guirnalda', [POSTES_U[j], POSTES_V], GUIRNALDA_Y, MIRA.V);
}

/** Lo de afuera (`out`): el balcón con su baranda de caño negra y la chapa con "GUERNICA" y las estrellas. */
function afuera(k: Kit): void {
  const { u0, u1, sale } = BALCON, y = LEVEL_H;
  // la losa del balcón, al ras del piso 1; su cara de atrás (la arista 2) es la del frente
  k.block(rect([u0, -sale, u1, 0]), y - 0.2, y, 'solid', 'otro', { top: BALCON_PISO, side: NEGRO, bottom: BALCON_BAJO }, { out: true, hide: [2] });
  k.railing([[u0 + 0.05, 0], [u0 + 0.05, -sale + 0.05], [u1 - 0.05, -sale + 0.05], [u1 - 0.05, 0]], 1, NEGRO, { caño: true, out: true });
  // la chapa acanalada: el fondo y las ondas, cada 0,15 m
  const { u0: c0, u1: c1, y0, y1 } = CHAPA_R;
  k.block(rect([c0, -0.03, c1, 0]), y0, y1, 'none', 'otro', { side: CHAPA, top: CHAPA, bottom: CHAPA }, { out: true, hide: [2] });
  for (let u = c0 + 0.075; u < c1; u += 0.15) k.block(rect([u - 0.025, -0.06, u + 0.025, -0.03]), y0, y1, 'none', 'otro', { side: ONDA, top: ONDA, bottom: ONDA }, { out: true, hide: [2] });
  const m = (c0 + c1) / 2, cy = (y0 + y1) / 2 - 0.05;
  k.label('GUERNICA', [m, -0.075], cy, [0, -1], 5.4, 0.72, CARTEL, { out: true, glow: true, placeSign: true });
  for (const s of [-1, 1]) k.label('★', [m + s * 3.3, -0.075], cy, [0, -1], 0.62, 0.62, CARTEL, { out: true, glow: true });
}

export const guernicaPlan: InteriorPlan = (k) => {
  const inner = k.inside;
  const us = inner.map((p) => p[0]), vs = inner.map((p) => p[1]);
  const [U0, U1, V0, V1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const ring = k.patios[0];
  k.shell({ publicFloors: 2, wall: LADRILLO, floor: [CEMENTO, TABLAS], ceiling: TECHO_NEGRO });
  if (U1 - U0 < 11.5 || V1 - V0 < 15.5 || k.height < 6.9 || !ring) {
    k.stair({ from: 0, to: 1, foot: [U0 + 0.8, V0 + 4.8], dir: [0, 1], width: 1.2, look: ESCALON, rail: NEGRO, railStyle: { caño: true }, approach: 1.0 });
    return k.done(AMBIENT);
  }
  k.stair({ from: 0, to: 1, foot: [ESCALERA.u, ESCALERA.v], dir: [0, 1], width: ESCALERA.ancho, look: ESCALON, rail: NEGRO, railStyle: { caño: true },
    approach: 1.0, handrail: 'izq', handrailLook: NEGRO });
  plantaBaja(k);
  plantaAlta(k);
  patio(k, ring);
  afuera(k);

  k.mark('planta-alta', [6.0, 2.6], LEVEL_H);
  k.mark('balcon', [6.0, -1.0], LEVEL_H);
  k.mark('patio', [5.2, -3.4], 0);
  k.mark('barra', [8.4, 6.7], 0);
  k.view('salon', [3.0, 1.6], 0, Math.PI / 4);
  k.view('balcon', [6.0, -0.6], LEVEL_H, Math.PI);
  return k.done(AMBIENT);
};
