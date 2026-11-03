// HUD: la mira en el centro y, con F3, los fps y los draw calls.

/** Cada cuántos ms se reescribe el texto de F3 (escribir en el DOM en cada cuadro no hace falta). */
const STATS_REFRESH_MS = 250;
/** Ventana del promedio de fps. */
const FPS_WINDOW_MS = 1000;

/** fps promediados sobre el último segundo de cuadros. */
export class FpsMeter {
  private times: number[] = [];

  tick(now: number): void {
    this.times.push(now);
    while (this.times.length > 2 && now - this.times[0] > FPS_WINDOW_MS) this.times.shift();
  }

  get fps(): number {
    const n = this.times.length;
    if (n < 2) return 0;
    const span = this.times[n - 1] - this.times[0];
    return span > 0 ? ((n - 1) * 1000) / span : 0;
  }
}

export interface Hud {
  toggleStats(): void;
  update(now: number, fps: number, drawCalls: number): void;
}

export function createHud(root: HTMLElement): Hud {
  const crosshair = document.createElement('div');
  crosshair.className = 'crosshair';
  const stats = document.createElement('div');
  stats.className = 'stats';
  stats.dataset.testid = 'hud-stats';
  stats.hidden = true;
  root.append(crosshair, stats);
  let lastWrite = -Infinity;

  return {
    toggleStats() {
      stats.hidden = !stats.hidden;
      lastWrite = -Infinity;
    },
    update(now, fps, drawCalls) {
      if (stats.hidden || now - lastWrite < STATS_REFRESH_MS) return;
      lastWrite = now;
      stats.textContent = `${Math.round(fps)} fps · ${drawCalls} draw calls`;
    },
  };
}
