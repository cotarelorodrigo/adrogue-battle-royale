// Recorrido de capturas por lo que hace reconocible a Adrogué, para compararlas a ojo contra la vista satelital.
// Solo valida que no haya errores y que las capturas existan (test-results/ no se versiona).
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Vec2, Vec3 } from '../src/shared/geo.ts';
import type { Prop } from '../src/shared/mapdata.ts';
import { collectErrors, frames, map, open, play } from './helpers.ts';

const DIR = 'test-results/tour';
const PLACES = ['estacion-adrogue', 'plaza-almirante-brown', 'banco-nacion', 'mcdonalds', 'la-veneciana', 'cine-pixel',
  'casa-de-la-cultura', 'guernica-bar'];

// SwiftShader: cada lugar nuevo compila shaders y sube texturas; subir 23 m por la escalera lleva ~8 s de juego.
test.describe.configure({ timeout: 300_000 });

type Ladder = Extract<Prop, { kind: 'ladder' }>;
const inBounds = ([x, z]: Vec2): boolean => x > map.bounds.minX && x < map.bounds.maxX && z > map.bounds.minZ && z < map.bounds.maxZ;

/** La escalera (dentro del mapa) más cercana a Guernica Bar: sube a un techo alto con vista al centro. */
function roofLadder(): Ladder {
  const [gx, gz] = map.places.find((p) => p.id === 'guernica-bar')!.position;
  const ladders = map.props.filter((p): p is Ladder => p.kind === 'ladder' && inBounds(p.base));
  return ladders.reduce((a, b) => (Math.hypot(b.base[0] - gx, b.base[1] - gz) < Math.hypot(a.base[0] - gx, a.base[1] - gz) ? b : a));
}

/** Sobre el eje de una calle que cruza x = maxX − 10: el cruce más cercano a z = 0. */
function eastEdge(): Vec3 {
  const x = map.bounds.maxX - 10;
  let best: Vec3 | null = null;
  for (const r of map.roads) {
    if (r.kind === 'footway' || r.kind === 'pedestrian') continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const [a, b] = [r.points[i], r.points[i + 1]];
      if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
      const z = a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
      if (inBounds([x, z]) && (!best || Math.abs(z) < Math.abs(best[2]))) best = [x, 0, z];
    }
  }
  if (!best) throw new Error('Ninguna calle cruza el borde este');
  return best;
}

test('recorrido: 10 capturas sin errores', async ({ page }) => {
  const errors = collectErrors(page);
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  await open(page);
  await play(page); // sin la interfaz encima; también hace falta para subir la escalera
  const files: string[] = [];
  const shot = async (id: string): Promise<void> => {
    await frames(page, 8);
    const file = `${DIR}/${String(files.length + 1).padStart(2, '0')}-${id}.png`;
    await page.screenshot({ path: file });
    files.push(file);
  };

  for (const id of PLACES) {
    await page.evaluate((x) => window.__adrogue.teleport(x), id);
    await shot(id);
  }

  // Techo: al pie de la escalera mirando la pared, W hasta quedar parado arriba; después, mirar hacia la calle.
  const l = roofLadder();
  const n = Math.hypot(l.normal[0], l.normal[1]);
  const [nx, nz] = [l.normal[0] / n, l.normal[1] / n];
  const foot: Vec3 = [l.base[0] + nx * 0.45, 0, l.base[1] + nz * 0.45];
  await page.evaluate(([p, yaw]) => window.__adrogue.placeAt(p, yaw), [foot, Math.atan2(nx, nz)] as const);
  await page.keyboard.down('KeyW');
  await page.waitForFunction((top) => {
    const s = window.__adrogue.state();
    return s.mode === 'walk' && s.onGround && s.pos[1] > top - 0.1;
  }, l.topY, { timeout: 120_000, polling: 100 });
  await page.keyboard.up('KeyW');
  const roof = (await page.evaluate(() => window.__adrogue.state())).pos;
  await page.evaluate(([p, yaw]) => window.__adrogue.placeAt(p, yaw), [roof, Math.atan2(-nx, -nz)] as const);
  await shot('techo');

  // Borde este, mirando hacia el oeste (yaw π/2: adelante = −x).
  await page.evaluate(([p, yaw]) => window.__adrogue.placeAt(p, yaw), [eastEdge(), Math.PI / 2] as const);
  await shot('borde-este');

  expect(files).toHaveLength(10);
  for (const f of files) expect(existsSync(f), f).toBe(true);
  expect(errors).toEqual([]);
});
