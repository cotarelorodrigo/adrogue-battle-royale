import { chromium, expect, test } from '@playwright/test';
import { canvasLuma, collectErrors, frames, map, open, play, playing } from './helpers.ts';

const HELP = 'WASD moverse · Espacio saltar · C agacharse · Mouse mirar · M lugares · Esc menú';

// SwiftShader (WebGL por software) es lento: compilar los shaders y dibujar los primeros cuadros lleva segundos.
test.describe.configure({ timeout: 180_000 });

test('carga sin errores de consola y el canvas no está vacío', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  await expect(page.getByRole('heading', { name: 'Adrogué' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hacé click para jugar' })).toBeEnabled();
  await expect(page.getByText(HELP, { exact: true }).filter({ visible: true })).toBeVisible(); // también está en el menú de Esc, oculto
  await frames(page, 3);
  const luma = await canvasLuma(page);
  console.log(`luminancia del canvas: media ${luma.mean.toFixed(1)}, varianza ${luma.variance.toFixed(1)}`);
  expect(luma.mean).toBeGreaterThan(20);
  expect(luma.variance).toBeGreaterThan(100);
  const stats = await page.evaluate(() => window.__adrogue.stats());
  expect(stats.drawCalls).toBeGreaterThan(0);
  expect(stats.triangles).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('teletransporte a los 38 lugares deja al jugador en suelo libre', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  await page.evaluate(() => window.__adrogue.setQuality('baja')); // cuadros más rápidos con SwiftShader
  await play(page); // sin puntero capturado la simulación está en pausa

  // La simulación corre: con W se camina hacia el lugar (el teletransporte deja mirando hacia él).
  const plaza = map.places.find((p) => p.id === 'plaza-almirante-brown')!;
  const toPlaza = (pos: number[]): number => Math.hypot(pos[0] - plaza.position[0], pos[2] - plaza.position[1]);
  await page.evaluate((id) => window.__adrogue.teleport(id), plaza.id);
  const before = toPlaza((await page.evaluate(() => window.__adrogue.state())).pos);
  await page.keyboard.down('KeyW');
  await frames(page, 4);
  await page.keyboard.up('KeyW');
  const after = toPlaza((await page.evaluate(() => window.__adrogue.state())).pos);
  expect(before - after).toBeGreaterThan(0.1);

  expect(map.places).toHaveLength(38);
  for (const place of map.places) {
    await page.evaluate((id) => window.__adrogue.teleport(id), place.id);
    await page.waitForTimeout(100);
    await frames(page, 3); // al menos dos pasos de simulación después del teletransporte
    const s = await page.evaluate(() => window.__adrogue.state());
    expect(s.onGround, place.id).toBe(true);
    expect(s.mode, place.id).toBe('walk');
    const [x, y, z] = place.spawn;
    expect(Math.hypot(s.pos[0] - x, s.pos[1] - y, s.pos[2] - z), place.id).toBeLessThan(1);
  }
  expect(errors).toEqual([]);
});

test('menú M lista 38 lugares + al azar; elegir uno teletransporta y vuelve a jugar', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  await page.keyboard.press('KeyM');
  const menu = page.getByTestId('menu-lugares');
  await expect(menu.getByRole('button')).toHaveCount(39);
  await expect(menu.getByRole('button', { name: 'Aparecer en un lugar al azar' })).toBeVisible();
  const names = await menu.getByRole('button').allTextContents();
  const placeNames = names.filter((n) => n !== 'Aparecer en un lugar al azar');
  expect(placeNames).toEqual(map.places.map((p) => p.name).sort((a, b) => a.localeCompare(b, 'es')));

  // Elegir un lugar teletransporta y captura el puntero (el click es el gesto que pide el navegador).
  const plaza = map.places.find((p) => p.id === 'plaza-almirante-brown')!;
  await menu.getByRole('button', { name: plaza.name, exact: true }).click();
  await expect(menu).toBeHidden();
  await playing(page);
  const s = await page.evaluate(() => window.__adrogue.state());
  expect(Math.hypot(s.pos[0] - plaza.spawn[0], s.pos[2] - plaza.spawn[2])).toBeLessThan(1);

  // M jugando suelta el puntero y abre el menú.
  await page.keyboard.press('KeyM');
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await menu.getByRole('button', { name: 'Aparecer en un lugar al azar' }).click();
  await playing(page);
  const r = await page.evaluate(() => window.__adrogue.state());
  expect(map.randomSpawns.some(([x, , z]) => Math.hypot(r.pos[0] - x, r.pos[2] - z) < 1)).toBe(true);

  // Esc cierra lugares y, como ya se jugó, queda el menú de Esc.
  await page.keyboard.press('KeyM');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  for (const name of ['Seguir', 'Baja', 'Media', 'Alta', 'Lugares', 'Créditos']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText('Calidad:', { exact: true })).toBeVisible();
  await expect(page.getByText(HELP, { exact: true }).filter({ visible: true })).toBeVisible(); // los controles, también acá
  await page.getByRole('button', { name: 'Créditos' }).click();
  await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('F3 muestra los fps y los draw calls', async ({ page }) => {
  await open(page);
  const hud = page.getByTestId('hud-stats');
  await expect(hud).toBeHidden();
  await page.keyboard.press('F3');
  await expect(hud).toBeVisible();
  await expect(hud).toHaveText(/\d+ fps · \d+ draw calls/);
  await page.keyboard.press('F3');
  await expect(hud).toBeHidden();
});

test('cambiar la calidad en caliente sigue dibujando sin errores', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  for (const q of ['baja', 'alta'] as const) {
    await page.evaluate((x) => window.__adrogue.setQuality(x), q);
    await frames(page, 3);
    const s = await page.evaluate(() => window.__adrogue.stats());
    expect(s.drawCalls, q).toBeGreaterThan(0);
    const luma = await canvasLuma(page);
    expect(luma.variance, q).toBeGreaterThan(100);
  }
  expect(await page.evaluate(() => localStorage.getItem('adrogue.calidad'))).toBe('alta');
  expect(errors).toEqual([]);
});

test('sin WebGL muestra el mensaje en español', async ({ baseURL }) => {
  // Los args de lanzamiento son por navegador: se abre uno aparte sin WebGL.
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-webgl', '--disable-webgl2'] });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/`);
    await expect(page.getByText('Tu navegador no soporta WebGL2.')).toBeVisible();
    await expect(page.getByText('Tu navegador no soporta WebGL2. Probá con Chrome, Edge o Firefox actualizados.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hacé click para jugar' })).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('si se pierde el contexto WebGL muestra el mensaje', async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.querySelector('canvas')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
  await expect(page.getByText('Se perdió el contexto gráfico. Recargá la página.', { exact: true })).toBeVisible();
});

test('si no carga el mapa muestra el mensaje', async ({ page }) => {
  await page.route('**/map/adrogue.map.json', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('No se pudo cargar el mapa. Recargá la página.', { exact: true })).toBeVisible();
});
