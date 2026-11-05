// Presupuestos de rendimiento por calidad: draw calls y triángulos (renderer.info, con la pasada de sombras) en los
// puntos del recorrido, el tamaño en disco de lo que baja el navegador y el benchmark corto. Con SwiftShader los fps no
// dicen nada de una placa de verdad: se anotan solo como referencia relativa. Deja una captura por punto y calidad en
// test-results/perf/ para mirar a ojo la niebla y el corte de camera.far.
//
// Se mide jugando una partida con semilla fija (PERF_SEED): en cada punto se dibuja el botín, los maniquíes y la zona
// que haya a la vista. La última parada, "combate", es el peor caso del combate: 11 maniquíes adelante, el punto de
// botín más cargado, la pared de la zona cerca y el rifle disparando (fogonazo, trazadores y marcas).
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { QUALITY } from '../src/client/render/quality.ts';
import type { Quality } from '../src/client/render/quality.ts';
import { collectErrors, combatStop, frames, goTo, goToCombat, maxStats, open, PERF_SEED, play, TOUR } from './helpers.ts';
import type { DebugStats } from '../src/client/debug.ts';

const DIR = 'test-results/perf';

// Presupuestos del spec (el techo): baja 150 draw calls / 800.000 triángulos, media 300 / 1.500.000, alta 450 / 3.000.000.
// Los de acá se fijaron en ~1,2 × el máximo medido en los 6 puntos del recorrido, con el mundo solo (SwiftShader,
// 2026-11-03: baja 107 / 108.238, media 204 / 190.633, alta 320 / 252.971), para que una regresión salte mucho antes de
// llegar al techo. No se suben: si un cambio los pasa, se recorta (como el botín y la sombra de los maniquíes según la
// calidad, en QUALITY).
// Desde la etapa 2a cada punto se mide dentro de una partida con semilla fija (PERF_SEED, 42), con el botín, los
// maniquíes y la zona que haya a la vista, más la parada "combate": el peor caso del combate. Máximos medidos el
// 2026-11-04: baja 116 / 123.590, media 226 / 228.955 (los dos en "combate"), alta 338 / 271.045 (Esteban Adrogué).
// Desde la etapa 2b el recorrido suma 3 paradas adentro (cultura-atrio, mcdonalds-salon y veneciana-vidrieras, las
// vistas de sus interiores): entran en los mismos topes, que no se tocaron.
const BUDGET: Record<Quality, { drawCalls: number; triangles: number }> = {
  baja: { drawCalls: 130, triangles: 130_000 },
  media: { drawCalls: 245, triangles: 230_000 },
  alta: { drawCalls: 385, triangles: 305_000 },
};

// SwiftShader dibuja ~3 cuadros por segundo y cada lugar nuevo compila shaders.
test.describe.configure({ timeout: 240_000 });

function dirSize(dir: string): number {
  return readdirSync(dir, { withFileTypes: true })
    .reduce((s, e) => s + (e.isDirectory() ? dirSize(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
}

function check(q: Quality, id: string, s: DebugStats): void {
  const row = [q.padEnd(5), id.padEnd(20), `${String(s.drawCalls).padStart(4)} draw calls`,
    `${String(s.triangles).padStart(8)} triángulos`, `${s.fps.toFixed(1)} fps`];
  console.log(row.join(' '));
  expect(s.drawCalls, `${q}/${id}`).toBeLessThanOrEqual(BUDGET[q].drawCalls);
  expect(s.triangles, `${q}/${id}`).toBeLessThanOrEqual(BUDGET[q].triangles);
}

const COMBAT = combatStop();

test('la parada "combate" tiene botín a la vista en cada calidad y la zona cerca hasta en baja', () => {
  const qs = ['baja', 'media', 'alta'] as const;
  console.log(`combate: ${qs.map((q) => `${COMBAT.drops[q]} objetos en ${q} (a ${QUALITY[q].dropRadius} m)`).join(', ')}; ` +
    `borde de la zona a ${COMBAT.zoneEdge.toFixed(0)} m`);
  for (const q of qs) expect(COMBAT.drops[q], `objetos que se dibujan en ${q}`).toBeGreaterThanOrEqual(15);
  expect(COMBAT.zoneEdge).toBeLessThan(200); // la niebla de baja tapa la pared a los 250 m
});

for (const q of ['baja', 'media', 'alta'] as const) {
  test(`presupuesto ${q}`, async ({ page }) => {
    const errors = collectErrors(page);
    mkdirSync(DIR, { recursive: true });
    await open(page, `?debug=1&semilla=${PERF_SEED}`);
    await page.evaluate(() => window.__adrogue.photosReady);
    await page.evaluate((x) => window.__adrogue.setQuality(x), q);
    await play(page); // sin la interfaz encima de las capturas
    for (const stop of TOUR) {
      await goTo(page, stop);
      await frames(page, 6); // culling, sombra y shaders del lugar nuevo ya resueltos
      const s = await page.evaluate(() => window.__adrogue.stats());
      await page.screenshot({ path: `${DIR}/${q}-${stop.id}.png` });
      check(q, stop.id, s);
    }

    await goToCombat(page, COMBAT);
    await frames(page, 6);
    expect(await page.evaluate(() => window.__adrogue.counters())).toMatchObject({ dummies: 11 });
    await page.mouse.down(); // entre las dos filas: los maniquíes no se caen y los tiros dejan marcas al fondo
    const s = await maxStats(page, 8);
    await page.screenshot({ path: `${DIR}/${q}-combate.png` });
    await page.mouse.up();
    const c = await page.evaluate(() => window.__adrogue.counters());
    expect(c.dummies).toBe(11);
    expect(c.decals).toBeGreaterThan(0);
    check(q, 'combate', s);
    expect(errors).toEqual([]);
  });
}

test('benchmark corto sin ?debug: recorre el camino y muestra el resultado en pantalla', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?bench=1&benchSecs=4');
  const result = page.getByTestId('bench-result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  const line = (await result.textContent())!;
  console.log(line);
  expect(line).toMatch(/^Promedio: \d+ fps · Peor 5 %: \d+ fps · Calidad: Media$/);
  expect(await page.evaluate(() => '__adrogue' in window)).toBe(false); // sin ganchos de debug
  await expect(page.getByRole('button', { name: 'Hacé click para jugar' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('tamaños en disco', () => {
  const sizes = { map: statSync('public/map/adrogue.map.json').size, textures: dirSize('public/textures'), photos: dirSize('public/photos') };
  const mb = (n: number): string => `${(n / 1e6).toFixed(2)} MB`;
  console.log(`mapa ${mb(sizes.map)} · texturas ${mb(sizes.textures)} · fotos ${mb(sizes.photos)}`);
  expect(sizes.map).toBeLessThan(3e6);
  expect(sizes.textures).toBeLessThan(25e6);
});
