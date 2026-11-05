// Los 9 lugares con interior en el juego de verdad (?debug=1, SwiftShader):
// - entrar a cada uno: teleport (mira a la puerta principal) y W derecho, sin girar, hasta quedar adentro de la planta;
//   ahí el interior se dibuja, la imagen no es lisa y queda una captura en test-results/interiores/<id>.png;
// - en la Casa de la Cultura, ida y vuelta de calidad estando adentro (Review Focus 3): el interior se sigue dibujando,
//   sin materiales liberados (negros) ni errores;
// - el botín de un piso alto (un balcón de la Casa): se dibuja ahí, sale "E: juntar…" y E lo junta parado en el balcón;
// - el McDonald's desde la vereda de enfrente, mirando su puerta: alta → media → alta (I1 de la revisión final), y se
//   dibuja en las tres; quedan capturas en test-results/interiores/mcdonalds-enfrente-<paso>-<calidad>.png.
// Sin errores de consola en todo el recorrido.
import { mkdirSync, rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildCollisionWorld } from '../src/shared/collision.ts';
import { pointInPolygon } from '../src/shared/geo.ts';
import type { Vec3 } from '../src/shared/geo.ts';
import { interiorOf } from '../src/shared/interiors/index.ts';
import { isFreeSpot } from '../src/mapgen/spawns.ts';
import { MATCH, newMatch } from '../src/shared/match.ts';
import { PLAYER } from '../src/shared/player.ts';
import { acrossTheStreet } from '../tests/helpers.ts';
import { canvasLuma, collectErrors, frames, map, open, PERF_SEED, play, playing } from './helpers.ts';

const DIR = 'test-results/interiores';

// SwiftShader dibuja unos pocos cuadros por segundo y cada interior compila sus shaders: entrar a los 9 lleva ~2 min.
test.describe.configure({ timeout: 300_000 });

const state = (page: Page) => page.evaluate(() => window.__adrogue.state());
const drawn = (page: Page) => page.evaluate(() => window.__adrogue.interiorsDrawn());
const fmt = (p: readonly number[]): string => p.map((v) => v.toFixed(2)).join(', ');

/** ¿`pos` está adentro del edificio del interior de `placeId`: sobre su planta y por debajo del techo? */
function insideOf(placeId: string): (pos: Vec3) => boolean {
  const input = map.interiors.find((i) => i.placeId === placeId)!;
  const b = map.buildings.find((x) => x.id === input.buildingId)!;
  return (pos) => pos[1] < b.height && pointInPolygon([pos[0], pos[2]], b.footprint);
}

test('entrar a cada uno de los 9 lugares con W derecho desde su spawn; en la Casa, cambiar la calidad adentro', async ({ page }) => {
  const errors = collectErrors(page);
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  await open(page);
  await page.evaluate(() => window.__adrogue.photosReady);
  // al modo paseo (sin zona ni maniquíes), por el menú de lugares, con el puntero capturado: así camina W
  await play(page);
  const first = map.places.find((p) => p.id === map.interiors[0].placeId)!;
  await page.keyboard.press('KeyM');
  await page.getByTestId('menu-lugares').getByRole('button', { name: first.name, exact: true }).click();
  await playing(page);
  expect(await page.evaluate(() => window.__adrogue.match())).toBeNull();

  expect(map.interiors).toHaveLength(9);
  for (const { placeId: id } of map.interiors) {
    await test.step(id, async () => {
      const inside = insideOf(id);
      await page.evaluate((x) => window.__adrogue.teleport(x), id);
      await frames(page, 2);
      const start = await state(page);
      expect(inside(start.pos), `${id}: el spawn ya está adentro`).toBe(false);
      await page.keyboard.down('KeyW');
      await expect.poll(async () => inside((await state(page)).pos), { message: `${id}: W derecho desde el spawn no entra en 30 s`, timeout: 30_000, intervals: [100] })
        .toBe(true);
      await page.keyboard.up('KeyW');
      await frames(page, 8); // que frene y que el interior compile sus shaders
      const end = await state(page);
      expect(inside(end.pos), `${id}: termina en ${fmt(end.pos)}`).toBe(true);
      expect(await drawn(page), id).toContain(id);
      const luma = await canvasLuma(page);
      console.log(`${id.padEnd(20)} de ${fmt(start.pos)} a ${fmt(end.pos)} · luminancia ${luma.mean.toFixed(1)} ± ${Math.sqrt(luma.variance).toFixed(1)}`);
      expect(luma.variance, `${id}: la imagen es lisa`).toBeGreaterThan(100);
      await page.screenshot({ path: `${DIR}/${id}.png` });

      if (id === 'casa-de-la-cultura') {
        // Review Focus 3: las mallas del interior pasan a los materiales nuevos y vuelven
        await page.evaluate(() => window.__adrogue.setQuality('baja'));
        await frames(page, 8);
        await page.evaluate(() => window.__adrogue.setQuality('media'));
        await frames(page, 4);
        expect(await drawn(page)).toContain(id);
        const again = await canvasLuma(page);
        expect(again.variance, `${id}: lisa después de cambiar la calidad`).toBeGreaterThan(100);
        expect(again.mean, `${id}: más oscura que antes de cambiar la calidad (¿un material liberado?)`).toBeGreaterThan(luma.mean * 0.7);
        await page.screenshot({ path: `${DIR}/${id}-calidad.png` });
      }
      expect(errors, id).toEqual([]);
    });
  }
  expect(errors).toEqual([]);
});

test('el botín de un balcón de la Casa de la Cultura: se ve sobre el balcón, sale "E: juntar…" y E lo junta ahí', async ({ page }) => {
  const errors = collectErrors(page);
  mkdirSync(DIR, { recursive: true });
  // el mismo sorteo que el cliente: ?semilla y sin maniquíes (el botín no depende de cuántos haya)
  const world = buildCollisionWorld(map);
  const m = newMatch(map, world, { seed: PERF_SEED, dummies: 0 });
  const casa = interiorOf(map, 'casa-de-la-cultura');
  const y1 = casa.floors.find((f) => f.level === 1)!.y;
  const onBalcony = m.drops.filter((d) => d.pos[1] === y1 && pointInPolygon([d.pos[0], d.pos[2]], casa.footprint));
  expect(onBalcony.length).toBeGreaterThan(0);
  // parado a 2,2 m, en el balcón, libre y con línea de vista: con pitch 0 el objeto queda ~31° abajo (coseno 0,85 >
  // pickCos), así que se junta sin mirar abajo; y 1,6 m más atrás, fuera del alcance, también libre (la captura de lejos)
  const sees = (p: Vec3, d: (typeof m.drops)[number]): boolean => {
    const eye: Vec3 = [p[0], y1 + PLAYER.eye, p[2]];
    const dir: Vec3 = [d.pos[0] - eye[0], d.pos[1] + MATCH.dropLift - eye[1], d.pos[2] - eye[2]];
    return isFreeSpot(world, p[0], p[2], y1) && !world.raycast(eye, dir, Math.hypot(...dir));
  };
  const pick = onBalcony.flatMap((d) => Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * 2 * Math.PI;
    const [ux, uz] = [Math.cos(a), Math.sin(a)];
    const p: Vec3 = [d.pos[0] + 2.2 * ux, y1, d.pos[2] + 2.2 * uz];
    const far: Vec3 = [d.pos[0] + 3.8 * ux, y1, d.pos[2] + 3.8 * uz];
    return sees(p, d) && sees(far, d) ? [{ d, p, far, yaw: Math.atan2(ux, uz) }] : []; // adelante = (−sin yaw, −cos yaw): hacia el objeto
  }).flat())[0];
  expect(pick, 'ningún objeto del balcón tiene dónde pararse a 2,2 y a 3,8 m').toBeDefined();

  await open(page, `?debug=1&semilla=${PERF_SEED}&maniquis=0`);
  await page.evaluate(() => window.__adrogue.photosReady);
  await play(page);
  const before = (await page.evaluate(() => window.__adrogue.match()))!;
  expect(before.drops).toBe(m.drops.length);
  // de lejos (3,8 m, fuera del alcance): se ve en el balcón, sin cartel
  await page.evaluate(([p, yaw]) => window.__adrogue.placeAt(p, yaw), [pick.far, pick.yaw] as const);
  await frames(page, 8);
  await expect(page.getByTestId('hud-juntar')).toBeHidden();
  await page.screenshot({ path: `${DIR}/botin-balcon.png` });
  await page.evaluate(([p, yaw]) => window.__adrogue.placeAt(p, yaw), [pick.p, pick.yaw] as const);
  await frames(page, 6);
  expect(await drawn(page)).toContain('casa-de-la-cultura');
  await expect(page.getByTestId('hud-juntar')).toBeVisible();
  await expect(page.getByTestId('hud-juntar')).toHaveText(/^E: juntar /);
  await page.screenshot({ path: `${DIR}/juntar.png` });
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await page.evaluate(() => window.__adrogue.match()))!.drops, { timeout: 15_000 }).toBe(before.drops - 1);
  const s = await state(page);
  expect(s.pos[1], 'parado en el balcón').toBeCloseTo(y1, 3);
  expect(errors).toEqual([]);
});

// I1 de la revisión final: entre media y alta cambia el tope de mallas de un interior (18 y 20) y no el detalle, y el
// cambio tiene que volver a compactarlos. Antes, el McDonald's armado en alta (19 mallas) quedaba igual en media, no
// entraba en sus draw calls y desde afuera no se dibujaba más, hasta recargar la página
test('el McDonald\'s desde la vereda de enfrente: alta → media → alta, y se dibuja en las tres', async ({ page }) => {
  const errors = collectErrors(page);
  mkdirSync(DIR, { recursive: true });
  const across = acrossTheStreet(map, 'mcdonalds');
  await open(page, `?debug=1&semilla=${PERF_SEED}&maniquis=0`);
  await page.evaluate(() => window.__adrogue.photosReady);
  await play(page);
  const steps = ['alta', 'media', 'alta'] as const;
  for (const [k, q] of steps.entries()) {
    await page.evaluate((x) => window.__adrogue.setQuality(x), q);
    await page.evaluate(([p, yaw]) => window.__adrogue.placeAt(p, yaw), [across.pos, across.yaw] as const);
    await frames(page, 8);
    expect(await drawn(page), `paso ${k + 1}, en ${q}`).toContain('mcdonalds');
    await page.screenshot({ path: `${DIR}/mcdonalds-enfrente-${k + 1}-${q}.png` });
    expect(errors, `paso ${k + 1}, en ${q}`).toEqual([]);
  }
});
