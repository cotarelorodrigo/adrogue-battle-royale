import polygonClipping from 'polygon-clipping';
import { describe, expect, test } from 'vitest';
import { applyFrentes, onFace } from '../../src/mapgen/frentes.ts';
import { resolveFrontage } from '../../src/mapgen/frontage.ts';
import { ROAD_SPECS } from '../../src/mapgen/osm.ts';
import type { OsmPoi } from '../../src/mapgen/osm.ts';
import type { FrenteInput, FrentesInput, LoteInput } from '../../src/mapgen/frentes-input.ts';
import type { PlaceInput } from '../../src/mapgen/places-input.ts';
import { polygonArea, unproject } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, Road, RoadKind } from '../../src/shared/mapdata.ts';

const road = (name: string, kind: RoadKind, points: Vec2[]): Road => ({ id: name, kind, name, ...ROAD_SPECS[kind], points });
const roads: Road[] = [
  road('A', 'tertiary', [[-100, 0], [100, 0]]),
  road('B', 'residential', [[-50, -60], [-50, 60]]),
  road('C', 'residential', [[50, -60], [50, 60]]),
];
const rect = (x0: number, x1: number, z0: number, z1: number): Vec2[] => [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
const ms: Building = { id: 'b0001', footprint: rect(-40, 40, -48, -8), height: 6.6, floors: 2, kind: 'shop', wall: 'plaster', tint: '#fff' };

const cartel = (texto: string, fondo = '#112233') => ({ texto, fondo, letra: '#ffffff', fuente: 'sans' as const, cursiva: false, posicion: 'frente' as const });
const lote = (ancho: number, o: Partial<LoteInput> = {}): LoteInput => ({
  ancho, pisos: 1, fondo: 15, retiro: 0, color: '#ccbbaa', pb: 'vidriera', arriba: 'ventanas', material: 'revoque', puerta: 'medio', ...o,
});
const frente = (o: Partial<FrenteInput> = {}): FrenteInput => ({
  id: 't', calle: 'A', desde: 'B', hasta: 'C', vereda: 'norte', fecha: '2026-01-01', osmAusentes: [],
  lotes: [
    lote(20, { cartel: cartel('BANCO UNO', '#aa0000'), lugar: 'p1' }),
    lote(20, { cartel: cartel("LUCCIANO'S") }),
    lote(20, { cartel: cartel('BONAFIDE') }),
    lote(26, { osm: 'Farrnacia Central' }),
  ],
  ...o,
});
const place = (id: string, p: Vec2, name = id, type: PlaceInput['type'] = 'bar'): PlaceInput => {
  const { lat, lon } = unproject(p);
  return { id, name, type, lat, lon, enterable: false, signText: name.toUpperCase() };
};
const poi = (name: string, p: Vec2): OsmPoi => ({ id: `n-${name}`, name, position: p });
const input = (f: FrenteInput = frente()): FrentesInput => ({ frentes: [f], calzadas: {} });
const places = [place('p1', [-36, -14], 'Banco Uno', 'bank'), place('p2', [-5, -18], "Lucciano's", 'icecream')];
const pois = [poi('Farrnacia Central', [35, -12]), poi('Bonafide', [10, -12])];
const run = (f = frente(), ps = places, os = pois) => applyFrentes(input(f), roads, [ms], ps, os);

describe('onFace', () => {
  const fr = resolveFrontage(roads, frente());
  test('sobre la línea, hacia adentro, en la calle del frente', () => {
    expect(onFace([0, -18], fr, roads)).toBe(true);
    expect(onFace([0, -5], fr, roads)).toBe(true); // 3 m hacia afuera, dentro de los 6 m
  });
  test('fuera del largo, demasiado adentro o demasiado afuera', () => {
    expect(onFace([-47, -18], fr, roads)).toBe(false);
    expect(onFace([0, -40], fr, roads)).toBe(false);
    expect(onFace([0, 2], fr, roads)).toBe(false);
  });
});

describe('applyFrentes', () => {
  test('lugar con "lugar": usa el lote y su cartel', () => {
    const r = run();
    const f = r.fixed.get('p1')!;
    expect(f.buildingId).toBe('t-1');
    expect(f.sign.look!.fondo).toBe('#aa0000');
    expect(r.warnings).toEqual([]);
  });

  test('enlace automático por nombre y cercanía', () => {
    const r = run();
    expect(r.fixed.get('p2')!.buildingId).toBe('t-2');
    expect(r.fixed.get('p2')!.sign.text).toBe("LUCCIANO'S");
  });

  test('lugar sobre el frente sin lote que lo nombre: aviso con la instrucción', () => {
    const r = run(frente(), [...places, place('p9', [20, -16], 'Casa Fantasma')]);
    expect(r.warnings).toContain('p9: cae sobre el frente t y ningún lote lo nombra; agregá "lugar": "p9" al lote que corresponde');
  });

  test('lugar con varios lotes que lo nombran: aviso', () => {
    const f = frente();
    f.lotes[2].cartel = cartel("LUCCIANO'S HELADOS");
    const r = run(f);
    expect(r.warnings).toContain('p2: en el frente t lo nombran los lotes t-2, t-3; dejá "lugar" en uno solo');
  });

  test('un lugar más cerca de la transversal no cuenta como del frente', () => {
    const r = run(frente(), [...places, place('pc', [52, -20], 'Casa Fantasma')]);
    expect(r.warnings).toEqual([]);
    expect(r.fixed.has('pc')).toBe(false);
  });

  test('plazas y monumentos no se enlazan solos', () => {
    const r = run(frente(), [...places, place('mon', [20, -16], 'Casa Fantasma', 'monument')]);
    expect(r.warnings).toEqual([]);
  });

  test('OSM: cubierto por osm, por nombre o por osmAusentes; si no, aviso', () => {
    const ok = run(frente({ osmAusentes: ['Subway'] }), places, [...pois, poi('Subway', [-20, -12])]);
    expect(ok.warnings).toEqual([]);
    const bad = run(frente(), places, [...pois, poi('Prato', [0, -12])]);
    expect(bad.warnings).toEqual(['t: el local de OSM "Prato" no está en ningún lote; si ya no existe, agregalo a "osmAusentes"']);
  });

  test('un POI que cae sobre otra calle no cuenta', () => {
    expect(run(frente(), places, [...pois, poi('Guernica', [52, -20])]).warnings).toEqual([]);
  });

  test('osmAusentes que no está en OSM: aviso', () => {
    const r = run(frente({ osmAusentes: ['Kiosco X'] }));
    expect(r.warnings).toEqual(['t: "Kiosco X" de osmAusentes no es un local de OSM sobre este frente']);
  });

  test('los edificios de Microsoft pierden lo que quedó bajo los lotes', () => {
    const r = run();
    const lots = r.buildings.filter((b) => b.id.startsWith('t-'));
    const rest = r.buildings.filter((b) => !b.id.startsWith('t-'));
    expect(lots).toHaveLength(4);
    expect(rest.length).toBeGreaterThan(0);
    const closed = (fp: Vec2[]): [number, number][][] => [[...fp, fp[0]].map((p): [number, number] => [p[0], p[1]])];
    for (const l of lots) for (const o of rest) {
      const area = polygonClipping.intersection(closed(l.footprint), closed(o.footprint)).reduce((s, p) => s + polygonArea(p[0].slice(0, -1) as Vec2[]), 0);
      expect(area).toBeLessThan(0.01);
    }
  });

  test('carteles de lotes sin lugar van a signs', () => {
    const r = run();
    expect(r.signs.map((s) => s.text)).toEqual(['BONAFIDE']);
    expect(r.signs[0].look).toBeDefined();
  });

  test('fronts por lote y report de distancias', () => {
    const r = run();
    expect([...r.fronts.keys()]).toEqual(['t-1', 't-2', 't-3', 't-4']);
    expect(r.fronts.get('t-1')!.front.length).toBeGreaterThanOrEqual(2);
    expect(r.report.some((l) => l.includes('p1') && l.includes('t-1'))).toBe(true);
  });
});
