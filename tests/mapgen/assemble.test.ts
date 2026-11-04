import { readFileSync } from 'node:fs';
import polygonClipping from 'polygon-clipping';
import { assembleMap } from '../../src/mapgen/assemble.ts';
import { filterTrees } from '../../src/mapgen/trees.ts';
import { SPAWN_RELAXED, findFreeSpot, isFatalWarning, randomSpawns, seesSign } from '../../src/mapgen/spawns.ts';
import { loadPlaces } from '../../src/mapgen/places-input.ts';
import { loadFrentes } from '../../src/mapgen/frentes-input.ts';
import { parkFractionOf } from '../../src/mapgen/buildings.ts';
import { roofClusters } from '../../src/mapgen/climb.ts';
import { lotOverlap } from '../../src/mapgen/lots.ts';
import { analyzeGround, solidOutlines } from '../../src/mapgen/pockets.ts';
import { FACADE_BY_TYPE } from '../../src/mapgen/place-facades.ts';
import { outwardNormal } from '../../src/mapgen/places.ts';
import { polygonDist } from '../../src/mapgen/spatial.ts';
import { climbOut, regionAt } from './pocket-exit.ts';
import { buildCollisionWorld } from '../../src/shared/collision.ts';
import { AWNING } from '../../src/client/world/fronts.ts';
import { distPointSegment, pointInPolygon, polygonArea } from '../../src/shared/geo.ts';
import type { Vec2 } from '../../src/shared/geo.ts';
import type { Building, MapData, Prop, Sign, Tree } from '../../src/shared/mapdata.ts';

const photos = JSON.parse(readFileSync('data/photo-facades.json', 'utf8')) as { placeId: string; edgeIndex?: number }[];
const MIN_OTHER_SETT = 43;
function loadRaw() {
  return {
    osm: JSON.parse(readFileSync('data/raw/osm.json', 'utf8')) as unknown,
    buildings: JSON.parse(readFileSync('data/raw/ms-buildings.geojson', 'utf8')),
    places: loadPlaces(),
    photos,
    frentes: loadFrentes(),
  };
}

function roadPointsInsideBuildings(map: MapData): string[] {
  const bad: string[] = [];
  for (const r of map.roads) {
    if (['footway', 'pedestrian', 'service'].includes(r.kind)) continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i], b = r.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let k = 0; k <= n; k++) {
        const p: Vec2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const bd = map.buildings.find((q) => pointInPolygon(p, q.footprint));
        if (bd) bad.push(`${r.id}@${p[0].toFixed(1)},${p[1].toFixed(1)} en ${bd.id}`);
      }
    }
  }
  return bad;
}

function hasAccess(clusterIds: string[], props: Prop[], m: MapData = map): boolean {
  const ids = new Set(clusterIds);
  return props.some((p) => p.kind === 'ladder' && ids.has(p.buildingId)) || props.some((p) => {
    if (p.kind !== 'dumpster') return false;
    return m.buildings.some((b) => ids.has(b.id) && b.footprint.some((v, i) =>
      distPointSegment(p.position, v, b.footprint[(i + 1) % b.footprint.length]) <= 1.5));
  });
}

/** Cluster de techos de cada edificio, y los clusters con una ayuda a la que se llega desde la componente principal del suelo. */
function mainClusters(m: MapData, g: ReturnType<typeof analyzeGround>) {
  const clusterOf = new Map<string, number>();
  roofClusters(m.buildings).forEach((c, i) => c.forEach((id) => clusterOf.set(id, i)));
  const fromMain = new Set<number>();
  for (const p of m.props) {
    if (p.kind === 'ladder') {
      const n = Math.hypot(p.normal[0], p.normal[1]);
      if (regionAt(g, p.base[0] + (p.normal[0] / n) * 0.45, p.base[1] + (p.normal[1] / n) * 0.45) === 0) fromMain.add(clusterOf.get(p.buildingId)!);
    } else if (p.kind === 'dumpster') {
      const perp: Vec2 = [Math.sin(p.rotation), Math.cos(p.rotation)];
      if (![1, -1].some((s) => regionAt(g, p.position[0] + perp[0] * s * 0.95, p.position[1] + perp[1] * s * 0.95) === 0)) continue;
      for (const b of m.buildings) {
        if (b.height > 3.85 || !b.footprint.some((v, i) => distPointSegment(p.position, v, b.footprint[(i + 1) % b.footprint.length]) <= 1)) continue;
        fromMain.add(clusterOf.get(b.id)!);
      }
    }
  }
  return { clusterOf, fromMain };
}

/** Corrida principal de un lote, de `desde` a `hasta`, como la arma el cliente (aristas de `front.edges`, al revés con `contra`). */
function mainRun(b: Building): { a: Vec2; c: Vec2; len: number; s0: number }[] {
  const fp = b.footprint;
  let s0 = 0;
  return b.front!.edges.map((e) => {
    const [a, c] = b.front!.contra ? [fp[(e + 1) % fp.length], fp[e]] : [fp[e], fp[(e + 1) % fp.length]];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    s0 += len;
    return { a, c, len, s0: s0 - len };
  });
}
/** Dónde cae `p` sobre la corrida: `s` sin acotar en las puntas (pasado el final sigue la última arista) y `d`, la
 *  distancia a la pared. */
function alongRun(run: ReturnType<typeof mainRun>, p: Vec2): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  run.forEach((g, k) => {
    const [dx, dz] = [(g.c[0] - g.a[0]) / g.len, (g.c[1] - g.a[1]) / g.len];
    let t = (p[0] - g.a[0]) * dx + (p[1] - g.a[1]) * dz;
    if (k > 0) t = Math.max(t, 0);
    if (k < run.length - 1) t = Math.min(t, g.len);
    const tc = Math.min(Math.max(t, 0), g.len);
    const d = Math.hypot(p[0] - (g.a[0] + dx * tc), p[1] - (g.a[1] + dz * tc));
    if (d < best.d) best = { s: g.s0 + t, d };
  });
  return best;
}
/** Las escaleras y los contenedores, con su medio ancho a lo largo de la pared. */
const climbAids = (m: MapData): { pos: Vec2; half: number; what: string }[] => m.props.flatMap((p) =>
  p.kind === 'ladder' ? [{ pos: p.base, half: 0.4, what: `escalera de ${p.buildingId}` }]
    : p.kind === 'dumpster' ? [{ pos: p.position, half: 0.9, what: `contenedor en ${p.position.join(', ')}` }] : []);
/** Ayudas de ascenso que caen en el tramo de un cartel o de un toldo de un lote, con `tol` m de tolerancia. */
function aidsOnLotFronts(m: MapData, tol: number): string[] {
  const lots = m.buildings.filter((b) => b.front);
  const ids = new Set(lots.map((b) => b.id));
  const signs: Sign[] = [...m.signs, ...m.places.filter((p) => p.sign && p.buildingId && ids.has(p.buildingId)).map((p) => p.sign!)];
  const bad: string[] = [];
  for (const aid of climbAids(m)) {
    for (const s of signs) {
      const rel: Vec2 = [aid.pos[0] - s.anchor[0], aid.pos[1] - s.anchor[1]];
      const dn = rel[0] * s.normal[0] + rel[1] * s.normal[1]; // en una bandera, la normal va a lo largo de la pared
      const dt = -rel[0] * s.normal[1] + rel[1] * s.normal[0];
      const hit = s.blade ? Math.abs(dn) < aid.half + 0.06 - tol && Math.abs(dt) < s.width / 2 + 1.5
        : Math.abs(dt) < s.width / 2 + aid.half - tol && Math.abs(dn) < 1.5;
      if (hit) bad.push(`${aid.what}: en el cartel ${s.text}`);
    }
    for (const b of lots) {
      if (!b.front!.toldo) continue;
      const run = mainRun(b);
      const L = run.reduce((t, g) => t + g.len, 0);
      const [lo, hi] = [b.front!.ayuda?.inicio ?? AWNING.inset, L - (b.front!.ayuda?.fin ?? AWNING.inset)];
      const { s, d } = alongRun(run, aid.pos);
      if (d < 1.5 && s + aid.half > lo + tol && s - aid.half < hi - tol) bad.push(`${aid.what}: en el toldo de ${b.id}`);
    }
  }
  return bad;
}

const { map, warnings, stats } = assembleMap(loadRaw());
const world = buildCollisionWorld(map);

describe('assembleMap sobre datos reales', () => {
  test('sin warnings salvo relajaciones del punto de aparición', () => expect(warnings.filter(isFatalWarning)).toEqual([]));
  test('cantidades razonables', () => {
    // los que cruzan el borde del área también son edificios (≈ 56 más); los rellenos de huecos y los lotes relevados
    // (`front`) no cuentan: crecen con cada frente que se carga
    const real = map.buildings.filter((b) => !b.fill && !b.front);
    expect(real.length).toBeGreaterThan(1000); expect(real.length).toBeLessThan(1350);
    expect(map.places).toHaveLength(38); expect(map.parks.length).toBeGreaterThanOrEqual(12);
    expect(map.trees.length).toBeGreaterThan(1000);
    expect(map.randomSpawns).toHaveLength(64);
  });
  test('todo lugar no-plaza/no-monumento tiene edificio y cartel', () => map.places.filter((p) => !['plaza', 'monument'].includes(p.type))
    .forEach((p) => { expect(p.buildingId, p.id).toBeDefined(); expect(p.sign, p.id).toBeDefined(); }));
  test('todos los spawns libres y dentro del área', () => [...map.places.map((p) => p.spawn), ...map.randomSpawns].forEach((s) => {
    expect(world.overlaps(s[0], s[2], 0.35, s[1] + 0.05, s[1] + 1.8)).toBe(false);
    expect(s[0]).toBeGreaterThan(map.bounds.minX); expect(s[0]).toBeLessThan(map.bounds.maxX);
    expect(s[2]).toBeGreaterThan(map.bounds.minZ); expect(s[2]).toBeLessThan(map.bounds.maxZ);
  }));
  test('cada spawn de lugar tiene 2,5 m libres, o figura en warnings', () => map.places.forEach((p) => {
    const s = p.spawn;
    if (!world.overlaps(s[0], s[2], 0.35 + 2.5, 0.05, 1.8)) return;
    expect(warnings.some((w) => w.startsWith(`${SPAWN_RELAXED} ${p.id}:`)), p.id).toBe(true);
  }));
  test('cada lugar con cartel ve el cartel desde su spawn, o figura en warnings', () => map.places.forEach((p) => {
    if (!p.sign || seesSign(world, p.sign, p.spawn)) return;
    expect(warnings.some((w) => w.startsWith(`${SPAWN_RELAXED} ${p.id}:`)), p.id).toBe(true);
  }));
  test('solo las relajaciones del spawn son avisos no fatales', () => {
    expect(isFatalWarning(`${SPAWN_RELAXED} x: punto de aparición con solo 1 m libre`)).toBe(false);
    expect(isFatalWarning('x: no se pudo ubicar el punto de aparición')).toBe(true);
    expect(isFatalWarning('x: sin punto libre cerca de 1, 2')).toBe(true);
  });
  test('ninguna escalera ni contenedor cae en el tramo de un cartel o de un toldo de un lote (5 cm de tolerancia)', () => {
    expect(aidsOnLotFronts(map, 0.05)).toEqual([]);
  });
  test('los carteles de los lotes quedan a 8 ± 5 cm de su pared de punta a punta (más 1 cm de redondeo) y nunca adentro', () => {
    const lots = map.buildings.filter((b) => b.front);
    const ids = new Set(lots.map((b) => b.id));
    const signs = [...map.signs, ...map.places.filter((p) => p.sign && p.buildingId && ids.has(p.buildingId)).map((p) => p.sign!)].filter((s) => !s.blade);
    expect(signs.length).toBeGreaterThan(70);
    for (const s of signs) {
      const lot = lots.find((b) => mainRun(b).some((g) => distPointSegment(s.anchor, g.a, g.c) < 0.25));
      expect(lot, s.text).toBeDefined();
      const run = mainRun(lot!);
      for (let k = 0; k <= 20; k++) {
        const u = -s.width / 2 + (s.width * k) / 20;
        const p: Vec2 = [s.anchor[0] - s.normal[1] * u, s.anchor[1] + s.normal[0] * u];
        expect(Math.abs(Math.min(...run.map((g) => distPointSegment(p, g.a, g.c))) - 0.08), `${s.text} @ ${k}/20`).toBeLessThanOrEqual(0.06);
        expect(pointInPolygon(p, lot!.footprint), `${s.text} @ ${k}/20`).toBe(false);
      }
    }
  });
  test('los lotes tienen aristas de frente y no se pisan con ningún edificio (≤ 0,1 m²: redondeo y empalmes en T)', () => {
    const lots = map.buildings.filter((b) => b.front);
    expect(lots.length).toBeGreaterThan(100);
    for (const l of lots) {
      expect(l.front!.edges.length, l.id).toBeGreaterThan(0);
      // lotOverlap descarta por caja: intersecar contra los 1400 edificios hace crecer el árbol global de polygon-clipping
      // y vuelve lentos los tests que siguen
      for (const o of map.buildings) if (o !== l) expect(lotOverlap(l.footprint, o.footprint).area, `${l.id} x ${o.id}`).toBeLessThanOrEqual(0.1);
    }
  });
  test('ninguna ayuda de ascenso queda a menos de 1 m del borde', () => map.props.forEach((pr) => {
    const q = pr.kind === 'ladder' ? pr.base : pr.kind === 'dumpster' ? pr.position : null;
    if (!q) return;
    expect(q[0]).toBeGreaterThanOrEqual(map.bounds.minX + 1); expect(q[0]).toBeLessThanOrEqual(map.bounds.maxX - 1);
    expect(q[1]).toBeGreaterThanOrEqual(map.bounds.minZ + 1); expect(q[1]).toBeLessThanOrEqual(map.bounds.maxZ - 1);
  }));
  test('ningún edificio tiene ≥ 50 % de su área dentro de un parque', () => {
    const frac = parkFractionOf(map.parks);
    for (const b of map.buildings) expect(frac(b.footprint), b.id).toBeLessThan(0.5);
  });
  test('ninguna calle vehicular pasa por adentro de un edificio', () => expect(roadPointsInsideBuildings(map)).toEqual([]));
  test('todo cluster de techos tiene acceso, salvo los del borde (noAidOutside)', () => {
    const b = map.bounds;
    // una arista cuyo punto medio queda a más de 2,5 m adentro del borde siempre deja lugar para un contenedor o una escalera
    const deep = ([x, z]: Vec2): boolean => x > b.minX + 2.5 && x < b.maxX - 2.5 && z > b.minZ + 2.5 && z < b.maxZ - 2.5;
    const byId = new Map(map.buildings.map((bd) => [bd.id, bd]));
    const without = roofClusters(map.buildings).filter((c) => !hasAccess(c, map.props));
    for (const c of without) {
      const mids = c.flatMap((id) => byId.get(id)!.footprint.map((p, i, fp): Vec2 => [(p[0] + fp[(i + 1) % fp.length][0]) / 2, (p[1] + fp[(i + 1) % fp.length][1]) / 2]));
      expect(mids.some(deep), c[0]).toBe(false);
    }
    expect(without).toHaveLength(stats.noAidOutside);
  });
  test('ningún footprint de las afueras entra al área (los que la tocan son edificios)', () => {
    const b = map.bounds;
    const rect: [number, number][][] = [[[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ], [b.minX, b.minZ]]];
    const ringArea = (r: [number, number][]): number => Math.abs(r.reduce((s, p, i) => (i + 1 < r.length ? s + p[0] * r[i + 1][1] - r[i + 1][0] * p[1] : s), 0)) / 2;
    const inside = map.outskirts.map((o) => {
      const poly: [number, number][][] = [[...o.footprint, o.footprint[0]].map(([x, z]): [number, number] => [x, z])];
      return polygonClipping.intersection(poly, rect).reduce((s, piece) => s + ringArea(piece[0]), 0);
    });
    expect(inside.filter((a) => a > 1e-6)).toEqual([]);
    // y los edificios que cruzan el borde existen (antes eran siluetas sin colisión)
    expect(map.buildings.some((bd) => bd.footprint.some(([x, z]) => x > b.maxX || x < b.minX || z > b.maxZ || z < b.minZ))).toBe(true);
  });
  test('cada lugar con cartel y sin foto tiene la fachada de su tipo en la arista del cartel (salvo en un lote relevado)', () => {
    const inputs = loadPlaces();
    const byId = new Map(map.buildings.map((b) => [b.id, b]));
    // un lote relevado dibuja su propio frente: el lugar enlazado no lleva fachada procedural
    const onLot = map.places.filter((p) => p.buildingId && byId.get(p.buildingId)!.front);
    for (const p of onLot) expect(byId.get(p.buildingId!)!.facades, p.id).toBeUndefined();
    const signed = map.places.filter((p) => p.sign && !photos.some((f) => f.placeId === p.id) && !onLot.includes(p));
    expect(signed.length).toBeGreaterThanOrEqual(15);
    const firstOnEdge = new Map<string, string>();
    for (const p of map.places.filter((q) => q.sign && !onLot.includes(q))) {
      const b = byId.get(p.buildingId!)!;
      const fp = b.footprint;
      // arista del cartel: pasa a ≤ 10 cm del ancla y mira para el mismo lado
      const edge = fp.findIndex((a, i) => {
        const c = fp[(i + 1) % fp.length];
        const n = outwardNormal(a, c);
        return distPointSegment(p.sign!.anchor, a, c) < 0.1 && n[0] * p.sign!.normal[0] + n[1] * p.sign!.normal[1] > 0.99;
      });
      expect(edge, p.id).toBeGreaterThanOrEqual(0);
      const key = `${b.id}#${edge}`;
      if (!firstOnEdge.has(key)) firstOnEdge.set(key, p.id);
      if (!signed.includes(p)) continue;
      const f = b.facades?.find((x) => x.edge === edge);
      expect(f, p.id).toBeDefined();
      const owner = inputs.find((x) => x.id === firstOnEdge.get(key))!;
      expect(f!.ground, p.id).toBe(owner.facade?.ground ?? FACADE_BY_TYPE[owner.type as keyof typeof FACADE_BY_TYPE].ground);
      expect(f!.tint, p.id).toBe(owner.facade?.tint ?? FACADE_BY_TYPE[owner.type as keyof typeof FACADE_BY_TYPE].tint);
    }
  });
  test('las fotos con edgeIndex tienen la fachada en esa arista', () => {
    for (const ph of photos.filter((f) => f.edgeIndex !== undefined)) {
      const b = map.buildings.find((x) => x.id === map.places.find((p) => p.id === ph.placeId)!.buildingId)!;
      expect(b.facades?.some((f) => f.edge === ph.edgeIndex), ph.placeId).toBe(true);
    }
  });
  test('Estación y Plaza Brown presentes', () => {
    expect(map.buildings.some((b) => b.kind === 'station')).toBe(true);
    expect(map.places.find((p) => p.id === 'plaza-almirante-brown')!.parkId).toBeDefined();
  });
  test('redondeo: sin vértices consecutivos repetidos y a 2 decimales', () => {
    for (const b of map.buildings) {
      b.footprint.forEach((p, i) => {
        const q = b.footprint[(i + 1) % b.footprint.length];
        expect(p[0] === q[0] && p[1] === q[1], b.id).toBe(false);
        expect(Math.round(p[0] * 100) / 100).toBe(p[0]);
      });
    }
  });
});

describe('huecos de suelo (flood fill sobre el mapa final)', () => {
  const g = analyzeGround(world, solidOutlines(map));
  const { clusterOf, fromMain } = mainClusters(map, g);
  test('ningún hueco queda sin salida: desde cada uno se sube por una escalera a un techo accesible', () => {
    const stuck = g.pockets.filter((p) => {
      const l = climbOut(world, map, p);
      return !l || !fromMain.has(clusterOf.get(l.buildingId)!);
    }).map((p) => `${p.points[0].map((v) => v.toFixed(1)).join(', ')} (${p.area.toFixed(2)} m²)`);
    expect(stuck).toEqual([]);
  });
  test('al techo de cada lote relevado se llega desde la calle', () => {
    const lots = map.buildings.filter((b) => b.front);
    expect(lots.filter((b) => !fromMain.has(clusterOf.get(b.id)!)).map((b) => b.id)).toEqual([]);
  });
  test('los spawns caen en la componente principal del suelo', () => {
    for (const s of [...map.places.map((p) => p.spawn), ...map.randomSpawns]) expect(g.regionOf(s[0], s[2]), s.join(',')).toBe(0);
  });
  test('los rellenos tienen techo al ras (−1 cm) de un vecino y no pisan a ningún edificio', () => {
    const fills = map.buildings.filter((b) => b.fill);
    const real = map.buildings.filter((b) => !b.fill);
    for (const f of fills) {
      const touching = real.filter((b) => polygonDist(f.footprint, b.footprint) < 0.02);
      expect(touching.length, f.id).toBeGreaterThan(0);
      expect(Math.min(...touching.map((b) => b.height)) - f.height, f.id).toBeCloseTo(0.01, 6);
    }
  });
});

describe('assembleMap con el frente de prueba', () => {
  const raw = { ...loadRaw(), frentes: loadFrentes('tests/fixtures/frentes-prueba.json') };
  const res = assembleMap(raw);
  const m = res.map;
  const fw = buildCollisionWorld(m);
  const lots = m.buildings.filter((b) => b.id.startsWith('ea-prueba-'));
  const withSign = raw.frentes.frentes.flatMap((f) => f.lotes).filter((l) => l.cartel);
  test('sin warnings fatales', () => expect(res.warnings.filter(isFatalWarning)).toEqual([]));
  test('los lugares ligados usan el lote y su cartel', () => {
    for (const id of ['banco-nacion', 'galicia', 'luccianos']) {
      const p = m.places.find((x) => x.id === id)!;
      expect(p.buildingId, id).toMatch(/^ea-prueba-/);
      expect(p.sign?.look, id).toBeDefined();
    }
  });
  test('todos los lotes de la calle recorren su frente en el mismo sentido (contra)', () => {
    expect(new Set(lots.map((l) => l.front!.contra ?? false)).size).toBe(1);
  });
  test('cada lote tiene aristas de frente y no se superpone con otro edificio', () => {
    expect(lots).toHaveLength(raw.frentes.frentes[0].lotes.filter((l) => l.pisos > 0).length);
    for (const l of lots) {
      expect(l.front!.edges.length, l.id).toBeGreaterThan(0);
      for (const o of m.buildings) {
        if (o === l) continue;
        const area = polygonClipping.intersection([[...l.footprint, l.footprint[0]]], [[...o.footprint, o.footprint[0]]])
          .reduce((a, poly) => a + Math.abs(poly[0].slice(0, -1).reduce((t, q, i, r) => t + q[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * q[1], 0)) / 2, 0);
        expect(area, `${l.id} x ${o.id}`).toBeLessThanOrEqual(0.05);
      }
    }
  });
  test('fotos de un lugar con lote: avisos de edgeIndex, alto y ancho', () => {
    const w = assembleMap({ ...raw, photos: [{ placeId: 'banco-nacion', edgeIndex: 1, widthM: 60, heightM: 30 }] }).warnings;
    expect(w).toContain('banco-nacion: la foto de un lugar con lote va a la arista del cartel (sacale edgeIndex)');
    expect(w.some((x) => x.startsWith('banco-nacion: la foto mide 30 m y el lote '))).toBe(true);
    expect(w.some((x) => x.startsWith('banco-nacion: la foto mide 60 m de ancho y el frente del lote '))).toBe(true);
    expect(res.warnings.some((x) => x.startsWith('banco-nacion:'))).toBe(false);
  }, 30_000);
  test('los edificios de Microsoft al otro lado de las transversales no pierden área', () => {
    const base = assembleMap({ ...raw, frentes: { ...raw.frentes, frentes: [] } }).map; // sin ningún frente relevado
    const area = (mm: MapData, id: string): number => mm.buildings.filter((b) => b.id === id || b.id.startsWith(`${id}-`))
      .reduce((a, b) => a + polygonArea(b.footprint), 0);
    for (const id of ['b0837', 'b0833']) expect(Math.abs(area(m, id) - area(base, id)), id).toBeLessThanOrEqual(0.5);
  }, 30_000);
  test('map.signs: los lotes con cartel y sin lugar', () => {
    const expected = withSign.filter((l) => l.lugar === undefined).length - 1; // LUCCIANO'S se enlaza solo con su lugar
    expect(m.signs).toHaveLength(expected);
    m.signs.forEach((sg) => expect(sg.look).toBeDefined());
  });
  test('ninguna calle vehicular pasa por adentro de un edificio', () => expect(roadPointsInsideBuildings(m)).toEqual([]));
  test('todo cluster de techos tiene acceso, salvo los del borde', () => {
    const b = m.bounds;
    const deep = ([x, z]: Vec2): boolean => x > b.minX + 2.5 && x < b.maxX - 2.5 && z > b.minZ + 2.5 && z < b.maxZ - 2.5;
    const byId = new Map(m.buildings.map((bd) => [bd.id, bd]));
    const without = roofClusters(m.buildings).filter((c) => !hasAccess(c, m.props, m));
    for (const c of without) {
      const mids = c.flatMap((id) => byId.get(id)!.footprint.map((p, i, fp): Vec2 => [(p[0] + fp[(i + 1) % fp.length][0]) / 2, (p[1] + fp[(i + 1) % fp.length][1]) / 2]));
      expect(mids.some(deep), c[0]).toBe(false);
    }
    expect(without).toHaveLength(res.stats.noAidOutside);
  });
  test('ningún hueco queda sin salida y los spawns están en el suelo principal', () => {
    const g = analyzeGround(fw, solidOutlines(m));
    const { clusterOf, fromMain } = mainClusters(m, g);
    const stuck = g.pockets.filter((p) => {
      const l = climbOut(fw, m, p);
      return !l || !fromMain.has(clusterOf.get(l.buildingId)!);
    });
    expect(stuck).toHaveLength(0);
    for (const sp of [...m.places.map((p) => p.spawn), ...m.randomSpawns]) expect(g.regionOf(sp[0], sp[2]), sp.join(',')).toBe(0);
  });
  test('cada lugar con cartel lo ve desde su spawn, o figura en warnings', () => m.places.forEach((p) => {
    if (!p.sign || seesSign(fw, p.sign, p.spawn)) return;
    expect(res.warnings.some((w) => w.startsWith(`${SPAWN_RELAXED} ${p.id}:`)), p.id).toBe(true);
  }));
});

describe('findFreeSpot / randomSpawns en un mundo chico', () => {
  const tiny: MapData = {
    version: 1, origin: { lat: 0, lon: 0 }, bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    buildings: [{ id: 'b', footprint: [[-2, -2], [2, -2], [2, 2], [-2, 2]], height: 4, floors: 1, kind: 'house', wall: 'plaster', tint: '#ccc' }],
    outskirts: [], roads: [], railways: [], platforms: [], parks: [], places: [], props: [], trees: [], randomSpawns: [], signs: [],
  };
  const w = buildCollisionWorld(tiny);
  test('devuelve el punto libre más cercano', () => {
    const s = findFreeSpot(w, [0, 0])!;
    expect(s[1]).toBe(0);
    const d = Math.hypot(s[0], s[2]);
    expect(d).toBeGreaterThan(2.3); expect(d).toBeLessThan(2.9);
    expect(findFreeSpot(w, [5, 5])).toEqual([5, 0, 5]);
  });
  test('null si todo dentro de maxRadius está bloqueado', () => expect(findFreeSpot(w, [0, 0], 2)).toBeNull());
  test('respeta bounds − 1 m', () => {
    expect(findFreeSpot(w, [10, 0], 0.4)).toBeNull();
    const s = findFreeSpot(w, [10, 0], 3)!;
    expect(s[0]).toBeLessThanOrEqual(9);
  });
  test('randomSpawns es determinista y respeta la separación', () => {
    const a = randomSpawns(w, 10, [8]);
    expect(a).toEqual(randomSpawns(w, 10, [8]));
    expect(a.length).toBeGreaterThan(1);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++)
      expect(Math.hypot(a[i][0] - a[j][0], a[i][2] - a[j][2])).toBeGreaterThanOrEqual(8);
  });
  test('findFreeSpot con clearance y accept', () => {
    // alrededor del origen hay 2 m de pared; con 2,5 m de aire el punto más cercano está más lejos
    const plain = findFreeSpot(w, [0, 0])!;
    const clear = findFreeSpot(w, [0, 0], 12, 2.5)!;
    expect(Math.hypot(clear[0], clear[2])).toBeGreaterThan(Math.hypot(plain[0], plain[2]));
    expect(w.overlaps(clear[0], clear[2], 0.35 + 2.5, 0.05, 1.8)).toBe(false);
    const east = findFreeSpot(w, [0, 0], 12, 0, (p) => p[0] > 4)!;
    expect(east[0]).toBeGreaterThan(4);
    expect(findFreeSpot(w, [0, 0], 12, 0, () => false)).toBeNull();
  });
});

describe('filterTrees', () => {
  const t = (x: number, z: number): Tree => ({ position: [x, z], variant: 0, scale: 1 });
  const props: Prop[] = [
    { kind: 'fountain', position: [0, 0], radius: 3 },
    { kind: 'monument', placeId: 'm', position: [50, 0], style: 'statue' },
    { kind: 'bench', position: [100, 0], rotation: 0 },
    { kind: 'ladder', base: [150, 0], normal: [0, 1], topY: 4, buildingId: 'x' },
  ];
  const platform: Vec2[][] = [[[200, 0], [210, 0], [210, 5], [200, 5]]];
  test('saca los que pisan props y andenes y deja el resto', () => {
    const drop = [t(4.9, 0), t(53, 0), t(101, 0), t(150, 1), t(205, 2), t(199.7, 2)];
    const keep = [t(5.1, 0), t(55, 0), t(102, 0), t(150, 2), t(199.4, 2)];
    expect(filterTrees([...drop, ...keep], props, platform)).toEqual(keep);
  });
});

describe('empedrado', () => {
  const raw = loadRaw();
  const roads = assembleMap(raw).map.roads;
  test('Esteban Adrogué sale con sett por data/frentes.json, incluida la vía w28314572', () => {
    const ea = roads.filter((r) => r.name === 'Esteban Adrogué');
    expect(ea.find((r) => r.id === 'w28314572')?.surface).toBe('sett');
    expect(ea.every((r) => r.surface === 'sett')).toBe(true);
  });
  test('calzada asfalto saca el sett que traía OSM', () => {
    const rosales = (rs: typeof roads) => rs.filter((r) => r.name === 'Leonardo Rosales');
    expect(rosales(roads).some((r) => r.surface === 'sett')).toBe(true);
    const asfaltada = assembleMap({ ...raw, frentes: { frentes: [], calzadas: { 'Leonardo Rosales': 'asfalto' } } }).map.roads;
    expect(rosales(asfaltada).length).toBeGreaterThan(0);
    expect(rosales(asfaltada).every((r) => r.surface === undefined)).toBe(true);
  });
  test('otras vías vehiculares con sett de OSM se conservan', () => {
    const others = roads.filter((r) => r.surface === 'sett' && r.kind !== 'footway' && r.kind !== 'pedestrian' && r.name !== 'Esteban Adrogué');
    expect(others.length).toBeGreaterThanOrEqual(MIN_OTHER_SETT);
  });
}, 60_000);
