// La partida de práctica de punta a punta (con ?debug=1): matar a un maniquí con el rifle, terminar la partida, "Jugar
// de nuevo" sin restos de la anterior, y el modo paseo del menú de lugares.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildCollisionWorld } from '../src/shared/collision.ts';
import { hitscan } from '../src/shared/combat.ts';
import type { Vec3 } from '../src/shared/geo.ts';
import { newMatch } from '../src/shared/match.ts';
import { PLAYER } from '../src/shared/player.ts';
import { collectErrors, frames, map, open, play, playing } from './helpers.ts';

// SwiftShader: unos pocos cuadros por segundo; skipTo(800) son 48.000 pasos.
test.describe.configure({ timeout: 240_000 });

const world = buildCollisionWorld(map);

/** Frente a Guernica Bar, en su punto de aparición y mirando hacia el bar: el maniquí va 8 m adelante y la pared queda
 *  detrás de él, para que los tiros que siguen a la muerte dejen marcas. */
function shootingRange(): { pos: Vec3; yaw: number; dummy: Vec3; wall: number } {
  const place = map.places.find((p) => p.id === 'guernica-bar')!;
  const pos = place.spawn;
  const yaw = Math.atan2(-(place.position[0] - pos[0]), -(place.position[1] - pos[2]));
  const fwd: Vec3 = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const hit = hitscan(world, [], [pos[0], pos[1] + PLAYER.eye, pos[2]], fwd, 250);
  return { pos, yaw, dummy: [pos[0] + fwd[0] * 8, pos[1], pos[2] + fwd[2] * 8], wall: hit?.dist ?? Infinity };
}

const match = (page: Page) => page.evaluate(() => window.__adrogue.match());
const counters = (page: Page) => page.evaluate(() => window.__adrogue.counters());

test('partida completa: matar un maniquí, terminar la partida y jugar de nuevo sin restos de la anterior', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '?debug=1&semilla=7&maniquis=2');
  await page.evaluate(() => window.__adrogue.setQuality('baja')); // cuadros más rápidos con SwiftShader
  await play(page);
  expect(await match(page)).toMatchObject({ seed: 7, alive: 3, me: { hp: 100, armor: 0, alive: true }, over: null });
  await expect(page.getByTestId('hud-quedan')).toHaveText('Quedan 3');

  // 1. Con el rifle, el maniquí 8 m adelante y el clic izquierdo apretado 2 s.
  const range = shootingRange();
  expect(range.wall, 'la pared detrás del maniquí').toBeGreaterThan(12);
  expect(range.wall).toBeLessThan(40);
  await page.evaluate(([pos, yaw, dummy]) => {
    window.__adrogue.placeAt(pos, yaw);
    window.__adrogue.placeDummy(0, dummy);
    window.__adrogue.give('rifle');
  }, [range.pos, range.yaw, range.dummy] as const);
  await expect(page.getByTestId('hud-municion')).toHaveText('30 / 30');
  // 2 s de partida: con SwiftShader (y más con otros tests en paralelo) el juego corre más lento que el reloj, porque
  // FixedStep hace a lo sumo 5 pasos por cuadro
  const t0 = (await match(page))!.t;
  await page.mouse.down();
  await page.waitForFunction((t) => window.__adrogue.match()!.t >= t + 2, t0, { timeout: 60_000, polling: 50 });
  await page.mouse.up();
  await expect(page.getByTestId('hud-feed')).toContainText('Eliminaste a Maniquí 1');
  const shot = (await match(page))!;
  expect(shot).toMatchObject({ alive: 2, kills: 1 });
  expect(shot.inv.slots[0]!.inMag, 'más tiros que los 5 a la cabeza que lo matan').toBeLessThan(25);
  expect((await counters(page)).decals, 'los tiros después de la muerte pegan en la pared').toBeGreaterThan(0);

  // 2. La zona termina la partida.
  await page.evaluate(() => window.__adrogue.skipTo(800));
  await expect(page.getByRole('heading', { name: /^(¡Ganaste!|Te eliminaron — quedaba)/ })).toBeVisible();
  await expect(page.getByText(/^Tiempo: \d+:\d\d · Eliminaciones: 1$/)).toBeVisible();
  const over = (await match(page))!;
  expect(over.over).not.toBeNull();
  expect((await counters(page)).decals, 'las marcas siguen ahí hasta jugar de nuevo').toBeGreaterThan(0);

  // 3. "Jugar de nuevo": partida limpia con la semilla siguiente.
  await page.getByRole('button', { name: 'Jugar de nuevo' }).click();
  await playing(page);
  await frames(page, 3);
  const again = (await match(page))!;
  expect(again).toMatchObject({ seed: 8, alive: 3, kills: 0, over: null, me: { hp: 100, armor: 0, alive: true } });
  expect(again.inv.slots).toEqual([null, null]);
  expect(again.inv.ammo).toEqual({ liviana: 0, cartuchos: 0, pesada: 0 });
  expect(again.drops, 'el botín es el del sorteo nuevo').toBe(newMatch(map, world, { seed: 8, dummies: 2 }).drops.length);
  expect(again.drops).not.toBe(newMatch(map, world, { seed: 7, dummies: 2 }).drops.length);
  expect(await counters(page), 'sin marcas, trazadores ni maniquíes caídos de la anterior').toEqual({ decals: 0, tracers: 0, dummies: 2 });
  await expect(page.getByTestId('hud-feed')).toBeEmpty();
  await expect(page.getByTestId('hud-vida')).toHaveText('100');
  await expect(page.getByTestId('hud-arma')).toHaveText('Sin arma');

  // 4. Sin errores de consola.
  expect(errors).toEqual([]);
});

test('modo paseo: un lugar del menú no arma partida; "Jugar una partida" vuelve a una', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '?debug=1&maniquis=2');
  await page.evaluate(() => window.__adrogue.setQuality('baja'));
  await play(page);
  expect(await match(page)).not.toBeNull();
  await expect(page.getByTestId('hud-zona')).toBeVisible();

  const banco = map.places.find((p) => p.id === 'banco-nacion')!;
  await page.keyboard.press('KeyM');
  await page.getByTestId('menu-lugares').getByRole('button', { name: banco.name, exact: true }).click();
  await playing(page);
  await frames(page, 3);
  expect(await match(page)).toBeNull();
  await expect(page.getByTestId('hud-zona')).toBeHidden();
  await expect(page.getByTestId('hud-vida')).toBeHidden();
  expect(await counters(page)).toEqual({ decals: 0, tracers: 0, dummies: 0 });
  const s = await page.evaluate(() => window.__adrogue.state());
  expect(Math.hypot(s.pos[0] - banco.spawn[0], s.pos[2] - banco.spawn[2])).toBeLessThan(1);

  // M y Esc: el menú de Esc del modo paseo tiene "Jugar una partida"
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('menu-lugares')).toBeVisible(); // cuando el navegador soltó el puntero
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Jugar una partida' }).click();
  await playing(page);
  await frames(page, 2);
  expect(await match(page)).toMatchObject({ alive: 3, t: expect.any(Number) });
  await expect(page.getByTestId('hud-zona')).toBeVisible();
  expect(errors).toEqual([]);
});
