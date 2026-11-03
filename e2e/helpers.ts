// Funciones comunes de los e2e: abrir el juego con ?debug=1, jugar, esperar cuadros y juntar errores de consola.
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { MapData } from '../src/shared/mapdata.ts';
import type {} from '../src/client/debug.ts'; // tipa window.__adrogue

export const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;

/** Avisos conocidos que no vienen del juego. */
const KNOWN_WARNINGS = [
  // SwiftShader (WebGL por software de los tests): Chrome copia el back buffer con ReadPixels para componer la página.
  /GL Driver Message \(OpenGL, Performance, .*\): GPU stall due to ReadPixels/,
];

/** Junta console.error, console.warn (salvo los conocidos) y errores no atrapados de la página. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    if (m.type() === 'warning' && !KNOWN_WARNINGS.some((r) => r.test(m.text()))) errors.push(`console.warn: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export async function open(page: Page, query = '?debug=1'): Promise<void> {
  await page.goto(`/${query}`);
  await page.evaluate(() => window.__adrogue.ready);
}

/** "Hacé click para jugar": captura el puntero (Chrome headless lo permite) y el juego empieza a simular. */
export async function play(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Hacé click para jugar' }).click();
  await playing(page);
}

/** Jugando = puntero capturado y la interfaz oculta (el juego ya procesó el pointerlockchange). */
export async function playing(page: Page): Promise<void> {
  await expect(page.locator('.overlay')).toBeHidden();
  expect(await page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
}

/** Espera n cuadros del juego (el bucle del juego pidió su rAF antes, así que corre primero en cada cuadro). */
export async function frames(page: Page, n: number): Promise<void> {
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
export async function canvasLuma(page: Page): Promise<{ mean: number; variance: number }> {
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
