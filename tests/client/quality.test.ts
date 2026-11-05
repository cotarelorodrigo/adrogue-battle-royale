// @vitest-environment jsdom
import { QUALITY, loadQuality, saveQuality } from '../../src/client/render/quality.ts';

test('presets exactos', () => {
  expect(QUALITY.baja).toMatchObject({ pixelRatioMax: 0.75, shadows: false, drawDistance: 250, treeDensity: 0.5 });
  expect(QUALITY.media.shadows).toEqual({ mapSize: 1024, range: 80 });
  expect(QUALITY.alta.drawDistance).toBe(900);
});

test('sombras de los contenedores solo en alta', () => {
  expect([QUALITY.baja.dumpsterShadows, QUALITY.media.dumpsterShadows, QUALITY.alta.dumpsterShadows]).toEqual([false, false, true]);
});

test('el botín se ve a 80, 100 y 120 m, y los maniquíes proyectan sombra solo en alta (como los contenedores)', () => {
  expect([QUALITY.baja.dropRadius, QUALITY.media.dropRadius, QUALITY.alta.dropRadius]).toEqual([80, 100, 120]);
  expect([QUALITY.baja.dummyShadows, QUALITY.media.dummyShadows, QUALITY.alta.dummyShadows]).toEqual([false, false, true]);
});

// T11b: los detalles chicos de todo el mapa (durmientes, barandas de las escaleras de mano) hasta acá; más allá miden
// menos de medio píxel de grueso
test('los detalles chicos se dibujan hasta 150, 200 y 250 m', () => {
  expect([QUALITY.baja.detailRadius, QUALITY.media.detailRadius, QUALITY.alta.detailRadius]).toEqual([150, 200, 250]);
});

test('calidad por defecto media y persistida', () => {
  localStorage.clear();
  expect(loadQuality()).toBe('media');
  saveQuality('baja');
  expect(loadQuality()).toBe('baja');
});

test('un valor guardado inválido vuelve a media', () => {
  localStorage.setItem('adrogue.calidad', 'ultra');
  expect(loadQuality()).toBe('media');
});

test('con localStorage bloqueado: media por defecto y guardar no explota', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError'); });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError'); });
  try {
    expect(loadQuality()).toBe('media');
    expect(() => saveQuality('alta')).not.toThrow();
  } finally {
    get.mockRestore();
    set.mockRestore();
  }
});
