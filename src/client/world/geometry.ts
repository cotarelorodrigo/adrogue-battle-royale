import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { PARAPET_H, parapetEdges } from '../../shared/collision.ts';
import type { Vec2, Vec3 } from '../../shared/geo.ts';
import { ensureCCW, pointInPolygon } from '../../shared/geo.ts';
import type { Building, FacadeGround, Opening } from '../../shared/mapdata.ts';
import { SUN_DIR } from '../render/sun.ts';
import { LOT_OPENINGS } from '../../shared/interiors/openings.ts';
import { SHOP_GLASS, cellRect, panesOf } from './front-atlas.ts';
import { frontGeometry } from './fronts.ts';
import type { WorldMaterials } from './types.ts';
import { BAY_W, cutRect, edgeHoles, facing, FLOOR_H, lattice, newBuilder, quad, tintColor, toGeometry, vert } from './wall-kit.ts';
import type { Builder, Rect } from './wall-kit.ts';

export { FLOOR_H, BAY_W };
const MITER_LIMIT = 2;
const PLANAR_UV = 4;

/** Triangula un polígono simple (x,z), con sus agujeros si tiene, y emite triángulos con normal +y. Los vértices ya
 *  están en b (en orden: los del contorno y después los de cada agujero). */
export function triangulateUp(poly: Vec2[], base: number, idx: number[], holes: Vec2[][] = []): void {
  // Pasamos (x, −z): así un polígono antihorario desde arriba también lo es en el plano 2D.
  const flip = (r: Vec2[]): THREE.Vector2[] => r.map(([x, z]) => new THREE.Vector2(x, -z));
  const all = holes.length === 0 ? poly : [...poly, ...holes.flat()];
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(flip(poly), holes.map(flip))) {
    const cross = (all[b][0] - all[a][0]) * (all[c][1] - all[a][1]) - (all[b][1] - all[a][1]) * (all[c][0] - all[a][0]);
    // normal.y = −(cross en x,z) con x/z de mano derecha invertida: y>0 si cross < 0
    if (cross < 0) idx.push(base + a, base + b, base + c);
    else idx.push(base + a, base + c, base + b);
  }
}

/** Lo que un interior le abre al techo de su edificio (D13, Interior.roofHoles): sus huecos (mundo) y, si un lucernario
 *  los tapa y sobresale del techo, sus paños de vidrio (los Pane `sky`: las aguas y los tímpanos; las esquinas en el
 *  mundo y la normal del lado de afuera). */
/** `terrace`: el color de la baldosa de una terraza (Interior.terrace): de lejos, sin el interior, el techo va teñido
 *  de ella (roofColor). */
export interface RoofCut { holes: Vec2[][]; skylight: { corners: Vec3[]; normal: Vec3 }[]; terrace?: string }
const NO_CUT: RoofCut = { holes: [], skylight: [] };

/** El promedio lineal de techo_diff.jpg (la textura del techo, sRGB ≈ (118, 107, 89)) y el tono lineal de la baldosa de
 *  los interiores (textures.ts: el gris 230 con la junta 150). */
export const TECHO_LINEAL: Vec3 = [0.1936, 0.1575, 0.1077];
export const BALDOSA_TONO = 0.76;
/** El color por vértice del techo (material `roof`): blanco, la textura tal cual; el de una terraza, el tinte que lleva
 *  el promedio de la textura al de su baldosa (el color por el tono): de lejos se lee como de cerca (T8, H12). */
function roofColor(cut: RoofCut): THREE.Color {
  if (!cut.terrace) return new THREE.Color(1, 1, 1);
  const c = new THREE.Color(cut.terrace); // lineal
  return new THREE.Color((c.r * BALDOSA_TONO) / TECHO_LINEAL[0], (c.g * BALDOSA_TONO) / TECHO_LINEAL[1], (c.b * BALDOSA_TONO) / TECHO_LINEAL[2]);
}

/** La planta menos los huecos: en pedazos, cada uno con su contorno y sus agujeros. Sin huecos, la planta tal cual. */
function capPieces(fp: Vec2[], holes: Vec2[][]): Vec2[][][] {
  if (holes.length === 0) return [[fp]];
  const ring = (r: Vec2[]): [number, number][] => [...r, r[0]].map((p): [number, number] => [p[0], p[1]]);
  return polygonClipping.difference([ring(fp)], ...holes.map((h) => [ring(h)]))
    .map((pg) => pg.map((r) => r.slice(0, -1).map((p): Vec2 => [p[0], p[1]])));
}

/** El techo: la planta `fp` a la altura `y`, con normal +y; con `down`, la misma planta mirando para abajo (la cáscara
 *  de sombra). El techo del chunk y el de la cáscara salen de acá y del mismo polígono, con los mismos huecos (`holes`,
 *  los de RoofCut: el atrio de la Casa de la Cultura, la escalera de una terraza): un hueco se abre en los dos. */
function roofCap(b: Builder, fp: Vec2[], y: number, color: THREE.Color, down = false, holes: Vec2[][] = []): void {
  for (const [outer, ...inner] of capPieces(fp, holes)) {
    const base = b.pos.length / 3;
    for (const [x, z] of [outer, ...inner].flat()) vert(b, [x, y, z], [0, down ? -1 : 1, 0], [x / PLANAR_UV, z / PLANAR_UV], color);
    const idx: number[] = [];
    triangulateUp(outer, base, idx, inner);
    if (down) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    b.idx.push(...idx);
  }
}

/** El vidrio de la tapa de un lucernario en el atlas del frente: el medio del primer paño de la vidriera (entre el
 *  marco y el primer parteluz, a media altura), sacado de LOT_OPENINGS y del ancho de paño con que la pinta el atlas.
 *  Toda la tapa toma ese color (con uv constante no hay mipmaps que lo mezclen con el marco). */
export const SKY_GLASS_UV: [number, number] = (() => {
  const r = cellRect('vidriera');
  const o = LOT_OPENINGS.vidriera.find((x) => x.kind === 'vidrio')!;
  const [x, y] = [o.x0 + (o.x1 - o.x0) / panesOf('vidriera', o) / 2, (o.y0 + o.y1) / 2];
  return [r.u0 + ((r.u1 - r.u0) * x) / BAY_W, r.v0 + ((r.v1 - r.v0) * y) / FLOOR_H];
})();

/**
 * La tapa de los huecos del techo (D6, D13): de lejos, mientras el interior no se dibuja. Un hueco sin lucernario (el
 * de una escalera que llega a la terraza) se tapa con el techo, plano y a la altura del techo (material `roof`). Uno con
 * lucernario, con sus paños de vidrio (en pendiente: las aguas y los tímpanos, por el lado de afuera) y el color del
 * vidrio: en un lote, en el atlas del frente con el vidrio de la vidriera (la tapa de sus aberturas ya es de ese
 * material: no suma mallas); si no, en `parapet`, con el vértice del color del vidrio.
 */
function roofTapa(bd: Building, roof: RoofCut, color: THREE.Color, tapa: (mat: keyof WorldMaterials) => () => Builder): void {
  const top = roofColor(roof);
  const lot = bd.front !== undefined;
  const glass = lot ? new THREE.Color(1, 1, 1) : tintColor(SHOP_GLASS[1]);
  for (const hole of roof.holes) {
    // un paño es de este hueco si su medio, corrido un poco hacia adentro (contra su normal), cae en el hueco: el de un
    // tímpano está justo sobre el borde
    const panes = roof.skylight.filter((s) => {
      const c = s.corners.reduce<Vec3>((a, p) => [a[0] + p[0] / s.corners.length, a[1], a[2] + p[2] / s.corners.length], [0, 0, 0]);
      return pointInPolygon([c[0] - s.normal[0] * 0.05, c[2] - s.normal[2] * 0.05], hole);
    });
    if (panes.length === 0) {
      roofCap(tapa('roof')(), hole, bd.height, top);
      continue;
    }
    const t = tapa(lot ? 'front' : 'parapet')();
    const uv = (p: Vec3): [number, number] => (lot ? SKY_GLASS_UV : [p[0] / PLANAR_UV, p[2] / PLANAR_UV]);
    for (const s of panes) {
      const corners = facing(s.corners, s.normal), base = t.pos.length / 3;
      for (const p of corners) vert(t, p, s.normal, uv(p), glass);
      for (let k = 1; k + 1 < corners.length; k++) t.idx.push(base, base + k, base + k + 1);
    }
  }
}

/** La cáscara de sombra (H1) se mete esto (m) adentro: las paredes, SHELL_WALL_IN de su arista, y el techo, SHELL_ROOF_IN
 *  abajo del techo (N2). A 5 cm de todo, con el sol rasante, el PCF de la sombra (unos 0,22 m de radio en alta) y el
 *  bias (~0,2 m) no alcanzaban: una pared al sol se tapaba a sí misma con la cáscara de atrás (un serrucho) y, arriba,
 *  con el borde del techo de la cáscara (una banda). Quedan detrás de lo que dibuja el interior: las paredes de afuera
 *  del Kit miden WALL_OUT = 0,2 m y la losa del techo, 0,8 m. */
const SHELL_WALL_IN = 0.15;
const SHELL_ROOF_IN = 0.05;

/** Dónde arranca la arista corrida `o` hacia adentro, contando desde su punta, para cortarse con la vecina corrida
 *  `oOther`: `away` es la dirección de la arista que se aleja de la esquina, `m` su normal hacia adentro y `other`, la
 *  de la vecina. Con las dos corridas lo mismo, en una esquina recta es lo corrido; en una aguda, más; en una casi
 *  llana, casi nada. */
function cornerAt(o: number, oOther: number, away: Vec2, m: Vec2, other: Vec2): number {
  const den = away[0] * other[0] + away[1] * other[1];
  return Math.abs(den) < 1e-9 ? 0 : (oOther - o * (m[0] * other[0] + m[1] * other[1])) / den;
}

/**
 * La cáscara de sombra de un edificio con aberturas (H1), en `b` (el techo del chunk, que ya proyecta: sin draw calls
 * nuevos). La pasada de sombras dibuja las caras de espaldas al sol, y por una abertura de ese lado un rayo de sol
 * entraba y salía por el techo o por una pared maciza del lado del sol, que miran al sol y no se dibujan: dejaba una
 * mancha de sol en la sombra. La cáscara es lo macizo mirando para adentro:
 * - en cada arista que mira al sol (por donde sale un rayo), sus piezas macizas (las de cutRect con los mismos huecos),
 *   SHELL_WALL_IN hacia adentro y dadas vuelta, recortadas hasta tocar justo a las vecinas. Las de espaldas al sol no
 *   llevan: dadas vuelta mirarían al sol y la pasada de sombras no las dibujaría;
 * - el techo, con normal −y a `height − SHELL_ROOF_IN`, del mismo polígono y con roofCap como el del chunk (un hueco que
 *   se le abra a `fp` se abre en los dos), corrido hasta esas paredes. Del lado de la sombra llega al borde: un rayo que
 *   entra rasante por una vidriera no sale por el techo entre la pared y la cáscara.
 * Depende del sol (fijo). Desde afuera son caras de atrás; desde adentro quedan detrás de las paredes y la losa del
 * interior. Un rayo que cruza dos aberturas sigue pasando.
 */
function shadowShell(b: Builder, fp: Vec2[], height: number, holes: Map<number, Rect[]>, color: THREE.Color, roofHoles: Vec2[][]): void {
  const n = fp.length;
  // dirección y normal hacia adentro de cada arista: adentro es −n, con n = (−ez, ex) la normal de afuera
  const dir = fp.map((a, i): Vec2 => {
    const c = fp[(i + 1) % n], len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    return [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
  });
  const inward = dir.map(([ex, ez]): Vec2 => [ez, -ex]);
  const sunny = inward.map(([mx, mz]) => -(mx * SUN_DIR.x + mz * SUN_DIR.z) > 1e-6);
  const off = sunny.map((s) => (s ? SHELL_WALL_IN : 0));
  const prev = (i: number): number => (i + n - 1) % n, next = (i: number): number => (i + 1) % n;
  const start = (i: number): number => cornerAt(off[i], off[prev(i)], dir[i], inward[i], inward[prev(i)]);
  // el contorno de la cáscara: en cada vértice de fp, donde se cortan las dos aristas corridas
  const inner = fp.map((a, i): Vec2 => [a[0] + dir[i][0] * start(i) + inward[i][0] * off[i], a[1] + dir[i][1] * start(i) + inward[i][1] * off[i]]);
  roofCap(b, inner, height - SHELL_ROOF_IN, color, true, roofHoles);
  for (let i = 0; i < n; i++) {
    if (!sunny[i]) continue;
    const a = fp[i], c = fp[next(i)];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const [ex, ez] = dir[i];
    const s0 = start(i);
    const s1 = len - cornerAt(off[i], off[next(i)], [-ex, -ez], inward[i], inward[next(i)]);
    if (s1 - s0 < 1e-3) continue;
    const at = (s: number): Vec2 => [a[0] + ex * s + ez * off[i], a[1] + ez * s - ex * off[i]];
    for (const r of cutRect({ s0, s1, y0: 0, y1: height }, holes.get(i) ?? []).solid) {
      const [p, q] = [at(r.s0), at(r.s1)];
      const [u0, u1, v0, v1] = [r.s0 / PLANAR_UV, r.s1 / PLANAR_UV, r.y0 / PLANAR_UV, r.y1 / PLANAR_UV];
      quad(b, [[q[0], r.y0, q[1]], [p[0], r.y0, p[1]], [p[0], r.y1, p[1]], [q[0], r.y1, q[1]]], [[u1, v0], [u0, v0], [u0, v1], [u1, v1]], [ez, 0, -ex], color);
    }
  }
}

/** Dónde se parten las paredes de un edificio con aberturas para no dejar juntas en T (wall-kit.ts, lattice): a lo largo
 *  de la arista i, en las puntas de sus huecos (`s(i)`, de todas las bandas: la de arriba también, que se junta en
 *  3,2 m); en alto, en las de todos los huecos y en cada piso (`y`, iguales en todas las aristas: se juntan en las
 *  esquinas). Sin aberturas, nada: una banda entera es un cuadrilátero. */
export interface WallMarks { s: (i: number) => number[]; y: number[] }
const NO_MARKS: WallMarks = { s: () => [], y: [] };

/** `colorOf(i)`: color de la arista i de `fp`, o null para saltearla (va en otra banda). Los huecos de cada arista
 *  (`holes`) no se dibujan: lo recortado va a `tapa()`, con las mismas uv. Los pedazos se parten en `marks`. */
function wallBand(fp: Vec2[], cum: number[], y0: number, y1: number, colorOf: (i: number) => THREE.Color | null,
  holes: Map<number, Rect[]>, tapa: () => Builder, marks: WallMarks = NO_MARKS): THREE.BufferGeometry {
  const b = newBuilder(true);
  for (let i = 0; i < fp.length; i++) {
    const color = colorOf(i);
    if (!color) continue;
    const a = fp[i], c = fp[(i + 1) % fp.length];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const n: [number, number, number] = [-dz / len, 0, dx / len];
    const piece = (to: Builder, r: Rect): void => {
      const [p, q] = [[a[0] + (dx * r.s0) / len, a[1] + (dz * r.s0) / len], [a[0] + (dx * r.s1) / len, a[1] + (dz * r.s1) / len]];
      const u0 = (cum[i] + r.s0) / BAY_W, u1 = (cum[i] + r.s1) / BAY_W;
      quad(to, [[p[0], r.y0, p[1]], [q[0], r.y0, q[1]], [q[0], r.y1, q[1]], [p[0], r.y1, p[1]]],
        [[u0, r.y0 / FLOOR_H], [u1, r.y0 / FLOOR_H], [u1, r.y1 / FLOOR_H], [u0, r.y1 / FLOOR_H]], n, color);
    };
    const { solid, cut } = cutRect({ s0: 0, s1: len, y0, y1 }, holes.get(i) ?? []);
    const ss = marks.s(i);
    for (const r of lattice(solid, ss, marks.y)) piece(b, r);
    for (const r of lattice(cut, ss, marks.y)) piece(tapa(), r);
  }
  return toGeometry(b);
}

/** El pretil de collision.ts (parapetEdges, PARAPET_H): lo que se ve es lo que frena. La cara de afuera, al ras de la
 *  pared, se parte en `splits(i)` (metros desde fp[i]): los vértices del borde de arriba de la pared, así no quedan
 *  juntas en T con ella. */
function parapetRing(fp: Vec2[], cum: number[], y0: number, color: THREE.Color, splits: (i: number) => number[] = () => []): THREE.BufferGeometry {
  const b = newBuilder(true);
  const y1 = y0 + PARAPET_H;
  for (const { i, a, c, ai, ci } of parapetEdges(fp)) {
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    const nx = -dz / len, nz = dx / len;
    const u0 = cum[i] / BAY_W, u1 = (cum[i] + len) / BAY_W;
    const v0 = y0 / FLOOR_H, v1 = y1 / FLOOR_H;
    // cara exterior (al ras de la pared)
    for (const r of lattice([{ s0: 0, s1: len, y0, y1 }], splits(i), [])) {
      const [p, q] = [[a[0] + (dx * r.s0) / len, a[1] + (dz * r.s0) / len], [a[0] + (dx * r.s1) / len, a[1] + (dz * r.s1) / len]];
      const [ua, ub] = [(cum[i] + r.s0) / BAY_W, (cum[i] + r.s1) / BAY_W];
      quad(b, [[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]],
        [[ua, v0], [ub, v0], [ub, v1], [ua, v1]], [nx, 0, nz], color);
    }
    // cara interior (mira hacia adentro): winding invertido
    quad(b, [[ci[0], y0, ci[1]], [ai[0], y0, ai[1]], [ai[0], y1, ai[1]], [ci[0], y1, ci[1]]],
      [[u1, v0], [u0, v0], [u0, v1], [u1, v1]], [-nx, 0, -nz], color);
    // tope
    const uv = (p: Vec2): [number, number] => [p[0] / PLANAR_UV, p[1] / PLANAR_UV];
    quad(b, [[a[0], y1, a[1]], [c[0], y1, c[1]], [ci[0], y1, ci[1]], [ai[0], y1, ai[1]]],
      [uv(a), uv(c), uv(ci), uv(ai)], [0, 1, 0], color);
  }
  return toGeometry(b);
}

/** El material de la planta baja de cada tipo de fachada de lugar (`bd.facades`). */
export const GROUND_MAT: Record<FacadeGround, keyof WorldMaterials> = { shop: 'wallGroundShop', house: 'wallGroundHouse', brick: 'brickGround' };

/** Los materiales de las bandas de pared de un edificio. Un lote dibuja su frente con el atlas (`front`) y sus
 *  medianeras y fondos con revoque liso teñido, sin ventanas (`parapet`). */
export function wallMaterials(bd: Building): { ground: keyof WorldMaterials; upper: keyof WorldMaterials } {
  if (bd.front) return { ground: 'parapet', upper: 'parapet' };
  const brick = bd.wall === 'brick';
  return { ground: brick ? 'brickGround' : bd.kind === 'house' ? 'wallGroundHouse' : 'wallGroundShop', upper: brick ? 'brickUpper' : 'wallUpper' };
}

/**
 * `walls.ground` es la planta baja de las aristas comunes; las de `bd.facades` van aparte en `walls.overrides`, una
 * geometría por tipo de planta baja (el que dibuja las suma al merge de ese material, sin draw calls nuevos).
 * Un lote (`bd.front`) saca de ground/upper las aristas de su frente y su esquina: las dibuja `walls.front`.
 * Las paredes no dibujan nada adentro de `openings` (las aberturas de su interior, en cualquier arista): lo recortado
 * vuelve en `tapas`, una geometría por material de pared (wallMaterials, GROUND_MAT o `front`), para taparlas de lejos
 * (D6). Con aberturas, `roof` suma la cáscara de sombra (shadowShell). Los huecos del techo de `cut` (D13) se abren en
 * el techo y en la cáscara, y sus tapas van también a `tapas` (roofTapa).
 */
export function extrudeBuilding(bd: Building, openings: readonly Opening[] = [], cut: RoofCut = NO_CUT): {
  walls: { ground: THREE.BufferGeometry; upper: THREE.BufferGeometry; front: THREE.BufferGeometry; overrides: { ground: FacadeGround; geometry: THREE.BufferGeometry }[] };
  roof: THREE.BufferGeometry;
  parapet: THREE.BufferGeometry;
  tapas: Partial<Record<keyof WorldMaterials, THREE.BufferGeometry>>;
} {
  const fp = ensureCCW(bd.footprint);
  const color = tintColor(bd.tint);
  // facades cuenta aristas sobre el footprint guardado; si ensureCCW lo dio vuelta, la arista i es la n − 2 − i
  const n = fp.length;
  const flipped = fp !== bd.footprint;
  const edgeOf = (e: number): number => (flipped ? (2 * n - 2 - e) % n : e);
  const own = new Map<number, { ground: FacadeGround; color: THREE.Color }>();
  for (const f of bd.facades ?? []) {
    own.set(edgeOf(f.edge), { ground: f.ground, color: f.tint ? tintColor(f.tint) : color });
  }

  const cum: number[] = [0];
  for (let i = 0; i < fp.length; i++) {
    const c = fp[(i + 1) % fp.length];
    cum.push(cum[i] + Math.hypot(c[0] - fp[i][0], c[1] - fp[i][1]));
  }

  // aristas del frente de un lote: las dibuja walls.front
  const lotEdges = new Set([...(bd.front?.edges ?? []), ...(bd.front?.corner ?? [])].map(edgeOf));

  const groundH = Math.min(FLOOR_H, bd.height);
  const grounds = [...new Set([...own.values()].map((o) => o.ground))].sort();
  const holes = edgeHoles(bd.footprint, fp, edgeOf, openings);
  // con aberturas, las paredes se parten sin juntas en T (T11c): en las puntas de los huecos de cada arista y, en alto,
  // en las de todos y en cada piso (el frente de un lote se parte por piso y su banda de arriba)
  const floorsY = Array.from({ length: Math.max(1, bd.floors) + 1 }, (_, r) => r * FLOOR_H).filter((y) => y < bd.height);
  const marks: WallMarks = openings.length === 0 ? NO_MARKS : {
    s: (i) => (holes.get(i) ?? []).flatMap((h) => [h.s0, h.s1]),
    y: [...floorsY, bd.height, ...[...holes.values()].flat().flatMap((h) => [h.y0, h.y1])],
  };

  const rb = newBuilder(true), top = roofColor(cut);
  roofCap(rb, fp, bd.height, top, false, cut.holes);
  if (openings.length > 0) shadowShell(rb, fp, bd.height, holes, top, cut.holes);
  const mats = wallMaterials(bd);
  const tapaBuilders = new Map<keyof WorldMaterials, Builder>();
  const tapa = (mat: keyof WorldMaterials) => (): Builder => {
    let t = tapaBuilders.get(mat);
    if (!t) tapaBuilders.set(mat, (t = newBuilder(true)));
    return t;
  };
  roofTapa(bd, cut, color, tapa);
  const walls = {
    ground: wallBand(fp, cum, 0, groundH, (i) => (own.has(i) || lotEdges.has(i) ? null : color), holes, tapa(mats.ground), marks),
    // edificio más bajo que un piso: sin banda superior (geometría vacía)
    upper: bd.height > FLOOR_H
      ? wallBand(fp, cum, FLOOR_H, bd.height, (i) => (lotEdges.has(i) ? null : color), holes, tapa(mats.upper), marks)
      : toGeometry(newBuilder(true)),
    front: bd.front ? frontGeometry(bd, fp, edgeOf, openings, tapa('front'), marks.y) : toGeometry(newBuilder(true)),
    overrides: grounds.map((ground) => ({
      ground,
      geometry: wallBand(fp, cum, 0, groundH, (i) => { const o = own.get(i); return o?.ground === ground ? o.color : null; }, holes, tapa(GROUND_MAT[ground]), marks),
    })),
  };
  // el pretil, partido donde la pared de abajo tiene vértices en su borde de arriba (con aberturas: sin juntas en T)
  const splits = openings.length === 0 ? undefined : topSplits(fp, bd.height, [walls.ground, walls.upper, walls.front, ...walls.overrides.map((o) => o.geometry)]);
  return {
    walls,
    roof: toGeometry(rb),
    // un relleno de hueco (mapgen/pockets.ts) es un parche de techo entre vecinos: sin pretil propio
    parapet: bd.fill ? toGeometry(newBuilder(true)) : parapetRing(fp, cum, bd.height, color, splits),
    tapas: Object.fromEntries([...tapaBuilders].map(([mat, t]) => [mat, toGeometry(t)])),
  };
}

/** De cada arista de `fp`, los vértices de `gs` sobre su recta a la altura `y` (en metros desde fp[i]). */
function topSplits(fp: Vec2[], y: number, gs: THREE.BufferGeometry[]): (i: number) => number[] {
  const pts: Vec2[] = [];
  for (const g of gs) {
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) if (Math.abs(pos.getY(k) - y) < 1e-6) pts.push([pos.getX(k), pos.getZ(k)]);
  }
  return (i) => {
    const [a, c] = [fp[i], fp[(i + 1) % fp.length]];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const e: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    return pts.filter((p) => Math.abs((p[0] - a[0]) * e[1] - (p[1] - a[1]) * e[0]) < 1e-4).map((p) => (p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]);
  };
}

/** `startV`: v (metros recorridos / 4) en el primer punto, para continuar la textura entre tramos. */
export function ribbon(points: Vec2[], width: number, y: number, startV = 0): THREE.BufferGeometry {
  const pts: Vec2[] = [];
  for (const p of points) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) pts.push([p[0], p[1]]);
  }
  const b = newBuilder(false);
  if (pts.length < 2) return toGeometry(b);
  const h = width / 2;
  const dirs: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dz);
    dirs.push([dx / l, dz / l]);
  }
  // extremos extendidos h a lo largo de la tangente
  const ext = pts.map((p) => [p[0], p[1]] as Vec2);
  ext[0] = [pts[0][0] - dirs[0][0] * h, pts[0][1] - dirs[0][1] * h];
  const last = pts.length - 1;
  ext[last] = [pts[last][0] + dirs[last - 1][0] * h, pts[last][1] + dirs[last - 1][1] * h];

  let dist = 0;
  const uMax = width / PLANAR_UV;
  for (let i = 0; i < ext.length; i++) {
    if (i > 0) dist += Math.hypot(ext[i][0] - ext[i - 1][0], ext[i][1] - ext[i - 1][1]);
    const d1 = dirs[Math.max(i - 1, 0)], d2 = dirs[Math.min(i, dirs.length - 1)];
    const n1: Vec2 = [-d1[1], d1[0]], n2: Vec2 = [-d2[1], d2[0]];
    const mx = n1[0] + n2[0], mz = n1[1] + n2[1], ml = Math.hypot(mx, mz);
    let ox: number, oz: number;
    if (ml < 1e-6) { ox = n2[0] * h; oz = n2[1] * h; }
    else {
      const len = Math.min((2 * h) / ml, MITER_LIMIT * h);
      ox = (mx / ml) * len; oz = (mz / ml) * len;
    }
    const v = startV + (dist - h) / PLANAR_UV;
    vert(b, [ext[i][0] + ox, y, ext[i][1] + oz], [0, 1, 0], [0, v]);
    vert(b, [ext[i][0] - ox, y, ext[i][1] - oz], [0, 1, 0], [uMax, v]);
  }
  // Cada cuadrilátero se orienta para que la normal sea +y sin depender del signo del giro.
  const pos = b.pos;
  const up = (a: number, c: number, d: number): void => {
    const cross = (pos[c * 3] - pos[a * 3]) * (pos[d * 3 + 2] - pos[a * 3 + 2]) - (pos[c * 3 + 2] - pos[a * 3 + 2]) * (pos[d * 3] - pos[a * 3]);
    if (cross < 0) b.idx.push(a, c, d); else b.idx.push(a, d, c);
  };
  for (let i = 0; i < ext.length - 1; i++) {
    const l0 = i * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
    up(l0, l1, r1);
    up(l0, r1, r0);
  }
  return toGeometry(b);
}

export function polygonGeometry(poly: Vec2[], y: number, uvScale: number): THREE.BufferGeometry {
  const b = newBuilder(false);
  const p = ensureCCW(poly);
  for (const [x, z] of p) vert(b, [x, y, z], [0, 1, 0], [x / uvScale, z / uvScale]);
  triangulateUp(p, 0, b.idx);
  return toGeometry(b);
}
