// Benchmark (?bench=1): la cámara recorre sola un camino fijo (estación → Esteban Adrogué → Espora → Plaza Brown →
// techos) en ?benchSecs=N segundos (60 si no se dice) y al final muestra los fps en pantalla. No usa el pointer lock
// ni la física: la posición sale solo del tiempo transcurrido, así cualquier compu ve el mismo recorrido.
import type { Vec3 } from '../shared/geo.ts';
import { QUALITY_LABEL } from './render/quality.ts';
import type { Quality } from './render/quality.ts';

const DEFAULT_SECONDS = 60;
/** Antes de medir, quieto en la estación: compila los shaders y sube las texturas de lo que se ve al arrancar. */
const WARMUP_MS = 2000;
/** La cámara mira hacia el punto del camino que está LOOK_AHEAD metros más adelante: dobla de a poco en las esquinas. */
const LOOK_AHEAD = 12;
/** Altura del vuelo sobre los techos (el edificio más alto mide 26,2 m) y cuánto mira hacia abajo ahí. */
const ROOF_Y = 30;
const ROOF_PITCH = -0.2;
/** Cada cuánto se reescribe el cartel de progreso. */
const PROGRESS_MS = 250;

/** Pies de la cámara (el ojo va PLAYER.eye más arriba), por el medio de las calles y después sobre los techos. */
export const BENCH_PATH: Vec3[] = [
  // estación: del spawn frente a la puerta de la boletería, por la calle de servicio hasta Somellera y Esteban Adrogué
  [-308.85, 0, 33.1], [-299, 0, 46], [-292, 0, 51], [-279, 0, 54], [-250, 0, 96],
  // Esteban Adrogué hacia el este, hasta Avenida Espora
  [-68, 0, 131], [-45, 0, 130], [12, 0, 102], [163, 0, 28], [179.5, 0, 19.4],
  // la mano este de Espora hacia el norte, y alrededor de la Plaza Esteban Adrogué
  [179.6, 0, -23.5], [179.3, 0, -30.7], [204, 0, -29], [218, 0, -24], [226, 0, -9], [227, 0, -3],
  // Diagonal Almirante Brown hasta la Plaza Brown
  [268, 0, 5], [468, 0, 43], [515, 0, 51], [567.38, 0, 74.79],
  // techos: sube sobre la plaza dando la vuelta y vuela hacia el oeste, sobre el centro
  [540, ROOF_Y, 70], [-90, ROOF_Y, 25],
];

export interface BenchView { pos: Vec3; yaw: number; pitch: number }
export interface BenchResult { avg: number; worst5: number }

/** Segundos del benchmark, o null si la URL no tiene ?bench=1. Una duración que no sirve vuelve a 60. */
export function benchSeconds(search: string): number | null {
  const q = new URLSearchParams(search);
  if (q.get('bench') !== '1') return null;
  const s = Number(q.get('benchSecs') ?? DEFAULT_SECONDS);
  return Number.isFinite(s) && s > 0 ? s : DEFAULT_SECONDS;
}

export function pathLength(path: Vec3[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    l += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return l;
}

/** El punto a `s` metros del principio (recortado al camino). */
function pointAt(path: Vec3[], s: number): Vec3 {
  let left = Math.max(0, s);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (left <= len && len > 0) {
      const t = left / len;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    left -= len;
  }
  return [...path[path.length - 1]];
}

/** Dónde está y hacia dónde mira la cámara a `s` metros del principio: hacia LOOK_AHEAD metros más adelante (al
 *  final, en la dirección del último tramo); con la vista un poco hacia abajo cuando vuela sobre los techos. */
export function viewAt(path: Vec3[], s: number): BenchView {
  const L = pathLength(path);
  const pos = pointAt(path, Math.min(L, s));
  const from = Math.max(0, Math.min(s, L - LOOK_AHEAD));
  const a = pointAt(path, from), b = pointAt(path, from + LOOK_AHEAD);
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const yaw = dx === 0 && dz === 0 ? 0 : Math.atan2(-dx, -dz); // adelante = (−sin yaw, −cos yaw)
  return { pos, yaw, pitch: ROOF_PITCH * Math.min(1, Math.max(0, pos[1] / ROOF_Y)) };
}

/** Promedio = cuadros / tiempo total. Peor 5 % = fps promedio del 5 % de cuadros más lentos (al menos uno): los
 *  tirones que el promedio esconde. */
export function summarize(frameMs: number[]): BenchResult {
  if (frameMs.length === 0) return { avg: 0, worst5: 0 };
  const total = frameMs.reduce((a, b) => a + b, 0);
  const n = Math.ceil(frameMs.length * 0.05); // con al menos un cuadro, al menos 1
  const worst = [...frameMs].sort((a, b) => b - a).slice(0, n);
  return { avg: (1000 * frameMs.length) / total, worst5: (1000 * n) / worst.reduce((a, b) => a + b, 0) };
}

export function formatResult(r: BenchResult, q: Quality): string {
  return `Promedio: ${Math.round(r.avg)} fps · Peor 5 %: ${Math.round(r.worst5)} fps · Calidad: ${QUALITY_LABEL[q]}`;
}

export interface BenchOptions {
  seconds: number;
  quality: Quality;
  /** "Medir en Baja / Media / Alta": guardar esa calidad y volver a correr. */
  onRerun(q: Quality): void;
  /** "Jugar": la misma página sin ?bench=1. */
  onPlay(): void;
}

export interface Bench {
  /** En cada cuadro, con el tiempo del requestAnimationFrame: dónde poner la cámara. */
  frame(now: number): BenchView;
  /** La escena ya está completa (fotos incluidas): entra en calor WARMUP_MS y después mide. */
  start(now: number): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createBench(root: HTMLElement, o: BenchOptions): Bench {
  const L = pathLength(BENCH_PATH);
  const start = viewAt(BENCH_PATH, 0), end = viewAt(BENCH_PATH, L);
  const status = el('div', 'stats', 'Benchmark: cargando…');
  root.append(status);
  let phase: 'waiting' | 'warmup' | 'running' | 'done' = 'waiting';
  let since = 0, last = 0, lastWrite = -Infinity;
  const frames: number[] = [];

  function finish(): void {
    phase = 'done';
    status.remove();
    const line = formatResult(summarize(frames), o.quality);
    const panel = el('div', 'panel');
    const result = el('p', 'bench-result', line);
    result.dataset.testid = 'bench-result';
    const again = el('div', 'quality');
    again.append(el('span', undefined, 'Medir en:'));
    (['baja', 'media', 'alta'] as const).forEach((q, i) => {
      if (i > 0) again.append(el('span', undefined, '/'));
      const b = el('button', undefined, QUALITY_LABEL[q]);
      b.type = 'button';
      b.addEventListener('click', () => o.onRerun(q));
      again.append(b);
    });
    const play = el('button', 'primary', 'Jugar');
    play.type = 'button';
    play.addEventListener('click', () => o.onPlay());
    panel.append(
      el('h2', undefined, 'Benchmark'),
      result,
      el('p', 'help', `${frames.length} cuadros en ${o.seconds} s por la estación, Esteban Adrogué, Espora, la Plaza Brown y `
        + 'los techos.'),
      again,
      play,
    );
    const wrap = el('div', 'overlay');
    wrap.setAttribute('role', 'status');
    wrap.append(panel);
    root.append(wrap);
  }

  return {
    start(now) {
      if (phase !== 'waiting') return;
      phase = 'warmup';
      since = now;
      status.textContent = 'Benchmark: preparando…';
    },
    frame(now) {
      if (phase === 'waiting') return start;
      if (phase === 'warmup') {
        if (now - since < WARMUP_MS) return start;
        phase = 'running';
        since = last = now;
        return start;
      }
      if (phase === 'done') return end;
      frames.push(now - last);
      last = now;
      const t = (now - since) / 1000;
      if (t >= o.seconds) {
        finish();
        return end;
      }
      if (now - lastWrite >= PROGRESS_MS) {
        lastWrite = now;
        status.textContent = `Benchmark: ${Math.floor(t)} de ${o.seconds} s · Calidad: ${QUALITY_LABEL[o.quality]}`;
      }
      return viewAt(BENCH_PATH, (t / o.seconds) * L);
    },
  };
}
