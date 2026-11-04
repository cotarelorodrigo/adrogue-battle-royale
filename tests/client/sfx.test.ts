// @vitest-environment jsdom
import { createSfx, playEvents, ZONE_HURT_EVERY } from '../../src/client/audio/sfx.ts';
import type { Sfx } from '../../src/client/audio/sfx.ts';
import type { MatchEvent } from '../../src/shared/match.ts';

afterEach(() => vi.unstubAllGlobals());

/** Un AudioContext de mentira: anota cuántos nodos se arman y cuántos se conectan a la salida. */
class FakeAudioContext {
  static made: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = { kind: 'destination' };
  started = 0;
  closed = false;
  resumed = 0;
  constructor() {
    FakeAudioContext.made.push(this);
  }
  private node(extra: object = {}) {
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
    return {
      gain: param(), frequency: param(), Q: param(), threshold: param(), ratio: param(), knee: param(), attack: param(), release: param(),
      type: '', buffer: null as unknown, loop: false,
      connect: (n: unknown) => n,
      disconnect() {},
      start: () => { this.started++; },
      stop() {},
      ...extra,
    };
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
  s.reload();
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
    ['shot', () => s.shot('rifle')], ['reload', () => s.reload()], ['hit', () => s.hit(false)], ['hit cabeza', () => s.hit(true)],
    ['pickup', () => s.pickup()], ['zoneHurt', () => s.zoneHurt()], ['empty', () => s.empty()],
  ];
  for (const [name, play] of sounds) {
    const before = ctx.started;
    play();
    expect(ctx.started, name).toBeGreaterThan(before);
  }
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
    shot: (w) => calls.push(`shot ${w}`), reload: () => calls.push('reload'), hit: (head) => calls.push(`hit ${head}`),
    pickup: () => calls.push('pickup'), zoneHurt: () => calls.push('zoneHurt'), empty: () => calls.push('empty'), dispose() {},
  };
  const hit = (part: 'cuerpo' | 'cabeza'): MatchEvent => ({ type: 'hit', id: 'm1', part, dmg: 10, point: [0, 1, 0] });
  playEvents(spy, [
    { type: 'shot', weapon: 'escopeta', from: [0, 0, 0], to: [] },
    hit('cuerpo'), hit('cuerpo'), hit('cabeza'), hit('cuerpo'),
    { type: 'zone-hurt', dmg: 0.1 }, { type: 'zone-hurt', dmg: 0.1 },
    { type: 'pickup', item: { kind: 'chaleco' } }, { type: 'reload', weapon: 'rifle' }, { type: 'empty' },
    { type: 'kill', id: 'm1', name: 'Maniquí 1' }, { type: 'over', won: true },
  ]);
  expect(calls).toEqual(['shot escopeta', 'pickup', 'reload', 'empty', 'hit true', 'zoneHurt']);
  calls.length = 0;
  playEvents(spy, [hit('cuerpo'), hit('cuerpo')]);
  expect(calls).toEqual(['hit false']);
});
