// Frentes relevados en el mapa: lotes con su cartel, recorte de los edificios de Microsoft, enlace con los lugares de
// data/places.json y cotejo con los locales de OSM. Las plantas relevadas (data/plantas.json) entran como lotes sueltos.
import { distPointSegment, project } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Building, Road, Sign } from '../shared/mapdata.ts';
import type { AidSlots, LotFront } from './climb.ts';
import { cumulative, pointAt, resolveFrontage, vehicular } from './frontage.ts';
import type { Frontage } from './frontage.ts';
import type { FrenteInput, FrentesInput } from './frentes-input.ts';
import { aidEnds, carveLots, layoutLots, lotBuilding, lotHeight, lotOverlap, lotSign } from './lots.ts';
import type { LotShape } from './lots.ts';
import type { OsmPoi } from './osm.ts';
import { normalizeName } from './places.ts';
import type { PlaceInput } from './places-input.ts';
import { plantaLadder, streetWarnings } from './plantas.ts';
import type { PlantaShape } from './plantas.ts';

const ADENTRO_MIN = -6;
const ADENTRO_MAX = 25;
const NAME_MIN = 3;
/** Dos lotes de frentes distintos se pisan si comparten más de OVERLAP_AREA m² con un ancho medio de más de
 *  OVERLAP_WIDTH m. Donde dos frentes seguidos se juntan en un empalme en T cada uno corta su lote a escuadra con su
 *  propia línea, y queda una astilla de 1 o 2 cm de ancho: esa no cuenta. */
const OVERLAP_AREA = 0.05;
const OVERLAP_WIDTH = 0.05;
/** Una planta relevada se pisa con un lote o con otra planta si comparten más de esto (m²): no viene de un empalme en T. */
const PLANTA_OVERLAP = 0.05;

export interface FrentesResult {
  buildings: Building[]; // Microsoft recortados + lotes
  fixed: Map<string, { buildingId: string; sign: Sign }>;
  signs: Sign[]; // carteles de los lotes que no son de un lugar
  fronts: Map<string, { front: Vec2[]; cornerRings: Vec2[][] }>; // por id de lote, para las aristas después del redondeo
  /** Por id de lote con edificio: su fachada y las puntas donde puede ir una ayuda de ascenso (para climb.ts). */
  climb: Map<string, LotFront>;
  lots: LotShape[];
  linked: Set<string>; // ids de los lotes ligados a un lugar (su cartel es el del lugar)
  plantas: Map<string, PlantaShape>; // por id del lugar: su planta relevada (data/plantas.json)
  warnings: string[];
  report: string[]; // informativo: distancia de cada lote enlazado a su punto de OSM o del lugar
}

/**
 * Los carteles de los lotes: los de los lotes ligados a un lugar (por id de lote) y el resto. `slots` (de climb.ts): los
 * metros que ocupa una ayuda de ascenso desde cada punta de la fachada, que el cartel deja libres. `warnings`: dónde
 * avisar un `cartel.ancho` que no entra.
 */
export function lotSigns(fr: Pick<FrentesResult, 'lots' | 'linked'>, slots: AidSlots = new Map(), warnings?: string[]): { signs: Sign[]; byLot: Map<string, Sign> } {
  const signs: Sign[] = [];
  const byLot = new Map<string, Sign>();
  for (const l of fr.lots) {
    const sign = lotSign(l, lotHeight(l.lote), slots.get(l.id), warnings);
    if (!sign) continue;
    if (fr.linked.has(l.id)) byLot.set(l.id, sign);
    else signs.push(sign);
  }
  return { signs, byLot };
}

const fmt = (n: number): string => n.toFixed(1).replace('.', ',');

/** Un nombre normalizado contiene al otro y el más corto tiene al menos 3 caracteres. */
function nameMatch(a: string, b: string): boolean {
  const [x, y] = [normalizeName(a), normalizeName(b)];
  const short = x.length <= y.length ? x : y;
  const long = short === x ? y : x;
  return short.length >= NAME_MIN && long.includes(short);
}

function distToLine(p: Vec2, pts: Vec2[]): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distPointSegment(p, pts[i - 1], pts[i]));
  return d;
}

/** Distancia del punto a cada calle con nombre (la menor entre sus tramos). */
function streetDistances(p: Vec2, roads: Road[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of roads) {
    if (!vehicular(r) || !r.name) continue;
    out.set(r.name, Math.min(out.get(r.name) ?? Infinity, distToLine(p, r.points)));
  }
  return out;
}

/** ¿El punto cae sobre el frente? Dentro de su largo, de −6 m (hacia la calle) a 25 m hacia adentro, y su calle más cercana es la del frente. */
export function onFace(p: Vec2, fr: Frontage, roads: Road[], calle: string): boolean {
  const cum = cumulative(fr.line);
  const last = fr.line.length - 2;
  let best = { d: Infinity, s: 0, side: 0 };
  for (let i = 0; i <= last; i++) {
    const [a, b] = [fr.line[i], fr.line[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
    const tc = Math.min(Math.max(t, 0), 1);
    const q: Vec2 = [a[0] + (b[0] - a[0]) * tc, a[1] + (b[1] - a[1]) * tc];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d >= best.d) continue;
    const tOut = i === 0 && t < 0 ? t : i === last && t > 1 ? t : tc; // pasado de las puntas queda fuera
    const n: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    best = { d, s: cum[i] + tOut * len, side: ((p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1]) * fr.inward };
  }
  if (best.s < 0 || best.s > fr.length || best.side < ADENTRO_MIN || best.side > ADENTRO_MAX) return false;
  const nearest = [...streetDistances(p, roads)].reduce((m, e) => (e[1] < m[1] ? e : m), ['', Infinity] as [string, number])[0];
  return nearest === calle;
}

/**
 * `plantas`: las plantas relevadas, ya en el mundo (placePlantas). Entran a los lotes: reciben el recorte, el enlace con
 * su lugar, el cartel, el frente para el atlas y las puntas para las ayudas de ascenso como cualquier otro.
 */
export function applyFrentes(
  input: FrentesInput, roads: Road[], buildings: Building[], places: PlaceInput[], pois: OsmPoi[], plantas: PlantaShape[] = [],
): FrentesResult {
  const res: FrentesResult = {
    buildings, fixed: new Map(), signs: [], fronts: new Map(), climb: new Map(), lots: [], linked: new Set(), plantas: new Map(), warnings: [], report: [],
  };
  if (input.frentes.length === 0 && plantas.length === 0) return res;

  const faces: { f: FrenteInput; fr: Frontage; lots: LotShape[] }[] = input.frentes.map((f) => {
    const fr = resolveFrontage(roads, f);
    return { f, fr, lots: layoutLots(f, fr, roads) };
  });
  // dentro de un frente los lotes no se pisan (layoutLots); entre frentes, si se copió un frente o si se cruzan las
  // esquinas de dos frentes perpendiculares
  faces.forEach((a, ia) => faces.slice(0, ia).forEach((b) => a.lots.forEach((la, i) => b.lots.forEach((lb, j) => {
    if (!la.footprint || !lb.footprint) return;
    const o = lotOverlap(la.footprint, lb.footprint);
    if (o.area > OVERLAP_AREA && o.width > OVERLAP_WIDTH) {
      res.warnings.push(`frente ${a.f.id}, lote ${i + 1} se pisa con frente ${b.f.id}, lote ${j + 1} (${fmt(o.area)} m²)`);
    }
  }))));
  // una planta se pisa con un lote o con otra planta, o pisa la calle
  plantas.forEach((p, i) => {
    for (const { f, lots } of faces) {
      lots.forEach((l, j) => {
        const o = l.footprint ? lotOverlap(p.footprint, l.footprint).area : 0;
        if (o > PLANTA_OVERLAP) res.warnings.push(`planta de ${p.planta.lugar} se pisa con frente ${f.id}, lote ${j + 1} (${fmt(o)} m²)`);
      });
    }
    for (const q of plantas.slice(0, i)) {
      const o = lotOverlap(p.footprint, q.footprint).area;
      if (o > PLANTA_OVERLAP) res.warnings.push(`planta de ${p.planta.lugar} se pisa con planta de ${q.planta.lugar} (${fmt(o)} m²)`);
    }
    res.warnings.push(...streetWarnings(p, roads));
  });
  const frontMid = (l: LotShape): Vec2 => pointAt(l.front, cumulative(l.front), cumulative(l.front).at(-1)! / 2);
  const placeLot = new Map<string, string>(); // id del lugar → id del lote (el cartel va al final, con lotSigns)
  const link = (placeId: string, l: LotShape, pos: Vec2): void => {
    placeLot.set(placeId, l.id);
    res.linked.add(l.id);
    const m = frontMid(l);
    res.report.push(`${placeId} -> ${l.id}: a ${fmt(Math.hypot(m[0] - pos[0], m[1] - pos[1]))} m del punto del lugar`);
  };

  // las plantas son lotes sueltos: después de los de los frentes, con su lugar en lote.lugar
  const lots = [...faces.flatMap((x) => x.lots), ...plantas];
  for (const p of plantas) res.plantas.set(p.planta.lugar, p);
  const positions = new Map(places.map((p) => [p.id, project(p.lat, p.lon)]));
  for (const l of lots) {
    if (l.lote.lugar === undefined) continue;
    if (!l.footprint) res.warnings.push(`${l.id}: tiene "lugar" pero no tiene edificio (pisos 0)`);
    else link(l.lote.lugar, l, positions.get(l.lote.lugar) ?? frontMid(l));
  }

  // enlace automático: lugares sin lote explícito que caen sobre un frente
  for (const p of places) {
    if (p.type === 'plaza' || p.type === 'monument' || placeLot.has(p.id)) continue;
    const pos = positions.get(p.id)!;
    const face = faces.find((x) => onFace(pos, x.fr, roads, x.f.calle));
    if (!face) continue;
    const named = face.lots.filter((l) => l.footprint && l.lote.lugar === undefined && l.lote.cartel
      && (nameMatch(l.lote.cartel.texto, p.name) || (p.signText !== undefined && nameMatch(l.lote.cartel.texto, p.signText))));
    if (named.length === 1) link(p.id, named[0], pos);
    else if (named.length === 0) res.warnings.push(`${p.id}: cae sobre el frente ${face.f.id} y ningún lote lo nombra; agregá "lugar": "${p.id}" al lote que corresponde`);
    else res.warnings.push(`${p.id}: en el frente ${face.f.id} lo nombran los lotes ${named.map((l) => l.id).join(', ')}; dejá "lugar" en uno solo`);
  }

  // locales de OSM sobre cada frente
  for (const { f, fr, lots } of faces) {
    const onThis = pois.filter((o) => onFace(o.position, fr, roads, f.calle));
    const ausentes = f.osmAusentes.map(normalizeName);
    for (const o of onThis) {
      const lot = lots.find((l) => l.lote.osm === o.name) ?? lots.find((l) => l.lote.cartel && nameMatch(l.lote.cartel.texto, o.name));
      if (lot) {
        const m = frontMid(lot);
        res.report.push(`${lot.id} <-> OSM "${o.name}": a ${fmt(Math.hypot(m[0] - o.position[0], m[1] - o.position[1]))} m`);
      } else if (!ausentes.includes(normalizeName(o.name))) {
        res.warnings.push(`${f.id}: el local de OSM "${o.name}" no está en ningún lote; si ya no existe, agregalo a "osmAusentes"`);
      }
    }
    f.osmAusentes.forEach((name, i) => {
      if (!onThis.some((o) => normalizeName(o.name) === ausentes[i])) res.warnings.push(`${f.id}: "${name}" de osmAusentes no es un local de OSM sobre este frente`);
    });
  }

  // antes de recortar, se borran enteros los bloques de Microsoft que nombra una planta en "reemplaza" (D8)
  const microsoft = new Set(buildings.map((b) => b.id));
  const gone = new Set<string>();
  for (const p of plantas) {
    for (const id of p.planta.reemplaza) {
      if (microsoft.has(id)) gone.add(id);
      else res.warnings.push(`planta de ${p.planta.lugar}: "reemplaza" nombra ${id}, que no es un edificio de Microsoft`);
    }
  }
  res.lots = lots;
  const kept = gone.size > 0 ? buildings.filter((b) => !gone.has(b.id)) : buildings;
  res.buildings = [...carveLots(kept, lots.flatMap((l) => l.claim)), ...lots.flatMap((l) => lotBuilding(l) ?? [])];
  for (const l of lots) {
    res.fronts.set(l.id, { front: l.front, cornerRings: l.cornerRings });
    if (!l.footprint) continue;
    const aid = 'planta' in l ? plantaLadder(l as PlantaShape) : null;
    res.climb.set(l.id, { line: l.front, puntas: aidEnds(l), ...(aid ? { aid } : {}) });
  }
  const signs = lotSigns(res, new Map(), res.warnings);
  res.signs = signs.signs;
  for (const [placeId, lotId] of placeLot) res.fixed.set(placeId, { buildingId: lotId, sign: signs.byLot.get(lotId)! });
  return res;
}
