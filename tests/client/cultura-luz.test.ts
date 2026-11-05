// Lo que se ve del ventanal de la Casa de la Cultura (H2): el frente de los pisos 1 y 2 es un vidrio a la calle, y desde
// los balcones se tiene que leer como luz de día por un vidrio con reflejo, no como un cartel ni como una lámpara. Va en
// in_luz (sin hornear), así que se ve su color pleno a la exposición de adentro (aces.ts).
import { readFileSync } from 'node:fs';
import { INTERIOR_EXPOSURE } from '../../src/client/world/interiors/build.ts';
import { interiorOf } from '../../src/shared/interiors/index.ts';
import type { MapData } from '../../src/shared/mapdata.ts';
import { seen } from './aces.ts';
import type { RGB } from './aces.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const i = interiorOf(map, 'casa-de-la-cultura');
const H = map.buildings.find((b) => b.id === i.buildingId)!.height;
const luma = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('el ventanal se ve como luz de día por un vidrio: más claro que la pared más iluminada, más oscuro que un panel de luz, y azulado', () => {
  // el vidrio del ventanal: los paños de luz verticales de los pisos de abajo del techo (no los de la estructura del lucernario)
  const colors = new Set(i.panes.filter((p) => p.look.mat === 'luz' && Math.abs(p.normal[1]) < 0.1 && p.corners.every((q) => q[1] < H - 1)).map((p) => p.look.color));
  expect(colors.size).toBeGreaterThanOrEqual(1);
  // la pared blanca a luz plena (1) y los paneles de luz del cielorraso (los bloques de in_luz que miran para abajo)
  const pared = seen('#f1eee7', 1 * INTERIOR_EXPOSURE);
  const paneles = [...new Set(i.blocks.filter((b) => b.bottom?.mat === 'luz').map((b) => b.bottom!.color))].map((c) => seen(c));
  expect(paneles.length).toBeGreaterThan(0);
  for (const c of colors) {
    const v = seen(c), say = `${c} se ve (${v.join(', ')})`;
    expect(luma(v), `${say}: más claro que la pared a luz plena (${pared.join(', ')})`).toBeGreaterThanOrEqual(luma(pared) + 20);
    for (const p of paneles) expect(luma(v), `${say}: más oscuro que un panel de luz (${p.join(', ')})`).toBeLessThanOrEqual(luma(p) - 10);
    expect(v[2] - v[0], `${say}: azulado, el cielo`).toBeGreaterThanOrEqual(10);
    expect(Math.max(...v) - Math.min(...v), `${say}: casi sin color, no un cartel`).toBeLessThanOrEqual(40);
  }
});
