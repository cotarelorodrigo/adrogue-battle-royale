// La descripción de un interior (§2.1): lo que arma el Kit (kit.ts) a partir del edificio y de sus datos de entrada,
// igual en el cliente y en el servidor. Son solo datos: la colisión (collision.ts) y el dibujo los leen.
import type { Vec2, Vec3 } from '../geo.ts';
import type { SignLook, Tree } from '../mapdata.ts';
import type { Door } from './openings.ts';

/** Material de una cara; el cliente lo traduce a `in_<mat>` de WorldMaterials. `color` multiplica la textura. */
export type Mat = 'liso' | 'porcelanato' | 'madera' | 'machimbre' | 'baldosa' | 'ceramico' | 'tela' | 'metal' | 'ladrillo' | 'vidrio' | 'luz';
/** `esmerilado` (solo en un vidrio): un vinilo esmerilado, blanquecino y translúcido, que deja pasar la luz pero no deja
 *  ver (la franja de las paredes de vidrio de los bancos); va en el mismo vidrio, sin sumar mallas. */
export interface Look { mat: Mat; color: string; esmerilado?: true }
/** solid: frena jugadores y balas; glass: solo jugadores; none: solo se ve. */
export type Collide = 'solid' | 'glass' | 'none';
/** `descanso`: el escalón largo de un tramo con descansos (StairOpts.landings): sube como un escalón, sin huella fija. */
export type Role = 'pared' | 'tabique' | 'losa' | 'escalon' | 'descanso' | 'baranda' | 'dintel' | 'mueble' | 'vidrio' | 'otro';
/** Prisma de planta antihoraria (mundo) entre y0 e y1. Una cara sin Look no se dibuja; `hide`: aristas de `polygon`
 *  sin cara lateral (la cara de afuera de las paredes exteriores la dibuja el chunk). `out`: se dibuja siempre, con el
 *  edificio (tarea 5), no solo de cerca. En una pared o un tabique la primera arista es una de sus caras (en las
 *  exteriores, la de afuera): el espesor se mide desde ahí. `sky`: está arriba del techo, sobre un hueco (D13, el
 *  lucernario y su estructura): su vidrio da al cielo (es fuente de luz y se ve como vidrio de afuera) y no cuenta para
 *  saber si la cámara está adentro. */
export interface Block { polygon: Vec2[]; y0: number; y1: number; collide: Collide; role: Role; top?: Look; bottom?: Look; side?: Look; hide?: number[]; out?: true; sky?: true }
/** Un paño plano que solo se dibuja (no choca ni tapa la luz): 3 o 4 esquinas en un plano (mundo) y la normal (unitaria)
 *  de su frente. Es lo que va inclinado: el vidrio y la estructura de un lucernario, el pasamanos de una escalera (H1 de
 *  la tarea 7); lo que se pisa o frena va aparte, en bloques. `back`: también se ve de atrás. `sky`: está arriba del
 *  techo, sobre un hueco (D13): su frente da al cielo y su espalda, al interior. `out`: se dibuja siempre, con el
 *  edificio (exteriorGeometry), como un bloque `out`: el pasamanos de una escalera `out` (H3 de la revisión de la T10). */
export interface Pane { corners: Vec3[]; normal: Vec3; look: Look; back?: true; sky?: true; out?: true }
/** Base; cada tarea de interior suma los suyos. Bancos (tarea 6): el cajero automático, el escritorio con sus dos sillas,
 *  el turnero colgado, el puesto de caja (su tramo de mostrador, con el cajero sentado detrás) y una fila de 4 sillas de
 *  espera unidas. Casa de la Cultura (tarea 7): el plafón colgado bajo el lucernario (su cara pintada es un cartel), la
 *  butaca del auditorio y el panel de una muestra. McDonald's y La Veneciana (tarea 8): la mesa redonda de pie negro, la
 *  freidora y la heladera de acero de la cocina, la pantalla de menú colgada (su menú es un cartel), la mesa de picnic
 *  con sus bancos, la sombrilla, la silla director, el metegol y un balde de helado de la vitrina. La lámpara de la base
 *  es la campana colgada (el origen, en el borde de abajo de la campana) y el sillón, un módulo de banqueta tapizada.
 *  Cine Pixel y Guernica (tarea 9): la butaca de cine con apoyabrazos, la máquina de pochoclo, el marco de un afiche (su
 *  dibujo es un cartel), una botella de estante, la torre de canillas en arco, un tramo de guirnalda de lamparitas (de
 *  `at` a 3 m hacia +x del modelo, colgando) y la mesa alta de pie de hierro. Estación Adrogué (tarea 10): el molinete
 *  de trípode (su gabinete y el paso con los brazos, con el lector SUBE arriba), la terminal de carga SUBE de pie, el
 *  banco de listones con respaldo y la ventanilla de la boletería (el marco, la reja, el pasaplatos y la repisa; el
 *  origen, en el borde de abajo del hueco). Los árboles del patio no son muebles: van en Interior.trees. */
export type ItemModel = 'silla' | 'banqueta' | 'lampara' | 'mesa' | 'sillon' | 'hoja-vidrio'
  | 'cajero' | 'escritorio' | 'turnero' | 'puesto-caja' | 'sillas-espera'
  | 'plafon' | 'silla-auditorio' | 'panel-muestra'
  | 'mesa-redonda' | 'freidora' | 'heladera' | 'pantalla' | 'mesa-picnic' | 'sombrilla' | 'silla-director' | 'metegol' | 'balde-helado'
  | 'butaca' | 'pochoclera' | 'afiche' | 'botella' | 'canillas' | 'guirnalda' | 'mesa-alta' | 'lamparita'
  | 'molinete' | 'sube' | 'banco-respaldo' | 'ventanilla';
/** yaw: rotación three.js sobre +Y, como Prop.rotation. detail 2: no se dibuja en baja. */
export interface Item { model: ItemModel; at: Vec3; yaw: number; color?: string; detail?: 2 }
/** Lo que un cartel puede llevar dibujado en vez de su texto (el cliente lo dibuja en canvas): la puerta redonda del
 *  tesoro de un banco (tarea 6); la cara pintada del plafón y un cuadro abstracto de una muestra (tarea 7), que salen
 *  del texto del cartel como semilla; el menú de una pantalla (genérico: fotos de colores y precios, sin marcas) y el
 *  tapizado en zigzag blanco y negro de un sillón (tarea 8); el afiche de una película inventada (tarea 9: sin títulos ni
 *  marcas, del texto como semilla) y la fila de atrás de un estante de bar (botellas a contraluz, sin marcas). */
export type LabelDrawing = 'tesoro' | 'plafon' | 'cuadro' | 'menu' | 'zigzag' | 'afiche' | 'botellas';
/** Cartel: `normal` apunta hacia quien lo lee. Uno `out` se vuelve un Sign del mapa (alto SIGN_H). Con `drawing`, en vez
 *  del texto va ese dibujo (el texto queda para nombrarlo y es su semilla). `down`: acostado, con la cara hacia abajo
 *  (`normal` es hacia dónde queda el borde de arriba del dibujo); `round`: un disco de diámetro `width`, el círculo
 *  inscripto del dibujo. `placeSign` (solo con `out`): es el cartel del lugar, así que el del lote (Place.sign) no se
 *  dibuja (la marquesina del cine, la chapa del Guernica). */
export interface Label { text: string; at: Vec3; normal: Vec2; width: number; height: number; look: SignLook; glow?: true; out?: true; drawing?: LabelDrawing;
  down?: true; round?: true; placeSign?: true }
export interface Lamp { at: Vec3; radius: number; power: number }
export interface FloorArea { level: number; y: number; polygon: Vec2[]; holes: Vec2[][]; area: number }
/** foot: 0,6 m antes del primer escalón; top: 0,6 m pasado el último; yaw: subiendo (convención de player.ts). */
export interface StairRun { from: number; to: number; foot: Vec3; top: Vec3; yaw: number }
/** yaw con la convención de la cámara y del TOUR: 0 mira a −z, π/2 a −x. */
export interface Viewpoint { id: string; pos: Vec3; yaw: number }
/** marks: puntos con nombre que fija cada plan (centro del salón, pasos, balcón…) para que los tests caminen hasta ahí.
 *  `footprint` (la planta del edificio, antihoraria) y `patios` (los de InteriorInput, D12): donde puede ir lo que no
 *  es `out`; los usa validateInterior. `roofHoles`: los huecos (mundo, antihorarios) que el interior le abre al techo
 *  del edificio (D13: el atrio de la Casa de la Cultura); el chunk los abre en su techo y en la cáscara de sombra.
 *  `trees`: los árboles de sus patios (Kit.tree, tarea 9), árboles del mapa como los de la calle: el cliente los dibuja
 *  con ellos (vegetation.ts) y collision.ts les pone el tronco sólido de cualquier árbol. `dim` (si está; si no, 1): por
 *  cuánto va la luz horneada bajo techo de un lugar que es oscuro aunque el ojo se adapte (el cine), sin tocar sus
 *  lámparas ni su ambient (la oclusión del horneado resta lo mismo). `shade` (si está): los edificios del mapa cerca de
 *  lo que el interior tiene al aire libre (planta y altura), que le pueden tapar el sol al horneado de afuera. */
export interface Interior { placeId: string; buildingId: string; publicFloors: number; terrace: boolean; ambient: number;
  blocks: Block[]; panes: Pane[]; items: Item[]; labels: Label[]; lamps: Lamp[]; floors: FloorArea[]; stairs: StairRun[]; doors: Door[];
  views: Viewpoint[]; marks: Record<string, Vec3>; footprint: Vec2[]; patios: Vec2[][]; roofHoles: Vec2[][]; trees: Tree[]; dim?: number;
  shade?: { polygon: Vec2[]; height: number }[] }
