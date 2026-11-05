// La Veneciana de Espora (§4.7), sobre la planta relevada: un pabellón vidriado de un piso (3,8 m) de 12 m de ancho, con
// el frente sesgado sobre Espora, los costados largos y, al fondo, la esquina redonda (un semicírculo vidriado); el
// techo es una terraza (terrace: el nivel 1, a height). Todo va en el marco del salón: D a lo largo de los costados (del
// frente hacia la esquina redonda) y P de través, del costado sur (0) al norte (W); el Kit dibuja en U, V.
// - Salón: cerámico beige, columnas blancas en el eje, el machimbre barnizado del cielorraso con vigas blancas de
//   través y spots, y en la esquina redonda un aro blanco. Mesas y sillas de madera oscura; el metegol (sólido) sobre una
//   alfombra redonda gris; contra el costado norte, el mostrador de madera con la vitrina de helados: los baldes de
//   colores brillan bajo el vidrio.
// - La escalera a la terraza, contra el costado sur, con su baranda blanca de caño; arriba, baldosa terracota (la del
//   Kit, GROUND_Y sobre el techo del chunk), la baranda de caño todo alrededor (D4: el pretil mide 0,6), sombrillas
//   rojas, sillas director rojas y mesas de madera.
// - Afuera (`out`): los toldos rojos de los costados con "La Veneciana" (el del frente y el cartel con la letra blanca
//   ya los pone el lote) y, en la vereda de Espora, sombrillas rojas, sillas director rojas y mesitas.
// Si la planta no es la relevada (sin la esquina redonda o más chica), queda el salón vacío.
import { ensureCCW, insetRing } from '../geo.ts';
import type { Vec2, Vec3 } from '../geo.ts';
import type { SignLook } from '../mapdata.ts';
import { barra } from './cultura.ts';
import type { InteriorPlan } from './index.ts';
import { GROUND_Y, RAIL_H, RAIL_T, TREAD } from './kit.ts';
import type { Kit } from './kit.ts';
import type { Look } from './types.ts';

// ---------- materiales ----------

const PARED: Look = { mat: 'liso', color: '#f4f2ec' };
/** El cerámico beige del salón y la baldosa terracota de la terraza. */
const CERAMICO: Look = { mat: 'ceramico', color: '#dcc9a6' };
const TERRACOTA: Look = { mat: 'baldosa', color: '#b8603e' };
/** El machimbre barnizado del cielorraso; las vigas, el aro y las columnas, blancos. */
const MACHIMBRE: Look = { mat: 'machimbre', color: '#c99258' };
const BLANCO: Look = { mat: 'liso', color: '#f6f5f1' };
/** La baranda de caño, blanca (de afuera se ve con el edificio). */
const CAÑO: Look = { mat: 'metal', color: '#f2f2ef' };
/** El mostrador de madera, la bandeja de acero de la vitrina y su vidrio. */
const MADERA: Look = { mat: 'madera', color: '#8a5a34' };
const BANDEJA: Look = { mat: 'metal', color: '#c9cdd0' };
const VIDRIO: Look = { mat: 'vidrio', color: '#b8d0d6' };
/** La alfombra redonda gris del metegol. */
const ALFOMBRA: Look = { mat: 'tela', color: '#8c8c8a' };
/** Los spots del machimbre (brillan). */
const SPOT: Look = { mat: 'luz', color: '#fff0d6' };
/** Los toldos y las mesitas de la vereda (`out`: van con el edificio). */
const TOLDO: Look = { mat: 'liso', color: '#c8202f' };
const MESITA: Look = { mat: 'liso', color: '#3a3a3c' };

/** El nombre en los toldos: el mismo rojo y la misma letra que el cartel del frente (no hay letra script: va la serif en
 *  cursiva del cartel del lugar). */
const NOMBRE: SignLook = { fondo: '#c8202f', letra: '#ffffff', marco: '#c8202f', fuente: 'serif', cursiva: true };

/** Los colores que tiñen los muebles: la madera oscura de las mesas y las sillas, el rojo de las sillas director. */
const MADERA_OSCURA = '#6a4630', MADERA_TERRAZA = '#9a7048', ROJO = '#c8202f';
/** Los gustos de la vitrina (brillan: sin hornear). Calibrados para que adentro, a INDOOR_EXPOSURE, se vean de su color
 *  (tests/client/mcd-veneciana.test.ts): chocolate, dulce de leche, frutilla, limón, menta granizada, vainilla,
 *  frambuesa, mango, pistacho y arándanos. */
const GUSTOS = ['#2a160b', '#704013', '#a92e45', '#a39a2c', '#3d8f6c', '#a4874a', '#7a0f2c', '#ae6512', '#5e7a32', '#3a2a6e'] as const;

/** La luz pareja del salón (vidriado todo alrededor); el resto, los spots. */
const AMBIENT = 0.42;
const SPOT_R = 4.2, SPOT_P = 0.32;

// ---------- medidas ----------

/** El cielorraso: el techo del chunk (0,8 m de losa). */
const ROOF_T = 0.8;
/** La escalera: de 1,3 m, contra el costado sur (P de 0,1 a 1,4) y subiendo hacia la esquina redonda desde D = 2; el
 *  hueco del techo arranca `antes` m antes del pie (StairOpts.approach: así el suelo de abajo se une con la escalera). */
const ESCALERA = { d0: 2.0, p: 0.75, w: 1.3, antes: 0.75 } as const;
/** El mostrador con la vitrina: contra el costado norte, de D 11 a 19 y de 0,9 m de fondo, a 1,15 m del vidrio. */
const MOSTRADOR = { d0: 11.0, d1: 19.0, fondo: 0.9, aire: 1.15, h: 0.9 } as const;
/** La vitrina: los baldes en dos filas, el vidrio del frente y la tapa. */
const VITRINA = { d0: 12.4, baldes: 12, paso: 0.19, tapa: 1.13 } as const;
/** El metegol y su alfombra (radio). */
const METEGOL = { d: 25.4, p: 3.0, r: 1.35 } as const;
/** El aro de la esquina redonda: radios de adentro y de afuera y cantidad de tramos. */
const ARO = { r0: 3.9, r1: 4.25, n: 24 } as const;
/** Los toldos de los costados: alto, vuelo y alto del faldón (el cartel). */
const TOLDO_M = { y: 2.78, vuelo: 0.9, t: 0.06, faldon: 0.3 } as const;

/** El marco del salón: el rincón del frente y el costado sur (S0), D a lo largo, P de través, el ancho W y el largo L de
 *  los costados; la esquina redonda tiene el centro en (L, W / 2) y radio W / 2. */
interface Marco { S0: Vec2; D: Vec2; P: Vec2; W: number; L: number; frente: number }
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const unit = (a: Vec2): Vec2 => [a[0] / Math.hypot(a[0], a[1]), a[1] / Math.hypot(a[0], a[1])];

/** El marco del salón a partir de la planta corrida (local) o null si no es la relevada. */
function marco(inside: Vec2[]): Marco | null {
  if (inside.length < 12) return null;
  // el frente es la arista de V más chico; S0, su punta de U más chico, y D, la arista que sale de S0 hacia adentro
  const minV = Math.min(...inside.map((p) => p[1]));
  const front = inside.map((p, k) => k).filter((k) => Math.abs(inside[k][1] - minV) < 0.05);
  if (front.length !== 2) return null;
  const [a, b] = front.map((k) => inside[k]).sort((p, q) => p[0] - q[0]);
  const k0 = inside.findIndex((p) => p === a), n = inside.length;
  const next = [inside[(k0 + 1) % n], inside[(k0 + n - 1) % n]].find((p) => p !== b)!;
  const D = unit(sub(next, a)), L = Math.hypot(next[0] - a[0], next[1] - a[1]);
  let P: Vec2 = [D[1], -D[0]];
  if (dot(sub(b, a), P) < 0) P = [-P[0], -P[1]];
  const W = dot(sub(b, a), P);
  if (W < 11 || L < 25) return null;
  return { S0: a, D, P, W, L, frente: dot(sub(b, a), D) / W };
}

export const venecianaPlan: InteriorPlan = (k) => {
  const m = marco(k.inside);
  if (!m) {
    k.shell({ publicFloors: 1, wall: PARED, floor: CERAMICO, ceiling: MACHIMBRE });
    return k.done(AMBIENT);
  }
  const H = k.height, TECHO = H - ROOF_T;
  /** (d, p) → local. */
  const L = (d: number, p: number): Vec2 => add(add(m.S0, m.D, d), m.P, p);
  /** Un rectángulo en (d, p). */
  const caja = (d0: number, p0: number, d1: number, p1: number): Vec2[] => [L(d0, p0), L(d1, p0), L(d1, p1), L(d0, p1)];
  /** Un polígono regular en (d, p). */
  const ngon = (d: number, p: number, r: number, n: number): Vec2[] =>
    Array.from({ length: n }, (_, j) => L(d + r * Math.cos((2 * Math.PI * j) / n), p + r * Math.sin((2 * Math.PI * j) / n)));
  /** El ángulo local (0 → +V, π/2 → +U) que mira hacia (dd, dp). */
  const mira = (dd: number, dp: number): number => {
    const v = add([m.D[0] * dd, m.D[1] * dd], m.P, dp);
    return Math.atan2(v[0], v[1]);
  };
  /** Lo que mide el frente (de adentro) en D a la altura p. */
  const frente = (p: number): number => m.frente * p;
  const C: [number, number] = [m.L, m.W / 2], R = m.W / 2;

  k.shell({ publicFloors: 1, terrace: true, wall: PARED, floor: [CERAMICO, TERRACOTA], ceiling: MACHIMBRE });

  // ---- la escalera a la terraza, contra el costado sur, con su baranda blanca de caño del lado del salón
  const foot = L(ESCALERA.d0, ESCALERA.p);
  k.stair({ from: 0, to: 1, foot, dir: m.D, width: ESCALERA.w, look: CERAMICO, rail: CAÑO, railStyle: { caño: true, out: true }, approach: ESCALERA.antes });
  barandaDeEscalera(k, m, ESCALERA.d0, ESCALERA.p + ESCALERA.w / 2 - RAIL_T / 2, 0, H, TECHO);

  // ---- la terraza: la baranda de caño todo alrededor, contra el pretil
  const anillo = insetRing(ensureCCW(k.inside), RAIL_T / 2, 2);
  k.railing([...anillo, anillo[0]], 1, CAÑO, { caño: true, out: true });

  // ---- el salón: columnas, vigas, el aro, los spots
  for (const d of [12.6, 19.4]) k.block(ngon(d, m.W / 2, 0.2, 12), 0, TECHO, 'solid', 'otro', { side: BLANCO });
  for (let d = 7.8; d < m.L - ARO.r1 - 0.3; d += 3.0) {
    const p0 = 0, p1 = m.W;
    if (frente(p1) > d - 0.2) continue;
    k.block(caja(d - 0.1, p0, d + 0.1, p1), TECHO - 0.24, TECHO, 'none', 'otro', { side: BLANCO, bottom: BLANCO });
  }
  for (let j = 0; j < ARO.n; j++) {
    const [a0, a1] = [(2 * Math.PI * j) / ARO.n, (2 * Math.PI * (j + 1)) / ARO.n];
    const at = (r: number, a: number): Vec2 => L(C[0] + r * Math.cos(a), C[1] + r * Math.sin(a));
    k.block([at(ARO.r0, a0), at(ARO.r1, a0), at(ARO.r1, a1), at(ARO.r0, a1)], TECHO - 0.08, TECHO, 'none', 'otro', { side: BLANCO, bottom: BLANCO });
  }
  const spot = (d: number, p: number): void => {
    k.block(ngon(d, p, 0.08, 8), TECHO - 0.012, TECHO - 0.004, 'none', 'otro', { bottom: SPOT, side: SPOT });
    k.lamp(L(d, p), TECHO - 0.1, SPOT_R, SPOT_P);
  };
  for (let d = 6.3; d < m.L; d += 3.0) for (const p of [2.6, m.W / 2 + 0.6, m.W - 2.4]) if (frente(p) < d - 0.8) spot(d, p);
  for (const [r, a] of [[2.0, 0], [3.2, Math.PI / 3], [3.2, -Math.PI / 3]] as const) spot(C[0] + r * Math.cos(a), C[1] + r * Math.sin(a));

  // ---- el mostrador de madera y la vitrina de helados, contra el costado norte
  const pm1 = m.W - MOSTRADOR.aire, pm0 = pm1 - MOSTRADOR.fondo;
  k.block(caja(MOSTRADOR.d0, pm0, MOSTRADOR.d1, pm1), 0, MOSTRADOR.h, 'solid', 'mueble', { side: MADERA, top: MADERA });
  const vd1 = VITRINA.d0 + VITRINA.baldes * VITRINA.paso + 0.1;
  k.block(caja(VITRINA.d0 - 0.06, pm0 + 0.06, vd1, pm1 - 0.06), MOSTRADOR.h, MOSTRADOR.h + 0.005, 'none', 'otro', { top: BANDEJA });
  for (let j = 0; j < VITRINA.baldes; j++) {
    for (const [f, p] of [[0, pm0 + 0.27], [1, pm0 + 0.62]] as const) {
      const g = GUSTOS[(j * 3 + f * 5) % GUSTOS.length];
      k.furniture('balde-helado', L(VITRINA.d0 + 0.05 + (j + 0.5) * VITRINA.paso, p), MOSTRADOR.h + 0.005, mira(0, 1), g);
    }
  }
  // el vidrio: el frente, del lado de los clientes, y la tapa sobre los baldes; detrás, abierto (se sirve de ahí)
  k.block(caja(VITRINA.d0 - 0.06, pm0, vd1, pm0 + 0.03), MOSTRADOR.h, VITRINA.tapa + 0.03, 'glass', 'vidrio', { side: VIDRIO, top: VIDRIO });
  k.block(caja(VITRINA.d0 - 0.06, pm0, vd1, pm1 - 0.1), VITRINA.tapa, VITRINA.tapa + 0.03, 'glass', 'vidrio', { side: VIDRIO, top: VIDRIO });
  // la mesada de atrás, contra el vidrio del costado
  k.block(caja(MOSTRADOR.d0 + 0.5, m.W - 0.5, MOSTRADOR.d1 - 0.5, m.W - 0.02), 0, 0.9, 'solid', 'mueble', { side: MADERA, top: BANDEJA });

  // ---- el metegol sobre la alfombra redonda
  k.block(ngon(METEGOL.d, METEGOL.p, METEGOL.r, 32), GROUND_Y, GROUND_Y + 0.01, 'none', 'otro', { top: ALFOMBRA, side: ALFOMBRA });
  k.furniture('metegol', L(METEGOL.d, METEGOL.p), 0, mira(1, 0));

  // ---- las mesas de madera oscura con sus sillas (la mesa a lo largo de D: su ancho va de través al yaw)
  const mesa = (d: number, p: number, y: number, color: string, sillas: string, director = false): void => {
    k.furniture('mesa', L(d, p), y, mira(0, 1), color);
    for (const s of [-1, 1]) for (const dd of [-0.3, 0.3]) {
      k.furniture(director ? 'silla-director' : 'silla', L(d + dd, p + s * 0.68), y, mira(0, -s), sillas);
    }
  };
  for (const d of [10.0, 16.0, 22.0]) mesa(d, 2.9, 0, MADERA_OSCURA, MADERA_OSCURA);
  for (const d of [8.6]) mesa(d, m.W - 2.6, 0, MADERA_OSCURA, MADERA_OSCURA);
  for (const d of [23.0]) mesa(d, m.W - 2.4, 0, MADERA_OSCURA, MADERA_OSCURA);
  // en la esquina redonda, mirando al vidrio
  for (const a of [-Math.PI / 3, 0, Math.PI / 3]) {
    const c: Vec2 = [C[0] + (R - 1.6) * Math.cos(a), C[1] + (R - 1.6) * Math.sin(a)];
    k.furniture('mesa', L(c[0], c[1]), 0, mira(Math.cos(a), Math.sin(a)), MADERA_OSCURA);
    for (const s of [-1, 1]) {
      const q: Vec2 = [c[0] - s * 0.68 * Math.cos(a), c[1] - s * 0.68 * Math.sin(a)];
      k.furniture('silla', L(q[0], q[1]), 0, mira(s * Math.cos(a), s * Math.sin(a)), MADERA_OSCURA);
    }
  }

  // ---- la terraza: mesas de madera con sillas director rojas y sombrillas rojas
  for (const [d, p] of [[11.0, 3.6], [11.0, 8.6], [16.5, 3.6], [16.5, 8.6], [22.0, 6.0]] as const) {
    mesa(d, p, H, MADERA_TERRAZA, ROJO, true);
    k.furniture('sombrilla', L(d, p), H, 0, '#ffffff');
  }

  // ---- afuera: los toldos rojos de los costados con el nombre, y en la vereda, sombrillas, sillas director y mesitas
  toldo(k, L, 4.0, m.L - 1.0, 0, -1);
  toldo(k, L, frente(m.W) + 2.0, m.L - 1.0, m.W, 1);
  vereda(k);

  // ---- marcas y vista
  k.mark('salon', L(9.8, 5.55), 0);
  k.mark('terraza', L(13.6, 6.0), H);
  k.mark('mostrador', L((MOSTRADOR.d0 + MOSTRADOR.d1) / 2, pm0 - 0.8), 0);
  k.mark('metegol', L(METEGOL.d + 1.4, METEGOL.p + 1.2), 0);
  k.view('vidrieras', [9.0, -6.0], 0, 0);
  return k.done(AMBIENT);
};

/** La baranda del costado de la escalera que da al salón, sobre el borde de las huellas (adentro del hueco): un paño de
 *  clase glass (que no se ve) por escalón, y la de caño blanca en pendiente: el pasamanos y un caño intermedio (barras)
 *  y un parante cada tres escalones. `p` es la línea de la baranda (de través), de y0 a y1. Los paños llegan hasta el
 *  cielorraso (`techo`): más arriba, el costado lo cierra la losa del techo, que el cuerpo ya toca. */
function barandaDeEscalera(k: Kit, m: Marco, d0: number, p: number, y0: number, y1: number, techo: number): void {
  const n = Math.ceil((y1 - y0) / 0.2 - 1e-9), r = (y1 - y0) / n, t = RAIL_T / 2;
  const L = (d: number, q: number): Vec2 => add(add(m.S0, m.D, d), m.P, q);
  const nariz = (s: number): number => y0 + r + (s * r) / TREAD;
  for (let i = 1; i < n; i++) {
    const [s0, s1] = [d0 + (i - 1) * TREAD - t, d0 + i * TREAD + t];
    if (y0 + i * r + RAIL_H <= techo + 1e-6) k.block([L(s0, p - t), L(s1, p - t), L(s1, p + t), L(s0, p + t)], y0 + i * r, y0 + i * r + RAIL_H, 'glass', 'baranda', {});
    if ((i - 1) % 3 === 0 || i === n - 1) {
      const c = L(d0 + (i - 0.5) * TREAD, p), h = 0.0225;
      k.block([add(c, [-h, -h]), add(c, [h, -h]), add(c, [h, h]), add(c, [-h, h])], y0 + i * r, nariz((i - 0.5) * TREAD) + 0.88, 'none', 'otro', { side: CAÑO, top: CAÑO });
    }
  }
  const fin = (n - 1) * TREAD;
  const [a, b] = [L(d0, p), L(d0 + fin, p)];
  for (const [alto, h] of [[0.9, 0.045], [0.45, 0.04]] as const) {
    const pa: Vec3 = [a[0], nariz(0) + alto, a[1]], pb: Vec3 = [b[0], nariz(fin) + alto, b[1]];
    barra(k, pa, pb, h, h, CAÑO, { puntas: true });
  }
}

/** Un toldo rojo (`out`) sobre las vidrieras del costado de P = `p` (lado −1: el sur, 1: el norte), de D d0 a d1: la
 *  lona a TOLDO_M.y, con su vuelo, y el faldón con "La Veneciana" cada 9 m. */
function toldo(k: Kit, L: (d: number, p: number) => Vec2, d0: number, d1: number, p: number, lado: -1 | 1): void {
  const o = 0.2 * lado, v = TOLDO_M.vuelo * lado;
  const at = (d: number, q: number): Vec2 => L(d, p + o + q);
  k.block([at(d0, 0), at(d1, 0), at(d1, v - o), at(d0, v - o)], TOLDO_M.y, TOLDO_M.y + TOLDO_M.t, 'none', 'otro', { top: TOLDO, bottom: TOLDO, side: TOLDO }, true);
  const n = Math.max(2, Math.round((d1 - d0) / 9));
  const nrm = unit(sub(at(0, v), at(0, 0)));
  for (let j = 0; j < n; j++) {
    const d = d0 + ((j + 0.5) * (d1 - d0)) / n;
    k.label('La Veneciana', at(d, v - o), TOLDO_M.y - TOLDO_M.faldon / 2 + TOLDO_M.t, nrm, 2.6, TOLDO_M.faldon, NOMBRE, { out: true });
  }
  // el faldón entre los carteles: una franja roja a lo largo del borde
  k.block([at(d0, v - o), at(d1, v - o), at(d1, v - o + 0.02 * lado), at(d0, v - o + 0.02 * lado)], TOLDO_M.y - TOLDO_M.faldon + TOLDO_M.t, TOLDO_M.y + TOLDO_M.t, 'none', 'otro', { side: TOLDO, bottom: TOLDO }, true);
}

/** En la vereda de Espora, delante del frente (V < 0): dos juegos de sombrilla roja, mesita y cuatro sillas director
 *  rojas, lejos del botín, de la puerta y del contenedor. Las mesitas van `out` (sin sólido); lo demás, con el interior. */
function vereda(k: Kit): void {
  for (const c of [[0.6, -2.6], [10.6, -2.4]] as Vec2[]) {
    k.block(Array.from({ length: 12 }, (_, j) => add(c, [0.33 * Math.cos((Math.PI * j) / 6), 0.33 * Math.sin((Math.PI * j) / 6)])), 0.72, 0.75, 'none', 'otro', { top: MESITA, side: MESITA, bottom: MESITA }, true);
    k.furniture('sombrilla', c, 0, 0, '#ffffff');
    for (let j = 0; j < 4; j++) {
      const a = (Math.PI / 2) * j + Math.PI / 4;
      k.furniture('silla-director', add(c, [0.72 * Math.sin(a), 0.72 * Math.cos(a)]), 0, a + Math.PI, ROJO);
    }
  }
}
