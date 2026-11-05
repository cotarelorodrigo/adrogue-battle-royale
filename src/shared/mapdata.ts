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
  /** Alto de la caja (m); sin él, SIGN_H. Lo usan los carteles `out` de un interior (la "M" de una torre, el de un toldo). */
  height?: number;
  /** Cartel de bandera: perpendicular a la fachada y de dos caras. */
  blade?: true }
export interface Place { id: string; name: string; type: PlaceType; position: Vec2; enterable: boolean;
  buildingId?: string; parkId?: string; sign?: Sign; spawn: Vec3;
  /** Centro de la puerta principal (D10), al ras de la cara exterior: solo en los lugares con interior. */
  door?: Vec2 }
export type Prop =
  | { kind: 'ladder'; base: Vec2; normal: Vec2; topY: number; buildingId: string }
  | { kind: 'dumpster'; position: Vec2; rotation: number }
  | { kind: 'bench'; position: Vec2; rotation: number }
  | { kind: 'fountain'; position: Vec2; radius: number }
  | { kind: 'monument'; placeId: string; position: Vec2; style: 'equestrian'|'statue'|'column' };
export interface Tree { position: Vec2; variant: 0|1|2; scale: number }
/** Nivel de un punto de botín (spec 2a §5): vereda, techo alcanzable o frente de un lugar entrable. */
export type LootTier = 'calle' | 'techo' | 'lugar';
/** Punto de botín: `pos` es el piso donde se apoya el objeto (y = 0 en la calle, el alto del techo arriba). */
export interface LootSpot { pos: Vec3; tier: LootTier }
export interface MapData { version: 1; origin: { lat: number; lon: number }; bounds: Bounds;
  buildings: Building[]; outskirts: OutskirtBuilding[]; roads: Road[]; railways: Vec2[][];
  platforms: Vec2[][]; parks: Park[]; places: Place[];
  /** Carteles de lotes que no son de un lugar. */
  signs: Sign[]; props: Prop[]; trees: Tree[]; randomSpawns: Vec3[]; lootSpots: LootSpot[];
  /** Los datos de entrada de cada interior (uno por lugar entrable con lote o planta relevada). */
  interiors: InteriorInput[] }

export type PlantaBaja = 'vidriera' | 'persiana' | 'porton' | 'puerta' | 'banco' | 'acceso' | 'pared';
export type Arriba = 'ventanas' | 'balcones' | 'vidriado' | 'ciego';
/** La letra de un cartel; `script`, la manuscrita de una heladería (fuentes del sistema: signs.ts). */
export type Fuente = 'sans' | 'serif' | 'condensada' | 'redondeada' | 'script';
export type Puerta = 'inicio' | 'medio' | 'fin';
/** Frente relevado de un lote. `edges`: aristas de `footprint` sobre la línea de edificación, de `desde` a `hasta`;
 *  `corner`: aristas sobre la línea de la calle transversal (lotes de esquina). */
export interface Front { edges: number[]; corner: number[]; pb: PlantaBaja; arriba: Arriba; puerta: Puerta;
  /** Presente cuando las aristas de `edges`, en el sentido de la planta guardada (footprint[e] → footprint[e+1]), van de
   *  `hasta` a `desde`. Todas las del lote comparten sentido; sin la marca van de `desde` a `hasta`. */
  contra?: true;
  ladrillo?: true; colorPB?: string; toldo?: { color: string; rayas?: true };
  /** Metros de la corrida principal que ocupa una ayuda de ascenso (escalera o contenedor, con su margen) desde la punta
   *  de `desde` (`inicio`) o la de `hasta` (`fin`): el toldo y el cartel dejan ese tramo libre. */
  ayuda?: { inicio?: number; fin?: number } }
export interface SignLook { fondo: string; letra: string; marco: string; fuente: Fuente; cursiva?: true }
/** Marco local de una planta relevada (data/plantas.json): el punto local (u, v) va al mundo como origin + u·U + v·V.
 *  `u` y `v` son unitarios y perpendiculares; `u` corre a lo largo del frente y `v` entra al edificio. */
export interface Frame { origin: Vec2; u: Vec2; v: Vec2 }
/** Hueco en una pared de afuera: va sobre la arista `edge` de la planta guardada (ya redondeada), de `s0` a `s1` m desde
 *  footprint[edge] y de `y0` a `y1` de alto. Una puerta arranca en el piso de su nivel (y0 = nivel · 3,2). */
export interface Opening { kind: 'puerta' | 'vidrio'; edge: number; s0: number; s1: number; y0: number; y1: number }
/** Lo que el mapa guarda de un interior: el resto se genera en src/shared/interiors a partir de esto y del edificio.
 *  `patios`: antihorarios, fuera de la planta (D12). */
export interface InteriorInput { placeId: string; buildingId: string; frame: Frame; openings: Opening[]; patios: Vec2[][] }
export const SIGN_H = 0.9;
export const SIGN_D = 0.12;
