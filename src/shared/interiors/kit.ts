// El kit con que cada plan arma su interior (§2.1): las paredes de afuera cortadas en las aberturas, las losas, el techo
// y el bloque cerrado (`shell`), y después tabiques, escaleras, barandas, sólidos, muebles, carteles, luces, vistas y
// puntos con nombre. El plan trabaja en el marco local del interior (U a lo largo del frente, V hacia adentro; los
// ángulos: 0 mira a +V y π/2 a +U) y el kit pasa todo al mundo. Determinista y sin DOM: lo usan la colisión, mapgen y
// el cliente.
import polygonClipping from 'polygon-clipping';
import { ensureCCW, insetRing, pointInPolygon, polygonArea, signedAreaFromAbove, toLocal, toWorld } from '../geo.ts';
import type { Vec2, Vec3 } from '../geo.ts';
import type { Building, InteriorInput, Opening, SignLook, Tree } from '../mapdata.ts';
import { LEVEL_H, LINTEL_MIN, doorsOf } from './openings.ts';
import { add } from './plan-util.ts';
import type { Block, Collide, FloorArea, Interior, Item, ItemModel, Label, LabelDrawing, Lamp, Look, Pane, Role, StairRun, Viewpoint } from './types.ts';

/** Espesores (m): pared de afuera, tabique, losa entre pisos y techo. */
export const WALL_OUT = 0.2, WALL_IN = 0.1, SLAB_T = 0.2, ROOF_T = 0.8;
/** Escaleras (§2.1): contrahuella máxima, huella y ancho mínimo (m). */
export const RISER_MAX = 0.2, TREAD = 0.3, STAIR_MIN_W = 1.2;
/** Alto de las barandas (m). */
export const RAIL_H = 1.0;
/** Un mueble con cuerpo de este alto (m) o más es sólido (§2.3); las mesas también. */
export const SOLID_MIN_H = 0.7;
/** La planta baja se dibuja a este alto, sin sólido: el suelo del mundo (y = 0) es el que apoya. La baldosa de una
 *  terraza, igual: GROUND_Y arriba del techo (que apoya), así no se pisa con el techo del chunk, a height (H8 de la
 *  revisión de la tarea 5). */
export const GROUND_Y = 0.02;

/** Las cajas sólidas de los muebles de §2.3: `w` sobre el +x del modelo, `d` sobre su +z y `h` de alto desde su `at`.
 *  Lo que no está acá (sillas, banquetas, lámparas, la hoja de vidrio, el turnero colgado, las sillas de espera) se
 *  atraviesa. Bancos (tarea 6): el cajero automático de pie, el escritorio (sin sus sillas) y el tramo de mostrador de
 *  un puesto de caja, de 1,1 m de alto (la mampara de vidrio, de 1,1 a 2,4 m, la pone el plan como bloque `glass`).
 *  Casa de la Cultura (tarea 7): el panel de una muestra, un tabique suelto de 1,6 × 2,2 m sobre dos pies; el plafón
 *  (colgado sobre el atrio) y las butacas del auditorio se atraviesan. */
export const MODEL_BOX: Partial<Record<ItemModel, { w: number; d: number; h: number }>> = {
  mesa: { w: 1.2, d: 0.8, h: 0.75 },
  sillon: { w: 0.85, d: 0.85, h: 0.8 },
  cajero: { w: 0.7, d: 0.6, h: 1.6 },
  escritorio: { w: 1.4, d: 0.7, h: 0.75 },
  'puesto-caja': { w: 1.9, d: 0.6, h: 1.1 },
  'panel-muestra': { w: 1.6, d: 0.12, h: 2.2 },
  // McDonald's y La Veneciana (tarea 8): la mesa redonda de 0,7 m, la freidora de una cuba (con su respaldo), la
  // heladera de acero de dos puertas (las de cocina miden ~1,3 m de ancho), la mesa de picnic con sus dos bancos y el
  // metegol (sin las barras ni las manijas)
  'mesa-redonda': { w: 0.7, d: 0.7, h: 0.75 },
  freidora: { w: 0.5, d: 0.8, h: 1.1 },
  heladera: { w: 1.3, d: 0.8, h: 2.0 },
  'mesa-picnic': { w: 1.8, d: 1.5, h: 0.75 },
  metegol: { w: 0.76, d: 1.42, h: 0.9 },
  // Cine Pixel y Guernica (tarea 9): la butaca del cine (sólida, §2.3: las filas no se cruzan, se va por los pasillos),
  // la máquina de pochoclo sobre su carrito y la mesa alta de bar
  butaca: { w: 0.55, d: 0.62, h: 1.0 },
  pochoclera: { w: 0.9, d: 0.6, h: 1.75 },
  'mesa-alta': { w: 0.6, d: 0.6, h: 1.05 },
  // Estación Adrogué (tarea 10): el molinete de trípode entero, su gabinete y el paso con los brazos (0,28 + 0,6 m a lo
  // ancho, 0,9 de fondo: sólido, §2.3; se pasa por el molinete ancho, D3), la terminal de carga SUBE de pie y el banco
  // de listones con su respaldo de 0,8 m
  molinete: { w: 0.88, d: 0.9, h: 1.0 },
  sube: { w: 0.56, d: 0.42, h: 1.62 },
  'banco-respaldo': { w: 1.8, d: 0.56, h: 0.8 },
};

/** `holes`: huecos (marco local) en la losa de un nivel; los del nivel `publicFloors` atraviesan el bloque cerrado o el
 *  techo (D13). `floor` y `ceiling`: uno para todos los niveles o uno por nivel (el último sigue para los de arriba). */
export interface ShellOpts { publicFloors: number; terrace?: true; holes?: { level: number; polygon: Vec2[] }[]; wall: Look; floor: Look | Look[]; ceiling: Look | Look[] }
/** Un tabique de `from` a `to` (marco local), centrado en esa recta. `gaps`: huecos con `at` (m desde `from`, al medio
 *  del hueco), `width` y `height` desde `y0`; arriba, dintel. `glassLeaf`: la hoja de vidrio dibujada abierta (D10). */
export interface WallOpts { t?: number; y0?: number; y1?: number; gaps?: { at: number; width: number; height: number; glassLeaf?: true }[]; look: Look; collide?: Collide }
/** Una escalera del nivel `from` al `to`: `foot` es el medio del primer escalón, en el piso de abajo, y sube hacia `dir`.
 *  `railStyle`: el de las barandas de su hueco (RailStyle). */
export interface StairOpts {
  from: number; to: number; foot: Vec2; dir: Vec2; width: number; look: Look; rail?: Look; railStyle?: RailStyle; out?: true;
  /**
   * Metros (≥ 0; por defecto 0) que el hueco de las losas de arriba arranca antes del pie, hacia −`dir`; la baranda del
   * hueco lo rodea igual. Hace falta si el pie queda bajo una losa (no en un atrio): sin eso, el borde de la losa cae
   * justo sobre el primer escalón y el análisis de huecos del suelo (pockets.ts: parado sobre un sólido bajo, sin nada de
   * 2,4 a 4,2 m) no une la escalera con el piso, y `build:map` pone una escalera de mano adentro. Con ≥ 2 radios del
   * jugador (0,75), sí la une. Lo usa La Veneciana (tarea 8).
   */
  approach?: number;
  /**
   * El pasamanos en pendiente (H9 de la T8), mirando la subida: 'izq', 'der' o 'ambos'. Va sobre el borde de las huellas,
   * adentro del ancho, con un paño de RAIL_H por escalón (clase glass, D4), las barras en pendiente sobre la línea de las
   * narices y un parante cada tres escalones. Un paño que pasaría el cielorraso de al lado (una losa de arriba, sin hueco
   * ahí) no va: el costado lo cierra esa losa, a menos de RAIL_H del escalón. Como las barandas del hueco, sigue a
   * `railStyle`: de vidrio, el paño con el look de `rail` y un pasamanos a HANDRAIL.vidrio; de caño, el paño no se ve y
   * se ven el pasamanos y un intermedio (HANDRAIL.caño).
   */
  handrail?: 'izq' | 'der' | 'ambos';
  /** El color del pasamanos y de los parantes; por defecto, el de `rail`. */
  handrailLook?: Look;
  /** Un tramo adentro del nivel `from` (con `to` = `from`): sube `rise` m sobre su piso, sin hueco en las losas ni barandas
   *  de hueco; arriba llega a lo que arme el plan (las gradas de un cine, T9). */
  rise?: number;
  /** Descansos: el escalón que cierra cada `every` contrahuellas lleva `length` m de huella (rol `descanso`) en vez de
   *  TREAD. El pasamanos va con la pendiente media del tramo. */
  landings?: { every: number; length: number };
}
/** Cómo se ve una baranda. Sin nada, un paño de RAIL_H con el look (el vidrio de un balcón). `caño`: de caño (la de la
 *  terraza de La Veneciana, §4.7): el paño frena y no se ve, y se ven el pasamanos, un caño intermedio y los parantes
 *  cada ≤ CAÑO.paso; con `out`, los caños se dibujan siempre, con el edificio (de lejos, sobre el pretil). */
export interface RailStyle { caño?: true; out?: true }

/** El inglete de la planta corrida: el del pretil (PARAPET_MITER de collision.ts), así coinciden. */
const MITER = 2;
/** El vidrio de una abertura de afuera: de GLASS_T de espesor, con el medio a GLASS_D de la cara de afuera. */
const GLASS_T = 0.04, GLASS_D = WALL_OUT / 2;
const GLASS: Look = { mat: 'vidrio', color: '#b8d0d6' };
/** Espesor de una baranda. */
export const RAIL_T = 0.05;
/** La baranda de caño: la sección de los caños (cuadrada, m), el alto del pasamanos y del intermedio (su tope, desde el
 *  piso) y los parantes, a lo sumo cada `paso` m. */
const CAÑO = { t: 0.045, top: RAIL_H, mid: 0.55, paso: 1.4 } as const;
/** El pasamanos de una escalera (StairOpts.handrail): sus barras (el tope sobre la línea de las narices, el ancho y el
 *  alto, m) y los parantes (la sección y su tope sobre las narices). El de vidrio, el de la Casa de la Cultura; el de
 *  caño, el de La Veneciana. */
const HANDRAIL = {
  vidrio: { bars: [[0.93, 0.07, 0.06]], post: 0.04, postTop: 0.87, postCap: false },
  caño: { bars: [[0.9, 0.045, 0.045], [0.45, 0.04, 0.04]], post: 0.045, postTop: 0.88, postCap: true },
} as const;
/** El foot y el top de un StairRun quedan a esto del primer escalón y del último. */
const STAIR_REACH = 0.6;
/** Las barandas del hueco de una escalera van por tramos de a lo sumo RAIL_PIECE m: queda cada tramo que tiene piso a
 *  RAIL_PROBE m del hueco (contra una pared o sobre otro hueco, no). */
const RAIL_PIECE = 0.5, RAIL_PROBE = 0.15;
const EPS = 1e-9;

type Ring = [number, number][];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: Vec2): Vec2 => {
  const l = Math.hypot(a[0], a[1]);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};
const closed = (r: Vec2[]): [Ring] => [[...r, r[0]].map((p): [number, number] => [p[0], p[1]])];
const opened = (r: Ring): Vec2[] => r.slice(0, -1).map((p): Vec2 => [p[0], p[1]]);
const pick = (l: Look | Look[], k: number): Look => (Array.isArray(l) ? l[Math.min(k, l.length - 1)] : l);
const looksOf = (l: Pick<Block, 'top' | 'bottom' | 'side'>): Pick<Block, 'top' | 'bottom' | 'side'> =>
  ({ ...(l.top ? { top: l.top } : {}), ...(l.bottom ? { bottom: l.bottom } : {}), ...(l.side ? { side: l.side } : {}) });
const onSegment = (p: Vec2, a: Vec2, b: Vec2): boolean => {
  const [dx, dz] = sub(b, a);
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return dist(p, [a[0] + dx * t, a[1] + dz * t]) < 1e-6;
};

/** Una abertura sobre una arista de la planta antihoraria: s en metros desde su primera punta. */
interface Cut { kind: Opening['kind']; s0: number; s1: number; y0: number; y1: number }

export class Kit {
  /** La planta en el marco local. */
  readonly box: { u0: number; u1: number; v0: number; v1: number };
  /** Las aberturas de InteriorInput, con sus puntas (`a` en s0, `c` en s1) en el marco local. */
  readonly openings: (Opening & { a: Vec2; c: Vec2 })[];
  /** La planta corrida WALL_OUT hacia adentro (marco local): las caras de adentro de las paredes de afuera. */
  get inside(): Vec2[] {
    return this.inner.map((p): Vec2 => [p[0], p[1]]);
  }
  /** Los patios de InteriorInput en el marco local, en el orden en que vienen. */
  get patios(): Vec2[][] {
    return this.input.patios.map((r) => r.map((p) => toLocal(this.input.frame, p)));
  }
  /** Los andenes del mapa (MapData.platforms: los anillos de stationLayout) en el marco local; [] si no vinieron. Para
   *  lo que llega a un andén, como la escalera de la estación. */
  get platforms(): Vec2[][] {
    return this.platformRings.map((r) => r.map((p) => toLocal(this.input.frame, p)));
  }
  /** El alto del edificio: el del techo (y el de la terraza). */
  get height(): number {
    return this.b.height;
  }
  private readonly b: Building;
  private readonly input: InteriorInput;
  private readonly platformRings: Vec2[][];
  /** La planta antihoraria (mundo) y, por cada arista suya, sus aberturas. */
  private readonly fp: Vec2[];
  private readonly cuts: Cut[][];
  /** La planta corrida WALL_OUT hacia adentro (marco local): lo que cubren las losas, el bloque cerrado y el techo. */
  private readonly inner: Vec2[];
  private shellOpts: ShellOpts | null = null;
  private finished = false;
  private readonly blocks: Block[] = [];
  private readonly panes: Pane[] = [];
  private readonly items: Item[] = [];
  private readonly trees: Tree[] = [];
  private readonly labels: Label[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly views: Viewpoint[] = [];
  private readonly marks: Record<string, Vec3> = {};
  private readonly runs: StairRun[] = [];
  /** El hueco (marco local) que abre cada escalera en las losas de los niveles from + 1 … to, y la baranda de su borde. */
  private readonly stairHoles: { from: number; to: number; poly: Vec2[]; rail: Look; style: RailStyle }[] = [];
  /** Los pasamanos de las escaleras: se arman en done(), cuando ya están todos los huecos. */
  /** Los pasamanos de las escaleras (StairOpts.handrail), que se arman en done(); `out`, el de la escalera. */
  private readonly handrails: { from: number; to: number; foot: Vec2; d: Vec2; side: Vec2; w: number; treads: [number, number][]; y0: number; y1: number; rail: Look; look: Look; style: RailStyle; out?: true }[] = [];

  constructor(b: Building, input: InteriorInput, platforms: Vec2[][] = []) {
    this.b = b;
    this.input = input;
    this.platformRings = platforms;
    const stored = b.footprint, n = stored.length;
    const ccw = signedAreaFromAbove(stored) > 0;
    this.fp = ccw ? stored.map((p): Vec2 => [p[0], p[1]]) : [...stored].reverse().map((p): Vec2 => [p[0], p[1]]);
    const local = stored.map((p) => toLocal(input.frame, p));
    const us = local.map((p) => p[0]), vs = local.map((p) => p[1]);
    this.box = { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
    this.cuts = this.fp.map(() => []);
    this.openings = input.openings.map((o) => {
      const [a, c] = [stored[o.edge], stored[(o.edge + 1) % n]];
      const len = dist(a, c);
      const d = unit(sub(c, a));
      // la planta antihoraria recorre al revés las aristas de una guardada en sentido horario
      const k = ccw ? o.edge : (((n - 2 - o.edge) % n) + n) % n;
      const [s0, s1] = ccw ? [o.s0, o.s1] : [len - o.s1, len - o.s0];
      if (len > EPS) this.cuts[k].push({ kind: o.kind, s0: Math.max(0, s0), s1: Math.min(len, s1), y0: o.y0, y1: o.y1 });
      return { ...o, a: toLocal(input.frame, add(a, d, o.s0)), c: toLocal(input.frame, add(a, d, o.s1)) };
    });
    this.inner = insetRing(this.fp, WALL_OUT, MITER).map((p) => toLocal(input.frame, p));
  }

  /** Local → mundo. */
  at(p: Vec2): Vec2 {
    return toWorld(this.input.frame, p);
  }

  /**
   * Las paredes de afuera (WALL_OUT, de 0 a height) cortadas en las aberturas: antepecho abajo, dintel o pared arriba y,
   * en los vidrios, un vidrio de GLASS_T de clase glass. Al terminar (`done`), las losas de los niveles 1 … publicFloors − 1
   * (la del nivel k, de k · 3,2 − 0,2 a k · 3,2), la planta baja (dibujada a GROUND_Y, sin sólido) y arriba:
   * - si el edificio tiene pisos cerrados arriba de los públicos, un solo bloque de publicFloors · 3,2 − 0,2 a height;
   * - si no, el techo, de height − 0,8 a height (D9: un piso alto, como el del cine, queda alto por adentro). Con
   *   `terrace`, el techo es un piso público más: el nivel publicFloors, que se pisa a height.
   * Las losas, el bloque cerrado y el techo cubren la planta corrida WALL_OUT hacia adentro, menos los huecos de `holes`
   * y los de las escaleras.
   */
  shell(o: ShellOpts): void {
    this.open();
    const id = this.input.placeId;
    if (this.shellOpts) throw new Error(`${id}: shell() va una sola vez`);
    if (!(Number.isInteger(o.publicFloors) && o.publicFloors >= 1)) throw new Error(`${id}: publicFloors tiene que ser un entero ≥ 1 (es ${o.publicFloors})`);
    for (const l of [o.floor, o.ceiling]) if (Array.isArray(l) && l.length === 0) throw new Error(`${id}: floor y ceiling necesitan al menos un look`);
    this.shellOpts = o;
    if ((o.publicFloors - 1) * LEVEL_H + LINTEL_MIN > this.topBottom()) {
      throw new Error(`${id}: ${o.publicFloors} pisos públicos no entran en ${this.b.height} m de alto`);
    }
    this.exteriorWalls(o.wall);
  }

  /** Tabique de WALL_IN (salvo `t`) de y0 (0) a y1 (el cielorraso de arriba de y0), con sus huecos y su dintel. */
  wall(from: Vec2, to: Vec2, o: WallOpts): void {
    this.need();
    const t = o.t ?? WALL_IN, y0 = o.y0 ?? 0, y1 = o.y1 ?? this.ceilingOver(y0);
    const collide = o.collide ?? 'solid';
    const role: Role = collide === 'glass' ? 'vidrio' : Math.abs(t - WALL_OUT) < EPS ? 'pared' : 'tabique';
    const len = dist(from, to);
    if (len < EPS) return;
    const e = unit(sub(to, from)), side: Vec2 = [-e[1], e[0]];
    // la primera arista es una cara (la de −side): desde ahí se mide el espesor
    const piece = (s0: number, s1: number, lo: number, hi: number, r: Role, l: Pick<Block, 'top' | 'bottom' | 'side'>): void =>
      this.block([add(add(from, e, s0), side, -t / 2), add(add(from, e, s1), side, -t / 2), add(add(from, e, s1), side, t / 2), add(add(from, e, s0), side, t / 2)], lo, hi, collide, r, l);
    const gaps = (o.gaps ?? []).map((g) => ({ g, g0: Math.max(0, g.at - g.width / 2), g1: Math.min(len, g.at + g.width / 2) })).sort((p, q) => p.g0 - q.g0);
    let s = 0;
    for (const { g, g0, g1 } of gaps) {
      if (g0 > s + EPS) piece(s, g0, y0, y1, role, { side: o.look, top: o.look });
      if (y0 + g.height < y1 - EPS) piece(g0, g1, y0 + g.height, y1, 'dintel', { side: o.look, top: o.look, bottom: o.look });
      if (g.glassLeaf) {
        // abierta 90°, pegada al marco de la punta g0: el ancho del modelo (+x) va hacia +side
        const w = unit(this.vec(side));
        const c = this.at(add(add(from, e, g0 + 0.03), side, (g1 - g0) / 2));
        this.items.push({ model: 'hoja-vidrio', at: [c[0], y0, c[1]], yaw: Math.atan2(-w[1], w[0]) });
      }
      s = Math.max(s, g1);
    }
    if (len > s + EPS) piece(s, len, y0, y1, role, { side: o.look, top: o.look });
  }

  /** Escalones sólidos hasta el piso de abajo (contrahuellas iguales ≤ RISER_MAX, huellas de TREAD), el hueco en las
   *  losas de arriba sobre toda su planta, barandas en el borde del hueco (salvo por donde se llega) y su StairRun. Con
   *  `rise`, un tramo adentro de un nivel (sin hueco); con `landings`, con descansos. */
  stair(o: StairOpts): void {
    this.need();
    const id = this.input.placeId;
    const inLevel = o.rise !== undefined;
    if (inLevel && o.to !== o.from) throw new Error(`${id}: un tramo con rise va adentro de un nivel (from = to)`);
    const y0 = this.floorY(o.from), y1 = inLevel ? y0 + o.rise! : this.floorY(o.to);
    if (!(y1 > y0)) throw new Error(`${id}: la escalera tiene que subir (del nivel ${o.from} al ${o.to})`);
    const d = unit(o.dir);
    if (d[0] === 0 && d[1] === 0) throw new Error(`${id}: la escalera necesita una dirección`);
    const n = Math.max(1, Math.ceil((y1 - y0) / RISER_MAX - 1e-9));
    const r = (y1 - y0) / n;
    const side: Vec2 = [-d[1], d[0]];
    const w = o.width / 2;
    const at = (s: number, q: number): Vec2 => add(add(o.foot, d, s), side, q);
    const landing = (i: number): boolean => o.landings !== undefined && i % o.landings.every === 0;
    const treads: [number, number][] = [];
    for (let i = 1, s = 0; i < n; i++) {
      const s1 = s + (landing(i) ? o.landings!.length : TREAD);
      treads.push([s, s1]);
      this.block([at(s, -w), at(s1, -w), at(s1, w), at(s, w)], y0, y0 + i * r, 'solid', landing(i) ? 'descanso' : 'escalon', { top: o.look, side: o.look }, o.out);
      s = s1;
    }
    const run = treads.length > 0 ? treads[treads.length - 1][1] : 0;
    const a = -(o.approach ?? 0);
    if (!inLevel) this.stairHoles.push({ from: o.from, to: o.to, poly: [at(a, -w), at(run, -w), at(run, w), at(a, w)], rail: o.rail ?? o.look, style: o.railStyle ?? {} });
    if (o.handrail) {
      // la izquierda de la subida, en el mundo (yaw de three.js: mirando hacia (x, z), la izquierda es (z, −x))
      const [dx, dz] = this.vec(d), [sx, sz] = this.vec(side);
      const left: Vec2 = sx * dz - sz * dx > 0 ? side : [-side[0], -side[1]];
      const sides: Vec2[] = o.handrail === 'izq' ? [left] : o.handrail === 'der' ? [[-left[0], -left[1]]] : [left, [-left[0], -left[1]]];
      const rail = o.rail ?? o.look;
      for (const s of sides) {
        this.handrails.push({ from: o.from, to: o.to, foot: o.foot, d, side: s, w, treads, y0, y1, rail, look: o.handrailLook ?? rail, style: o.railStyle ?? {}, ...(o.out ? { out: true as const } : {}) });
      }
    }
    const [f, t] = [this.at(add(o.foot, d, -STAIR_REACH)), this.at(add(o.foot, d, run + STAIR_REACH))];
    this.runs.push({ from: o.from, to: o.to, foot: [f[0], y0, f[1]], top: [t[0], y1, t[1]], yaw: this.yawToward(d) });
  }

  /** Baranda de RAIL_H sobre el piso de `level`, centrada en `path` (marco local): clase glass (D4). Con `y`, desde ese
   *  alto en vez del piso (la de un tramo de escalera, sobre la huella de su escalón). Con `caño` (RailStyle), de caño:
   *  el paño que frena no se ve y se ven los caños, del color de `look`. */
  railing(path: Vec2[], level: number, look: Look, o: { y?: number } & RailStyle = {}): void {
    this.need();
    const y = o.y ?? this.floorY(level), x = RAIL_T / 2;
    for (let i = 0; i + 1 < path.length; i++) {
      const [p, q] = [path[i], path[i + 1]];
      if (dist(p, q) < EPS) continue;
      // cada tramo se alarga medio espesor en cada punta: así cierra las esquinas
      const e = unit(sub(q, p)), side: Vec2 = [-e[1], e[0]];
      const [a, c] = [add(p, e, -x), add(q, e, x)];
      this.block([add(a, side, -x), add(c, side, -x), add(c, side, x), add(a, side, x)], y, y + RAIL_H, 'glass', 'baranda', o.caño ? {} : { side: look, top: look });
    }
    if (o.caño) this.pipes(path, y, look, o.out === true);
  }

  /** Los caños de una baranda de caño a lo largo de `path` desde el alto `y`: el pasamanos y el intermedio de cada tramo
   *  (alargados media sección en cada punta, como la baranda) y los parantes en las puntas y cada ≤ CAÑO.paso. */
  private pipes(path: Vec2[], y: number, look: Look, out: boolean): void {
    const h = CAÑO.t / 2, l = { side: look, top: look, bottom: look }, o = out ? { out: true as const } : undefined;
    const post = (m: Vec2): void => this.block([add(m, [-h, -h]), add(m, [h, -h]), add(m, [h, h]), add(m, [-h, h])], y, y + CAÑO.top - CAÑO.t, 'none', 'otro', l, o);
    for (let i = 0; i + 1 < path.length; i++) {
      const [p, q] = [path[i], path[i + 1]];
      const len = dist(p, q);
      if (len < EPS) continue;
      const e = unit(sub(q, p)), side: Vec2 = [-e[1], e[0]];
      const [a, c] = [add(p, e, -h), add(q, e, h)];
      const bar = [add(a, side, -h), add(c, side, -h), add(c, side, h), add(a, side, h)];
      this.block(bar, y + CAÑO.top - CAÑO.t, y + CAÑO.top, 'none', 'otro', l, o);
      this.block(bar, y + CAÑO.mid - CAÑO.t, y + CAÑO.mid, 'none', 'otro', l, o);
      const n = Math.max(1, Math.ceil(len / CAÑO.paso - 1e-9));
      for (let j = 0; j < n; j++) post(add(p, e, (len * j) / n));
    }
    // el de la última punta, si el recorrido no cierra (si cierra, es el de la primera)
    const [first, last] = [path[0], path[path.length - 1]];
    if (path.length > 1 && dist(first, last) > EPS) post(last);
  }

  /** Una barra que solo se dibuja (paños): de `a` a `b` (marco local, [u, y, v]: el medio de su cara de arriba en cada
   *  punta), de `width` de través (horizontal) y `height` hacia abajo, de canto a a → b; para lo inclinado (un cabio, un
   *  pasamanos). Con `ends`, también las tapas de las puntas; con `out`, se dibuja con el edificio (Pane.out). a → b no
   *  puede ser vertical. */
  bar(a: Vec3, b: Vec3, width: number, height: number, look: Look, o: { sky?: true; ends?: true; out?: true } = {}): void {
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d), h = Math.hypot(d[0], d[2]);
    const e: Vec3 = [d[0] / l, d[1] / l, d[2] / l], t: Vec3 = [-d[2] / h, 0, d[0] / h];
    // arriba: perpendicular a a → b y al través (t × e o e × t, el que sube)
    const c: Vec3 = [t[1] * e[2] - t[2] * e[1], t[2] * e[0] - t[0] * e[2], t[0] * e[1] - t[1] * e[0]];
    const up: Vec3 = c[1] >= 0 ? c : [-c[0], -c[1], -c[2]];
    const at = (p: Vec3, s: number, y: number): Vec3 => [p[0] + t[0] * s - up[0] * y, p[1] - up[1] * y, p[2] + t[2] * s - up[2] * y];
    const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
    const w = width / 2, f = { ...(o.sky ? { sky: true as const } : {}), ...(o.out ? { out: true as const } : {}) };
    this.pane([at(a, -w, 0), at(b, -w, 0), at(b, w, 0), at(a, w, 0)], up, look, f);
    this.pane([at(a, -w, height), at(a, w, height), at(b, w, height), at(b, -w, height)], neg(up), look, f);
    this.pane([at(a, w, 0), at(b, w, 0), at(b, w, height), at(a, w, height)], t, look, f);
    this.pane([at(a, -w, 0), at(a, -w, height), at(b, -w, height), at(b, -w, 0)], neg(t), look, f);
    if (!o.ends) return;
    this.pane([at(a, -w, 0), at(a, w, 0), at(a, w, height), at(a, -w, height)], neg(e), look, f);
    this.pane([at(b, -w, 0), at(b, -w, height), at(b, w, height), at(b, w, 0)], e, look, f);
  }

  /** Un prisma de planta `poly` (marco local) entre y0 e y1. `true` (o `out`): se dibuja con el edificio; `sky`: va
   *  arriba del techo, sobre un hueco (D13); `hide`: las aristas de `poly` (la k va de poly[k] a poly[k + 1]) sin cara
   *  del costado, como Block.hide (las cuenta de nuevo si la planta queda al revés en el mundo). */
  block(poly: Vec2[], y0: number, y1: number, collide: Collide, role: Role, looks: Pick<Block, 'top' | 'bottom' | 'side'>,
    o?: true | { out?: true; sky?: true; hide?: number[] }): void {
    this.open();
    const { out, sky, hide } = o === true ? { out: true as const, sky: undefined, hide: undefined } : (o ?? {});
    const ring = poly.map((p) => this.at(p)), n = ring.length;
    const flipped = signedAreaFromAbove(ring) < 0;
    const polygon = flipped ? [...ring].reverse() : ring;
    this.blocks.push({ polygon, y0, y1, collide, role, ...looksOf(looks), ...(out ? { out: true as const } : {}), ...(sky ? { sky: true as const } : {}),
      ...(hide && hide.length > 0 ? { hide: hide.map((k) => (flipped ? (((n - 2 - k) % n) + n) % n : k)) } : {}) });
  }

  /** Un paño que solo se dibuja (Pane): sus 3 o 4 esquinas y la normal de su frente en el marco local, como [u, y, v].
   *  `back`: se ve también de atrás; `sky`: arriba del techo, sobre un hueco (D13). */
  pane(corners: Vec3[], normal: Vec3, look: Look, o: { back?: true; sky?: true; out?: true } = {}): void {
    this.open();
    if (corners.length < 3 || corners.length > 4) throw new Error(`${this.input.placeId}: un paño lleva 3 o 4 esquinas (tiene ${corners.length})`);
    const world = corners.map(([u, y, v]): Vec3 => {
      const [x, z] = this.at([u, v]);
      return [x, y, z];
    });
    const [nx, nz] = this.vec([normal[0], normal[2]]), l = Math.hypot(nx, normal[1], nz);
    if (l < EPS) throw new Error(`${this.input.placeId}: un paño necesita la normal de su frente`);
    this.panes.push({ corners: world, normal: [nx / l, normal[1] / l, nz / l], look, ...(o.back ? { back: true as const } : {}), ...(o.sky ? { sky: true as const } : {}),
      ...(o.out ? { out: true as const } : {}) });
  }

  /** Un mueble en `p` sobre el piso `y`, mirando hacia `yaw` (local): su frente (el +z del modelo) va hacia ahí. Y su
   *  caja sólida de MODEL_BOX si la tiene. */
  furniture(model: ItemModel, p: Vec2, y: number, yaw: number, color?: string, detail?: 2): void {
    this.open();
    const [x, z] = this.at(p);
    // rotación three.js sobre +Y: el +z del modelo va a (sin rot, cos rot)
    const [fx, fz] = this.vec([Math.sin(yaw), Math.cos(yaw)]);
    const rot = Math.atan2(fx, fz);
    this.items.push({ model, at: [x, y, z], yaw: rot, ...(color !== undefined ? { color } : {}), ...(detail ? { detail } : {}) });
    const box = MODEL_BOX[model];
    if (!box) return;
    // rotación three.js sobre +Y: el +x del modelo va a (cos, −sin) y el +z a (sin, cos)
    const c = Math.cos(rot), s = Math.sin(rot);
    const [ux, uz, vx, vz] = [(c * box.w) / 2, (-s * box.w) / 2, (s * box.d) / 2, (c * box.d) / 2];
    const poly: Vec2[] = [[x - ux - vx, z - uz - vz], [x + ux - vx, z + uz - vz], [x + ux + vx, z + uz + vz], [x - ux + vx, z - uz + vz]];
    this.blocks.push({ polygon: ensureCCW(poly), y0: y, y1: y + box.h, collide: 'solid', role: 'mueble' });
  }

  /** Un árbol del mapa en `p`, adentro de un patio (D12): Interior.trees. El cliente lo dibuja con los de la calle y
   *  collision.ts le pone el tronco sólido de cualquier árbol (TRUNK_R, trunkHeight): no hace falta un bloque. */
  tree(p: Vec2, variant: Tree['variant'], scale: number): void {
    this.open();
    if (!this.patios.some((r) => pointInPolygon(p, r))) throw new Error(`${this.input.placeId}: el árbol de (${p.join(', ')}) no está en un patio`);
    this.trees.push({ position: this.at(p), variant, scale });
  }

  /** Cartel con el medio en `p` a la altura `y`; `normal` (local) apunta hacia quien lo lee. Con `drawing`, en vez del
   *  texto lleva ese dibujo. `down`: acostado mirando abajo (`normal`, hacia el borde de arriba del dibujo); `round`: un
   *  disco de diámetro `width`. `placeSign` (con `out`): reemplaza al cartel del lote del lugar (Label.placeSign). */
  label(text: string, p: Vec2, y: number, normal: Vec2, width: number, height: number, look: SignLook,
    o: { glow?: true; out?: true; drawing?: LabelDrawing; down?: true; round?: true; placeSign?: true } = {}): void {
    this.open();
    const [x, z] = this.at(p);
    this.labels.push({ text, at: [x, y, z], normal: unit(this.vec(normal)), width, height, look, ...(o.glow ? { glow: true as const } : {}),
      ...(o.out ? { out: true as const } : {}), ...(o.drawing ? { drawing: o.drawing } : {}), ...(o.down ? { down: true as const } : {}),
      ...(o.round ? { round: true as const } : {}), ...(o.placeSign ? { placeSign: true as const } : {}) });
  }

  lamp(p: Vec2, y: number, radius: number, power: number): void {
    this.open();
    const [x, z] = this.at(p);
    this.lamps.push({ at: [x, y, z], radius, power });
  }

  /** Vista con los pies en `p` sobre el piso `y`, mirando hacia `yaw` (local). */
  view(id: string, p: Vec2, y: number, yaw: number): void {
    this.open();
    const [x, z] = this.at(p);
    this.views.push({ id, pos: [x, y, z], yaw: this.yawOf(yaw) });
  }

  /** Punto con nombre sobre el piso `y`. */
  mark(id: string, p: Vec2, y: number): void {
    this.open();
    if (Object.hasOwn(this.marks, id)) throw new Error(`${this.input.placeId}: la marca "${id}" está repetida`);
    const [x, z] = this.at(p);
    this.marks[id] = [x, y, z];
  }

  /** Cierra el interior: arma las losas, el techo, la planta baja, las barandas de los huecos y los pisos públicos.
   *  `dim`: el de Interior (un lugar oscuro aunque el ojo se adapte). */
  done(ambient: number, dim?: number): Interior {
    const o = this.need();
    const pf = o.publicFloors, H = this.b.height;
    const floor = (k: number): Look => pick(o.floor, k), ceiling = (k: number): Look => pick(o.ceiling, k);
    const ground = this.toWorldRing(this.inner);
    this.blocks.push({ polygon: ground, y0: 0, y1: GROUND_Y, collide: 'none', role: 'losa', top: floor(0), hide: ground.map((_, i) => i) });
    for (let k = 1; k < pf; k++) this.slab(k, k * LEVEL_H - SLAB_T, k * LEVEL_H, { top: floor(k), bottom: ceiling(k - 1), side: o.wall });
    if (this.closedAbove()) this.slab(pf, pf * LEVEL_H - SLAB_T, H, { bottom: ceiling(pf - 1), side: o.wall });
    else {
      this.slab(pf, H - ROOF_T, H, { bottom: ceiling(pf - 1), side: o.wall });
      // la baldosa de la terraza, sin sólido y GROUND_Y arriba del techo, que es el que apoya (como la planta baja)
      if (o.terrace) this.slab(pf, H, H + GROUND_Y, { top: floor(pf), side: floor(pf) }, 'none', 'otro');
    }
    for (const h of this.stairHoles) if (this.walkable(h.to)) this.holeRails(h.poly, h.to, h.rail, h.style);
    for (const h of this.handrails) this.stairHandrail(h);
    const levels = [...Array(pf).keys(), ...(o.terrace ? [pf] : [])];
    const floors = levels.map((k): FloorArea => {
      const holes = this.holesAt(k);
      const area = holes.length === 0 ? polygonArea(this.inner) : areaOf(polygonClipping.difference(closed(this.inner), ...holes.map(closed)));
      return { level: k, y: this.floorY(k), polygon: ground, holes: holes.map((h) => this.toWorldRing(h)), area };
    });
    this.finished = true;
    return {
      placeId: this.input.placeId, buildingId: this.b.id, publicFloors: pf, terrace: o.terrace === true, ambient,
      blocks: this.blocks, panes: this.panes, items: this.items, labels: this.labels, lamps: this.lamps, floors, stairs: this.runs,
      doors: doorsOf(this.b, this.input), views: this.views, marks: this.marks,
      footprint: this.fp, patios: this.input.patios.map((r) => ensureCCW(r.map((p): Vec2 => [p[0], p[1]]))),
      roofHoles: this.holesAt(pf).map((h) => this.toWorldRing(h)), trees: this.trees, ...(dim === undefined ? {} : { dim }),
    };
  }

  // ---------- adentro ----------

  private open(): void {
    if (this.finished) throw new Error(`${this.input.placeId}: el interior ya está cerrado (done)`);
  }

  private need(): ShellOpts {
    this.open();
    if (!this.shellOpts) throw new Error(`${this.input.placeId}: shell() va antes que el resto`);
    return this.shellOpts;
  }

  /** ¿Hay pisos cerrados arriba de los públicos? */
  private closedAbove(): boolean {
    return this.shellOpts!.publicFloors < this.b.floors;
  }

  /** Donde empieza lo de arriba del último piso público: el bloque cerrado o el techo. */
  private topBottom(): number {
    return this.closedAbove() ? this.shellOpts!.publicFloors * LEVEL_H - SLAB_T : this.b.height - ROOF_T;
  }

  /** Alto del piso de un nivel: k · 3,2, salvo la terraza (el techo, a height). */
  private floorY(level: number): number {
    const o = this.shellOpts!;
    return o.terrace && level === o.publicFloors ? this.b.height : level * LEVEL_H;
  }

  /** ¿Se camina por el piso de `level`? Los públicos y la terraza. */
  private walkable(level: number): boolean {
    const o = this.shellOpts!;
    return level < o.publicFloors || (o.terrace === true && level === o.publicFloors);
  }

  /** El cielorraso más bajo por encima de y: la losa siguiente, el bloque cerrado o el techo. */
  ceilingOver(y: number): number {
    this.need();
    const tops = [...Array(this.shellOpts!.publicFloors).keys()].slice(1).map((k) => k * LEVEL_H - SLAB_T);
    return Math.min(...[...tops, this.topBottom(), this.b.height].filter((c) => c > y + EPS));
  }

  /** Huecos (marco local) de la losa de `level`: los de shell y los de las escaleras que la atraviesan. */
  private holesAt(level: number): Vec2[][] {
    return [
      ...(this.shellOpts!.holes ?? []).filter((h) => h.level === level).map((h) => h.polygon),
      ...this.stairHoles.filter((h) => h.from < level && level <= h.to).map((h) => h.poly),
    ];
  }

  /** Vector local → mundo. */
  private vec([a, b]: Vec2): Vec2 {
    const { u, v } = this.input.frame;
    return [a * u[0] + b * v[0], a * u[1] + b * v[1]];
  }

  /** yaw (convención de la cámara y de three.js) que mira hacia el vector local `d`. */
  private yawToward(d: Vec2): number {
    const [x, z] = this.vec(d);
    return Math.atan2(-x, -z);
  }

  /** Ángulo local (0 → +V, π/2 → +U) → yaw del mundo. */
  private yawOf(a: number): number {
    return this.yawToward([Math.sin(a), Math.cos(a)]);
  }

  /** Planta local → mundo, antihoraria. */
  private toWorldRing(poly: Vec2[]): Vec2[] {
    return ensureCCW(poly.map((p) => this.at(p)));
  }

  /** Las paredes de afuera. Cada arista es un rectángulo de WALL_OUT hacia adentro, partido a lo largo en tramos con lo
   *  que queda macizo arriba y abajo de las aberturas; en una esquina saliente los rectángulos se pisan (en una aguda,
   *  recortados con la arista vecina), y en una entrante el hueco entre los dos lo llena una cuña hasta la punta de la
   *  planta corrida. La cara de afuera (la
   *  primera arista) y las puntas de cada arista quedan sin cara lateral: las dibuja el chunk o caen adentro del vecino. */
  private exteriorWalls(look: Look): void {
    const fp = this.fp, n = fp.length, H = this.b.height, t = WALL_OUT;
    const dirs = fp.map((p, k) => unit(sub(fp[(k + 1) % n], p)));
    const inw = (e: Vec2): Vec2 => [e[1], -e[0]];
    const dot = (p: Vec2, q: Vec2): number => p[0] * q[0] + p[1] * q[1];
    for (let k = 0; k < n; k++) {
      const [a, c] = [fp[k], fp[(k + 1) % n]];
      const len = dist(a, c);
      if (len < EPS) continue;
      const e = dirs[k], inward = inw(e);
      // En una esquina saliente aguda (< 90°) el rectángulo se saldría de la planta por la arista vecina: se recorta
      // con ella (en las demás esquinas salientes el recorte no saca nada).
      const [prev, next] = [dirs[(k + n - 1) % n], dirs[(k + 1) % n]];
      const clips = [...(dot(e, inw(prev)) > 0 ? [{ p: a, n: inw(prev) }] : []), ...(dot(next, inward) > 0 ? [{ p: c, n: inw(next) }] : [])];
      const cuts = this.cuts[k];
      const emit = (s0: number, s1: number, lo: number, hi: number, role: Role): void => {
        let polygon = [add(a, e, s0), add(a, e, s1), add(add(a, e, s1), inward, t), add(add(a, e, s0), inward, t)];
        for (const h of clips) polygon = clipHalf(polygon, h.p, h.n);
        if (polygon.length < 3 || polygonArea(polygon) < 1e-6) return;
        // se tapan la cara de afuera, las puntas contra la pared vecina y lo que quedó sobre una arista vecina
        const along = (q: Vec2): number => dot(sub(q, a), e);
        // las dos puntas sobre la misma recta de recorte (en una esquina de 90° puede haber un recorte por redondeo en
        // cada punta: una cara que va de una recta a la otra, como la de adentro, no queda sobre ninguna)
        const onClip = (p: Vec2, q: Vec2): boolean =>
          clips.some((h) => Math.abs(dot(sub(p, h.p), h.n)) < 1e-6 && Math.abs(dot(sub(q, h.p), h.n)) < 1e-6);
        const hide = polygon.map((_, i) => i).filter((i) => {
          const [p, q] = [polygon[i], polygon[(i + 1) % polygon.length]];
          if (i === 0 || onClip(p, q)) return true;
          return [0, len].some((x) => (x === 0 ? s0 <= EPS : s1 >= len - EPS) && Math.abs(along(p) - x) < 1e-6 && Math.abs(along(q) - x) < 1e-6);
        });
        // un pedazo de esquina más fino que la pared (una abertura pegada a una esquina aguda) es relleno, como la cometa
        const thin = Math.max(...polygon.map((q) => dot(sub(q, a), inward))) < t - 0.01;
        this.blocks.push({ polygon, y0: lo, y1: hi, collide: 'solid', role: thin ? 'otro' : role, side: look, ...(hi < H - EPS ? { top: look } : {}), ...(lo > EPS ? { bottom: look } : {}), hide });
      };
      // tramos entre las puntas de las aberturas; lo macizo de cada tramo se junta con el del tramo siguiente si es igual
      const marks = [...new Set([0, len, ...cuts.flatMap((o) => [o.s0, o.s1])])].sort((p, q) => p - q);
      const running = new Map<string, { s0: number; lo: number; hi: number; role: Role }>();
      for (let j = 0; j + 1 < marks.length; j++) {
        const [sa, sb] = [marks[j], marks[j + 1]];
        if (sb - sa < EPS) continue;
        const spans = solidSpans(H, cuts.filter((o) => o.s0 <= sa + EPS && o.s1 >= sb - EPS));
        const keys = new Set(spans.map(spanKey));
        for (const [key, r] of running) {
          if (keys.has(key)) continue;
          emit(r.s0, sa, r.lo, r.hi, r.role);
          running.delete(key);
        }
        for (const sp of spans) if (!running.has(spanKey(sp))) running.set(spanKey(sp), { s0: sa, ...sp });
      }
      for (const r of running.values()) emit(r.s0, len, r.lo, r.hi, r.role);
      for (const o of cuts) {
        if (o.kind !== 'vidrio' || !(o.s1 - o.s0 > EPS) || !(Math.min(o.y1, H) > o.y0)) continue;
        const [d0, d1] = [GLASS_D - GLASS_T / 2, GLASS_D + GLASS_T / 2];
        let polygon = [add(add(a, e, o.s0), inward, d0), add(add(a, e, o.s1), inward, d0), add(add(a, e, o.s1), inward, d1), add(add(a, e, o.s0), inward, d1)];
        for (const h of clips) polygon = clipHalf(polygon, h.p, h.n);
        if (polygon.length < 3) continue;
        // las puntas dan contra los marcos (o contra la arista vecina, si la recortó)
        const end = (q: Vec2): number => dot(sub(q, a), e);
        const hide = polygon.map((_, i) => i).filter((i) => {
          const [p, q] = [polygon[i], polygon[(i + 1) % polygon.length]];
          return [o.s0, o.s1].some((x) => Math.abs(end(p) - x) < 1e-6 && Math.abs(end(q) - x) < 1e-6) || clips.some((h) => Math.abs(dot(sub(p, h.p), h.n)) < 1e-6 && Math.abs(dot(sub(q, h.p), h.n)) < 1e-6);
        });
        this.blocks.push({ polygon, y0: o.y0, y1: Math.min(o.y1, H), collide: 'glass', role: 'vidrio', side: GLASS, hide });
      }
    }
    const tip = insetRing(fp, t, MITER);
    for (let k = 0; k < n; k++) {
      const [prev, V, next] = [fp[(k + n - 1) % n], fp[k], fp[(k + 1) % n]];
      const e1 = unit(sub(V, prev)), e2 = unit(sub(next, V));
      const in1: Vec2 = [e1[1], -e1[0]], in2: Vec2 = [e2[1], -e2[0]];
      if (e2[0] * in1[0] + e2[1] * in1[1] >= -1e-9) continue; // saliente o derecha: los rectángulos la cubren
      const [A1, A2] = [add(V, in1, t), add(V, in2, t)];
      const polygon = ensureCCW([V, A1, tip[k], A2]);
      // las aristas que tocan la punta de afuera dan contra los rectángulos de las dos paredes
      const hide = polygon.map((_, i) => i).filter((i) => dist(polygon[i], V) < EPS || dist(polygon[(i + 1) % polygon.length], V) < EPS);
      this.blocks.push({ polygon, y0: 0, y1: H, collide: 'solid', role: 'otro', side: look, hide });
    }
  }

  /** Una losa (o el bloque cerrado o el techo) de `level` entre y0 e y1, sin sus huecos: en polígonos simples (los
   *  prismas no tienen agujeros), franjas del marco local cortadas en cada u de los vértices de los huecos. La cara
   *  del costado se dibuja solo en el borde de un hueco. */
  private slab(level: number, y0: number, y1: number, looks: Pick<Block, 'top' | 'bottom' | 'side'>, collide: Collide = 'solid', role: Role = 'losa'): void {
    const holes = this.holesAt(level);
    if (holes.length === 0) {
      const polygon = this.toWorldRing(this.inner);
      this.blocks.push({ polygon, y0, y1, collide, role, ...looksOf({ ...looks, side: undefined }) });
      return;
    }
    const region = polygonClipping.difference(closed(this.inner), ...holes.map(closed));
    const { u0, u1, v0, v1 } = this.box;
    const us = [...new Set(holes.flat().map((p) => p[0]))].filter((u) => u > u0 && u < u1).sort((p, q) => p - q);
    const cuts = [u0 - 1, ...us, u1 + 1];
    const edges = holes.map((h) => this.toWorldRing(h));
    for (let j = 0; j + 1 < cuts.length; j++) {
      const strip: Vec2[] = [[cuts[j], v0 - 1], [cuts[j + 1], v0 - 1], [cuts[j + 1], v1 + 1], [cuts[j], v1 + 1]];
      for (const pg of polygonClipping.intersection(region, closed(strip))) {
        if (pg.length > 1) throw new Error(`${this.input.placeId}: la losa del nivel ${level} quedó con un agujero adentro de una franja`);
        // los vértices de los huecos que caen en una arista la parten: cada arista queda toda en un hueco o fuera
        const ring = this.toWorldRing(opened(pg[0]));
        const polygon = ring.flatMap((p, i) => {
          const q = ring[(i + 1) % ring.length];
          const on = edges.flat().filter((r) => dist(r, p) > 1e-6 && dist(r, q) > 1e-6 && onSegment(r, p, q));
          return [p, ...on.sort((r, w) => dist(p, r) - dist(p, w)).filter((r, j, a) => j === 0 || dist(r, a[j - 1]) > 1e-6)];
        });
        const hide = polygon.map((_, i) => i).filter((i) => {
          const [p, q] = [polygon[i], polygon[(i + 1) % polygon.length]];
          return !edges.some((h) => h.some((r, m) => onSegment(p, r, h[(m + 1) % h.length]) && onSegment(q, r, h[(m + 1) % h.length])));
        });
        this.blocks.push({ polygon, y0, y1, collide, role, ...looksOf(looks), hide });
      }
    }
  }

  /** El pasamanos de un costado de una escalera (StairOpts.handrail): `side` (unitario, marco local) apunta a ese costado
   *  y `w` es el medio ancho. Si la escalera es `out` (se ve siempre, con el edificio), sus paños, parantes y barras
   *  también (H3 de la revisión de la T10); el `out` de railStyle (el de las barandas de hueco) no lo toca. */
  private stairHandrail(h: Kit['handrails'][number]): void {
    const { foot, d, side, w, treads, y0, y1, rail, look } = h;
    const out = h.out ? { out: true as const } : undefined;
    if (treads.length === 0) return;
    const caño = h.style.caño === true, P = caño ? HANDRAIL.caño : HANDRAIL.vidrio;
    const t = RAIL_T / 2, q = w - t, p = P.post / 2, r = (y1 - y0) / (treads.length + 1);
    const at = (s: number, lat: number): Vec2 => add(add(foot, d, s), side, lat);
    // la línea de las narices: de la del primer escalón (a y0 + r) a la llegada (a y1, al final de la última huella); sin
    // descansos, pasa por todas
    const fin = treads[treads.length - 1][1];
    const nose = (s: number): number => y0 + r + (s * (y1 - y0 - r)) / fin;
    treads.forEach(([s0, s1], k) => {
      const i = k + 1, y = y0 + i * r, m = (s0 + Math.min(s1, s0 + TREAD)) / 2;
      if (y + RAIL_H <= this.ceilingBeside(at((s0 + s1) / 2, w + RAIL_PROBE), h.from, h.to, y) + 1e-6) {
        this.block([at(s0 - t, q - t), at(s1 + t, q - t), at(s1 + t, q + t), at(s0 - t, q + t)], y, y + RAIL_H, 'glass', 'baranda', caño ? {} : { side: rail, top: rail }, out);
      }
      if ((i - 1) % 3 === 0 || i === treads.length) {
        this.block([at(m - p, q - p), at(m + p, q - p), at(m + p, q + p), at(m - p, q + p)], y, nose(m) + P.postTop, 'none', 'otro', P.postCap ? { side: look, top: look } : { side: look }, out);
      }
    });
    const [a, b] = [at(0, q), at(fin, q)];
    for (const [top, width, height] of P.bars) this.bar([a[0], nose(0) + top, a[1]], [b[0], nose(fin) + top, b[1]], width, height, look, { ends: true, ...out });
  }

  /** El cielorraso al lado de una escalera en `p` (marco local), sobre un escalón a y: la cara de abajo de la losa más baja
   *  de los niveles que sube (from + 1 … to) que no tiene hueco ahí y termina arriba de y (la de un escalón a la altura de
   *  la losa también cuenta: la tiene al lado). Afuera de la planta (contra una pared), Infinity. */
  private ceilingBeside(p: Vec2, from: number, to: number, y: number): number {
    if (!pointInPolygon(p, this.inner)) return Infinity;
    const pf = this.shellOpts!.publicFloors;
    let c = Infinity;
    for (let k = from + 1; k <= to; k++) {
      const [bottom, top] = k < pf ? [k * LEVEL_H - SLAB_T, k * LEVEL_H] : [this.topBottom(), this.b.height];
      if (top > y + EPS && !this.holesAt(k).some((hole) => pointInPolygon(p, hole))) c = Math.min(c, bottom);
    }
    return c;
  }

  /** Las barandas del hueco de una escalera en el piso `level`: por los dos costados y el pie (no por la llegada, la
   *  arista poly[1] → poly[2]), solo donde del otro lado hay piso. */
  private holeRails(poly: Vec2[], level: number, look: Look, style: RailStyle = {}): void {
    const holes = this.holesAt(level);
    const onFloor = (p: Vec2): boolean => pointInPolygon(p, this.inner) && !holes.some((h) => pointInPolygon(p, h));
    const mid: Vec2 = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
    for (const [p, q] of [[poly[0], poly[1]], [poly[2], poly[3]], [poly[3], poly[0]]] as const) {
      const e = unit(sub(q, p));
      let out: Vec2 = [-e[1], e[0]];
      const m: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if ((m[0] - mid[0]) * out[0] + (m[1] - mid[1]) * out[1] < 0) out = [-out[0], -out[1]];
      const pieces = Math.max(1, Math.ceil(dist(p, q) / RAIL_PIECE));
      const at = (j: number): Vec2 => add(p, sub(q, p), j / pieces);
      let start = -1;
      for (let j = 0; j <= pieces; j++) {
        const keep = j < pieces && onFloor(add(add(at(j), sub(q, p), 0.5 / pieces), out, RAIL_PROBE));
        if (keep && start < 0) start = j;
        if (!keep && start >= 0) {
          this.railing([add(at(start), out, RAIL_T / 2), add(at(j), out, RAIL_T / 2)], level, look, style);
          start = -1;
        }
      }
    }
  }
}

/** Lo que queda de un polígono convexo del lado de adentro (n · (q − p) ≥ 0) de una recta, en el mismo orden. */
function clipHalf(poly: Vec2[], p: Vec2, n: Vec2): Vec2[] {
  const side = (q: Vec2): number => n[0] * (q[0] - p[0]) + n[1] * (q[1] - p[1]);
  const out: Vec2[] = [];
  poly.forEach((q, i) => {
    const r = poly[(i + 1) % poly.length];
    const [sq, sr] = [side(q), side(r)];
    if (sq >= -1e-9) out.push(q);
    if ((sq > 1e-9 && sr < -1e-9) || (sq < -1e-9 && sr > 1e-9)) out.push(add(q, sub(r, q), sq / (sq - sr)));
  });
  return out;
}

/** Lo macizo de 0 a H en un tramo con las aberturas `over`: arriba de una puerta, dintel; lo demás, pared. */
function solidSpans(H: number, over: Cut[]): { lo: number; hi: number; role: Role }[] {
  const holes = over.map((o) => [Math.max(0, o.y0), Math.min(H, o.y1)] as const).filter(([lo, hi]) => hi > lo).sort((p, q) => p[0] - q[0]);
  const roleAt = (lo: number): Role => (over.some((o) => o.kind === 'puerta' && Math.abs(o.y1 - lo) < 1e-6) ? 'dintel' : 'pared');
  const out: { lo: number; hi: number; role: Role }[] = [];
  let y = 0;
  for (const [lo, hi] of holes) {
    if (lo > y + EPS) out.push({ lo: y, hi: lo, role: roleAt(y) });
    y = Math.max(y, hi);
  }
  if (H > y + EPS) out.push({ lo: y, hi: H, role: roleAt(y) });
  return out;
}

const spanKey = (s: { lo: number; hi: number; role: Role }): string => `${s.lo}:${s.hi}:${s.role}`;

/** Área de un multipolígono de polygon-clipping (los agujeros restan). */
export function areaOf(m: polygonClipping.MultiPolygon): number {
  return m.reduce((t, pg) => t + pg.reduce((a, r, i) => a + (i === 0 ? 1 : -1) * polygonArea(opened(r)), 0), 0);
}
