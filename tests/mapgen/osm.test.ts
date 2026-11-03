import mini from '../fixtures/osm-mini.json';
import { parseOsm, ROAD_SPECS } from '../../src/mapgen/osm.ts';
import { project, signedAreaFromAbove, polygonArea } from '../../src/shared/geo.ts';

const f = parseOsm(mini);
const [a, b] = [project(-34.7992, -58.392), project(-34.7992, -58.3915)];
const lengthOfMiniPlatform = Math.hypot(b[0] - a[0], b[1] - a[1]);

test('calles con ancho y vereda por tipo', () => {
  const espora = f.roads.find((r) => r.name === 'Avenida Espora')!;
  expect([espora.width, espora.sidewalk]).toEqual([12, 3]);
  expect(espora.id).toBe('w100');
  expect(f.roads.some((r) => r.kind === 'footway')).toBe(true);
  expect(f.roads).toHaveLength(2);
});
test('plaza en CCW sin vértice de cierre duplicado', () => {
  const p = f.parks[0];
  expect(p.name).toBe('Plaza Almirante Brown');
  expect(p.id).toBe('p103');
  expect(p.polygon).toHaveLength(4);
  expect(signedAreaFromAbove(p.polygon)).toBeGreaterThan(0);
  expect(p.polygon[0]).not.toEqual(p.polygon.at(-1));
});
test('andén lineal ensanchado a polígono de 4 m', () => {
  expect(polygonArea(f.platforms[0])).toBeCloseTo(lengthOfMiniPlatform * 4, 0);
  expect(signedAreaFromAbove(f.platforms[0])).toBeGreaterThan(0);
});
test('vías y fuentes', () => {
  expect(f.railways).toHaveLength(1);
  expect(f.fountains).toHaveLength(1);
});
test('ROAD_SPECS y validación', () => {
  expect(ROAD_SPECS.footway).toEqual({ width: 2.5, sidewalk: 0 });
  expect(() => parseOsm({})).toThrow(/elements/);
});
