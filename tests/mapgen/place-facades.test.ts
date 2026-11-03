import { FACADE_BY_TYPE, placeFacades } from '../../src/mapgen/place-facades.ts';
import type { BuildingPlaceType } from '../../src/mapgen/place-facades.ts';
import type { PlaceInput } from '../../src/mapgen/places-input.ts';
import { outwardNormal } from '../../src/mapgen/places.ts';
import { ensureCCW } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, Place, PlaceType } from '../../src/shared/mapdata.ts';

const square = (): Building => ({
  id: 'b1', footprint: ensureCCW([[0, 0], [10, 0], [10, 10], [0, 10]]), height: 7, floors: 2, kind: 'house', wall: 'plaster', tint: '#cccccc',
});
/** Lugar con el cartel sobre la arista `edge` del edificio (ancla a 8 cm, como places.ts). */
function placeOn(b: Building, id: string, type: PlaceType, edge: number): Omit<Place, 'spawn'> {
  const a = b.footprint[edge], c = b.footprint[(edge + 1) % b.footprint.length];
  const n = outwardNormal(a, c);
  const anchor: Vec2 = [(a[0] + c[0]) / 2 + n[0] * 0.08, (a[1] + c[1]) / 2 + n[1] * 0.08];
  return { id, name: id, type, position: anchor, enterable: false, buildingId: b.id, sign: { text: id, anchor, normal: n, width: 4, bottomY: 3 } };
}
const input = (id: string, type: PlaceType, facade?: PlaceInput['facade']): PlaceInput =>
  ({ id, name: id, type, lat: 0, lon: 0, enterable: false, signText: id, ...(facade ? { facade } : {}) });

test('tabla por tipo: todo tipo con edificio tiene fachada; los comercios, de local', () => {
  const withBuilding: BuildingPlaceType[] = ['bank', 'bar', 'restaurant', 'fastfood', 'icecream', 'cinema', 'club', 'clinic', 'school', 'culture', 'station'];
  expect(Object.keys(FACADE_BY_TYPE).sort()).toEqual([...withBuilding].sort());
  for (const t of withBuilding) {
    expect(['shop', 'house', 'brick']).toContain(FACADE_BY_TYPE[t].ground);
    expect(FACADE_BY_TYPE[t].tint).toMatch(/^#[0-9a-f]{6}$/);
  }
  for (const t of ['bank', 'bar', 'restaurant', 'fastfood', 'icecream', 'cinema'] as const) expect(FACADE_BY_TYPE[t].ground).toBe('shop');
  // ninguno queda con la puerta de madera y la ventana con reja de una casa
  expect(Object.values(FACADE_BY_TYPE).some((f) => f.ground === 'house')).toBe(false);
});

test('sin foto: la arista del cartel, con el material y el tinte del tipo', () => {
  const b = square();
  const warnings = placeFacades([b], [placeOn(b, 'banco', 'bank', 1)], [input('banco', 'bank')], []);
  expect(warnings).toEqual([]);
  expect(b.facades).toEqual([{ edge: 1, ground: 'shop', tint: FACADE_BY_TYPE.bank.tint }]);
});

test('places.json manda: ground y tint del lugar; si falta uno, el del tipo', () => {
  const b = square();
  placeFacades([b], [placeOn(b, 'bar', 'bar', 2)], [input('bar', 'bar', { ground: 'brick' })], []);
  expect(b.facades).toEqual([{ edge: 2, ground: 'brick', tint: FACADE_BY_TYPE.bar.tint }]);
  const c = square();
  placeFacades([c], [placeOn(c, 'bar', 'bar', 2)], [input('bar', 'bar', { tint: '#123456' })], []);
  expect(c.facades).toEqual([{ edge: 2, ground: 'shop', tint: '#123456' }]);
});

test('con foto: en su edgeIndex si lo tiene; si no, en la del cartel', () => {
  const b = square();
  placeFacades([b], [placeOn(b, 'est', 'station', 0)], [input('est', 'station')], [{ placeId: 'est', edgeIndex: 3 }]);
  expect(b.facades?.map((f) => f.edge)).toEqual([3]);
  const c = square();
  placeFacades([c], [placeOn(c, 'casa', 'culture', 2)], [input('casa', 'culture')], [{ placeId: 'casa' }]);
  expect(c.facades?.map((f) => f.edge)).toEqual([2]);
});

test('dos lugares en la misma arista: manda el primero; en aristas distintas, una cada uno', () => {
  const b = square();
  placeFacades([b], [placeOn(b, 'a', 'bank', 1), placeOn(b, 'b', 'school', 1), placeOn(b, 'c', 'school', 3)],
    [input('a', 'bank'), input('b', 'school'), input('c', 'school')], []);
  expect(b.facades).toEqual([
    { edge: 1, ground: 'shop', tint: FACADE_BY_TYPE.bank.tint },
    { edge: 3, ground: FACADE_BY_TYPE.school.ground, tint: FACADE_BY_TYPE.school.tint },
  ]);
});

test('edgeIndex de foto fuera de rango: aviso (rompe el build)', () => {
  const b = square();
  const w = placeFacades([b], [placeOn(b, 'est', 'station', 0)], [input('est', 'station')], [{ placeId: 'est', edgeIndex: 9 }]);
  expect(w).toEqual(['est: edgeIndex 9 de la foto no existe en b1 (tiene 4 aristas)']);
});
