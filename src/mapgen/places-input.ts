import { readFileSync } from 'node:fs';
import { AREA } from '../shared/geo.ts';
import type { FacadeGround, PlaceType } from '../shared/mapdata.ts';

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
  /** Fachada de la arista del cartel (o de la foto). Lo que falta sale del tipo (mapgen/place-facades.ts). */
  facade?: { ground?: FacadeGround; tint?: string };
}

export const ENTERABLE_IDS: readonly string[] = [
  'banco-nacion', 'galicia', 'bbva', 'mcdonalds', 'cine-pixel',
  'la-veneciana', 'guernica-bar', 'casa-de-la-cultura', 'estacion-adrogue',
];

const TYPES: readonly string[] = ['bank', 'bar', 'restaurant', 'fastfood', 'icecream', 'cinema', 'club', 'clinic', 'school', 'culture', 'station', 'monument', 'plaza'];

const GROUNDS: readonly string[] = ['shop', 'house', 'brick'];
const FACADE_KEYS: readonly string[] = ['ground', 'tint'];

export function loadPlaces(path = 'data/places.json'): PlaceInput[] {
  return validatePlaces(JSON.parse(readFileSync(path, 'utf8')), path);
}

function validateFacade(who: string, f: unknown): void {
  if (typeof f !== 'object' || f === null || Array.isArray(f)) {
    throw new Error(`${who}: facade tiene que ser un objeto como { "ground": "shop", "tint": "#e4e2dc" }`);
  }
  for (const k of Object.keys(f)) if (!FACADE_KEYS.includes(k)) throw new Error(`${who}: facade tiene un campo desconocido "${k}" (van ground y tint)`);
  const { ground, tint } = f as { ground?: unknown; tint?: unknown };
  if (ground !== undefined && (typeof ground !== 'string' || !GROUNDS.includes(ground))) {
    throw new Error(`${who}: facade.ground tiene que ser "shop", "house" o "brick" (vino "${String(ground)}")`);
  }
  if (tint !== undefined && (typeof tint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(tint))) {
    throw new Error(`${who}: facade.tint tiene que ser un color #rrggbb (vino "${String(tint)}")`);
  }
}

/** Valida la lista de lugares (`source`: de dónde vino, para el mensaje) y la devuelve tipada. */
export function validatePlaces(data: unknown, source: string): PlaceInput[] {
  if (!Array.isArray(data)) throw new Error(`${source}: se esperaba una lista de lugares`);
  const places = data as PlaceInput[];
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
    if (p.facade !== undefined) {
      if (p.type === 'plaza' || p.type === 'monument') throw new Error(`${who}: facade no va en plazas ni monumentos (no tienen edificio)`);
      validateFacade(who, p.facade);
    }
  }
  return places;
}
