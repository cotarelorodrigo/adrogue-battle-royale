// Las ayudas de planta de los planos (en el marco local del Kit: U a lo largo del frente, V hacia adentro): el
// rectángulo [u0, v0, u1, v1], el polígono regular y el yaw que pone el frente de un mueble (+z del modelo) hacia cada
// lado.
import type { Vec2 } from '../geo.ts';

export type Rect = [number, number, number, number];

/** Las cuatro esquinas de [u0, v0, u1, v1], desde (u0, v0). */
export const rect = ([u0, v0, u1, v1]: Rect): Vec2[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

/** Los n vértices del polígono regular de radio r con el medio en c; el primero, sobre +U. */
export const ngon = (c: Vec2, r: number, n: number): Vec2[] =>
  Array.from({ length: n }, (_, k): Vec2 => [c[0] + r * Math.cos((2 * Math.PI * k) / n), c[1] + r * Math.sin((2 * Math.PI * k) / n)]);

/** El yaw de un mueble que mira hacia +V, +U, −V o −U (con yaw MIRA.V, el +x del modelo va hacia +U). */
export const MIRA = { V: 0, U: Math.PI / 2, menosV: Math.PI, menosU: -Math.PI / 2 } as const;
