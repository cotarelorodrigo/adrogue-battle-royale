// Curvas para las animaciones del combate (el arma en mano, los trazadores).

/** smoothstep: 0 hasta `a`, 1 desde `b` y una S suave en el medio. */
export function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
