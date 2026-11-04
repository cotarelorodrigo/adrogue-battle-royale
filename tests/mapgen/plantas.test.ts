import { readFileSync } from 'node:fs';
import mini from '../fixtures/osm-mini.json';
import { assembleMap } from '../../src/mapgen/assemble.ts';
import type { GeoJSONFeatureCollection } from '../../src/mapgen/buildings.ts';
import { cumulative, pointAt, resolveFrontage, streetChain } from '../../src/mapgen/frontage.ts';
import { loadFrentes } from '../../src/mapgen/frentes-input.ts';
import type { FrentesInput, LoteInput } from '../../src/mapgen/frentes-input.ts';
import { lotOverlap } from '../../src/mapgen/lots.ts';
import { parseOsm } from '../../src/mapgen/osm.ts';
import { loadPlaces } from '../../src/mapgen/places-input.ts';
import { SIN_LOTE, loadPlantas, validatePlantas } from '../../src/mapgen/plantas-input.ts';
import type { PlantaInput } from '../../src/mapgen/plantas-input.ts';
import { placePlantas, toWorld } from '../../src/mapgen/plantas.ts';
import { distPointSegment, polygonArea, project, signedAreaFromAbove, unproject } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { MapData } from '../../src/shared/mapdata.ts';

const FIXTURE = 'tests/fixtures/plantas-prueba.json';
const NO_FRENTES: FrentesInput = { frentes: [], calzadas: {} };
const roads = parseOsm(mini).roads;

const distToLine = (p: Vec2, line: Vec2[]): number => Math.min(...line.slice(1).map((q, i) => distPointSegment(p, line[i], q)));

/** Una entrada válida (la del Guernica del plan), para romperla de a un campo. */
const ok = (): Record<string, unknown> => ({
  lugar: 'guernica-bar', fecha: '2026-11',
  marco: { calle: 'Pellerano', vereda: 'norte', desde: 'Esteban Adrogué', hasta: 'Samuel Miguel Spiro', s: 31.5 },
  planta: [[0, 4], [9.6, 4], [9.6, 21], [0, 21]],
  patios: [[[0, 0], [9.6, 0], [9.6, 4], [0, 4]]],
  frente: [0], pisos: 2, reemplaza: [],
  puertas: [{ arista: 0, centro: 4.8, ancho: 1.6, alto: 2.4, piso: 0 }],
  vidrios: [{ arista: 0, desde: 0.4, hasta: 3.8, abajo: 0.3, arriba: 2.6, piso: 0 }],
  color: '#3a3a3a', pb: 'vidriera', arriba: 'ventanas', puerta: 'medio',
  cartel: { texto: 'GUERNICA', fondo: '#2b2b2b', letra: '#f2c14e' },
});
const check = (e: Record<string, unknown>, frentes: FrentesInput = NO_FRENTES) => validatePlantas({ plantas: [e] }, 'x', frentes);
const puerta = (o: object = {}) => ({ arista: 0, centro: 4.8, ancho: 1.6, alto: 2.4, piso: 0, ...o });
const lote = (ancho: number, o: Partial<LoteInput> = {}): LoteInput => ({
  ancho, pisos: 1, fondo: 15, retiro: 0, color: '#ccbbaa', pb: 'vidriera', arriba: 'ventanas', material: 'revoque', puerta: 'medio', ...o,
});

describe('validatePlantas', () => {
  test('completa el lote: ancho con el largo del frente, fondo con la profundidad y lugar', () => {
    const [p] = check(ok());
    expect(p.lote).toMatchObject({ ancho: 9.6, fondo: 17, lugar: 'guernica-bar', pisos: 2, color: '#3a3a3a', puerta: 'medio', retiro: 0 });
    expect(p.lote.alto).toBeUndefined();
    expect(p.lote.cartel).toMatchObject({ texto: 'GUERNICA', fuente: 'sans', posicion: 'frente' });
    expect(p.frente).toEqual([0]);
    expect(p.patios).toHaveLength(1);
    // lo que no viene queda vacío
    const { patios: _p, vidrios: _v, reemplaza: _r, ...min } = ok();
    expect(check(min)[0]).toMatchObject({ patios: [], vidrios: [], reemplaza: [] });
  });

  test('el fixture y data/plantas.json son válidos', () => {
    expect(loadPlantas(NO_FRENTES, FIXTURE).map((p) => p.lugar)).toEqual(['guernica-bar', 'mcdonalds']);
    expect(loadPlantas(NO_FRENTES, FIXTURE)[0].lote.alto).toBe(7.5);
    expect(() => loadPlantas(loadFrentes())).not.toThrow();
  });

  test('campo desconocido, en la entrada, en el marco, en una puerta o en el cartel', () => {
    expect(() => check({ ...ok(), colour: '#ffffff' })).toThrow(/^x: planta de guernica-bar: campo desconocido "colour" \(van lugar, fecha, /);
    expect(() => check({ ...ok(), marco: { lat: -34.797, lon: -58.39, rumbo: 0, s: 3 } })).toThrow(/^x: planta de guernica-bar: marco: campo desconocido "s"/);
    expect(() => check({ ...ok(), puertas: [puerta({ lado: 'norte' })] })).toThrow(/^x: planta de guernica-bar, puerta 1: campo desconocido "lado"/);
    expect(() => check({ ...ok(), cartel: { texto: 'G', fondo: '#000000', letra: '#ffffff', color: '#ffffff' } })).toThrow(/^x: planta de guernica-bar: cartel: campo desconocido "color"/);
  });

  test('lugar fuera de SIN_LOTE', () => {
    expect(() => check({ ...ok(), lugar: 'galicia' })).toThrow(/^x: planta de galicia: lugar tiene que ser uno de guernica-bar, cine-pixel, mcdonalds, estacion-adrogue, la-veneciana \(vino "galicia"\)$/);
  });

  test('lugar que ya tiene lote en frentes.json: nombra el frente y el lote', () => {
    const frentes: FrentesInput = { calzadas: {}, frentes: [{
      id: 'ea-sur', calle: 'Esteban Adrogué', desde: 'A', hasta: 'B', vereda: 'sur', fecha: '2024-03', osmAusentes: [],
      lotes: [lote(8), lote(9, { lugar: 'guernica-bar', cartel: { texto: 'G', fondo: '#000000', letra: '#ffffff', fuente: 'sans', cursiva: false, posicion: 'frente' } })],
    }] };
    expect(() => check(ok(), frentes)).toThrow(/^x: planta de guernica-bar: el lugar ya tiene lote \(frente ea-sur, lote 2\)/);
  });

  test('un lugar con dos plantas', () => {
    expect(() => validatePlantas({ plantas: [ok(), ok()] }, 'x', NO_FRENTES)).toThrow(/^x: planta de guernica-bar: está dos veces/);
  });

  test('planta que se cruza: nombra las dos aristas', () => {
    const bowtie = { ...ok(), planta: [[0, 0], [10, 0], [0, 10], [10, 10]], patios: [], puertas: [puerta({ centro: 5 })], vidrios: [] };
    expect(() => check(bowtie)).toThrow(/^x: planta de guernica-bar: la planta se cruza: la arista 1 corta a la arista 3$/);
    const patio = { ...ok(), patios: [[[0, 0], [9.6, 0], [0, 4], [9.6, 4]]] };
    expect(() => check(patio)).toThrow(/^x: planta de guernica-bar: el patio 1 se cruza: la arista 1 corta a la arista 3$/);
  });

  test('marco: de frente o geográfico, y frente: aristas seguidas', () => {
    expect(() => check({ ...ok(), marco: { calle: 'Pellerano' } })).toThrow(/^x: planta de guernica-bar: marco: vereda tiene que ser uno de norte, sur, este, oeste/);
    expect(() => check({ ...ok(), marco: { lat: -34.797, lon: -58.39 } })).toThrow(/^x: planta de guernica-bar: marco: rumbo tiene que ser un número entre 0 y 360/);
    expect(() => check({ ...ok(), marco: { lat: -58.39, lon: -34.797, rumbo: 0 } })).toThrow(/^x: planta de guernica-bar: marco: lat tiene que ser un número entre/);
    expect(() => check({ ...ok(), marco: 'Pellerano' })).toThrow(/^x: planta de guernica-bar: marco tiene que ser \{ calle, vereda, desde, hasta, s \} o \{ lat, lon, rumbo \}/);
    expect(() => check({ ...ok(), frente: [0, 2] })).toThrow(/^x: planta de guernica-bar: frente tiene que ser aristas seguidas de la planta/);
    expect(() => check({ ...ok(), frente: [4] })).toThrow(/^x: planta de guernica-bar: frente tiene que ser aristas seguidas de la planta/);
  });

  test('puerta que no entra en su arista, con 0,2 m libres en cada punta', () => {
    expect(() => check({ ...ok(), puertas: [puerta({ centro: 0.9 })] })).toThrow(/^x: planta de guernica-bar, puerta 1: no entra en la arista 0: /);
    expect(() => check({ ...ok(), puertas: [puerta({ centro: 8.9 })] })).toThrow(/^x: planta de guernica-bar, puerta 1: no entra en la arista 0: /);
    // justo con 0,2 m de cada lado entra (y la del medio queda en la bahía de la punta: "inicio")
    expect(() => check({ ...ok(), puerta: 'inicio', puertas: [puerta({ centro: 1.0 })], vidrios: [] })).not.toThrow();
    expect(() => check({ ...ok(), puertas: [puerta({ arista: 4 })] })).toThrow(/^x: planta de guernica-bar, puerta 1: arista tiene que ser un entero entre 0 y 3/);
  });

  test('ninguna puerta con piso 0, y la principal es la primera', () => {
    expect(() => check({ ...ok(), puertas: [puerta({ piso: 1 })] })).toThrow(/^x: planta de guernica-bar: ninguna puerta tiene piso 0/);
    expect(() => check({ ...ok(), puertas: [] })).toThrow(/^x: planta de guernica-bar: ninguna puerta tiene piso 0/);
    expect(() => check({ ...ok(), puertas: [puerta({ arista: 2, piso: 1 }), puerta()] })).toThrow(/^x: planta de guernica-bar, puerta 1: la primera es la principal y tiene que tener piso 0/);
    expect(() => check({ ...ok(), puertas: [puerta(), puerta({ piso: 2 })] })).toThrow(/^x: planta de guernica-bar, puerta 2: piso tiene que ser un entero entre 0 y 1/);
  });

  test('puertas de al menos 1,0 m de ancho y 2,2 m de alto (D10)', () => {
    expect(() => check({ ...ok(), puertas: [puerta({ ancho: 0.9 })] })).toThrow(/^x: planta de guernica-bar, puerta 1: ancho tiene que ser un número entre 1 y /);
    expect(() => check({ ...ok(), puertas: [puerta({ alto: 2.1 })] })).toThrow(/^x: planta de guernica-bar, puerta 1: alto tiene que ser un número entre 2,2 y /);
    expect(() => check({ ...ok(), puertas: [puerta({ ancho: 1.0, alto: 2.2 })] })).not.toThrow();
  });

  test('vidrio que se pisa con una puerta del mismo piso y arista', () => {
    const vidrio = (o: object) => ({ arista: 0, desde: 4.0, hasta: 6.0, abajo: 0.3, arriba: 2.6, piso: 0, ...o });
    expect(() => check({ ...ok(), vidrios: [vidrio({})] })).toThrow(/^x: planta de guernica-bar, vidrio 1: se pisa con la puerta 1 \(misma arista y piso\)$/);
    expect(() => check({ ...ok(), vidrios: [vidrio({ piso: 1 })] })).not.toThrow();
    expect(() => check({ ...ok(), vidrios: [vidrio({ arista: 2 })] })).not.toThrow();
    expect(() => check({ ...ok(), vidrios: [vidrio({ abajo: 2.5, arriba: 3.0 })] })).not.toThrow(); // arriba de la puerta
    expect(() => check({ ...ok(), vidrios: [vidrio({ hasta: 10 })] })).toThrow(/^x: planta de guernica-bar, vidrio 1: no entra en la arista 0/);
    expect(() => check({ ...ok(), vidrios: [vidrio({ abajo: 2.6 })] })).toThrow(/^x: planta de guernica-bar, vidrio 1: arriba tiene que ser mayor que abajo/);
  });

  test('alto de al menos pisos · 3,2 + 0,6 (D9)', () => {
    expect(() => check({ ...ok(), alto: 6.5 })).toThrow(/^x: planta de guernica-bar: alto tiene que ser de al menos pisos · 3,2 \+ 0,6 = 7 m \(vino 6.5\)$/);
    expect(check({ ...ok(), alto: 7 })[0].lote.alto).toBe(7);
    expect(() => check({ ...ok(), pisos: 0 })).toThrow(/^x: planta de guernica-bar: pisos tiene que ser un entero entre 1 y 20/);
  });

  test('"puerta" (el dibujo) va en la bahía de 3 m donde cae la puerta principal', () => {
    // 9,6 m de frente: 3 bahías de 3,2 m; la puerta, a 4,8 m, cae en la del medio
    expect(() => check({ ...ok(), puerta: 'inicio' })).toThrow(/^x: planta de guernica-bar: puerta "inicio" pinta la puerta en la bahía 1 de 3, pero la puerta está en la bahía 2 de 3; usá "medio"$/);
    expect(() => check({ ...ok(), puerta: 'fin', puertas: [puerta({ centro: 8.6 })], vidrios: [] })).not.toThrow();
    // con 4 bahías, la tercera no es ni inicio ni medio ni fin
    const ancho = { ...ok(), planta: [[0, 4], [12, 4], [12, 21], [0, 21]], patios: [], puertas: [puerta({ centro: 7.5 })] };
    expect(() => check(ancho)).toThrow(/la puerta está en la bahía 3 de 4; ninguna de inicio, medio y fin cae ahí/);
    // sobre el frente al revés de como está escrita la planta, la bahía se cuenta desde la punta de u menor
    const alReves = { ...ok(), planta: [[9.6, 4], [0, 4], [0, 21], [9.6, 21]], patios: [], vidrios: [], puerta: 'inicio', puertas: [puerta({ centro: 8.6 })] };
    expect(() => check(alReves)).not.toThrow();
  });
});

describe('placePlantas', () => {
  const plantas = loadPlantas(NO_FRENTES, FIXTURE);
  const shapes = placePlantas(plantas, roads);
  const [frente, geo] = shapes;

  test('id, planta antihoraria, frente y claim', () => {
    expect(shapes.map((s) => s.id)).toEqual(['pl-guernica-bar', 'pl-mcdonalds']);
    for (const s of shapes) expect(signedAreaFromAbove(s.footprint!)).toBeGreaterThan(0);
    expect(frente.front).toHaveLength(2);
    expect(frente.claim).toHaveLength(3); // la planta, el patio y la franja de la calle
    expect(frente.patios).toHaveLength(1);
    expect(geo.claim).toHaveLength(1); // sin patios ni calle
  });

  test('marco de frente: [0, 0] sobre la línea a s y [0, 1] a 1 m hacia la manzana', () => {
    const m = plantas[0].marco as { calle: string; vereda: 'sur'; desde: string; hasta: string; s: number };
    const fr = resolveFrontage(roads, { id: 'x', ...m });
    const o = toWorld(frente.frame, [0, 0]);
    const at = pointAt(fr.line, cumulative(fr.line), m.s);
    expect(Math.hypot(o[0] - at[0], o[1] - at[1])).toBeLessThan(0.01);
    const one = toWorld(frente.frame, [0, 1]);
    expect(distToLine(one, fr.line)).toBeCloseTo(1, 3);
    expect(distToLine(one, streetChain(roads, m.calle))).toBeCloseTo(fr.setback + 1, 3);
    expect(Math.hypot(...frente.frame.u)).toBeCloseTo(1, 9);
    expect(frente.frame.u[0] * frente.frame.v[0] + frente.frame.u[1] * frente.frame.v[1]).toBeCloseTo(0, 9);
  });

  test('el área en el mundo es la local', () => {
    plantas.forEach((p, i) => expect(Math.abs(polygonArea(shapes[i].footprint!) - polygonArea(p.planta))).toBeLessThan(0.01));
    expect(Math.abs(polygonArea(frente.patios[0]) - polygonArea(plantas[0].patios[0]))).toBeLessThan(0.01);
  });

  test('marco geográfico con rumbo 90: U ≈ (1, 0) y V ≈ (0, 1)', () => {
    const m = plantas[1].marco as { lat: number; lon: number; rumbo: number };
    expect(geo.frame.u[0]).toBeCloseTo(1, 9); expect(geo.frame.u[1]).toBeCloseTo(0, 9);
    expect(geo.frame.v[0]).toBeCloseTo(0, 9); expect(geo.frame.v[1]).toBeCloseTo(1, 9);
    expect(geo.frame.origin).toEqual(project(m.lat, m.lon));
    // rumbo 0: U al norte (−z) y V al este, a la derecha de U
    const norte = placePlantas([{ ...plantas[1], marco: { ...m, rumbo: 0 } }], roads)[0].frame;
    expect(norte.u[0]).toBeCloseTo(0, 9); expect(norte.u[1]).toBeCloseTo(-1, 9);
    expect(norte.v[0]).toBeCloseTo(1, 9); expect(norte.v[1]).toBeCloseTo(0, 9);
  });

  test('marco que no cierra: s más largo que el frente o una calle que no está', () => {
    const m = plantas[0].marco as { s: number };
    expect(() => placePlantas([{ ...plantas[0], marco: { ...m, s: 500 } as PlantaInput['marco'] }], roads)).toThrow(/^planta de guernica-bar: marco: s es 500 m y el frente mide 169,0 m$/);
    expect(() => placePlantas([{ ...plantas[0], marco: { ...m, hasta: 'Inventada' } as PlantaInput['marco'] }], roads)).toThrow(/^planta de guernica-bar: marco: no hay ninguna calle "Inventada"|^planta de guernica-bar: marco: "Inventada" no cruza/);
  });
});

describe('assembleMap con plantas', () => {
  const osm = mini as unknown;
  const ms = JSON.parse(readFileSync('tests/fixtures/buildings-mini.geojson', 'utf8')) as GeoJSONFeatureCollection;
  const places = loadPlaces().filter((p) => SIN_LOTE.includes(p.id));
  const plantas = loadPlantas(NO_FRENTES, FIXTURE);
  const run = (ps: PlantaInput[], frentes?: FrentesInput) => assembleMap({ osm, buildings: ms, places, plantas: ps, ...(frentes ? { frentes } : {}) });
  /** Las plantas del fixture, con un cambio. */
  const with_ = (change: (ps: PlantaInput[]) => void): PlantaInput[] => {
    const ps = structuredClone(plantas);
    change(ps);
    return ps;
  };
  const geoAt = (x: number, z: number): PlantaInput['marco'] => ({ ...unproject([x, z]), rumbo: 90 });
  const area = (m: MapData, id: string): number => m.buildings.filter((b) => b.id === id || b.id.startsWith(`${id}-`)).reduce((a, b) => a + polygonArea(b.footprint), 0);

  const sin = run([]);
  const con = run(plantas);
  const byId = (m: MapData, id: string) => m.buildings.find((b) => b.id === id);

  test('el bloque de Microsoft de abajo pierde lo que tapa la planta (y el patio)', () => {
    const b0001 = byId(sin.map, 'b0001')!;
    const pl = byId(con.map, 'pl-guernica-bar')!;
    const tapado = lotOverlap(b0001.footprint, pl.footprint).area;
    expect(tapado).toBeGreaterThan(100);
    expect(area(sin.map, 'b0001') - area(con.map, 'b0001')).toBeCloseTo(tapado, 0);
    for (const b of con.map.buildings.filter((x) => x.id.startsWith('b0001'))) expect(lotOverlap(b.footprint, pl.footprint).area).toBeLessThan(0.01);
  });

  test('con "reemplaza", el bloque desaparece entero; sin "reemplaza", queda lo que no tapa', () => {
    expect(area(sin.map, 'b0002')).toBeGreaterThan(70);
    expect(con.map.buildings.filter((b) => b.id === 'b0002' || b.id.startsWith('b0002-'))).toEqual([]);
    const sinReemplazo = run(with_((ps) => { ps[1].reemplaza = []; })).map;
    const tapado = lotOverlap(byId(sin.map, 'b0002')!.footprint, byId(sinReemplazo, 'pl-mcdonalds')!.footprint).area;
    expect(tapado).toBeGreaterThan(15);
    expect(area(sinReemplazo, 'b0002')).toBeCloseTo(area(sin.map, 'b0002') - tapado, 0);
  });

  test('pl-<lugar>: pisos, alto y color del archivo, y aristas de frente', () => {
    const g = byId(con.map, 'pl-guernica-bar')!;
    expect([g.floors, g.height, g.tint]).toEqual([2, 7.5, '#3a3a3a']);
    expect(g.front!.edges).toHaveLength(1);
    expect(g.front).toMatchObject({ pb: 'vidriera', arriba: 'ventanas', puerta: 'medio' });
    const [a, b] = [g.footprint[g.front!.edges[0]], g.footprint[(g.front!.edges[0] + 1) % g.footprint.length]];
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(9.6, 1);
    expect(a[1]).toBeCloseTo(-39.81 + 4, 1); // el frente de la planta, detrás del patio
    const m = byId(con.map, 'pl-mcdonalds')!;
    expect([m.floors, m.height, m.tint]).toEqual([1, 3.8, '#b5121b']);
    expect(m.front!.edges).toHaveLength(1);
  });

  test('el lugar queda con ese edificio y el cartel del archivo', () => {
    const g = con.map.places.find((p) => p.id === 'guernica-bar')!;
    expect(g.buildingId).toBe('pl-guernica-bar');
    expect(g.sign).toMatchObject({ text: 'GUERNICA', look: { fondo: '#2b2b2b', letra: '#f2c14e' } });
    const m = con.map.places.find((p) => p.id === 'mcdonalds')!;
    expect(m.buildingId).toBe('pl-mcdonalds');
    expect(m.sign).toMatchObject({ text: "McDonald's", look: { fondo: '#b5121b', letra: '#ffc72c', fuente: 'redondeada' } });
    expect(con.map.signs).toEqual([]); // los dos carteles son de lugares
  });

  test('falta relevar: un aviso por cada lugar de SIN_LOTE sin planta; nada más de las plantas', () => {
    const avisos = (ws: string[]) => ws.filter((w) => /planta|andén/.test(w));
    expect(avisos(con.warnings)).toEqual(['cine-pixel', 'estacion-adrogue', 'la-veneciana'].map((l) => `${l}: falta relevar la planta (data/plantas.json)`));
    expect(avisos(sin.warnings)).toHaveLength(5);
  });

  test('aviso: la planta pisa la calle', () => {
    const w = run(with_((ps) => { (ps[0].marco as { s: number }).s = 165; })).warnings;
    expect(w.filter((x) => x.includes('pisa la calle'))).toEqual([expect.stringMatching(/^planta de guernica-bar: pisa la calle Macías \(\d+,\d m²\); corré el marco hacia adentro$/)]);
  });

  test('aviso: la planta se pisa con un lote o con otra planta', () => {
    const L = resolveFrontage(roads, { id: 'e-sur', calle: 'Avenida Espora', vereda: 'sur', desde: 'Somellera', hasta: 'Macías' }).length;
    const frentes: FrentesInput = { calzadas: {}, frentes: [{
      id: 'e-sur', calle: 'Avenida Espora', desde: 'Somellera', hasta: 'Macías', vereda: 'sur', fecha: '2026-11', osmAusentes: [], lotes: [lote(L)],
    }] };
    const conLote = run(plantas, frentes).warnings;
    expect(conLote.filter((x) => x.includes(' se pisa con '))).toEqual([expect.stringMatching(/^planta de guernica-bar se pisa con frente e-sur, lote 1 \(\d+,\d m²\)$/)]);
    const encima = run(with_((ps) => { ps[1].marco = geoAt(12, -30); })).warnings;
    expect(encima).toContain('planta de mcdonalds se pisa con planta de guernica-bar (48,0 m²)');
  });

  test('aviso: "reemplaza" que no es un edificio de Microsoft', () => {
    const w = run(with_((ps) => { ps[1].reemplaza = ['b0002', 'b9999']; })).warnings;
    expect(w).toContain('planta de mcdonalds: "reemplaza" nombra b9999, que no es un edificio de Microsoft');
  });

  test('aviso: una puerta que da a otro edificio', () => {
    const w = run(with_((ps) => {
      ps[1].reemplaza = [];
      ps[1].puertas.push({ arista: 2, centro: 5, ancho: 1.2, alto: 2.2, piso: 0 }); // atrás, contra lo que queda de b0002
    })).warnings;
    expect(w.filter((x) => x.includes(' da a '))).toEqual(['planta de mcdonalds: la puerta 2 da a b0002']);
  });

  test('aviso: un edificio que pisa un andén', () => {
    const w = run(with_((ps) => { ps[1].marco = geoAt(-100, 192); })).warnings;
    expect(w.filter((x) => x.includes('andén'))).toEqual(['pl-mcdonalds: pisa un andén (32,0 m²)']);
  });
});
