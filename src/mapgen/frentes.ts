// Frentes relevados en el mapa: lotes con su cartel, recorte de los edificios de Microsoft, enlace con los lugares de
// data/places.json y cotejo con los locales de OSM.
import { distPointSegment, project } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Building, Road, Sign } from '../shared/mapdata.ts';
import { heightFor } from './buildings.ts';
import { cumulative, pointAt, resolveFrontage, vehicular } from './frontage.ts';
import type { Frontage } from './frontage.ts';
import type { FrenteInput, FrentesInput } from './frentes-input.ts';
import { carveLots, layoutLots, lotBuilding, lotSign } from './lots.ts';
import type { LotShape } from './lots.ts';
import type { OsmPoi } from './osm.ts';
import { normalizeName } from './places.ts';
import type { PlaceInput } from './places-input.ts';

const ADENTRO_MIN = -6;
const ADENTRO_MAX = 25;
const NAME_MIN = 3;

export interface FrentesResult {
  buildings: Building[]; // Microsoft recortados + lotes
  fixed: Map<string, { buildingId: string; sign: Sign }>;
  signs: Sign[]; // carteles de los lotes que no son de un lugar
  fronts: Map<string, { front: Vec2[]; cornerRings: Vec2[][] }>; // por id de lote, para las aristas después del redondeo
  warnings: string[];
  report: string[]; // informativo: distancia de cada lote enlazado a su punto de OSM o del lugar
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

export function applyFrentes(input: FrentesInput, roads: Road[], buildings: Building[], places: PlaceInput[], pois: OsmPoi[]): FrentesResult {
  const res: FrentesResult = { buildings, fixed: new Map(), signs: [], fronts: new Map(), warnings: [], report: [] };
  if (input.frentes.length === 0) return res;

  const faces: { f: FrenteInput; fr: Frontage; lots: LotShape[] }[] = input.frentes.map((f) => {
    const fr = resolveFrontage(roads, f);
    return { f, fr, lots: layoutLots(f, fr, roads) };
  });
  const lotHeight = (l: LotShape): number => heightFor(l.lote.pisos);
  const frontMid = (l: LotShape): Vec2 => pointAt(l.front, cumulative(l.front), cumulative(l.front).at(-1)! / 2);
  const linked = new Set<string>(); // lotes ligados a un lugar
  const link = (placeId: string, l: LotShape, pos: Vec2): void => {
    const sign = lotSign(l, lotHeight(l))!;
    res.fixed.set(placeId, { buildingId: l.id, sign });
    linked.add(l.id);
    const m = frontMid(l);
    res.report.push(`${placeId} -> ${l.id}: a ${fmt(Math.hypot(m[0] - pos[0], m[1] - pos[1]))} m del punto del lugar`);
  };

  const positions = new Map(places.map((p) => [p.id, project(p.lat, p.lon)]));
  for (const { lots } of faces) {
    for (const l of lots) {
      if (l.lote.lugar === undefined) continue;
      if (!l.footprint) res.warnings.push(`${l.id}: tiene "lugar" pero no tiene edificio (pisos 0)`);
      else link(l.lote.lugar, l, positions.get(l.lote.lugar) ?? frontMid(l));
    }
  }

  // enlace automático: lugares sin lote explícito que caen sobre un frente
  for (const p of places) {
    if (p.type === 'plaza' || p.type === 'monument' || res.fixed.has(p.id)) continue;
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

  const lots = faces.flatMap((x) => x.lots);
  res.buildings = [...carveLots(buildings, lots.flatMap((l) => l.claim)), ...lots.flatMap((l) => lotBuilding(l) ?? [])];
  for (const l of lots) {
    res.fronts.set(l.id, { front: l.front, cornerRings: l.cornerRings });
    if (l.lote.cartel && !linked.has(l.id)) res.signs.push(lotSign(l, lotHeight(l))!);
  }
  return res;
}
