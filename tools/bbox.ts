import { areaRect, MARGIN_M, unproject } from '../src/shared/geo.ts';

/** Área de juego ampliada MARGIN_M metros por cada lado, en grados. */
export function expandedBbox() {
  const r = areaRect();
  const sw = unproject([r.minX - MARGIN_M, r.maxZ + MARGIN_M]);
  const ne = unproject([r.maxX + MARGIN_M, r.minZ - MARGIN_M]);
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}
