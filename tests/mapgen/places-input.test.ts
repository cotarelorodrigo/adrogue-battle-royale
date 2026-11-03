import { loadPlaces, validatePlaces, ENTERABLE_IDS } from '../../src/mapgen/places-input.ts';
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

describe('facade en places.json', () => {
  const base = { id: 'x', name: 'X', type: 'bank', lat: -34.7975, lon: -58.39, enterable: false, signText: 'X' };
  const check = (extra: Record<string, unknown>) => () => validatePlaces([{ ...base, ...extra }], 'prueba.json');
  test('acepta ground y tint válidos, o uno solo', () => {
    expect(check({ facade: { ground: 'brick', tint: '#a05a3a' } })).not.toThrow();
    expect(check({ facade: { ground: 'house' } })).not.toThrow();
    expect(check({ facade: { tint: '#FFEEDD' } })).not.toThrow();
    expect(validatePlaces([{ ...base, facade: { ground: 'shop' } }], 'p')[0].facade).toEqual({ ground: 'shop' });
  });
  test('ground fuera de la lista: error claro', () =>
    expect(check({ facade: { ground: 'vidrio' } })).toThrow('Lugar "x": facade.ground tiene que ser "shop", "house" o "brick" (vino "vidrio")'));
  test('tint que no es #rrggbb: error claro', () => {
    expect(check({ facade: { tint: 'rojo' } })).toThrow('Lugar "x": facade.tint tiene que ser un color #rrggbb (vino "rojo")');
    expect(check({ facade: { tint: '#fff' } })).toThrow(/facade\.tint tiene que ser un color #rrggbb/);
  });
  test('campo desconocido o facade que no es un objeto', () => {
    expect(check({ facade: { color: '#ffffff' } })).toThrow('Lugar "x": facade tiene un campo desconocido "color" (van ground y tint)');
    expect(check({ facade: 'shop' })).toThrow('Lugar "x": facade tiene que ser un objeto como { "ground": "shop", "tint": "#e4e2dc" }');
  });
  test('plazas y monumentos no tienen fachada', () =>
    expect(() => validatePlaces([{ ...base, type: 'plaza', facade: { ground: 'shop' } }], 'p')).toThrow('Lugar "x": facade no va en plazas ni monumentos (no tienen edificio)'));
});
