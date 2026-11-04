// Los colores de los bancos (tarea 6) como se ven adentro, con la curva de aces.ts (la de three a INDOOR_EXPOSURE):
// - los letreros de cada marca se ven del color de la marca, con la letra blanca (H1 de la revisión);
// - todo lo que brilla (la franja de las cajas y sus números, los letreros, el cartel de los cajeros, los paneles, el
//   cajero automático y el turnero) se ve como tiene que verse (H2). Lo que brilla va sin hornear: su color está
//   calibrado para la exposición de adentro, así que si la cambia la tarea que la calibre, esto falla y dice qué
//   recalibrar.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { TONE_MAPPING } from '../../src/client/render/scene.ts';
import { lightAt } from '../../src/client/world/interiors/bake.ts';
import { INTERIOR_EXPOSURE } from '../../src/client/world/interiors/build.ts';
import { ITEM_GLOW, ITEM_MODELS } from '../../src/client/world/interiors/models.ts';
import { interiorOf } from '../../src/shared/interiors/index.ts';
import type { Interior, Label, Look } from '../../src/shared/interiors/types.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { ACES, deltaE, hexRGB, seen } from './aces.ts';
import type { RGB } from './aces.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
/** Lo más lejos que puede quedar un color de lo que tiene que verse. */
const MAX_DE = 8;
const BLANCO = '#ffffff';
const fmt = (c: RGB): string => `(${c.join(', ')})`;

describe('la curva de los tests (aces.ts)', () => {
  test('es la de three: el tone mapping del renderer es ACESFilmic y sus constantes son las del shader', () => {
    expect(TONE_MAPPING).toBe(THREE.ACESFilmicToneMapping);
    const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
    const [a, b, c, d, e] = ACES.fit;
    expect(chunk).toContain(`v * ( v + ${a} ) - ${b}`);
    expect(chunk).toContain(`v * ( ${c} * v + ${d} ) + ${e}`);
    expect(chunk).toContain('color *= toneMappingExposure / 0.6;');
    const numbers = (name: string): number[] => (chunk.match(new RegExp(`${name} = mat3\\(([^;]*)\\);`))![1].match(/-?\d+\.\d+/g) ?? []).map(Number);
    expect(numbers('ACESInputMat')).toEqual(ACES.input.flat());
    expect(numbers('ACESOutputMat')).toEqual(ACES.output.flat());
  });

  test('da lo medido en las capturas de la tarea 6: la pantalla del cajero (#3d76a8) y la franja del Galicia (#883010)', () => {
    expect(seen('#3d76a8')).toEqual([143, 198, 228]);
    expect(seen('#883010')).toEqual([225, 88, 33]);
  });
});

/** Lo que se ve de un color de un cartel: pleno si brilla; si no, horneado con la luz del lugar donde está. */
function labelSeen(i: Interior, l: Label, color: string): RGB {
  return l.glow ? seen(color) : seen(color, lightAt(i, l.at, [l.normal[0], 0, l.normal[1]]) * INTERIOR_EXPOSURE);
}

describe.each([
  { id: 'banco-nacion', marca: 'BANCO NACIÓN', fondo: '#005ba4', marco: '#59b7e6' },
  { id: 'galicia', marca: 'Galicia', fondo: '#e1561f', marco: undefined },
  { id: 'bbva', marca: 'BBVA', fondo: '#1e44a8', marco: undefined },
])('$id', ({ id, marca, fondo, marco }) => {
  test(`el letrero "${marca}" se ve del color de la marca (ΔE ≤ ${MAX_DE}): fondo ${fondo}, letra blanca${marco ? `, borde ${marco}` : ''}`, () => {
    const i = interiorOf(map, id);
    const brand = i.labels.filter((l) => l.text === marca);
    expect(brand.length, id).toBeGreaterThan(0);
    for (const l of brand) {
      const want: [string, string | undefined][] = [[l.look.fondo, fondo], [l.look.letra, BLANCO], [l.look.marco, marco]];
      for (const [color, target] of want) {
        if (!target) continue;
        const got = labelSeen(i, l, color);
        expect(deltaE(got, hexRGB(target)), `${id}: ${color} se ve ${fmt(got)}, y la marca es ${target}`).toBeLessThanOrEqual(MAX_DE);
      }
    }
  });
});

/**
 * Cada color que brilla en los bancos y lo que tiene que verse. Los de la marca se comparan con la marca; los del
 * cajero automático y el turnero, que imitan lo horneado (ITEM_GLOW va sin hornear para que la pantalla brille), con
 * su material real horneado a la luz del salón cerca de un panel (0,9).
 */
const horneado = (real: string, luz = 0.9): RGB => seen(real, luz * INTERIOR_EXPOSURE);
const QUE_SE_VE: { que: string; brilla: string; ve: RGB }[] = [
  { que: 'el naranja del Galicia (franja, números, letreros)', brilla: '#883010', ve: hexRGB('#e1561f') },
  { que: 'el azul del Nación', brilla: '#003860', ve: hexRGB('#005ba4') },
  { que: 'el celeste del Nación', brilla: '#1068ac', ve: hexRGB('#59b7e6') },
  { que: 'el azul del BBVA', brilla: '#1c2c60', ve: hexRGB('#1e44a8') },
  { que: 'la letra blanca de lo iluminado', brilla: '#e8e8e8', ve: hexRGB(BLANCO) },
  { que: 'el panel de luz del salón', brilla: '#dcdedc', ve: hexRGB(BLANCO) },
  { que: 'el panel de luz fría del vestíbulo', brilla: '#d2deec', ve: hexRGB('#f2f4f8') },
  { que: 'el fondo negro del turnero', brilla: '#070707', ve: hexRGB('#000000') },
  { que: 'el número del turnero, LED rojo', brilla: '#aa1503', ve: hexRGB('#ff3b1c') },
  { que: 'la pantalla encendida del cajero automático', brilla: '#3d76a8', ve: hexRGB('#8fc6e4') },
  { que: 'el gabinete del cajero: aluminio', brilla: '#3a3e44', ve: horneado('#9aa0a6') },
  { que: 'el frente del cajero: plástico gris oscuro', brilla: '#1d1f23', ve: horneado('#50555c') },
  { que: 'el teclado del cajero: acero claro', brilla: '#55595f', ve: horneado('#d0d4d8') },
  { que: 'las ranuras del cajero: negro', brilla: '#0a0b0c', ve: horneado('#2a2c30') },
  { que: 'la caja del turnero: acero oscuro', brilla: '#121316', ve: horneado('#3a3c40') },
  { que: 'la pantalla apagada del turnero', brilla: '#050506', ve: horneado('#1b1c1f') },
  { que: 'las varillas del turnero', brilla: '#2c2e32', ve: horneado('#777b82') },
];

/** Los colores que brillan en un interior: los carteles `glow`, los bloques de in_luz y los muebles de ITEM_GLOW. */
function glowing(i: Interior): Set<string> {
  const out = new Set<string>();
  for (const l of i.labels.filter((x) => x.glow)) for (const c of [l.look.fondo, l.look.letra, l.look.marco]) out.add(c.toLowerCase());
  for (const b of i.blocks) for (const look of [b.side, b.top, b.bottom] as (Look | undefined)[]) if (look?.mat === 'luz') out.add(look.color.toLowerCase());
  for (const m of new Set(i.items.filter((it) => ITEM_GLOW[it.model]).map((it) => it.model))) {
    const col = ITEM_MODELS[m]().getAttribute('color');
    for (let k = 0; k < col.count; k++) out.add(`#${new THREE.Color().setRGB(col.getX(k), col.getY(k), col.getZ(k), THREE.LinearSRGBColorSpace).getHexString()}`);
  }
  return out;
}

describe('todo lo que brilla en los bancos', () => {
  test('cada color que brilla está en la tabla de lo que tiene que verse', () => {
    const known = new Set(QUE_SE_VE.map((x) => x.brilla));
    for (const id of ['banco-nacion', 'galicia', 'bbva']) {
      const missing = [...glowing(interiorOf(map, id))].filter((c) => !known.has(c));
      expect(missing, `${id}: brillan sin objetivo`).toEqual([]);
    }
  });

  test.each(QUE_SE_VE)(`$que ($brilla) se ve a ΔE ≤ ${MAX_DE} de lo que tiene que verse`, ({ brilla, ve }) => {
    const got = seen(brilla);
    expect(deltaE(got, ve), `${brilla} se ve ${fmt(got)} y tiene que verse ${fmt(ve)}`).toBeLessThanOrEqual(MAX_DE);
  });
});
