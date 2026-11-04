// Entradas de los interiores en el mapa (MapData.interiors): por cada lugar entrable con lote o planta relevada, su marco
// local, sus aberturas sobre la planta guardada (ya redondeada) y sus patios. Es lo único que guarda el mapa: el interior
// se arma en src/shared/interiors a partir de esto y del edificio.
import { distPointSegment, pointInPolygon, signedAreaFromAbove, toWorld } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import { BAY_W, DOOR_MIN_W, GROUND_CELLS, LEVEL_H, LOT_OPENINGS, isLotCell } from '../shared/interiors/openings.ts';
import type { Building, Frame, InteriorInput, Opening, Place } from '../shared/mapdata.ts';
import { doorBay } from './lots.ts';
import type { PlantaShape } from './plantas.ts';
import { ring, rn, v2 } from './round.ts';

/** Una abertura de la planta relevada tiene que caer a esto (m) de una arista de la planta guardada. */
const ON_EDGE = 0.05;
/** En una planta relevada, origin + 0,5·V tiene que quedar adentro de la planta o de un patio, o a esto (m) de su borde
 *  (un origen en la esquina de una planta rectangular deja ese punto sobre la medianera). */
const FRAME_TOL = 0.01;

const fmt = (n: number): string => n.toFixed(2).replace('.', ',');
const edgeLen = (fp: Vec2[], e: number): number => {
  const [a, c] = [fp[e], fp[(e + 1) % fp.length]];
  return Math.hypot(c[0] - a[0], c[1] - a[1]);
};
const ringDist = (p: Vec2, r: Vec2[]): number => Math.min(...r.map((a, i) => distPointSegment(p, a, r[(i + 1) % r.length])));
/** Metros sobre una arista de largo `len`, a 2 decimales y sin pasarse de sus puntas. */
const onEdge = (s: number, len: number): number => Math.min(Math.max(rn(s), 0), Math.floor(len * 100) / 100);

/**
 * Las aberturas de la planta baja de un lote, como las pinta el atlas (client/world/fronts.ts): la corrida principal de
 * `front.edges` en n bahías de L / n, la de la puerta con `LOT_OPENINGS[celda de la puerta]` y el resto con
 * `LOT_OPENINGS[celda del resto]`, estiradas a lo ancho de la bahía como la textura. Una abertura que cruza dos aristas
 * se parte. Las celdas que no son aberturas (persiana, portón, pared…) no dan ninguna.
 */
export function lotOpenings(b: Building): Opening[] {
  const f = b.front;
  if (!f) return [];
  const fp = b.footprint;
  const pieces: { e: number; s0: number; len: number }[] = [];
  let L = 0;
  for (const e of f.edges) {
    const len = edgeLen(fp, e);
    if (len < 1e-6) continue;
    pieces.push({ e, s0: L, len });
    L += len;
  }
  if (L === 0) return [];
  // la textura crece en el sentido de la planta antihoraria; si la corrida (de desde a hasta) va al revés, x también
  const rev = (signedAreaFromAbove(fp) < 0) !== (f.contra === true);
  const { n, bay: doorAt } = doorBay(L, f.puerta);
  const bw = L / n;
  const k = bw / BAY_W;
  const [doorCell, restCell] = GROUND_CELLS[f.pb];
  const out: Opening[] = [];
  for (let i = 0; i < n; i++) {
    const cell = i === doorAt ? doorCell : restCell;
    if (!isLotCell(cell)) continue;
    for (const o of LOT_OPENINGS[cell]) {
      const [ra, rb] = rev ? [(i + 1) * bw - o.x1 * k, (i + 1) * bw - o.x0 * k] : [i * bw + o.x0 * k, i * bw + o.x1 * k];
      for (const p of pieces) {
        const sa = Math.max(ra, p.s0), sb = Math.min(rb, p.s0 + p.len);
        if (sb - sa <= 1e-6) continue;
        // de la corrida a la arista guardada: sin contra, la arista va de footprint[e] hacia hasta
        const [d0, d1] = f.contra ? [p.len - (sb - p.s0), p.len - (sa - p.s0)] : [sa - p.s0, sb - p.s0];
        const [s0, s1] = [onEdge(d0, p.len), onEdge(d1, p.len)];
        if (s1 - s0 >= 0.01) out.push({ kind: o.kind, edge: p.e, s0, s1, y0: o.y0, y1: o.y1 });
      }
    }
  }
  return out;
}

/** Marco de un lote: el origen en la primera punta de su fachada, U hacia la última y V hacia adentro (al revés de la
 *  normal de afuera de las aristas del frente). */
function lotFrame(b: Building, front: Vec2[]): Frame | null {
  const [a, c] = [front[0], front[front.length - 1]];
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (len < 1e-6) return null;
  const u: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
  const fp = b.footprint;
  const ccw = signedAreaFromAbove(fp) > 0;
  let out = 0; // normal de afuera · la izquierda de U, pesada por largo: positivo si la izquierda de U es afuera
  for (const e of b.front!.edges) {
    const [p, q] = [fp[e], fp[(e + 1) % fp.length]];
    const n: Vec2 = ccw ? [-(q[1] - p[1]), q[0] - p[0]] : [q[1] - p[1], -(q[0] - p[0])];
    out += n[0] * -u[1] + n[1] * u[0];
  }
  if (out === 0) return null;
  return { origin: v2(a), u, v: out < 0 ? [-u[1], u[0]] : [u[1], -u[0]] };
}

/** Las puertas y los vidrios de una planta relevada, sobre la planta guardada: cada uno va a la arista más cercana a su
 *  punto medio (la planta guardada puede estar dada vuelta y redondeada). */
function plantaOpenings(placeId: string, b: Building, s: PlantaShape, warnings: string[]): Opening[] {
  const pl = s.planta.planta;
  const fp = b.footprint;
  const out: Opening[] = [];
  const locate = (what: string, kind: Opening['kind'], arista: number, from: number, to: number, y0: number, y1: number): void => {
    const [a, c] = [pl[arista], pl[(arista + 1) % pl.length]];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const at = (t: number): Vec2 => toWorld(s.frame, [a[0] + ((c[0] - a[0]) * t) / len, a[1] + ((c[1] - a[1]) * t) / len]);
    const [p0, p1] = [at(from), at(to)];
    const mid: Vec2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    let e = 0;
    let best = Infinity;
    fp.forEach((q, i) => {
      const d = distPointSegment(mid, q, fp[(i + 1) % fp.length]);
      if (d < best) { best = d; e = i; }
    });
    if (best > ON_EDGE) {
      warnings.push(`${placeId}: ${what} queda a ${fmt(best)} m de la planta`);
      return;
    }
    const [q, r] = [fp[e], fp[(e + 1) % fp.length]];
    const el = Math.hypot(r[0] - q[0], r[1] - q[1]);
    const along = (p: Vec2): number => ((p[0] - q[0]) * (r[0] - q[0]) + (p[1] - q[1]) * (r[1] - q[1])) / el;
    const [t0, t1] = [along(p0), along(p1)].sort((x, y) => x - y);
    out.push({ kind, edge: e, s0: onEdge(t0, el), s1: onEdge(t1, el), y0: rn(y0), y1: rn(y1) });
  };
  s.planta.puertas.forEach((p, k) => {
    const y = p.piso * LEVEL_H;
    locate(`la puerta ${k + 1}`, 'puerta', p.arista, p.centro - p.ancho / 2, p.centro + p.ancho / 2, y, y + p.alto);
  });
  s.planta.vidrios.forEach((v, k) => {
    const y = v.piso * LEVEL_H;
    locate(`el vidrio ${k + 1}`, 'vidrio', v.arista, v.desde, v.hasta, y + v.abajo, y + v.arriba);
  });
  return out;
}

/**
 * Un interior por lugar entrable cuyo edificio es un lote relevado (`lotFronts`: la fachada de cada lote, por id) o una
 * planta relevada (`plantas`, por id del lugar). Un lugar entrable sin ninguno de los dos todavía no tiene interior (los
 * de SIN_LOTE sin planta ya avisan que falta relevarla). `buildings` y `places`: los ya redondeados.
 */
export function interiorInputs(
  buildings: Building[], places: Omit<Place, 'spawn'>[], plantas: Map<string, PlantaShape>, lotFronts: Map<string, Vec2[]>,
): { inputs: InteriorInput[]; warnings: string[] } {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const inputs: InteriorInput[] = [];
  const warnings: string[] = [];
  for (const p of places) {
    const b = p.enterable && p.buildingId !== undefined ? byId.get(p.buildingId) : undefined;
    if (!b?.front) continue;
    const s = plantas.get(p.id);
    let input: InteriorInput;
    if (s && s.id === b.id) {
      input = {
        placeId: p.id, buildingId: b.id, frame: { origin: v2(s.frame.origin), u: s.frame.u, v: s.frame.v },
        openings: plantaOpenings(p.id, b, s, warnings), patios: s.patios.map(ring),
      };
      // el marco de una planta es dato del relevamiento: V tiene que entrar al edificio (o a un patio de adelante)
      const { origin, v } = input.frame;
      const q: Vec2 = [origin[0] + v[0] * 0.5, origin[1] + v[1] * 0.5];
      if (![b.footprint, ...input.patios].some((r) => pointInPolygon(q, r) || ringDist(q, r) < FRAME_TOL)) {
        warnings.push(`${p.id}: el marco del interior no entra en la planta: origin + 0,5·V cae afuera`);
      }
    } else {
      // el de un lote sale de su planta (V, al revés de la normal de afuera): en una esquina en diagonal, origin + 0,5·V
      // puede caer afuera sin que nada esté mal
      const front = lotFronts.get(b.id);
      const frame = front && lotFrame(b, front);
      if (!frame) { warnings.push(`${p.id}: el lote ${b.id} no tiene fachada para el marco del interior`); continue; }
      input = { placeId: p.id, buildingId: b.id, frame, openings: lotOpenings(b), patios: [] };
      const n = input.openings.filter((o) => o.kind === 'puerta').length;
      if (n > 1) warnings.push(`${p.id}: la puerta del lote cae sobre un quiebre de la fachada y queda partida en ${n}`);
    }
    const doors = input.openings.filter((o) => o.kind === 'puerta');
    if (doors.length === 0) warnings.push(`${p.id}: el interior no tiene puerta (planta baja "${b.front.pb}")`);
    doors.forEach((o, k) => {
      if (o.s1 - o.s0 < DOOR_MIN_W - 1e-6) warnings.push(`${p.id}: la puerta ${k + 1} mide ${fmt(o.s1 - o.s0)} m de ancho (D10: al menos ${fmt(DOOR_MIN_W)})`);
    });
    inputs.push(input);
  }
  return { inputs, warnings };
}
