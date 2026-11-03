import type { Vec2, Vec3 } from './geo.ts';

export type RoadKind = 'secondary'|'tertiary'|'residential'|'living_street'|'service'|'pedestrian'|'footway';
export type PlaceType = 'bank'|'bar'|'restaurant'|'fastfood'|'icecream'|'cinema'|'club'|'clinic'|'school'|'culture'|'station'|'monument'|'plaza';
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
/** Planta baja de una fachada: local (vidriera con persiana), casa (puerta y ventana con reja) o casa de ladrillo. */
export type FacadeGround = 'shop'|'house'|'brick';
/** La banda de planta baja de la arista `edge` (índice sobre `footprint`: de footprint[edge] a footprint[edge + 1])
 *  se dibuja como `ground`, con `tint` (si no, el del edificio). Las otras aristas no cambian. */
export interface FacadeOverride { edge: number; ground: FacadeGround; tint?: string }
export interface Building { id: string; footprint: Vec2[]; height: number; floors: number;
  kind: 'house'|'shop'|'apartments'|'station'; wall: 'plaster'|'brick'; tint: string; landmarkId?: string;
  /** Fachadas procedurales de los lugares con cartel (spec 4.3): una por arista con cartel o foto. */
  facades?: FacadeOverride[];
  /** Relleno de un hueco de suelo sin salida (mapgen/pockets.ts): un sólido al ras del techo vecino más bajo, no un
   *  edificio real. Se dibuja sin pretil. */
  fill?: true;
  /** Frente relevado (data/frentes.json). */
  front?: Front }
export interface OutskirtBuilding { footprint: Vec2[]; height: number }
export interface Road { id: string; kind: RoadKind; name?: string; width: number; sidewalk: number; points: Vec2[]; surface?: 'sett' }
export interface Park { id: string; name?: string; polygon: Vec2[] }
export interface Sign { text: string; anchor: Vec2; normal: Vec2; width: number; bottomY: number;
  look?: SignLook;
  /** Cartel de bandera: perpendicular a la fachada y de dos caras. */
  blade?: true }
export interface Place { id: string; name: string; type: PlaceType; position: Vec2; enterable: boolean;
  buildingId?: string; parkId?: string; sign?: Sign; spawn: Vec3 }
export type Prop =
  | { kind: 'ladder'; base: Vec2; normal: Vec2; topY: number; buildingId: string }
  | { kind: 'dumpster'; position: Vec2; rotation: number }
  | { kind: 'bench'; position: Vec2; rotation: number }
  | { kind: 'fountain'; position: Vec2; radius: number }
  | { kind: 'monument'; placeId: string; position: Vec2; style: 'equestrian'|'statue'|'column' };
export interface Tree { position: Vec2; variant: 0|1|2; scale: number }
export interface MapData { version: 1; origin: { lat: number; lon: number }; bounds: Bounds;
  buildings: Building[]; outskirts: OutskirtBuilding[]; roads: Road[]; railways: Vec2[][];
  platforms: Vec2[][]; parks: Park[]; places: Place[];
  /** Carteles de lotes que no son de un lugar. */
  signs: Sign[]; props: Prop[]; trees: Tree[]; randomSpawns: Vec3[] }

export type PlantaBaja = 'vidriera' | 'persiana' | 'porton' | 'puerta' | 'banco' | 'acceso' | 'pared';
export type Arriba = 'ventanas' | 'balcones' | 'vidriado' | 'ciego';
export type Fuente = 'sans' | 'serif' | 'condensada' | 'redondeada';
export type Puerta = 'inicio' | 'medio' | 'fin';
/** Frente relevado de un lote. `edges`: aristas de `footprint` sobre la línea de edificación, de `desde` a `hasta`;
 *  `corner`: aristas sobre la línea de la calle transversal (lotes de esquina). */
export interface Front { edges: number[]; corner: number[]; pb: PlantaBaja; arriba: Arriba; puerta: Puerta;
  /** Presente cuando las aristas de `edges`, en el sentido de la planta guardada (footprint[e] → footprint[e+1]), van de
   *  `hasta` a `desde`. Todas las del lote comparten sentido; sin la marca van de `desde` a `hasta`. */
  contra?: true;
  ladrillo?: true; colorPB?: string; toldo?: { color: string; rayas?: true } }
export interface SignLook { fondo: string; letra: string; marco: string; fuente: Fuente; cursiva?: true }
export const SIGN_H = 0.9;
export const SIGN_D = 0.12;
