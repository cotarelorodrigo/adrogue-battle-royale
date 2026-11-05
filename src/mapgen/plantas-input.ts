// Plantas relevadas (data/plantas.json): los lugares que caen en bloques fusionados de Microsoft y no tienen lote en
// data/frentes.json. Cada una es un lote suelto: la planta real en un marco local, sus patios y despejes, sus puertas y
// vidrios, dónde va su escalera de mano si no es en el frente, y el aspecto con los mismos campos que un lote. Un patio es parte del lugar sin losa ni techo (lo amuebla el
// interior); un despeje es suelo que solo se le saca a los bloques de Microsoft (una vereda o un pasillo que tapaban),
// sin ser parte del interior.
import { readFileSync } from 'node:fs';
import { AREA, polygonArea } from '../shared/geo.ts';
import type { Vec2 } from '../shared/geo.ts';
import type { Puerta } from '../shared/mapdata.ts';
import { checkSubFields, dec, isObj, num, oneOf, str, unknownField, validateLote } from './frentes-input.ts';
import type { FrentesInput, LoteInput, Obj } from './frentes-input.ts';
import { doorBay, lotOverlap } from './lots.ts';

/** Los lugares entrables que no tienen lote en data/frentes.json: cada uno necesita su planta. */
export const SIN_LOTE: readonly string[] = ['guernica-bar', 'cine-pixel', 'mcdonalds', 'estacion-adrogue', 'la-veneciana'];

/** De frente: el origen está sobre la línea de edificación de la vereda, a `s` m de `desde`. Geográfico: el origen es
 *  (lat, lon) y `rumbo` (grados desde el norte, en sentido horario) es la dirección de U. */
export type Marco = { calle: string; vereda: 'norte' | 'sur' | 'este' | 'oeste'; desde: string; hasta: string; s: number } | { lat: number; lon: number; rumbo: number };
/** `arista`: índice sobre `planta` tal como está escrita (de planta[arista] a planta[arista + 1]); `centro`: metros desde
 *  el vértice `arista`. `alto` desde el piso de `piso`. */
export interface PuertaInput { arista: number; centro: number; ancho: number; alto: number; piso: number }
/** `desde` y `hasta`: metros desde el vértice `arista`; `abajo` y `arriba`: alturas desde el piso de `piso`. */
export interface VidrioInput { arista: number; desde: number; hasta: number; abajo: number; arriba: number; piso: number }
/** La escalera de mano relevada (climb.ts): sobre la arista `arista` (que no es del frente), con su medio a `centro` m
 *  del vértice `arista`. Sin esto la ayuda va en una punta del frente (aidEnds). */
export interface EscaleraInput { arista: number; centro: number }
export interface PlantaInput {
  lugar: string; fecha: string; marco: Marco;
  /** Puntos (u, v) en metros: u a lo largo del frente, v hacia adentro. */
  planta: Vec2[];
  /** Patios: fuera de la planta (sin losa ni techo), dentro del recorte de Microsoft (D12). */
  patios: Vec2[][];
  /** Despejes: suelo que se le saca a los bloques de Microsoft sin ser parte del interior (una vereda tapada, el pasillo
   *  delante del cine). Solo entran al recorte: ni a los patios del interior ni a los filtros de las apariciones. */
  despejes: Vec2[][];
  /** Aristas de `planta` sobre la fachada: seguidas. */
  frente: number[];
  /** Bloques de Microsoft que se borran enteros (D8). */
  reemplaza: string[];
  /** La primera es la principal (D10). */
  puertas: PuertaInput[];
  vidrios: VidrioInput[];
  escalera?: EscaleraInput;
  lote: LoteInput;
}

const VEREDAS: readonly string[] = ['norte', 'sur', 'este', 'oeste'];
const PUERTAS: readonly Puerta[] = ['inicio', 'medio', 'fin'];
/** Los campos de aspecto, sueltos como en un lote (los valida validateLote). */
const ASPECTO = ['pisos', 'alto', 'color', 'colorPB', 'material', 'pb', 'arriba', 'puerta', 'toldo', 'cartel', 'nota'];
const PLANTA_KEYS = ['lugar', 'fecha', 'marco', 'planta', 'patios', 'despejes', 'frente', 'reemplaza', 'puertas', 'vidrios', 'escalera', ...ASPECTO];
const MARCO_FRENTE_KEYS = ['calle', 'vereda', 'desde', 'hasta', 's'];
const MARCO_GEO_KEYS = ['lat', 'lon', 'rumbo'];
const PUERTA_KEYS = ['arista', 'centro', 'ancho', 'alto', 'piso'];
const VIDRIO_KEYS = ['arista', 'desde', 'hasta', 'abajo', 'arriba', 'piso'];
const ESCALERA_KEYS = ['arista', 'centro'];
/** La escalera de mano: su ancho (el volumen de climb.ts) y lo libre que deja en cada punta de su arista (m). */
const ESCALERA_W = 0.8, ESCALERA_MARGEN = 0.1;
const RAIZ_KEYS = ['plantas'];
const ID_MICROSOFT = /^b\d+$/;
/** Lo más lejos del origen que puede ir un punto de la planta (m). */
const MAX_LOCAL = 200;
/** Lo libre que deja una puerta en cada punta de su arista (m). */
const PUERTA_MARGEN = 0.2;
/** D10: una puerta mide al menos esto de ancho y de alto (m). */
const PUERTA_MIN = { ancho: 1.0, alto: 2.2 };
const EPS = 1e-6;
/** Una arista del frente da a la calle si su normal de afuera está a 60° o menos de −V (como SIGN_FRONT_COS): una
 *  ochava a 45° todavía es frente; una de costado o la de atrás, no. */
const FRENTE_COS = 0.5;
/** Un patio puede tocar la planta en una arista, pero no pisarla: más que esto (m²) es un error del relevamiento. */
const PATIO_PISA = 0.01;
const m2 = (n: number): string => dec(Math.round(n * 100) / 100);
const len = (a: Vec2, b: Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
const edgeLen = (r: Vec2[], i: number): number => len(r[i], r[(i + 1) % r.length]);

export function loadPlantas(frentes: FrentesInput, path = 'data/plantas.json'): PlantaInput[] {
  return validatePlantas(JSON.parse(readFileSync(path, 'utf8')), path, frentes);
}

/** La corrida de las aristas `frente` (seguidas) sobre `planta`: los vértices de punta a punta, en el sentido en que crece
 *  u (de `desde` a `hasta` en un marco de frente), y por arista dónde empieza sobre la corrida y si va al revés de como
 *  está escrita. */
export interface FrontRun { points: Vec2[]; length: number; edges: { i: number; s0: number; len: number; rev: boolean }[] }
export function frontRun(planta: Vec2[], frente: number[]): FrontRun {
  const n = planta.length;
  const set = new Set(frente);
  const start = [...set].find((i) => !set.has((i + n - 1) % n))!;
  const order = Array.from({ length: set.size }, (_, k) => (start + k) % n);
  const points = [...order.map((i) => planta[i]), planta[(order[order.length - 1] + 1) % n]];
  const rev = points[points.length - 1][0] < points[0][0];
  const edges: FrontRun['edges'] = [];
  let s = 0;
  for (const i of rev ? [...order].reverse() : order) {
    edges.push({ i, s0: s, len: edgeLen(planta, i), rev });
    s += edgeLen(planta, i);
  }
  return { points: rev ? points.reverse() : points, length: s, edges };
}

const orient = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const inBox = (a: Vec2, b: Vec2, p: Vec2): boolean => Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS
  && Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS;
/** ¿Los segmentos ab y cd se tocan (se cruzan, o una punta cae sobre el otro)? */
function touch(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const [d1, d2, d3, d4] = [orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)];
  const opposite = (x: number, y: number): boolean => (x > EPS && y < -EPS) || (x < -EPS && y > EPS);
  if (opposite(d1, d2) && opposite(d3, d4)) return true;
  return (Math.abs(d1) <= EPS && inBox(a, b, c)) || (Math.abs(d2) <= EPS && inBox(a, b, d))
    || (Math.abs(d3) <= EPS && inBox(c, d, a)) || (Math.abs(d4) <= EPS && inBox(c, d, b));
}
/** El primer par de aristas de `r` que se cruzan: dos no vecinas que se tocan, o dos vecinas que se doblan una sobre la otra. */
function selfCrossing(r: Vec2[]): [number, number] | null {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [a, b, c, d] = [r[i], r[(i + 1) % n], r[j], r[(j + 1) % n]];
      if (j === i + 1 || (i === 0 && j === n - 1)) {
        const [o, p, q] = j === i + 1 ? [b, a, d] : [a, b, c]; // la punta compartida y las otras dos
        if (Math.abs(orient(o, p, q)) <= EPS && (p[0] - o[0]) * (q[0] - o[0]) + (p[1] - o[1]) * (q[1] - o[1]) > 0) return [i, j];
      } else if (touch(a, b, c, d)) return [i, j];
    }
  }
  return null;
}

function points(where: string, field: string, v: unknown): Vec2[] {
  if (!Array.isArray(v) || v.length < 3) throw new Error(`${where}: ${field} tiene que ser una lista de 3 o más puntos [u, v]`);
  return v.map((p: unknown, i): Vec2 => {
    const ok = Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= MAX_LOCAL);
    if (!ok) throw new Error(`${where}: ${field}: el punto ${i} tiene que ser [u, v], con dos números de −${MAX_LOCAL} a ${MAX_LOCAL} m (vino ${JSON.stringify(p)})`);
    return [(p as number[])[0], (p as number[])[1]];
  });
}

/** Un anillo que cierra: sin aristas de largo 0, sin cruzarse y con área. `what`: "la planta", "el patio k" o "el despeje k". */
function checkRing(where: string, what: string, r: Vec2[]): void {
  r.forEach((_, i) => {
    if (edgeLen(r, i) < 1e-3) throw new Error(`${where}: ${what} tiene la arista ${i} de largo 0 (el punto ${i} y el siguiente son iguales)`);
  });
  const x = selfCrossing(r);
  if (x) throw new Error(`${where}: ${what} se cruza: la arista ${x[0]} corta a la arista ${x[1]}`);
  if (polygonArea(r) < 1) throw new Error(`${where}: ${what} tiene menos de 1 m²`);
}

function list(where: string, field: string, v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${where}: ${field} tiene que ser una lista`);
  return v;
}

/** Primera pasada de una entrada: campos desconocidos en todos sus niveles, antes de mirar valores. */
function checkUnknownFields(where: string, e: Obj): void {
  unknownField(where, e, PLANTA_KEYS);
  if (isObj(e.marco)) {
    if ('calle' in e.marco) unknownField(`${where}: marco`, e.marco, MARCO_FRENTE_KEYS);
    else if ('lat' in e.marco) unknownField(`${where}: marco`, e.marco, MARCO_GEO_KEYS);
  }
  for (const [field, keys, name] of [['puertas', PUERTA_KEYS, 'puerta'], ['vidrios', VIDRIO_KEYS, 'vidrio']] as const) {
    const xs = e[field];
    if (Array.isArray(xs)) xs.forEach((x: unknown, k) => { if (isObj(x)) unknownField(`${where}, ${name} ${k + 1}`, x, keys); });
  }
  if (isObj(e.escalera)) unknownField(`${where}: escalera`, e.escalera, ESCALERA_KEYS);
  checkSubFields(where, e);
}

function validateMarco(where: string, m: unknown): Marco {
  const mw = `${where}: marco`;
  if (isObj(m) && 'calle' in m) {
    const calle = str(mw, 'calle', m.calle);
    const vereda = oneOf(mw, 'vereda', m.vereda, VEREDAS) as 'norte' | 'sur' | 'este' | 'oeste';
    const desde = str(mw, 'desde', m.desde), hasta = str(mw, 'hasta', m.hasta);
    if (desde === hasta) throw new Error(`${mw}: desde y hasta tienen que ser distintos`);
    return { calle, vereda, desde, hasta, s: num(mw, 's', m.s, 0, 2000) };
  }
  if (isObj(m) && 'lat' in m) {
    return { lat: num(mw, 'lat', m.lat, AREA.south, AREA.north), lon: num(mw, 'lon', m.lon, AREA.west, AREA.east), rumbo: num(mw, 'rumbo', m.rumbo, 0, 360) };
  }
  throw new Error(`${where}: marco tiene que ser { calle, vereda, desde, hasta, s } o { lat, lon, rumbo }`);
}

function validateFrente(where: string, v: unknown, n: number): number[] {
  const bad = (): Error => new Error(`${where}: frente tiene que ser aristas seguidas de la planta, de 0 a ${n - 1} (vino ${JSON.stringify(v)})`);
  if (!Array.isArray(v) || v.length === 0 || v.length >= n) throw bad();
  if (v.some((i) => typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= n) || new Set(v).size !== v.length) throw bad();
  const set = new Set(v as number[]);
  // seguidas: una sola arista de la lista no tiene a la anterior en la lista (la punta de inicio)
  if ((v as number[]).filter((i) => !set.has((i + n - 1) % n)).length !== 1) throw bad();
  return v as number[];
}

function validatePlanta(e: Obj, where: string, frentes: FrentesInput, seen: Set<string>): PlantaInput {
  const lugar = oneOf(where, 'lugar', e.lugar, SIN_LOTE);
  if (seen.has(lugar)) throw new Error(`${where}: está dos veces`);
  seen.add(lugar);
  for (const f of frentes.frentes) {
    f.lotes.forEach((l, k) => {
      if (l.lugar === lugar) throw new Error(`${where}: el lugar ya tiene lote (frente ${f.id}, lote ${k + 1}); va en uno solo de los dos archivos`);
    });
  }
  if (typeof e.fecha !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(e.fecha)) throw new Error(`${where}: fecha tiene que ser AAAA-MM (vino "${String(e.fecha)}")`);
  const marco = validateMarco(where, e.marco);

  const planta = points(where, 'planta', e.planta);
  checkRing(where, 'la planta', planta);
  const patios = list(where, 'patios', e.patios ?? []).map((r, k) => {
    const ring = points(where, `patio ${k + 1}`, r);
    checkRing(where, `el patio ${k + 1}`, ring);
    return ring;
  });
  const despejes = list(where, 'despejes', e.despejes ?? []).map((r, k) => {
    const ring = points(where, `el despeje ${k + 1}`, r);
    checkRing(where, `el despeje ${k + 1}`, ring);
    return ring;
  });
  const n = planta.length;
  const frente = validateFrente(where, e.frente, n);
  // en el marco local V entra al edificio desde la vereda: cada arista del frente tiene que mirar a −V
  const ccw = planta.reduce((a, p, i) => a + p[0] * planta[(i + 1) % n][1] - planta[(i + 1) % n][0] * p[1], 0) > 0;
  for (const i of frente) {
    const [a, b] = [planta[i], planta[(i + 1) % n]];
    const l = len(a, b);
    const out: Vec2 = ccw ? [(b[1] - a[1]) / l, -(b[0] - a[0]) / l] : [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    if (out[1] > -FRENTE_COS) throw new Error(`${where}: la arista ${i} del frente no mira a la calle (−V): su normal de afuera es (${m2(out[0])}; ${m2(out[1])})`);
  }
  // D12: el patio es suelo sin losa ni techo, afuera de la planta
  patios.forEach((r, k) => {
    const pisa = lotOverlap(planta, r).area;
    if (pisa > PATIO_PISA) throw new Error(`${where}: el patio ${k + 1} pisa la planta (${dec(Math.round(pisa * 10) / 10)} m²); va afuera, pegado a ella`);
  });
  const run = frontRun(planta, frente);
  if (run.length > 60) throw new Error(`${where}: el frente mide ${m2(run.length)} m y no puede pasar de 60`);
  const vs = planta.map((p) => p[1]);
  const fondo = Math.max(...vs) - Math.min(...vs);
  if (fondo < 3 || fondo > 60) throw new Error(`${where}: la planta tiene ${m2(fondo)} m de fondo (en v) y tiene que tener de 3 a 60`);

  // el aspecto, como el de un lote: ancho es el largo del frente, fondo la profundidad de la planta
  const pisos = num(where, 'pisos', e.pisos, 1, 20, { int: true });
  const aspecto: Obj = Object.fromEntries(ASPECTO.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));
  const lote = validateLote({ ...aspecto, ancho: run.length, fondo, lugar }, where, {}, SIN_LOTE);

  const reemplaza = list(where, 'reemplaza', e.reemplaza ?? []);
  if (reemplaza.some((id) => typeof id !== 'string' || !ID_MICROSOFT.test(id))) {
    throw new Error(`${where}: reemplaza tiene que ser una lista de ids de edificios de Microsoft, como "b0714" (vino ${JSON.stringify(reemplaza)})`);
  }

  const puertas = list(where, 'puertas', e.puertas).map((p, k): PuertaInput => {
    const pw = `${where}, puerta ${k + 1}`;
    if (!isObj(p)) throw new Error(`${pw}: tiene que ser un objeto`);
    const arista = num(pw, 'arista', p.arista, 0, n - 1, { int: true });
    const centro = num(pw, 'centro', p.centro, 0, MAX_LOCAL);
    const ancho = num(pw, 'ancho', p.ancho, PUERTA_MIN.ancho, 20);
    const alto = num(pw, 'alto', p.alto, PUERTA_MIN.alto, 10);
    const piso = num(pw, 'piso', p.piso, 0, pisos - 1, { int: true });
    const [a, b, l] = [centro - ancho / 2, centro + ancho / 2, edgeLen(planta, arista)];
    if (a < PUERTA_MARGEN - EPS || b > l - PUERTA_MARGEN + EPS) {
      throw new Error(`${pw}: no entra en la arista ${arista}: va de ${m2(a)} a ${m2(b)} m y la arista mide ${m2(l)} m, con ${dec(PUERTA_MARGEN)} m libres en cada punta`);
    }
    return { arista, centro, ancho, alto, piso };
  });
  if (!puertas.some((p) => p.piso === 0)) throw new Error(`${where}: ninguna puerta tiene piso 0 (hace falta una para entrar desde la calle)`);
  if (puertas[0].piso !== 0) throw new Error(`${where}, puerta 1: la primera es la principal y tiene que tener piso 0`);

  const vidrios = list(where, 'vidrios', e.vidrios ?? []).map((v, k): VidrioInput => {
    const vw = `${where}, vidrio ${k + 1}`;
    if (!isObj(v)) throw new Error(`${vw}: tiene que ser un objeto`);
    const arista = num(vw, 'arista', v.arista, 0, n - 1, { int: true });
    const desde = num(vw, 'desde', v.desde, 0, MAX_LOCAL), hasta = num(vw, 'hasta', v.hasta, 0, MAX_LOCAL);
    const abajo = num(vw, 'abajo', v.abajo, 0, 20), arriba = num(vw, 'arriba', v.arriba, 0, 20);
    const piso = num(vw, 'piso', v.piso, 0, pisos - 1, { int: true });
    if (hasta <= desde + EPS) throw new Error(`${vw}: hasta tiene que ser mayor que desde`);
    if (arriba <= abajo + EPS) throw new Error(`${vw}: arriba tiene que ser mayor que abajo`);
    const l = edgeLen(planta, arista);
    if (hasta > l + EPS) throw new Error(`${vw}: no entra en la arista ${arista}: va de ${m2(desde)} a ${m2(hasta)} m y la arista mide ${m2(l)} m`);
    // se pisan si comparten un pedazo de pared: a lo largo de la arista y en altura (un vidrio arriba de la puerta, no)
    const j = puertas.findIndex((p) => p.arista === arista && p.piso === piso
      && Math.min(hasta, p.centro + p.ancho / 2) - Math.max(desde, p.centro - p.ancho / 2) > EPS && Math.min(arriba, p.alto) - abajo > EPS);
    if (j >= 0) throw new Error(`${vw}: se pisa con la puerta ${j + 1} (misma arista y piso)`);
    return { arista, desde, hasta, abajo, arriba, piso };
  });

  let escalera: EscaleraInput | undefined;
  if (e.escalera !== undefined) {
    const x = e.escalera, ew = `${where}: escalera`;
    if (!isObj(x)) throw new Error(`${where}: escalera tiene que ser { arista, centro }`);
    const arista = num(ew, 'arista', x.arista, 0, n - 1, { int: true });
    const centro = num(ew, 'centro', x.centro, 0, MAX_LOCAL);
    if (frente.includes(arista)) {
      throw new Error(`${where}: la escalera va en la arista ${arista}, que es del frente: ahí la ayuda va sola en una punta; escalera es para una cara sin frente`);
    }
    const [a, b, l] = [centro - ESCALERA_W / 2, centro + ESCALERA_W / 2, edgeLen(planta, arista)];
    if (a < ESCALERA_MARGEN - EPS || b > l - ESCALERA_MARGEN + EPS) {
      throw new Error(`${where}: la escalera no entra en la arista ${arista}: va de ${m2(a)} a ${m2(b)} m y la arista mide ${m2(l)} m, con ${dec(ESCALERA_MARGEN)} m libres en cada punta`);
    }
    const j = puertas.findIndex((p) => p.arista === arista && Math.min(b, p.centro + p.ancho / 2) - Math.max(a, p.centro - p.ancho / 2) > EPS);
    if (j >= 0) throw new Error(`${where}: la escalera se pisa con la puerta ${j + 1} (misma arista)`);
    escalera = { arista, centro };
  }

  // "puerta" es la bahía donde el atlas pinta la puerta: tiene que ser la de la puerta principal, si está en el frente
  const main = puertas[0];
  const edge = run.edges.find((x) => x.i === main.arista);
  if (edge) {
    const s = edge.s0 + (edge.rev ? edge.len - main.centro : main.centro);
    const { n: bays, bay: drawn } = doorBay(run.length, lote.puerta);
    const real = Math.min(bays - 1, Math.floor(s / (run.length / bays)));
    if (drawn !== real) {
      const fits = PUERTAS.find((p) => doorBay(run.length, p).bay === real);
      throw new Error(`${where}: puerta "${lote.puerta}" pinta la puerta en la bahía ${drawn + 1} de ${bays}, pero la puerta está en la bahía ${real + 1} de ${bays}; `
        + (fits ? `usá "${fits}"` : 'ninguna de inicio, medio y fin cae ahí: corré la puerta'));
    }
  }
  return { lugar, fecha: e.fecha, marco, planta, patios, despejes, frente, reemplaza: reemplaza as string[], puertas, vidrios, ...(escalera ? { escalera } : {}), lote };
}

/** Valida data/plantas.json (`source`: de dónde vino, para el mensaje) contra los lotes de `frentes`, completa los valores
 *  por defecto y lo devuelve tipado. */
export function validatePlantas(data: unknown, source: string, frentes: FrentesInput): PlantaInput[] {
  if (!isObj(data)) throw new Error(`${source}: se esperaba un objeto con "plantas"`);
  unknownField(source, data, RAIZ_KEYS);
  const entries = list(source, 'plantas', data.plantas);
  const where = (e: Obj, i: number): string => `${source}: ${typeof e.lugar === 'string' && e.lugar.trim() ? `planta de ${e.lugar}` : `planta ${i + 1}`}`;
  entries.forEach((e, i) => {
    if (!isObj(e)) throw new Error(`${source}: planta ${i + 1}: tiene que ser un objeto`);
    checkUnknownFields(where(e, i), e);
  });
  const seen = new Set<string>();
  return (entries as Obj[]).map((e, i) => validatePlanta(e, where(e, i), frentes, seen));
}
