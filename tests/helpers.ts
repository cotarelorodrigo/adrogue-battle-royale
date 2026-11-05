// Ayudas de los tests que se repetían en varios archivos. Las que ya están en src (closed, areaOf, orientedBox) se
// reexportan de ahí: el test usa la misma que el código.
import { readFileSync } from 'node:fs';
import { vehicular } from '../src/mapgen/frontage.ts';
import { loadFrentes } from '../src/mapgen/frentes-input.ts';
import { loadPlaces } from '../src/mapgen/places-input.ts';
import { loadPlantas } from '../src/mapgen/plantas-input.ts';
import { toLocal } from '../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../src/shared/geo.ts';
import { doorsOf } from '../src/shared/interiors/openings.ts';
import type { Block } from '../src/shared/interiors/types.ts';
import type { Frame, MapData } from '../src/shared/mapdata.ts';

export { orientedBox } from '../src/shared/collision.ts';
export { areaOf, closed } from '../src/shared/interiors/kit.ts';

/** Un número o un punto, a 2 decimales (para los mensajes de los expect). */
export const fmt = (p: number | readonly number[]): string => (typeof p === 'number' ? [p] : p).map((v) => v.toFixed(2)).join(', ');

/** La caja (u0, v0, u1, v1) de un bloque en el marco local `frame`. */
export const boxIn = (frame: Frame) => (x: Block): [number, number, number, number] => {
  const l = x.polygon.map((p) => toLocal(frame, p));
  return [Math.min(...l.map((p) => p[0])), Math.min(...l.map((p) => p[1])), Math.max(...l.map((p) => p[0])), Math.max(...l.map((p) => p[1]))];
};

/** Las entradas de assembleMap con los datos reales del repo. */
export function loadRaw() {
  const frentes = loadFrentes();
  return {
    osm: JSON.parse(readFileSync('data/raw/osm.json', 'utf8')) as unknown,
    buildings: JSON.parse(readFileSync('data/raw/ms-buildings.geojson', 'utf8')),
    places: loadPlaces(),
    photos: JSON.parse(readFileSync('data/photo-facades.json', 'utf8')) as { placeId: string; edgeIndex?: number }[],
    frentes,
    plantas: loadPlantas(frentes),
  };
}

/**
 * La vereda de enfrente de la puerta principal de `placeId`: siguiendo la normal de la puerta hacia afuera, el medio de
 * la vereda del otro lado de la calle vehicular que cruza primero. Una avenida de dos manos (Espora: dos vías de 12 m
 * con los ejes a 10 m) es una sola calzada: se sigue mientras la próxima vía arranque antes de que termine la anterior.
 * Todo medido a lo largo de la normal. `pos`: los pies, en el suelo; `yaw`: mira a la puerta (yaw 0 mira a −z; π/2, a −x).
 */
export function acrossTheStreet(map: Pick<MapData, 'roads' | 'buildings' | 'interiors'>, placeId: string): { pos: Vec3; yaw: number } {
  const input = map.interiors.find((i) => i.placeId === placeId);
  const b = input && map.buildings.find((x) => x.id === input.buildingId);
  if (!input || !b) throw new Error(`${placeId}: no tiene interior en el mapa`);
  const door = doorsOf(b, input)[0];
  const [o, n] = [door.at, door.normal];
  // cada cruce de la normal con el eje de una vía: dónde empieza y termina su calzada y hasta dónde llega su vereda
  const hits: { near: number; far: number; walk: number }[] = [];
  for (const r of map.roads) {
    if (!vehicular(r)) continue;
    for (let k = 0; k + 1 < r.points.length; k++) {
      const [a, c] = [r.points[k], r.points[k + 1]];
      const e: Vec2 = [c[0] - a[0], c[1] - a[1]];
      const den = n[0] * e[1] - n[1] * e[0];
      if (Math.abs(den) < 1e-9) continue;
      // o + n·t = a + e·s, con s en [0, 1]
      const t = ((a[0] - o[0]) * e[1] - (a[1] - o[1]) * e[0]) / den;
      const s = ((a[0] - o[0]) * n[1] - (a[1] - o[1]) * n[0]) / den;
      if (t <= 0 || s < 0 || s > 1) continue;
      const cos = Math.abs(den) / Math.hypot(e[0], e[1]); // entre la normal de la puerta y la del eje
      hits.push({ near: t - r.width / 2 / cos, far: t + r.width / 2 / cos, walk: r.sidewalk / 2 / cos });
    }
  }
  hits.sort((p, q) => p.near - q.near);
  if (hits.length === 0) throw new Error(`${placeId}: ninguna calle vehicular delante de la puerta principal`);
  let last = hits[0];
  for (const h of hits.slice(1)) if (h.near <= last.far + 1e-6 && h.far > last.far) last = h;
  const d = last.far + last.walk;
  return { pos: [o[0] + n[0] * d, 0, o[1] + n[1] * d], yaw: Math.atan2(n[0], n[1]) }; // adelante = −normal
}
