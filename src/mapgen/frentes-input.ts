import { readFileSync } from 'node:fs';
import type { Arriba, Fuente, PlantaBaja, Puerta } from '../shared/mapdata.ts';
import { loadPlaces } from './places-input.ts';

export interface CartelInput {
  texto: string; fondo: string; letra: string; marco?: string; fuente: Fuente; cursiva: boolean;
  posicion: 'frente' | 'alto' | 'bandera'; ancho?: number;
}
export interface LoteInput {
  ancho: number; pisos: number; fondo: number; retiro: number; color: string; colorPB?: string;
  pb: PlantaBaja; arriba: Arriba; material: 'revoque' | 'ladrillo'; puerta: Puerta;
  toldo?: { color: string; rayas: boolean }; cartel?: CartelInput; lugar?: string; osm?: string; nota?: string;
}
export interface FrenteInput {
  id: string; calle: string; desde: string; hasta: string; vereda: 'norte' | 'sur' | 'este' | 'oeste';
  fecha: string; osmAusentes: string[]; lotes: LoteInput[];
}
export interface FrentesInput { frentes: FrenteInput[]; calzadas: Record<string, 'empedrado' | 'asfalto'> }

const PB: readonly string[] = ['vidriera', 'persiana', 'porton', 'puerta', 'banco', 'acceso', 'pared'];
const ARRIBA: readonly string[] = ['ventanas', 'balcones', 'vidriado', 'ciego'];
const FUENTES: readonly string[] = ['sans', 'serif', 'condensada', 'redondeada'];
const PUERTAS: readonly string[] = ['inicio', 'medio', 'fin'];
const MATERIALES: readonly string[] = ['revoque', 'ladrillo'];
const POSICIONES: readonly string[] = ['frente', 'alto', 'bandera'];
const VEREDAS: readonly string[] = ['norte', 'sur', 'este', 'oeste'];
const CALZADAS: readonly string[] = ['empedrado', 'asfalto'];

const LOTE_KEYS = ['ancho', 'pisos', 'fondo', 'retiro', 'color', 'colorPB', 'pb', 'arriba', 'material', 'puerta', 'toldo', 'cartel', 'lugar', 'osm', 'nota', 'usa'];
/** Un estilo no lleva ancho (es de cada lote), usa (no se encadenan) ni lugar (cada lugar va en un solo lote). */
const NO_ESTILO = ['ancho', 'usa', 'lugar'];
const ESTILO_KEYS = LOTE_KEYS.filter((k) => !NO_ESTILO.includes(k));
const CARTEL_KEYS = ['texto', 'fondo', 'letra', 'marco', 'fuente', 'cursiva', 'posicion', 'ancho'];
const TOLDO_KEYS = ['color', 'rayas'];
const FRENTE_KEYS = ['id', 'desde', 'hasta', 'vereda', 'fecha', 'osmAusentes', 'lotes'];
const CALLE_KEYS = ['calle', 'calzada', 'frentes'];
const RAIZ_KEYS = ['estilos', 'calles'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const COLOR = /^#[0-9a-fA-F]{6}$/;
/** Ids de frente: van a los ids de los edificios (`<id>-k`) y a una RegExp de los tests e2e. */
const ID = /^[a-z0-9-]+$/;
/** Como los edificios de Microsoft (b0837): sus pedazos recortados se llaman b0837-2, como el lote 2 de un frente así. */
const ID_MICROSOFT = /^b\d+$/;
const dec = (n: number): string => String(n).replace('.', ',');

export function loadFrentes(path = 'data/frentes.json', placeIds: readonly string[] = loadPlaces().map((p) => p.id)): FrentesInput {
  return validateFrentes(JSON.parse(readFileSync(path, 'utf8')), path, placeIds);
}

function unknownField(where: string, o: Obj, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new Error(`${where}: campo desconocido "${k}" (van ${allowed.join(', ')})`);
  }
}

/** Primera pasada: campos desconocidos en todos los niveles, antes de mirar valores. */
function checkUnknownFields(data: Obj, source: string): void {
  unknownField(source, data, RAIZ_KEYS);
  if (data.estilos !== undefined) {
    if (!isObj(data.estilos)) throw new Error(`${source}: estilos tiene que ser un objeto`);
    for (const [name, e] of Object.entries(data.estilos)) {
      if (!isObj(e)) throw new Error(`${source}: estilo "${name}" tiene que ser un objeto`);
      for (const k of NO_ESTILO) if (k in e) throw new Error(`${source}: estilo "${name}": un estilo no puede tener ${k}`);
      unknownField(`${source}: estilo "${name}"`, e, ESTILO_KEYS);
      checkSubFields(`${source}: estilo "${name}"`, e);
    }
  }
  if (!Array.isArray(data.calles)) throw new Error(`${source}: calles tiene que ser una lista`);
  for (const c of data.calles) {
    if (!isObj(c)) throw new Error(`${source}: cada calle tiene que ser un objeto`);
    unknownField(`${source}: calle ${String(c.calle ?? '?')}`, c, CALLE_KEYS);
    if (!Array.isArray(c.frentes)) throw new Error(`${source}: calle ${String(c.calle ?? '?')}: frentes tiene que ser una lista`);
    for (const f of c.frentes) {
      if (!isObj(f)) throw new Error(`${source}: calle ${String(c.calle ?? '?')}: cada frente tiene que ser un objeto`);
      const fw = `${source}: frente ${String(f.id ?? '?')}`;
      unknownField(fw, f, FRENTE_KEYS);
      if (!Array.isArray(f.lotes)) continue;
      f.lotes.forEach((l: unknown, i: number) => {
        if (!isObj(l)) throw new Error(`${fw}, lote ${i + 1}: tiene que ser un objeto`);
        unknownField(`${fw}, lote ${i + 1}`, l, LOTE_KEYS);
        checkSubFields(`${fw}, lote ${i + 1}`, l);
      });
    }
  }
}

function checkSubFields(where: string, l: Obj): void {
  if (isObj(l.cartel)) unknownField(`${where}: cartel`, l.cartel, CARTEL_KEYS);
  if (isObj(l.toldo)) unknownField(`${where}: toldo`, l.toldo, TOLDO_KEYS);
}

function oneOf(where: string, field: string, v: unknown, list: readonly string[]): string {
  if (typeof v !== 'string' || !list.includes(v)) throw new Error(`${where}: ${field} tiene que ser uno de ${list.join(', ')} (vino "${String(v)}")`);
  return v;
}
function color(where: string, field: string, v: unknown): string {
  if (typeof v !== 'string' || !COLOR.test(v)) throw new Error(`${where}: ${field} tiene que ser #rrggbb (vino "${String(v)}")`);
  return v;
}
function num(where: string, field: string, v: unknown, min: number, max: number, opts: { int?: boolean; excludeMin?: boolean } = {}): number {
  const ok = typeof v === 'number' && Number.isFinite(v) && (opts.excludeMin ? v > min : v >= min) && v <= max && (!opts.int || Number.isInteger(v));
  if (!ok) {
    throw new Error(`${where}: ${field} tiene que ser ${opts.int ? 'un entero' : 'un número'} entre ${dec(min)}${opts.excludeMin ? ' (sin incluirlo)' : ''} y ${dec(max)} (vino ${JSON.stringify(v)})`);
  }
  return v as number;
}
function str(where: string, field: string, v: unknown, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${where}: ${field} tiene que ser un texto de 1 a ${max} caracteres`);
  return v;
}

function validateLote(raw: Obj, where: string, estilos: Obj, placeIds: readonly string[]): LoteInput {
  let merged: Obj = raw;
  if (raw.usa !== undefined) {
    if (typeof raw.usa !== 'string' || !isObj(estilos[raw.usa])) throw new Error(`${where}: no existe el estilo "${String(raw.usa)}"`);
    merged = { ...(estilos[raw.usa] as Obj), ...raw };
  }
  const pisos = num(where, 'pisos', merged.pisos, 0, 20, { int: true });
  const lote: LoteInput = {
    ancho: num(where, 'ancho', merged.ancho, 0, 60, { excludeMin: true }),
    pisos,
    fondo: num(where, 'fondo', merged.fondo ?? 15, 3, 60),
    retiro: num(where, 'retiro', merged.retiro ?? 0, 0, 60),
    color: '',
    pb: oneOf(where, 'pb', merged.pb ?? 'vidriera', PB) as PlantaBaja,
    arriba: oneOf(where, 'arriba', merged.arriba ?? 'ventanas', ARRIBA) as Arriba,
    material: oneOf(where, 'material', merged.material ?? 'revoque', MATERIALES) as LoteInput['material'],
    puerta: oneOf(where, 'puerta', merged.puerta ?? 'inicio', PUERTAS) as Puerta,
  };
  if (lote.retiro + lote.fondo > 80) throw new Error(`${where}: retiro + fondo no puede pasar de 80 (vino ${lote.retiro + lote.fondo})`);
  if (pisos > 0 && merged.color === undefined) throw new Error(`${where}: falta color (obligatorio si pisos es mayor que 0)`);
  if (merged.color !== undefined) lote.color = color(where, 'color', merged.color);
  if (merged.colorPB !== undefined) lote.colorPB = color(where, 'colorPB', merged.colorPB);
  for (const k of ['osm', 'nota'] as const) if (merged[k] !== undefined) lote[k] = str(where, k, merged[k]);

  if (merged.toldo !== undefined) {
    if (!isObj(merged.toldo)) throw new Error(`${where}: toldo tiene que ser un objeto como { "color": "#2e6b3a", "rayas": true }`);
    if (pisos === 0) throw new Error(`${where}: un lote sin edificio (pisos 0) no lleva toldo`);
    lote.toldo = { color: color(where, 'toldo.color', merged.toldo.color), rayas: merged.toldo.rayas === true };
    if (merged.toldo.rayas !== undefined && typeof merged.toldo.rayas !== 'boolean') throw new Error(`${where}: toldo.rayas tiene que ser true o false`);
  }
  if (merged.cartel !== undefined) {
    const c = merged.cartel;
    if (!isObj(c)) throw new Error(`${where}: cartel tiene que ser un objeto`);
    if (pisos === 0) throw new Error(`${where}: un lote sin edificio (pisos 0) no lleva cartel`);
    const cartel: CartelInput = {
      texto: str(where, 'cartel.texto', c.texto, 40),
      fondo: color(where, 'cartel.fondo', c.fondo),
      letra: color(where, 'cartel.letra', c.letra),
      fuente: oneOf(where, 'cartel.fuente', c.fuente ?? 'sans', FUENTES) as Fuente,
      cursiva: c.cursiva === true,
      posicion: oneOf(where, 'cartel.posicion', c.posicion ?? 'frente', POSICIONES) as CartelInput['posicion'],
    };
    if (c.cursiva !== undefined && typeof c.cursiva !== 'boolean') throw new Error(`${where}: cartel.cursiva tiene que ser true o false`);
    if (c.marco !== undefined) cartel.marco = color(where, 'cartel.marco', c.marco);
    if (c.ancho !== undefined) cartel.ancho = num(where, 'cartel.ancho', c.ancho, 0.5, 20);
    lote.cartel = cartel;
  }
  if (merged.lugar !== undefined) {
    if (typeof merged.lugar !== 'string' || !placeIds.includes(merged.lugar)) throw new Error(`${where}: no existe el lugar "${String(merged.lugar)}"`);
    if (!lote.cartel) throw new Error(`${where}: un lote con lugar necesita cartel (el punto de aparición sale del cartel)`);
    lote.lugar = merged.lugar;
  }
  return lote;
}

/** Valida data/frentes.json (`source`: de dónde vino, para el mensaje), completa los valores por defecto y lo devuelve tipado. */
export function validateFrentes(data: unknown, source: string, placeIds: readonly string[]): FrentesInput {
  if (!isObj(data)) throw new Error(`${source}: se esperaba un objeto con "estilos" y "calles"`);
  checkUnknownFields(data, source);
  const estilos = (data.estilos ?? {}) as Obj;
  // cada estilo, solo y una vez (aunque ningún lote lo use): así el error nombra el estilo y no el primer lote que lo usa.
  // Lo que un estilo puede no traer porque lo pone cada lote (ancho, pisos, color) va con un valor cualquiera válido.
  for (const [name, e] of Object.entries(estilos)) validateLote({ ancho: 1, pisos: 1, color: '#000000', ...(e as Obj) }, `${source}: estilo "${name}"`, {}, placeIds);
  const out: FrentesInput = { frentes: [], calzadas: {} };
  const ids = new Set<string>();
  const lugares = new Map<string, string>();
  for (const c of data.calles as Obj[]) {
    const calle = str(source, 'calle', c.calle);
    if (c.calzada !== undefined) out.calzadas[calle] = oneOf(`${source}: calle ${calle}`, 'calzada', c.calzada, CALZADAS) as 'empedrado' | 'asfalto';
    for (const f of c.frentes as Obj[]) {
      const id = str(source, 'id del frente', f.id);
      const fw = `${source}: frente ${id}`;
      if (!ID.test(id)) throw new Error(`${fw}: id tiene que tener solo minúsculas sin acento, números y guiones (vino "${id}")`);
      if (ID_MICROSOFT.test(id)) throw new Error(`${fw}: id no puede ser una b y un número, como los edificios de Microsoft`);
      if (ids.has(id)) throw new Error(`${fw}: id repetido`);
      ids.add(id);
      const desde = str(fw, 'desde', f.desde), hasta = str(fw, 'hasta', f.hasta);
      if (desde === hasta) throw new Error(`${fw}: desde y hasta tienen que ser distintos`);
      if (typeof f.fecha !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(f.fecha)) throw new Error(`${fw}: fecha tiene que ser AAAA-MM (vino "${String(f.fecha)}")`);
      const osmAusentes = f.osmAusentes ?? [];
      if (!Array.isArray(osmAusentes) || osmAusentes.some((s) => typeof s !== 'string')) throw new Error(`${fw}: osmAusentes tiene que ser una lista de textos`);
      if (!Array.isArray(f.lotes) || f.lotes.length === 0) throw new Error(`${fw}: lotes no puede estar vacío`);
      const lotes = (f.lotes as Obj[]).map((l, i) => {
        const lote = validateLote(l, `${fw}, lote ${i + 1}`, estilos, placeIds);
        if (lote.lugar !== undefined) {
          const antes = lugares.get(lote.lugar);
          if (antes) throw new Error(`${fw}, lote ${i + 1}: el lugar "${lote.lugar}" ya está en el ${antes}`);
          lugares.set(lote.lugar, `frente ${id}, lote ${i + 1}`);
        }
        return lote;
      });
      out.frentes.push({ id, calle, desde, hasta, vereda: oneOf(fw, 'vereda', f.vereda, VEREDAS) as FrenteInput['vereda'], fecha: f.fecha, osmAusentes: osmAusentes as string[], lotes });
    }
  }
  return out;
}
