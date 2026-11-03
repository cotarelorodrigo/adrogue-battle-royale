import type { Vec2, Vec3 } from './geo.ts';

export type RoadKind = 'secondary'|'tertiary'|'residential'|'living_street'|'service'|'pedestrian'|'footway';
export type PlaceType = 'bank'|'bar'|'restaurant'|'fastfood'|'icecream'|'cinema'|'club'|'clinic'|'school'|'culture'|'station'|'monument'|'plaza';
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Building { id: string; footprint: Vec2[]; height: number; floors: number;
  kind: 'house'|'shop'|'apartments'|'station'; wall: 'plaster'|'brick'; tint: string; landmarkId?: string }
export interface OutskirtBuilding { footprint: Vec2[]; height: number }
export interface Road { id: string; kind: RoadKind; name?: string; width: number; sidewalk: number; points: Vec2[] }
export interface Park { id: string; name?: string; polygon: Vec2[] }
export interface Sign { text: string; anchor: Vec2; normal: Vec2; width: number; bottomY: number }
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
  platforms: Vec2[][]; parks: Park[]; places: Place[]; props: Prop[]; trees: Tree[]; randomSpawns: Vec3[] }
