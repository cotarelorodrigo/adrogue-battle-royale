// Sonidos del combate sintetizados con WebAudio (spec 2a §4), sin archivos: ruido filtrado con un golpe grave para
// los disparos (distinto por arma), chasquidos para la recarga y el gatillo vacío, tonos cortos para los impactos y
// para juntar, y un zumbido grave para la zona.
//
// El AudioContext se crea en el primer gesto del usuario (tecla o clic): creado antes, Chrome lo deja suspendido y
// avisa en la consola. Hasta entonces, y donde no hay WebAudio (jsdom), los sonidos no hacen nada.
import type { WeaponId } from '../../shared/combat.ts';
import type { MatchEvent } from '../../shared/match.ts';

export interface Sfx {
  shot(weapon: WeaponId): void;
  reload(): void;
  /** Impacto en un maniquí; en la cabeza suena más agudo. */
  hit(head: boolean): void;
  pickup(): void;
  /** La zona lastima en cada paso: suena a lo sumo una vez cada ZONE_HURT_EVERY s. */
  zoneHurt(): void;
  /** Gatillo sin balas. */
  empty(): void;
  /** Deja de escuchar los gestos y cierra el AudioContext. */
  dispose(): void;
}

/** Segundos entre dos zumbidos de la zona. */
export const ZONE_HURT_EVERY = 0.7;
const VOLUME = 0.5;
/** Eventos que cuentan como gesto del usuario para arrancar el audio. */
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/** Disparo: ruido por un pasabajos que se cierra (dur s, desde freq Hz) y un golpe grave que baja desde thump Hz. */
const SHOT: Record<WeaponId, { dur: number; freq: number; gain: number; thump: number; tail?: number }> = {
  pistola: { dur: 0.14, freq: 3200, gain: 0.55, thump: 170 },
  escopeta: { dur: 0.36, freq: 1500, gain: 0.85, thump: 95 },
  rifle: { dur: 0.1, freq: 3600, gain: 0.5, thump: 140 },
  francotirador: { dur: 0.3, freq: 2400, gain: 0.95, thump: 75, tail: 0.9 },
};

const NO_SOUND: Sfx = { shot() {}, reload() {}, hit() {}, pickup() {}, zoneHurt() {}, empty() {}, dispose() {} };

/** `target` recibe los gestos (por defecto, window). */
export function createSfx(target?: EventTarget): Sfx {
  if (typeof AudioContext === 'undefined') return NO_SOUND;
  const gestures = target ?? window;
  let ctx: AudioContext | null = null;
  let out: AudioNode | null = null;
  let noise: AudioBuffer | null = null;
  let zoneAt = -Infinity;
  let disposed = false;
  let bursts = 0;

  const onGesture = (): void => {
    if (!ctx) {
      ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = VOLUME;
      const comp = ctx.createDynamicsCompressor(); // ráfagas del rifle con impactos: que no sature
      master.connect(comp).connect(ctx.destination);
      out = master;
      noise = whiteNoise(ctx);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  };
  for (const g of GESTURES) gestures.addEventListener(g, onGesture, { capture: true, passive: true });

  /** Ruido de `dur` s desde `t0`: por un filtro (de f0 a f1 Hz) y con una envolvente que cae de `gain` a casi nada. */
  function burst(t0: number, dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number): void {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f0, t0);
    filter.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const env = c.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(env).connect(out!);
    src.start(t0, ((bursts++ * 0.618034) % 1) * 0.5); // cada ruido arranca en otro lugar del buffer: no suenan todos iguales
    src.stop(t0 + dur);
  }

  /** Tono de `dur` s desde `t0` que va de f0 a f1 Hz, con ataque corto y caída hasta casi nada. */
  function tone(t0: number, dur: number, type: OscillatorType, f0: number, f1: number, gain: number): void {
    const c = ctx!;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(env).connect(out!);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  /** El momento de ahora, o null si todavía no hay audio. */
  const now = (): number | null => (ctx && !disposed ? ctx.currentTime : null);

  return {
    shot(weapon) {
      const t = now();
      if (t === null) return;
      const s = SHOT[weapon];
      burst(t, s.dur, 'lowpass', s.freq, s.freq * 0.25, s.gain);
      tone(t, s.dur * 0.8, 'sine', s.thump * 2, s.thump * 0.5, s.gain * 0.9);
      if (s.tail) burst(t + 0.06, s.tail, 'lowpass', 900, 200, s.gain * 0.25); // el eco del francotirador
    },
    reload() {
      const t = now();
      if (t === null) return;
      burst(t, 0.04, 'highpass', 2500, 1800, 0.35); // sale el cargador
      burst(t + 0.32, 0.05, 'bandpass', 1800, 1200, 0.45); // entra
      tone(t + 0.34, 0.03, 'square', 900, 700, 0.08);
    },
    hit(head) {
      const t = now();
      if (t === null) return;
      if (head) {
        tone(t, 0.12, 'triangle', 2200, 2600, 0.3);
        tone(t + 0.03, 0.1, 'sine', 3300, 3300, 0.15);
      } else {
        tone(t, 0.06, 'square', 1400, 1100, 0.12);
      }
    },
    pickup() {
      const t = now();
      if (t === null) return;
      tone(t, 0.09, 'sine', 520, 1040, 0.25);
      tone(t + 0.05, 0.09, 'sine', 780, 1560, 0.18);
    },
    zoneHurt() {
      const t = now();
      if (t === null || t - zoneAt < ZONE_HURT_EVERY) return;
      zoneAt = t;
      tone(t, 0.2, 'sawtooth', 95, 60, 0.12);
      burst(t, 0.2, 'lowpass', 500, 150, 0.15);
    },
    empty() {
      const t = now();
      if (t === null) return;
      burst(t, 0.015, 'highpass', 3500, 3000, 0.3);
      tone(t, 0.012, 'square', 1800, 1600, 0.05);
    },
    dispose() {
      disposed = true;
      for (const g of GESTURES) gestures.removeEventListener(g, onGesture, { capture: true });
      void ctx?.close().catch(() => {});
    },
  };
}

/** Un segundo de ruido blanco (xorshift: sin Math.random). */
function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let x = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    data[i] = ((x >>> 0) / 4294967296) * 2 - 1;
  }
  return buf;
}

/** Los sonidos de los eventos de un cuadro. Los impactos se juntan en uno (los 8 perdigones de la escopeta suenan
 *  una vez, en la cabeza si alguno pegó ahí) y la zona suena al final; los demás, en orden. */
export function playEvents(sfx: Sfx, events: readonly MatchEvent[]): void {
  let hit: boolean | null = null;
  let zone = false;
  for (const e of events) {
    switch (e.type) {
      case 'shot': sfx.shot(e.weapon); break;
      case 'reload': sfx.reload(); break;
      case 'pickup': sfx.pickup(); break;
      case 'empty': sfx.empty(); break;
      case 'hit': hit = hit === true || e.part === 'cabeza'; break;
      case 'zone-hurt': zone = true; break;
      default: break; // kill y over: los muestra el HUD
    }
  }
  if (hit !== null) sfx.hit(hit);
  if (zone) sfx.zoneHurt();
}
