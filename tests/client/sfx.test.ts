// @vitest-environment jsdom
import { createSfx, playEvents, RELOAD_IN, trackReload, ZONE_HURT_EVERY } from '../../src/client/audio/sfx.ts';
import type { Sfx } from '../../src/client/audio/sfx.ts';
import { newGun, WEAPONS } from '../../src/shared/combat.ts';
import type { Gun } from '../../src/shared/combat.ts';
import type { MatchEvent, MatchState } from '../../src/shared/match.ts';

afterEach(() => vi.unstubAllGlobals());

/** Un nodo de mentira: anota cuándo arranca y para, cuántas veces se desconecta y su onended. */
interface FakeNode {
  starts: number[]; stops: (number | undefined)[]; disconnects: number; onended: (() => void) | null;
}

/** Un AudioContext de mentira: anota los nodos que se arman, cuántas fuentes arrancan y cuándo. */
class FakeAudioContext {
  static made: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = { kind: 'destination' };
  started = 0;
  closed = false;
  resumed = 0;
  nodes: FakeNode[] = [];
  constructor() {
    FakeAudioContext.made.push(this);
  }
  private node(extra: object = {}) {
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
    const n = {
      gain: param(), frequency: param(), Q: param(), threshold: param(), ratio: param(), knee: param(), attack: param(), release: param(),
      type: '', buffer: null as unknown, loop: false,
      starts: [] as number[], stops: [] as (number | undefined)[], disconnects: 0, onended: null as (() => void) | null,
      connect: (to: unknown) => to,
      disconnect() { n.disconnects++; },
      start: (when = 0) => { this.started++; n.starts.push(when); },
      stop(when?: number) { n.stops.push(when); },
      ...extra,
    };
    this.nodes.push(n);
    return n;
  }
  createGain() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createOscillator() { return this.node(); }
  createBufferSource() { return this.node(); }
  createDynamicsCompressor() { return this.node(); }
  createBuffer(_ch: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  resume() {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }
}

const gesture = (): void => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); };
const everySound = (s: Sfx): void => {
  s.shot('pistola');
  s.shot('escopeta');
  s.shot('rifle');
  s.shot('francotirador');
  s.reload(2);
  s.hit(false);
  s.hit(true);
  s.pickup();
  s.zoneHurt();
  s.empty();
};

beforeEach(() => {
  FakeAudioContext.made = [];
});

test('en jsdom (sin AudioContext) createSfx no tira y los sonidos no hacen nada', () => {
  expect('AudioContext' in window).toBe(false);
  const s = createSfx();
  gesture();
  expect(() => everySound(s)).not.toThrow();
  s.dispose();
});

test('el AudioContext se crea en el primer gesto del usuario, uno solo; antes los sonidos no hacen nada', () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const s = createSfx();
  everySound(s); // sin gesto: no se crea (Chrome avisaría que no puede arrancar)
  expect(FakeAudioContext.made).toHaveLength(0);
  gesture();
  expect(FakeAudioContext.made).toHaveLength(1);
  window.dispatchEvent(new Event('pointerdown'));
  expect(FakeAudioContext.made).toHaveLength(1);
  s.dispose();
});

test('cada sonido arranca al menos una fuente en el contexto', () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const s = createSfx();
  gesture();
  const ctx = FakeAudioContext.made[0];
  const sounds: [string, () => void][] = [
    ['shot', () => s.shot('rifle')], ['reload', () => s.reload(2)], ['hit', () => s.hit(false)], ['hit cabeza', () => s.hit(true)],
    ['pickup', () => s.pickup()], ['zoneHurt', () => s.zoneHurt()], ['empty', () => s.empty()],
  ];
  for (const [name, play] of sounds) {
    const before = ctx.started;
    play();
    expect(ctx.started, name).toBeGreaterThan(before);
  }
  s.dispose();
});

test('la recarga: el cargador sale enseguida y entra a 0,7 de la duración de la recarga del arma', () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const s = createSfx();
  gesture();
  const ctx = FakeAudioContext.made[0];
  expect(RELOAD_IN).toBe(0.7);
  for (const w of ['pistola', 'francotirador'] as const) {
    ctx.currentTime = 10;
    const from = ctx.nodes.length;
    s.reload(WEAPONS[w].reload);
    const starts = ctx.nodes.slice(from).flatMap((n) => n.starts).sort((a, b) => a - b);
    expect(starts[0], w).toBe(10); // sale
    const inAt = 10 + RELOAD_IN * WEAPONS[w].reload;
    expect(starts.filter((t) => t > 10).every((t) => t >= inAt - 1e-9 && t < inAt + 0.05), w).toBe(true); // entra
    expect(starts.filter((t) => t > 10).length, w).toBeGreaterThan(0);
  }
  s.dispose();
});

test('cancelReload: lo que faltaba de la recarga no suena (se para y se desconecta); lo que ya sonó, no se toca', () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const s = createSfx();
  gesture();
  const ctx = FakeAudioContext.made[0];
  ctx.currentTime = 5;
  const from = ctx.nodes.length;
  s.reload(2);
  ctx.currentTime = 5.5;
  s.cancelReload();
  const sources = ctx.nodes.slice(from).filter((n) => n.starts.length > 0);
  const later = sources.filter((n) => n.starts[0] > 5);
  expect(later.length).toBeGreaterThan(0);
  for (const n of later) {
    expect(n.stops.at(-1)).toBeUndefined(); // stop() sin hora: ya
    expect(n.disconnects).toBeGreaterThan(0);
  }
  const out = sources.find((n) => n.starts[0] === 5)!;
  expect(out.stops).toHaveLength(1); // el que ya sonó: solo su stop de siempre, y se desconecta cuando termina
  expect(out.disconnects).toBe(0);
  // una recarga nueva también corta lo que quedaba de la anterior
  const again = ctx.nodes.length;
  s.reload(2);
  const pending = ctx.nodes.slice(again).filter((n) => n.starts[0] > 5.5);
  s.reload(1.2);
  for (const n of pending) expect(n.stops.at(-1)).toBeUndefined();
  s.cancelReload(); // dos veces seguidas no rompe nada
  s.cancelReload();
  s.dispose();
});

test('cada sonido desconecta sus nodos al terminar (onended)', () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const s = createSfx();
  gesture();
  const ctx = FakeAudioContext.made[0];
  const from = ctx.nodes.length; // el volumen y el compresor quedan conectados toda la sesión
  everySound(s);
  const made = ctx.nodes.slice(from);
  expect(made.length).toBeGreaterThan(20);
  for (const n of made) n.onended?.();
  expect(made.filter((n) => n.disconnects === 0)).toEqual([]);
  s.dispose();
});

test(`la zona suena a lo sumo una vez cada ${ZONE_HURT_EVERY} s (lastima en cada paso)`, () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const s = createSfx();
  gesture();
  const ctx = FakeAudioContext.made[0];
  s.zoneHurt();
  const one = ctx.started;
  for (let i = 0; i < 30; i++) s.zoneHurt();
  expect(ctx.started).toBe(one);
  ctx.currentTime = ZONE_HURT_EVERY + 0.01;
  s.zoneHurt();
  expect(ctx.started).toBeGreaterThan(one);
  s.dispose();
});

test('dispose cierra el contexto y deja de escuchar los gestos', () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const s = createSfx();
  gesture();
  s.dispose();
  expect(FakeAudioContext.made[0].closed).toBe(true);
  const started = FakeAudioContext.made[0].started;
  everySound(s);
  expect(FakeAudioContext.made[0].started).toBe(started);
  const other = createSfx();
  other.dispose(); // otro sfx ya liberado: un gesto no crea nada
  gesture();
  expect(FakeAudioContext.made).toHaveLength(1);
});

test('playEvents: un tiro de escopeta suena una vez y sus perdigones dan un solo impacto, de cabeza si hubo uno', () => {
  const calls: string[] = [];
  const spy: Sfx = {
    shot: (w) => calls.push(`shot ${w}`), reload: (d) => calls.push(`reload ${d}`), cancelReload: () => calls.push('cancelReload'),
    hit: (head) => calls.push(`hit ${head}`), pickup: () => calls.push('pickup'), zoneHurt: () => calls.push('zoneHurt'),
    empty: () => calls.push('empty'), dispose() {},
  };
  const hit = (part: 'cuerpo' | 'cabeza'): MatchEvent => ({ type: 'hit', id: 'm1', part, dmg: 10, point: [0, 1, 0] });
  playEvents(spy, [
    { type: 'shot', weapon: 'escopeta', from: [0, 0, 0], to: [] },
    hit('cuerpo'), hit('cuerpo'), hit('cabeza'), hit('cuerpo'),
    { type: 'zone-hurt', dmg: 0.1 }, { type: 'zone-hurt', dmg: 0.1 },
    { type: 'pickup', item: { kind: 'chaleco' } }, { type: 'reload', weapon: 'rifle' }, { type: 'empty' },
    { type: 'kill', id: 'm1', name: 'Maniquí 1' }, { type: 'over', won: true },
  ]);
  expect(calls).toEqual(['shot escopeta', 'pickup', `reload ${WEAPONS.rifle.reload}`, 'empty', 'hit true', 'zoneHurt']);
  calls.length = 0;
  playEvents(spy, [hit('cuerpo'), hit('cuerpo')]);
  expect(calls).toEqual(['hit false']);
});

test('trackReload corta el sonido si la recarga se cancela (cambio de arma, muerte, fin, salir de la partida), no si sigue', () => {
  let cancels = 0;
  const spy: Sfx = { shot() {}, reload() {}, cancelReload: () => { cancels++; }, hit() {}, pickup() {}, zoneHurt() {}, empty() {}, dispose() {} };
  const reloading: Gun = { ...newGun('rifle'), inMag: 3, reloadUntil: 12 };
  const state = (slots: [Gun | null, Gun | null], active: 0 | 1 = 0, over: Partial<MatchState> = {}): MatchState => ({
    me: { alive: true }, over: null, inv: { slots, active, ammo: { liviana: 30, cartuchos: 0, pesada: 0 }, medkits: 0, healingUntil: null }, ...over,
  }) as unknown as MatchState;
  const started: MatchEvent[] = [{ type: 'reload', weapon: 'rifle' }];
  const cases: [string, MatchState | null][] = [
    ['cambio de arma', state([reloading, newGun('pistola')], 1)],
    ['muerte', state([reloading, null], 0, { me: { alive: false } as MatchState['me'], over: { won: false, alive: 3, at: 11 } })],
    ['fin', state([reloading, null], 0, { over: { won: true, alive: 1, at: 11 } })],
    ['paseo', null],
  ];
  for (const [name, after] of cases) {
    const track = trackReload(spy);
    cancels = 0;
    track(started, state([reloading, null]));
    track([], state([reloading, null])); // sigue recargando: nada
    expect(cancels, name).toBe(0);
    track([], after);
    expect(cancels, name).toBe(1);
    track([], after); // una sola vez
    expect(cancels, name).toBe(1);
  }
  // empezó y se canceló en el mismo cuadro (dos pasos): se corta igual
  const track = trackReload(spy);
  cancels = 0;
  track(started, state([reloading, newGun('pistola')], 1));
  expect(cancels).toBe(1);
  // la recarga de otra arma después de cambiar: es otra recarga, sigue
  cancels = 0;
  const other: Gun = { ...newGun('pistola'), inMag: 0, reloadUntil: 13 };
  track(started, state([reloading, null]));
  track([{ type: 'reload', weapon: 'pistola' }], state([{ ...reloading, reloadUntil: null }, other], 1));
  expect(cancels).toBe(0);
});
