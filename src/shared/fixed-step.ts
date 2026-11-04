// Paso fijo: convierte el dt variable de cada cuadro en N pasos de duración constante (determinista, sin relojes).
export const SIM_HZ = 60;

// Tolerancia para que 2 × (1/120) o 1/60 no queden en 0,9999… pasos por redondeo de punto flotante.
const EPS = 1e-9;

export class FixedStep {
  private readonly hz: number;
  private readonly maxSteps: number;
  private acc = 0; // resto acumulado, en pasos (0 ≤ acc < 1 entre llamadas)

  constructor(hz: number = SIM_HZ, maxSteps = 5) {
    this.hz = hz;
    this.maxSteps = maxSteps;
  }

  // Corre los pasos que entran en dt (cada uno llama a step(1/hz)) y devuelve cuántos fueron.
  // Si piden más de maxSteps, corre maxSteps y descarta el resto (evita la espiral de la muerte tras una pausa).
  advance(dt: number, step: (h: number) => void): number {
    if (!(dt > 0) || !Number.isFinite(dt)) return 0;
    this.acc += dt * this.hz;
    let n = Math.floor(this.acc + EPS);
    this.acc = Math.max(0, this.acc - n);
    if (n > this.maxSteps) {
      n = this.maxSteps;
      this.acc = 0;
    }
    const h = 1 / this.hz;
    for (let i = 0; i < n; i++) step(h);
    return n;
  }
}
