import { readFileSync } from 'node:fs';
import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { MapData } from '../src/shared/mapdata.ts';
import type {} from '../src/client/debug.ts'; // tipa window.__adrogue

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;
const HELP = 'WASD moverse · Espacio saltar · C agacharse · Mouse mirar · M lugares · Esc menú';

// SwiftShader (WebGL por software) es lento: compilar los shaders y dibujar los primeros cuadros lleva segundos.
test.describe.configure({ timeout: 180_000 });

/** Avisos conocidos que no vienen del juego. */
const KNOWN_WARNINGS = [
  // SwiftShader (WebGL por software de los tests): Chrome copia el back buffer con ReadPixels para componer la página.
  /GL Driver Message \(OpenGL, Performance, .*\): GPU stall due to ReadPixels/,
];

/** Junta console.error, console.warn (salvo los conocidos) y errores no atrapados de la página. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    if (m.type() === 'warning' && !KNOWN_WARNINGS.some((r) => r.test(m.text()))) errors.push(`console.warn: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function open(page: Page, query = '?debug=1'): Promise<void> {
  await page.goto(`/${query}`);
  await page.evaluate(() => window.__adrogue.ready);
}

/** "Hacé click para jugar": captura el puntero (Chrome headless lo permite) y el juego empieza a simular. */
async function play(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Hacé click para jugar' }).click();
  await playing(page);
}

/** Jugando = puntero capturado y la interfaz oculta (el juego ya procesó el pointerlockchange). */
async function playing(page: Page): Promise<void> {
  await expect(page.locator('.overlay')).toBeHidden();
  expect(await page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
}

/** Espera n cuadros del juego (el bucle del juego pidió su rAF antes, así que corre primero en cada cuadro). */
async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let k = 0;
        const tick = (): void => {
          if (++k >= count) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
}

/** Media y varianza de la luminancia (0–255) de lo que dibujó WebGL en este cuadro (sin la interfaz encima). */
async function canvasLuma(page: Page): Promise<{ mean: number; variance: number }> {
  return page.evaluate(
    () =>
      new Promise<{ mean: number; variance: number }>((resolve) => {
        requestAnimationFrame(() => {
          // Dentro del rAF, después de que el juego dibujó y antes de componer: el drawing buffer sigue vigente.
          const src = document.querySelector('canvas')!;
          const w = 160, h = 90;
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(src, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h).data;
          let sum = 0, sum2 = 0;
          for (let i = 0; i < d.length; i += 4) {
            const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            sum += l;
            sum2 += l * l;
          }
          const n = d.length / 4;
          const mean = sum / n;
          resolve({ mean, variance: sum2 / n - mean * mean });
        });
      }),
  );
}

test('carga sin errores de consola y el canvas no está vacío', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  await expect(page.getByRole('heading', { name: 'Adrogué' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hacé click para jugar' })).toBeEnabled();
  await expect(page.getByText(HELP, { exact: true })).toBeVisible();
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
