// Fachadas procedurales por lugar (spec 4.3): la arista del cartel (o la de la foto) de cada lugar con edificio se dibuja
// con la planta baja y el tinte de su tipo, salvo que data/places.json diga otra cosa en `facade`.
import { distPointSegment } from '../shared/geo.ts';
import type { Building, FacadeGround, Place, PlaceType } from '../shared/mapdata.ts';
import type { PlaceInput } from './places-input.ts';
import { outwardNormal } from './places.ts';

/** Tipos que tienen edificio (plazas y monumentos no). */
export type BuildingPlaceType = Exclude<PlaceType, 'plaza' | 'monument'>;

/**
 * Planta baja y tinte por tipo de lugar. `Record` obliga a que un tipo nuevo (por ejemplo uno religioso) entre en esta
 * tabla: sin su fila el build de TypeScript no compila.
 *
 * | tipo        | planta baja | tinte   | por qué                                              |
 * |-------------|-------------|---------|------------------------------------------------------|
 * | bank        | shop        | #e4e2dc | vidriera de sucursal, revoque gris piedra            |
 * | bar         | shop        | #dcc8a8 | vidriera, revoque ocre                               |
 * | restaurant  | shop        | #eadcc0 | vidriera, revoque crema                              |
 * | fastfood    | shop        | #efe7d6 | vidriera, revoque claro                              |
 * | icecream    | shop        | #f6f2ea | vidriera, casi blanco                                |
 * | cinema      | shop        | #d3cec6 | hall vidriado, gris                                  |
 * | clinic      | shop        | #f2f2ee | entrada vidriada, blanco                             |
 * | school      | brick       | #f0e6dc | edificio escolar de ladrillo visto                   |
 * | culture     | shop        | #efe6d8 | casona con planta baja abierta                       |
 * | club        | brick       | #efe4d6 | sede de club de ladrillo                             |
 * | station     | shop        | #dde3cc | boletería y andén vidriados, verde claro             |
 *
 * Ninguno usa `house` (puerta de madera y ventana con reja): un lugar con cartel no tiene que parecer una casa.
 */
export const FACADE_BY_TYPE: Record<BuildingPlaceType, { ground: FacadeGround; tint: string }> = {
  bank: { ground: 'shop', tint: '#e4e2dc' },
  bar: { ground: 'shop', tint: '#dcc8a8' },
  restaurant: { ground: 'shop', tint: '#eadcc0' },
  fastfood: { ground: 'shop', tint: '#efe7d6' },
  icecream: { ground: 'shop', tint: '#f6f2ea' },
  cinema: { ground: 'shop', tint: '#d3cec6' },
  clinic: { ground: 'shop', tint: '#f2f2ee' },
  school: { ground: 'brick', tint: '#f0e6dc' },
  culture: { ground: 'shop', tint: '#efe6d8' },
  club: { ground: 'brick', tint: '#efe4d6' },
  station: { ground: 'shop', tint: '#dde3cc' },
};

/** Lo que mapgen lee de data/photo-facades.json. */
export interface PhotoEdge { placeId: string; edgeIndex?: number }

/** Arista del cartel: la más cercana al ancla entre las que miran para el mismo lado; si ninguna, la más cercana. */
function signEdge(b: Building, p: Pick<Place, 'sign'>): number {
  const fp = b.footprint, s = p.sign!;
  let best = -1, bestD = Infinity, any = -1, anyD = Infinity;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], c = fp[(i + 1) % fp.length];
    if (a[0] === c[0] && a[1] === c[1]) continue;
    const d = distPointSegment(s.anchor, a, c);
    if (d < anyD) { anyD = d; any = i; }
    const n = outwardNormal(a, c);
    if (n[0] * s.normal[0] + n[1] * s.normal[1] > 0.99 && d < bestD) { bestD = d; best = i; }
  }
  return best >= 0 ? best : any;
}

/**
 * Pone `facades` en los edificios de los lugares con cartel o con foto con `edgeIndex`. La arista es la de la foto si la
 * tiene, si no la del cartel; si dos lugares caen en la misma arista manda el primero de `places`. Lo que falte en el
 * `facade` de places.json sale de FACADE_BY_TYPE. Devuelve avisos (fatales para el build).
 */
export function placeFacades(buildings: Building[], places: Omit<Place, 'spawn'>[], inputs: PlaceInput[], photos: PhotoEdge[]): string[] {
  const warnings: string[] = [];
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const inputOf = new Map(inputs.map((i) => [i.id, i]));
  const photoOf = new Map(photos.map((f) => [f.placeId, f]));
  for (const p of places) {
    if (p.type === 'plaza' || p.type === 'monument' || !p.buildingId) continue;
    const b = byId.get(p.buildingId);
    if (!b) continue;
    const photoEdge = photoOf.get(p.id)?.edgeIndex;
    let edge: number;
    if (photoEdge !== undefined) {
      if (!Number.isInteger(photoEdge) || photoEdge < 0 || photoEdge >= b.footprint.length) {
        warnings.push(`${p.id}: edgeIndex ${photoEdge} de la foto no existe en ${b.id} (tiene ${b.footprint.length} aristas)`);
        continue;
      }
      edge = photoEdge;
    } else if (p.sign) edge = signEdge(b, p);
    else continue;
    if (b.facades?.some((f) => f.edge === edge)) continue;
    const def = FACADE_BY_TYPE[p.type];
    const own = inputOf.get(p.id)?.facade;
    (b.facades ??= []).push({ edge, ground: own?.ground ?? def.ground, tint: own?.tint ?? def.tint });
  }
  return warnings;
}
