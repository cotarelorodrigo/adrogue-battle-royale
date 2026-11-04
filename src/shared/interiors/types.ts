// La descripción de un interior (§2.1): lo que arma el Kit (kit.ts) a partir del edificio y de sus datos de entrada,
// igual en el cliente y en el servidor. Son solo datos: la colisión (collision.ts) y el dibujo los leen.
import type { Vec2, Vec3 } from '../geo.ts';
import type { SignLook } from '../mapdata.ts';
import type { Door } from './openings.ts';

/** Material de una cara; el cliente lo traduce a `in_<mat>` de WorldMaterials. `color` multiplica la textura. */
export type Mat = 'liso' | 'porcelanato' | 'madera' | 'machimbre' | 'baldosa' | 'ceramico' | 'tela' | 'metal' | 'ladrillo' | 'vidrio' | 'luz';
export interface Look { mat: Mat; color: string }
/** solid: frena jugadores y balas; glass: solo jugadores; none: solo se ve. */
export type Collide = 'solid' | 'glass' | 'none';
export type Role = 'pared' | 'tabique' | 'losa' | 'escalon' | 'baranda' | 'dintel' | 'mueble' | 'vidrio' | 'otro';
/** Prisma de planta antihoraria (mundo) entre y0 e y1. Una cara sin Look no se dibuja; `hide`: aristas de `polygon`
 *  sin cara lateral (la cara de afuera de las paredes exteriores la dibuja el chunk). `out`: se dibuja siempre, con el
 *  edificio (tarea 5), no solo de cerca. En una pared o un tabique la primera arista es una de sus caras (en las
 *  exteriores, la de afuera): el espesor se mide desde ahí. */
export interface Block { polygon: Vec2[]; y0: number; y1: number; collide: Collide; role: Role; top?: Look; bottom?: Look; side?: Look; hide?: number[]; out?: true }
/** Base; cada tarea de interior suma los suyos. Bancos (tarea 6): el cajero automático, el escritorio con sus dos sillas,
 *  el turnero colgado, el puesto de caja (su tramo de mostrador, con el cajero sentado detrás) y una fila de 4 sillas de
 *  espera unidas. */
export type ItemModel = 'silla' | 'banqueta' | 'lampara' | 'mesa' | 'sillon' | 'hoja-vidrio'
  | 'cajero' | 'escritorio' | 'turnero' | 'puesto-caja' | 'sillas-espera';
/** yaw: rotación three.js sobre +Y, como Prop.rotation. detail 2: no se dibuja en baja. */
export interface Item { model: ItemModel; at: Vec3; yaw: number; color?: string; detail?: 2 }
/** Lo que un cartel puede llevar dibujado en vez de su texto (el cliente lo dibuja en canvas): la puerta redonda del
 *  tesoro de un banco (tarea 6). */
export type LabelDrawing = 'tesoro';
/** Cartel: `normal` apunta hacia quien lo lee. Uno `out` se vuelve un Sign del mapa (alto SIGN_H). Con `drawing`, en vez
 *  del texto va ese dibujo (el texto queda para nombrarlo). */
export interface Label { text: string; at: Vec3; normal: Vec2; width: number; height: number; look: SignLook; glow?: true; out?: true; drawing?: LabelDrawing }
export interface Lamp { at: Vec3; radius: number; power: number }
export interface FloorArea { level: number; y: number; polygon: Vec2[]; holes: Vec2[][]; area: number }
/** foot: 0,6 m antes del primer escalón; top: 0,6 m pasado el último; yaw: subiendo (convención de player.ts). */
export interface StairRun { from: number; to: number; foot: Vec3; top: Vec3; yaw: number }
/** yaw con la convención de la cámara y del TOUR: 0 mira a −z, π/2 a −x. */
export interface Viewpoint { id: string; pos: Vec3; yaw: number }
/** marks: puntos con nombre que fija cada plan (centro del salón, pasos, balcón…) para que los tests caminen hasta ahí.
 *  `footprint` (la planta del edificio, antihoraria) y `patios` (los de InteriorInput, D12): donde puede ir lo que no
 *  es `out`; los usa validateInterior. */
export interface Interior { placeId: string; buildingId: string; publicFloors: number; terrace: boolean; ambient: number;
  blocks: Block[]; items: Item[]; labels: Label[]; lamps: Lamp[]; floors: FloorArea[]; stairs: StairRun[]; doors: Door[];
  views: Viewpoint[]; marks: Record<string, Vec3>; footprint: Vec2[]; patios: Vec2[][] }
