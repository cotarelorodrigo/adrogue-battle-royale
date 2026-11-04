// Coordenadas de juego en metros: x = este, z = sur (norte = −z), y arriba.
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const AREA = { south: -34.80137, west: -58.39887, north: -34.79351, east: -58.38246 };
export const MARGIN_M = 150;
export const ORIGIN = { lat: -34.79744, lon: -58.390665 };

const phi = (ORIGIN.lat * Math.PI) / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const M_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);

export function project(lat: number, lon: number): Vec2 {
  const x = (lon - ORIGIN.lon) * M_LON;
  const z = -(lat - ORIGIN.lat) * M_LAT;
  return [x === 0 ? 0 : x, z === 0 ? 0 : z]; // evita −0
}

export function unproject(p: Vec2): { lat: number; lon: number } {
  return { lat: ORIGIN.lat - p[1] / M_LAT, lon: ORIGIN.lon + p[0] / M_LON };
}

export function areaRect(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const [minX, maxZ] = project(AREA.south, AREA.west);
  const [maxX, minZ] = project(AREA.north, AREA.east);
  return { minX, maxX, minZ, maxZ };
}

/** > 0 = antihorario visto desde arriba (el eje norte es −z). */
export function signedAreaFromAbove(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    s += x1 * -z2 - x2 * -z1;
  }
  return s / 2;
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedAreaFromAbove(poly) < 0 ? [...poly].reverse() : poly;
}

export function polygonArea(poly: Vec2[]): number {
  return Math.abs(signedAreaFromAbove(poly));
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

/** Liang–Barsky: recorta el segmento a un rectángulo; null si queda afuera. */
export function clipSegment(a: Vec2, b: Vec2, minX: number, minZ: number, maxX: number, maxZ: number): [Vec2, Vec2] | null {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  let t0 = 0, t1 = 1;
  const test = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (!test(-dx, a[0] - minX) || !test(dx, maxX - a[0]) || !test(-dz, a[1] - minZ) || !test(dz, maxZ - a[1])) return null;
  if (t1 - t0 < 1e-9) return null;
  return [
    t0 === 0 ? a : [a[0] + dx * t0, a[1] + dz * t0],
    t1 === 1 ? b : [a[0] + dx * t1, a[1] + dz * t1],
  ];
}
/** FNV-1a de 32 bits → [0, 1). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** Entero → [0, 1) (lowbias32). A diferencia de hash01 sobre "clave:i", índices consecutivos dan valores sin
 *  correlación: sirve para sembrar texturas (x e y de un mismo punto no quedan alineados). */
export function hashIndex(i: number): number {
  let x = (i + 0x9e3779b9) | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
