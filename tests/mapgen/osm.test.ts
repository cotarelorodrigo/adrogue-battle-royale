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
test('pois: nodos y vías con nombre y shop, amenity, office o craft; las vías en el promedio de sus nodos', () => {
  const [a, b, c] = [[-34.7992, -58.392], [-34.7992, -58.3918], [-34.7994, -58.3918]];
  const node = (id: number, [lat, lon]: number[], tags?: Record<string, string>) => ({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) });
  const r = parseOsm({ elements: [
    node(1, a, { name: 'Kiosco Uno', shop: 'kiosk' }), node(2, b), node(3, c),
    node(4, a, { shop: 'kiosk' }), node(5, a, { name: 'Sin rubro', note: 'x' }),
    { type: 'way', id: 9, nodes: [2, 3], tags: { name: 'Taller', craft: 'carpenter' } },
  ] });
  expect(r.pois.map((p) => [p.id, p.name])).toEqual([['n1', 'Kiosco Uno'], ['w9', 'Taller']]);
  const [pb, pc] = [project(b[0], b[1]), project(c[0], c[1])];
  expect(r.pois[1].position[0]).toBeCloseTo((pb[0] + pc[0]) / 2, 6);
  expect(r.pois[1].position[1]).toBeCloseTo((pb[1] + pc[1]) / 2, 6);
});

test('surface sett/cobblestone marca la calzada; paving_stones no', () => {
  const way = (id: number, surface: string) => ({ type: 'way', id, nodes: [1, 2], tags: { highway: 'residential', surface } });
  const osm = {
    elements: [
      { type: 'node', id: 1, lat: -34.797, lon: -58.392 },
      { type: 'node', id: 2, lat: -34.797, lon: -58.39 },
      way(10, 'sett'), way(11, 'cobblestone'), way(12, 'unhewn_cobblestone'), way(13, 'paving_stones'),
    ],
  };
  const roads = parseOsm(osm).roads;
  expect(roads.map((r) => [r.id, r.surface])).toEqual([['w10', 'sett'], ['w11', 'sett'], ['w12', 'sett'], ['w13', undefined]]);
});
