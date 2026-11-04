import { readFileSync } from 'node:fs';
import mini from '../fixtures/osm-mini.json';
import { assembleMap } from '../../src/mapgen/assemble.ts';
import type { GeoJSONFeatureCollection } from '../../src/mapgen/buildings.ts';
import { cumulative, pointAt, resolveFrontage, streetChain } from '../../src/mapgen/frontage.ts';
import { applyFrentes } from '../../src/mapgen/frentes.ts';
import { loadFrentes } from '../../src/mapgen/frentes-input.ts';
import type { FrentesInput, LoteInput } from '../../src/mapgen/frentes-input.ts';
import { lotOverlap } from '../../src/mapgen/lots.ts';
import { parseOsm } from '../../src/mapgen/osm.ts';
import type { PhotoEdge } from '../../src/mapgen/place-facades.ts';
import { ENTERABLE_IDS, loadPlaces } from '../../src/mapgen/places-input.ts';
import { SIN_LOTE, loadPlantas, validatePlantas } from '../../src/mapgen/plantas-input.ts';
import type { PlantaInput } from '../../src/mapgen/plantas-input.ts';
import { placePlantas } from '../../src/mapgen/plantas.ts';
import { isFreeSpot } from '../../src/mapgen/spawns.ts';
import { buildCollisionWorld } from '../../src/shared/collision.ts';
import { distPointSegment, pointInPolygon, polygonArea, project, signedAreaFromAbove, toWorld, unproject } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import { doorsOf } from '../../src/shared/interiors/openings.ts';
import type { Building, MapData } from '../../src/shared/mapdata.ts';

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
    expect(check(min)[0]).toMatchObject({ patios: [], despejes: [], vidrios: [], reemplaza: [] });
  });

  test('despejes: anillos como los patios, validados igual', () => {
    const despeje: Vec2[] = [[0, -3], [9.6, -3], [9.6, 0], [0, 0]];
    expect(check({ ...ok(), despejes: [despeje] })[0].despejes).toEqual([despeje]);
    expect(() => check({ ...ok(), despejes: [[[0, 0], [9.6, 0]]] })).toThrow(/^x: planta de guernica-bar: el despeje 1 tiene que ser una lista de 3 o más puntos \[u, v\]$/);
    expect(() => check({ ...ok(), despejes: [despeje, [[0, 0], [9.6, 0], [0, 4], [9.6, 4]]] })).toThrow(/^x: planta de guernica-bar: el despeje 2 se cruza: la arista 1 corta a la arista 3$/);
    expect(() => check({ ...ok(), despejes: [[[0, 0], [0.5, 0], [0.5, 0.5]]] })).toThrow(/^x: planta de guernica-bar: el despeje 1 tiene menos de 1 m²$/);
    expect(() => check({ ...ok(), despejes: 'vereda' })).toThrow(/^x: planta de guernica-bar: despejes tiene que ser una lista$/);
    // con otro nombre sigue siendo un campo desconocido
    expect(() => check({ ...ok(), despeje: [despeje] })).toThrow(/^x: planta de guernica-bar: campo desconocido "despeje" \(van lugar, fecha, marco, planta, patios, despejes, /);
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
    // la planta, el patio y la franja de la calle, fusionados en una sola pieza: 9,6 m de ancho, del eje al fondo
    const { setback } = resolveFrontage(roads, { id: 'x', ...(plantas[0].marco as { calle: string; vereda: 'sur'; desde: string; hasta: string }) });
    expect(frente.claim).toHaveLength(1);
    expect(polygonArea(frente.claim[0])).toBeCloseTo(9.6 * (setback + 21), 6);
    expect(frente.patios).toHaveLength(1);
    expect(geo.claim).toEqual([geo.footprint]); // sin patios ni calle
  });

  test('claim: la unión sin redondear de la planta, los patios y los despejes, en anillos antihorarios', () => {
    // girada 33°, con un patio sobre un pedazo de la arista de atrás y un despeje pegado al frente: una sola pieza
    const m = plantas[1].marco as { lat: number; lon: number; rumbo: number };
    const girada: PlantaInput = {
      ...plantas[1], marco: { ...m, rumbo: 33 },
      patios: [[[2, 6], [6, 6], [6, 9], [2, 9]]], despejes: [[[0, -2], [8, -2], [8, 0], [0, 0]]],
    };
    const [s] = placePlantas([girada], roads);
    expect(s.claim).toHaveLength(1);
    expect(polygonArea(s.claim[0])).toBeCloseTo(8 * 6 + 4 * 3 + 8 * 2, 6);
    expect(signedAreaFromAbove(s.claim[0])).toBeGreaterThan(0);
    expect(s.patios).toHaveLength(1);
    // un despeje suelto queda como otra pieza
    const [suelto] = placePlantas([{ ...girada, despejes: [[[20, 0], [24, 0], [24, 4], [20, 4]]] }], roads);
    expect(suelto.claim).toHaveLength(2);
    for (const r of suelto.claim) expect(signedAreaFromAbove(r)).toBeGreaterThan(0);
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

describe('applyFrentes: recorte de una planta girada', () => {
  const plantas = loadPlantas(NO_FRENTES, FIXTURE);
  test('una planta girada 33° adentro de un bloque grande, con un patio pegado a una arista: el patio queda sin Microsoft', () => {
    const bloque: Building = { id: 'b0001', footprint: [[-40, -40], [40, -40], [40, 40], [-40, 40]], height: 6.6, floors: 2, kind: 'shop', wall: 'plaster', tint: '#aaaaaa' };
    // el patio, sobre un pedazo de la arista de atrás de la planta de 8 × 6 m
    const patio: Vec2[] = [[2, 6], [6, 6], [6, 9], [2, 9]];
    const girada: PlantaInput = { ...plantas[1], marco: { ...unproject([-3, -4]), rumbo: 33 }, patios: [patio], reemplaza: [] };
    const shapes = placePlantas([girada], []);
    const res = applyFrentes(NO_FRENTES, [], [bloque], [], [], shapes);
    const microsoft = res.buildings.filter((b) => !b.id.startsWith('pl-'));
    expect(microsoft.length).toBeGreaterThan(0);
    // el centro y un punto a 0,3 m de cada esquina hacia adentro, del patio y de la planta
    const probes: Vec2[] = [[4, 7.5], [2.3, 6.3], [5.7, 6.3], [5.7, 8.7], [2.3, 8.7], [4, 3], [0.3, 0.3], [7.7, 0.3], [7.7, 5.7], [0.3, 5.7]];
    for (const q of probes) {
      const w = toWorld(shapes[0].frame, q);
      expect(microsoft.filter((b) => pointInPolygon(w, b.footprint)).map((b) => b.id), `[${q}]`).toEqual([]);
    }
    // lo que no tapa queda: el bloque menos la planta y el patio
    expect(microsoft.reduce((a, b) => a + polygonArea(b.footprint), 0)).toBeCloseTo(80 * 80 - 8 * 6 - 4 * 3, 1);
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

  test('una planta que arranca a 0,5 m de la línea y sin patio: el recorte llega hasta la fachada', () => {
    const ps = with_((p) => { p[0].planta = [[0, 0.5], [9.6, 0.5], [9.6, 17.5], [0, 17.5]]; p[0].patios = []; });
    const [shape] = placePlantas(ps, roads);
    // b0001 estirado al norte hasta 0,5 m sobre la vereda (v = −0,5), como un bloque fusionado de Microsoft
    const vereda = unproject(toWorld(shape.frame, [0, -0.5])).lat;
    const estirado = structuredClone(ms);
    const f = estirado.features.find((x) => x.properties?.name === 'grande-esteban')!;
    const norte = Math.max(...f.geometry.coordinates[0].map((c) => c[1]));
    f.geometry.coordinates[0] = f.geometry.coordinates[0].map(([lon, lat]) => [lon, lat === norte ? vereda : lat]);
    const conBloque = (pl: PlantaInput[]) => assembleMap({ osm, buildings: estirado, places, plantas: pl });
    // la franja entre la línea de edificación y la fachada, a lo ancho de la planta
    const franja = ([[0, 0], [9.6, 0], [9.6, 0.5], [0, 0.5]] as Vec2[]).map((q) => toWorld(shape.frame, q));
    const enFranja = (m: MapData) => m.buildings.filter((b) => b.id.startsWith('b0001')).reduce((a, b) => a + lotOverlap(b.footprint, franja).area, 0);
    expect(enFranja(conBloque([]).map)).toBeGreaterThan(4); // sin la planta, el bloque la tapa (9,6 × 0,5 m)
    const res = conBloque(ps);
    expect(enFranja(res.map)).toBeLessThan(0.01);
    expect(res.warnings.filter((w) => w.includes(' da a '))).toEqual([]);
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

  test('la planta de un lugar de tipo station sale con kind station; las otras, con la del lote', () => {
    expect(byId(con.map, 'pl-mcdonalds')!.kind).toBe('shop');
    const estacion = run(with_((ps) => { ps[1].lugar = 'estacion-adrogue'; ps[1].lote.lugar = 'estacion-adrogue'; })).map;
    expect(estacion.places.find((p) => p.id === 'estacion-adrogue')!.buildingId).toBe('pl-estacion-adrogue');
    expect(byId(estacion, 'pl-estacion-adrogue')!.kind).toBe('station');
    expect(byId(estacion, 'pl-guernica-bar')!.kind).toBe('shop');
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

  test('un despeje recorta el bloque de Microsoft y no es un patio del interior', () => {
    // al oeste de la planta del McDonald's (U = +x, V = +z): la mitad oeste de b0002, que la planta no tapa
    const despeje: Vec2[] = [[-5, 2], [0, 2], [0, 10], [-5, 10]];
    const sinReemplazo = run(with_((ps) => { ps[1].reemplaza = []; })).map;
    const conDespeje = run(with_((ps) => { ps[1].reemplaza = []; ps[1].despejes = [despeje]; })).map;
    const [shape] = placePlantas([{ ...plantas[1], despejes: [despeje] }], roads);
    const tapado = lotOverlap(byId(sin.map, 'b0002')!.footprint, despeje.map((q) => toWorld(shape.frame, q))).area;
    expect(tapado).toBeCloseTo(40, 1);
    expect(area(conDespeje, 'b0002')).toBeCloseTo(area(sinReemplazo, 'b0002') - tapado, 0);
    // no entra a los patios: ni a los de la planta ni a los del interior
    expect(shape.patios).toEqual([]);
    expect(conDespeje.interiors.find((i) => i.placeId === 'mcdonalds')!.patios).toEqual([]);
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

describe('las plantas del mapa real', () => {
  const frentes = loadFrentes();
  const plantas = loadPlantas(frentes);
  const { map } = assembleMap({
    osm: JSON.parse(readFileSync('data/raw/osm.json', 'utf8')) as unknown,
    buildings: JSON.parse(readFileSync('data/raw/ms-buildings.geojson', 'utf8')) as GeoJSONFeatureCollection,
    places: loadPlaces(),
    photos: JSON.parse(readFileSync('data/photo-facades.json', 'utf8')) as PhotoEdge[],
    frentes,
    plantas,
  });
  const byId = new Map(map.buildings.map((b) => [b.id, b]));

  test('un interior por cada lugar entrable; los de las plantas, con sus patios y sin los despejes', () => {
    expect(map.interiors.map((i) => i.placeId).sort()).toEqual([...ENTERABLE_IDS].sort());
    expect(plantas.map((p) => p.lugar).sort()).toEqual([...SIN_LOTE].sort());
    for (const p of plantas) {
      const i = map.interiors.find((x) => x.placeId === p.lugar)!;
      expect(i.buildingId).toBe(`pl-${p.lugar}`);
      expect(i.patios, p.lugar).toHaveLength(p.patios.length);
    }
    expect(plantas.filter((p) => p.despejes.length > 0).map((p) => p.lugar).sort()).toEqual(['cine-pixel', 'guernica-bar', 'mcdonalds']);
  });

  test('Guernica: 2 pisos y 7,0 m; La Veneciana: 1 piso', () => {
    const g = byId.get('pl-guernica-bar')!;
    expect([g.floors, g.height]).toEqual([2, 7.0]);
    expect(byId.get('pl-la-veneciana')!.floors).toBe(1);
  });

  test('ningún edificio pisa un andén más de 1 m² (D8)', () => {
    for (const b of map.buildings) expect(map.platforms.reduce((a, p) => a + lotOverlap(b.footprint, p).area, 0), b.id).toBeLessThanOrEqual(1);
  });

  test('1 m afuera de cada puerta de la planta baja el punto está libre', () => {
    const world = buildCollisionWorld(map);
    const altas: string[] = [];
    for (const i of map.interiors) {
      for (const d of doorsOf(byId.get(i.buildingId)!, i)) {
        // una puerta de un piso alto da a un balcón que arma el interior (el del Guernica, Tarea 9): mapgen no tiene la
        // losa del balcón y ahí afuera no hay piso; no se mira
        if (d.level >= 1) { altas.push(i.placeId); continue; }
        expect(isFreeSpot(world, d.at[0] + d.normal[0], d.at[1] + d.normal[1]), `${i.placeId}: [${d.at}]`).toBe(true);
      }
    }
    expect(altas).toEqual(['guernica-bar']);
  });
});
