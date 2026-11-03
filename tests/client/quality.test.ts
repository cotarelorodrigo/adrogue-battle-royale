// @vitest-environment jsdom
import { QUALITY, loadQuality, saveQuality } from '../../src/client/render/quality.ts';

test('presets exactos', () => {
  expect(QUALITY.baja).toMatchObject({ pixelRatioMax: 0.75, shadows: false, drawDistance: 250, treeDensity: 0.5 });
  expect(QUALITY.media.shadows).toEqual({ mapSize: 1024, range: 80 });
  expect(QUALITY.alta.drawDistance).toBe(900);
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
