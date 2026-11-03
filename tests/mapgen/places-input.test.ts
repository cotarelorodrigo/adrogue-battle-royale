import { loadPlaces, ENTERABLE_IDS } from '../../src/mapgen/places-input.ts';
import { AREA } from '../../src/shared/geo.ts';

const places = loadPlaces();

test('son 38 lugares con id único', () => {
  expect(places).toHaveLength(38);
  expect(new Set(places.map((p) => p.id)).size).toBe(38);
});
test('todos dentro del área', () =>
  places.forEach((p) => {
    expect(p.lat).toBeGreaterThanOrEqual(AREA.south);
    expect(p.lat).toBeLessThanOrEqual(AREA.north);
    expect(p.lon).toBeGreaterThanOrEqual(AREA.west);
    expect(p.lon).toBeLessThanOrEqual(AREA.east);
  }));
test('exactamente los 9 enterables del spec', () => {
  expect(places.filter((p) => p.enterable).map((p) => p.id).sort()).toEqual([...ENTERABLE_IDS].sort());
  expect(ENTERABLE_IDS).toEqual(['banco-nacion', 'galicia', 'bbva', 'mcdonalds', 'cine-pixel', 'la-veneciana', 'guernica-bar', 'casa-de-la-cultura', 'estacion-adrogue']);
});
test('cartel obligatorio salvo plaza/monumento', () =>
  places
    .filter((p) => !['plaza', 'monument'].includes(p.type))
    .forEach((p) => expect(p.signText?.trim().length).toBeGreaterThan(0)));
test('loadPlaces rechaza un lugar fuera del área', () => {
  expect(() => loadPlaces('tests/fixtures/places-bad.json')).toThrow(/fuera del área/);
});
