import { readFileSync } from 'node:fs';
import { AREA } from '../shared/geo.ts';
import type { PlaceType } from '../shared/mapdata.ts';

export interface PlaceInput {
  id: string;
  name: string;
  type: PlaceType;
  lat: number;
  lon: number;
  enterable: boolean;
  signText?: string;
  floors?: number;
  tint?: string;
  wall?: 'plaster' | 'brick';
}

export const ENTERABLE_IDS: readonly string[] = [
  'banco-nacion', 'galicia', 'bbva', 'mcdonalds', 'cine-pixel',
  'la-veneciana', 'guernica-bar', 'casa-de-la-cultura', 'estacion-adrogue',
];

const TYPES: readonly string[] = ['bank', 'bar', 'restaurant', 'fastfood', 'icecream', 'cinema', 'club', 'clinic', 'school', 'culture', 'station', 'monument', 'plaza'];

export function loadPlaces(path = 'data/places.json'): PlaceInput[] {
  const places = JSON.parse(readFileSync(path, 'utf8')) as PlaceInput[];
  if (!Array.isArray(places)) throw new Error(`${path}: se esperaba una lista de lugares`);
  const ids = new Set<string>();
  for (const p of places) {
    const who = `Lugar "${p?.id ?? '?'}"`;
    if (!p.id || !p.name) throw new Error(`${who}: falta id o nombre`);
    if (ids.has(p.id)) throw new Error(`${who}: id repetido`);
    ids.add(p.id);
    if (!TYPES.includes(p.type)) throw new Error(`${who}: tipo desconocido "${p.type}"`);
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || p.lat < AREA.south || p.lat > AREA.north || p.lon < AREA.west || p.lon > AREA.east) {
      throw new Error(`${who}: fuera del área`);
    }
    if (p.type !== 'plaza' && p.type !== 'monument' && !p.signText?.trim()) throw new Error(`${who}: falta el cartel (signText)`);
    if (p.enterable !== ENTERABLE_IDS.includes(p.id)) throw new Error(`${who}: "enterable" no coincide con la lista del spec`);
  }
  return places;
}
