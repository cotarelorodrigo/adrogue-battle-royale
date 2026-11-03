import polygonClipping from 'polygon-clipping';
import { distPointSegment, ensureCCW, pointInPolygon, polygonArea } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import { SIGN_H } from '../shared/mapdata.ts';
import type { Building, Road, Sign } from '../shared/mapdata.ts';
import { heightFor, MIN_AREA } from './buildings.ts';
import { cumulative, pointAt, slice, vehicular } from './frontage.ts';
import type { Frontage } from './frontage.ts';
import type { FrenteInput, LoteInput } from './frentes-input.ts';
import { bufferLine, offsetLine } from './osm.ts';

export const MAX_DESVIO = 0.10;
export const LOT_SIGN = { frenteY: 2.35, banderaY: 2.6, banderaAncho: 1.2, margen: 0.4, offset: 0.08 } as const;

const EXTEND = 20;
const MIN_LOT_AREA = 4;
const STEP = 0.05;
const ON_EDGE = 2e-3;
const TOUCH = 0.01;

export interface LotShape {
  id: string; // `${frente.id}-${k}`, con k desde 1
  lote: LoteInput;
  /** Sentido de la manzana respecto de `front` (el de `Frontage.inward`); el cartel mira al lado contrario. */
  inward: 1 | -1;
  front: Vec2[]; // la fachada: el tramo del lote sobre la línea de edificación, corrido `retiro`; de desde a hasta
  cornerRings: Vec2[][]; // corredores contra los que se recortó (solo en el primer y el último lote)
  footprint: Vec2[] | null; // antihorario; null si pisos = 0
  claim: Vec2[][]; // lo que se le saca a los edificios de Microsoft: del eje de la calle al fondo del lote
}

type Ring = [number, number][];
type Multi = polygonClipping.MultiPolygon;

// polygon-clipping modifica los puntos de entrada: siempre se le pasan copias
const poly = (r: Vec2[]): [Ring] => [[...r, r[0]].map((p): [number, number] => [p[0], p[1]])];
const outer = (p: Multi[number]): Vec2[] => p[0].slice(0, -1) as Vec2[];
const fmt = (n: number): string => n.toFixed(1).replace('.', ',');
const bbox = (r: Vec2[]): [number, number, number, number] =>
  [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))];
const overlaps = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

function distToRing(p: Vec2, ring: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, distPointSegment(p, ring[i], ring[(i + 1) % ring.length]));
  return d;
}

function subtract(subject: Vec2[], cuts: Vec2[][]): Multi {
  return cuts.length ? polygonClipping.difference(poly(subject), ...cuts.map(poly)) : [poly(subject) as Multi[number]];
}

/** La parte de `raw` (polilínea sobre el borde de `ring` antes del recorte) que sigue sobre el borde. */
function survivingFront(raw: Vec2[], ring: Vec2[]): Vec2[] {
  const samples: { p: Vec2; vertex: boolean; on: boolean }[] = [];
  const add = (p: Vec2, vertex: boolean): void => { samples.push({ p, vertex, on: distToRing(p, ring) <= ON_EDGE }); };
  for (let i = 0; i < raw.length; i++) {
    add(raw[i], true);
    if (i === raw.length - 1) break;
    const len = Math.hypot(raw[i + 1][0] - raw[i][0], raw[i + 1][1] - raw[i][1]);
    for (let s = STEP; s < len - 1e-9; s += STEP) {
      const t = s / len;
      add([raw[i][0] + (raw[i + 1][0] - raw[i][0]) * t, raw[i][1] + (raw[i + 1][1] - raw[i][1]) * t], false);
    }
  }
  let best: [number, number] | null = null;
  for (let i = 0; i < samples.length; ) {
    if (!samples[i].on) { i++; continue; }
    let j = i;
    while (j + 1 < samples.length && samples[j + 1].on) j++;
    if (!best || j - i > best[1] - best[0]) best = [i, j];
    i = j + 1;
  }
  if (!best) return raw;
  // bisección entre la última muestra de adentro y la primera de afuera, hasta 1 mm
  const edge = (inside: Vec2, outside: Vec2): Vec2 => {
    let [a, b] = [inside, outside];
    while (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-3) {
      const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (distToRing(m, ring) <= ON_EDGE) a = m;
      else b = m;
    }
    return a;
  };
  const [i0, i1] = best;
  const out: Vec2[] = [i0 > 0 ? edge(samples[i0].p, samples[i0 - 1].p) : samples[i0].p];
  for (let i = i0 + 1; i < i1; i++) if (samples[i].vertex) out.push(samples[i].p);
  out.push(i1 < samples.length - 1 ? edge(samples[i1].p, samples[i1 + 1].p) : samples[i1].p);
  return out;
}

export function layoutLots(f: FrenteInput, fr: Frontage, roads: Road[]): LotShape[] {
  const L = fr.length;
  const suma = f.lotes.reduce((s, l) => s + l.ancho, 0);
  if (Math.abs(suma - L) > MAX_DESVIO * L) {
    const p = ((suma - L) / L) * 100;
    throw new Error(`frente ${f.id}: los anchos suman ${fmt(suma)} m pero el frente mide ${fmt(L)} m (${p < 0 ? '−' : '+'}${fmt(Math.abs(p))} %). ¿Falta o sobra un lote?`);
  }
  const k = L / suma;
  const own = fr.corners.flat();
  const cumLine = cumulative(fr.line);
  const cuts = (box: [number, number, number, number]): Vec2[][] => [
    ...own,
    ...roads.filter((r) => vehicular(r) && r.name !== f.calle).map((r) => bufferLine(r.points, r.width / 2 + r.sidewalk)),
  ].filter((c) => overlaps(bbox(c), box));

  const out: LotShape[] = [];
  const taken: Vec2[][] = [];
  let s = 0;
  f.lotes.forEach((lote, i) => {
    const n = i + 1;
    const first = i === 0;
    const last = i === f.lotes.length - 1;
    const s0 = s;
    s += lote.ancho * k;
    const s1 = last ? L : s;
    const F = slice(fr.ext, first && fr.corners[0].length > 0 ? 0 : s0 + EXTEND, last && fr.corners[1].length > 0 ? L + 2 * EXTEND : s1 + EXTEND);
    const dIn = fr.inward;
    const rawFront = offsetLine(F, dIn * lote.retiro);
    const back = offsetLine(F, dIn * (lote.retiro + lote.fondo)).reverse();
    const raw = [...rawFront, ...back];
    const rawClaim = [...offsetLine(F, -dIn * fr.setback), ...back];
    const box = bbox([...raw, ...rawClaim]);
    const near = cuts(box);

    const pieces = subtract(raw, [...near, ...taken]);
    // el pedazo que corresponde al lote es el más cercano a su tramo de la línea (el recorte de una esquina oblicua puede
    // dejar del otro lado de la transversal uno más grande); a igual distancia, el mayor
    const mid = pointAt(fr.line, cumLine, (s0 + s1) / 2);
    const gap = (r: Vec2[]): number => (pointInPolygon(mid, r) ? 0 : distToRing(mid, r));
    const big = pieces.reduce<Vec2[] | null>((m, p) => {
      const r = outer(p);
      if (!m) return r;
      const [dr, dm] = [gap(r), gap(m)];
      return dr < dm - 1e-6 || (Math.abs(dr - dm) <= 1e-6 && polygonArea(r) > polygonArea(m)) ? r : m;
    }, null);
    const area = big ? polygonArea(big) : 0;
    if (lote.pisos > 0 && area < MIN_LOT_AREA) throw new Error(`frente ${f.id}, lote ${n}: el lote quedó demasiado chico (${fmt(area)} m²)`);
    const ring = big && area >= MIN_LOT_AREA ? ensureCCW(big) : null;
    // del claim solo queda el pedazo del lado del frente: los que cruzan la transversal pertenecerían a la manzana de al lado
    const claimPieces = subtract(rawClaim, near).map((p) => ensureCCW(outer(p)));
    const touching = ring ? claimPieces.filter((c) => polygonClipping.intersection(poly(c), poly(ring)).some((x) => polygonArea(outer(x)) > 1e-6)) : [];
    const nearest = claimPieces.length ? [claimPieces.reduce((m, c) => (gap(c) < gap(m) ? c : m))] : [];
    const claim = touching.length ? touching : nearest;
    const rings = [...(first ? fr.corners[0] : []), ...(last ? fr.corners[1] : [])];
    if (lote.pisos > 0 && ring) taken.push(ring);
    out.push({
      id: `${f.id}-${n}`, lote, inward: dIn,
      front: ring ? survivingFront(rawFront, ring) : rawFront,
      cornerRings: ring ? rings.filter((c) => ring.some((p) => distToRing(p, c) < TOUCH)) : [],
      footprint: lote.pisos > 0 ? ring : null,
      claim,
    });
  });
  return out;
}

export function carveLots(buildings: Building[], claims: Vec2[][]): Building[] {
  if (claims.length === 0) return buildings;
  const union = polygonClipping.union(poly(claims[0]), ...claims.slice(1).map(poly));
  const boxes = union.map((p) => bbox(outer(p)));
  const out: Building[] = [];
  for (const b of buildings) {
    const bb = bbox(b.footprint);
    if (!boxes.some((x) => overlaps(bb, x))) { out.push(b); continue; }
    const hit = polygonClipping.intersection(poly(b.footprint), union);
    if (hit.every((p) => polygonArea(outer(p)) < 1e-6)) { out.push(b); continue; }
    const rest = polygonClipping.difference(poly(b.footprint), union)
      .map((p) => ensureCCW(outer(p)))
      .map((fp) => ({ fp, area: polygonArea(fp), x: Math.min(...fp.map((p) => p[0])) }))
      .filter((p) => p.area >= MIN_AREA)
      .sort((a, c) => (Math.abs(a.area - c.area) > 1e-6 ? c.area - a.area : a.x - c.x));
    rest.forEach((p, i) => out.push({ ...b, id: i === 0 ? b.id : `${b.id}-${i + 1}`, footprint: p.fp }));
  }
  return out;
}

export function lotBuilding(l: LotShape): Building | null {
  if (!l.footprint) return null;
  const o = l.lote;
  return {
    id: l.id, footprint: l.footprint, height: heightFor(o.pisos), floors: o.pisos, tint: o.color,
    kind: o.pisos >= 3 ? 'apartments' : o.pb === 'puerta' ? 'house' : 'shop',
    wall: o.material === 'ladrillo' ? 'brick' : 'plaster',
    front: {
      edges: [], corner: [], pb: o.pb, arriba: o.arriba, puerta: o.puerta,
      ...(o.material === 'ladrillo' ? { ladrillo: true as const } : {}),
      ...(o.colorPB ? { colorPB: o.colorPB } : {}),
      ...(o.toldo ? { toldo: { color: o.toldo.color, ...(o.toldo.rayas ? { rayas: true as const } : {}) } } : {}),
    },
  };
}

export function lotSign(l: LotShape, height: number): Sign | null {
  const c = l.lote.cartel;
  if (!c) return null;
  const cum = cumulative(l.front);
  const len = cum[cum.length - 1];
  const dir = (s: number): Vec2 => {
    let i = 1;
    while (i < l.front.length - 1 && cum[i] < s) i++;
    const [a, b] = [l.front[i - 1], l.front[i]];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };
  const look = { fondo: c.fondo, letra: c.letra, marco: c.marco ?? c.fondo, fuente: c.fuente, ...(c.cursiva ? { cursiva: true as const } : {}) };
  const mid = pointAt(l.front, cum, len / 2);
  const t = dir(len / 2);
  const n: Vec2 = [t[1] * l.inward, -t[0] * l.inward]; // exterior: al revés de la manzana
  const dflt = Math.max(Math.min(len - LOT_SIGN.margen, len - 0.2), 1);
  if (c.posicion === 'bandera') {
    const width = c.ancho ?? LOT_SIGN.banderaAncho;
    const p = pointAt(l.front, cum, 0.5);
    const tn = dir(0.5);
    const out: Vec2 = [tn[1] * l.inward, -tn[0] * l.inward];
    return {
      text: c.texto, anchor: [p[0] + out[0] * (width / 2 + 0.1), p[1] + out[1] * (width / 2 + 0.1)], normal: tn, width,
      bottomY: LOT_SIGN.banderaY, look, blade: true,
    };
  }
  return {
    text: c.texto, anchor: [mid[0] + n[0] * LOT_SIGN.offset, mid[1] + n[1] * LOT_SIGN.offset], normal: n, width: c.ancho ?? dflt,
    bottomY: c.posicion === 'alto' ? Math.max(LOT_SIGN.frenteY, height - SIGN_H - 0.1) : LOT_SIGN.frenteY, look,
  };
}

/** Posición (m) del punto más cercano de `line` a `p`, medida desde el comienzo de `line`. */
function alongLine(p: Vec2, line: Vec2[], cum: number[]): number {
  let best = [Infinity, 0];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
    const t = Math.min(Math.max(((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2, 0), 1);
    const d = distPointSegment(p, a, b);
    if (d < best[0]) best = [d, cum[i - 1] + t * (cum[i] - cum[i - 1])];
  }
  return best[1];
}

/** true si las aristas `edges` de `footprint`, en el sentido guardado (footprint[e] → footprint[e+1]), van de `hasta` a `desde`.
 *  Decide la suma de lo que avanza cada arista sobre `line` (pesa por largo y aguanta una curva). */
export function frontIsContra(footprint: Vec2[], edges: number[], line: Vec2[]): boolean {
  const cum = cumulative(line);
  let sum = 0;
  for (const e of edges) sum += alongLine(footprint[(e + 1) % footprint.length], line, cum) - alongLine(footprint[e], line, cum);
  return sum < 0;
}

export function frontEdgesOf(footprint: Vec2[], line: Vec2[], tol = 0.15): number[] {
  const dist = (p: Vec2): number => {
    let d = Infinity;
    for (let i = 1; i < line.length; i++) d = Math.min(d, distPointSegment(p, line[i - 1], line[i]));
    return d;
  };
  const cum = cumulative(line);
  const along = (p: Vec2): number => alongLine(p, line, cum);
  const edges: { i: number; s: number }[] = [];
  footprint.forEach((a, i) => {
    const b = footprint[(i + 1) % footprint.length];
    if (dist(a) <= tol && dist(b) <= tol) edges.push({ i, s: along([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) });
  });
  return edges.sort((x, y) => x.s - y.s).map((e) => e.i);
}
