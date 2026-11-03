// Redondeo de lo que se escribe en el mapa: 2 decimales (1 cm) salvo que se pida otra cosa.
import type { Vec2 } from '../shared/geo.ts';

export const rn = (n: number, d = 2): number => { const f = 10 ** d; return Math.round(n * f) / f; };
export const v2 = (p: Vec2, d = 2): Vec2 => [rn(p[0], d), rn(p[1], d)];

/** Redondea y quita vértices consecutivos repetidos (también el último igual al primero). */
export function ring(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts.map((q) => v2(q))) {
    const l = out[out.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}
