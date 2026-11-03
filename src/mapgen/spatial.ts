import { distPointSegment, pointInPolygon } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';

export interface Box { minX: number; minZ: number; maxX: number; maxZ: number }

export function bboxOf(pts: Vec2[], pad = 0): Box {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

/** Grilla uniforme de cajas; `query` devuelve índices únicos en orden ascendente (determinista). */
export function createGrid(boxes: Box[], cell = 40): { query(box: Box): number[] } {
  const cells = new Map<string, number[]>();
  const key = (i: number, j: number): string => `${i},${j}`;
  boxes.forEach((b, idx) => {
    for (let i = Math.floor(b.minX / cell); i <= Math.floor(b.maxX / cell); i++)
      for (let j = Math.floor(b.minZ / cell); j <= Math.floor(b.maxZ / cell); j++) {
        const k = key(i, j);
        const arr = cells.get(k);
        if (arr) arr.push(idx);
        else cells.set(k, [idx]);
      }
  });
  return {
    query(box: Box): number[] {
      const seen = new Set<number>();
      for (let i = Math.floor(box.minX / cell); i <= Math.floor(box.maxX / cell); i++)
        for (let j = Math.floor(box.minZ / cell); j <= Math.floor(box.maxZ / cell); j++)
          for (const idx of cells.get(key(i, j)) ?? []) if (boxesOverlap(boxes[idx], box)) seen.add(idx);
      return [...seen].sort((x, y) => x - y);
    },
  };
}

/** Distancia entre segmentos a-b y c-d (0 si se cruzan). */
export function segSegDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const s: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (den !== 0) {
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(distPointSegment(a, c, d), distPointSegment(b, c, d), distPointSegment(c, a, b), distPointSegment(d, a, b));
}

/** Distancia de un punto al contorno de un anillo cerrado. */
export function distToRing(p: Vec2, ring: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, distPointSegment(p, ring[i], ring[(i + 1) % ring.length]));
  return d;
}

/** Distancia entre un segmento y un polígono (0 si lo toca o está dentro). */
export function segToPolygonDist(p: Vec2, q: Vec2, ring: Vec2[]): number {
  if (pointInPolygon(p, ring)) return 0;
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, segSegDist(p, q, ring[i], ring[(i + 1) % ring.length]));
  return d;
}

/** Distancia entre dos polígonos (0 si se tocan, cruzan o uno contiene al otro). */
export function polygonDist(a: Vec2[], b: Vec2[]): number {
  if (pointInPolygon(a[0], b) || pointInPolygon(b[0], a)) return 0;
  let d = Infinity;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      d = Math.min(d, segSegDist(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
      if (d === 0) return 0;
    }
  return d;
}
