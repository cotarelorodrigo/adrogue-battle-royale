// Funciones comunes de los e2e: abrir el juego con ?debug=1, jugar, esperar cuadros y juntar errores de consola.
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signedAreaFromAbove } from '../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../src/shared/geo.ts';
import type { MapData } from '../src/shared/mapdata.ts';
import type {} from '../src/client/debug.ts'; // tipa window.__adrogue

export const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;

export const inBounds = ([x, z]: Vec2): boolean => x > map.bounds.minX && x < map.bounds.maxX && z > map.bounds.minZ && z < map.bounds.maxZ;

/** Sobre el eje de una calle que cruza x = maxX − 10: el cruce más cercano a z = 0. */
export function eastEdge(): Vec3 {
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

/** Arriba del edificio más alto (de los empatados, el más cercano al centro), en el promedio de sus vértices. */
export function tallestRoof(): Vec3 {
  const top = Math.max(...map.buildings.map((b) => b.height));
  const centre = (fp: Vec2[]): Vec2 => [fp.reduce((s, p) => s + p[0], 0) / fp.length, fp.reduce((s, p) => s + p[1], 0) / fp.length];
  const [x, z] = map.buildings.filter((b) => b.height === top).map((b) => centre(b.footprint))
    .reduce((a, b) => (Math.hypot(...b) < Math.hypot(...a) ? b : a));
  return [x, top, z];
}

/** Un punto del recorrido de medición: un lugar (teletransporte) o una posición y hacia dónde mirar. */
export type TourStop = { id: string } & ({ place: string } | { pos: Vec3; yaw: number });

/** Los puntos de los presupuestos de rendimiento. yaw 0 mira a −z; π/2, a −x. */
export const TOUR: TourStop[] = [
  { id: 'estacion', place: 'estacion-adrogue' },
  { id: 'plaza-brown', place: 'plaza-almirante-brown' },
  // sobre la calle Esteban Adrogué, mirando a lo largo de ella hacia el este
  { id: 'esteban-adrogue', pos: [-180, 0, 109.45], yaw: Math.atan2(-182.74, -35.11) },
  // sobre la mano este de Avenida Espora, mirando hacia el sur (+z)
  { id: 'espora', pos: [178.75, 0, -90], yaw: Math.PI },
  // techo del edificio más alto, mirando hacia el este (+x): la mitad más larga del mapa
  { id: 'techo', pos: tallestRoof(), yaw: -Math.PI / 2 },
  // borde este, mirando hacia el oeste: todo el mapa por delante
  { id: 'borde', pos: eastEdge(), yaw: Math.PI / 2 },
  // frente relevado más cargado (Mitre–Pellerano, vereda sur), de cerca: lotes con cartel, toldo y fachada propia
  ...faceStops().filter((s) => s.id === 'frente-ea-mitre-pellerano-s'),
];

/** Ids de los frentes relevados en `data/frentes.json`. */
function faceIds(): string[] {
  const data = JSON.parse(readFileSync('data/frentes.json', 'utf8')) as { calles: { frentes: { id: string }[] }[] };
  return data.calles.flatMap((c) => c.frentes.map((f) => f.id));
}

/** Una parada por frente relevado: a 9 m de la fachada, frente al punto medio de sus aristas `front.edges`
 *  (promedio pesado por largo de los lotes `${faceId}-N`), mirando hacia la fachada. */
export function faceStops(): TourStop[] {
  return faceIds().map((faceId) => {
    const lot = new RegExp(`^${faceId}-\\d+$`);
    let len = 0, cx = 0, cz = 0, nx = 0, nz = 0;
    for (const b of map.buildings) {
      if (!b.front || !lot.test(b.id)) continue;
      const fp = b.footprint;
      const sign = signedAreaFromAbove(fp) < 0 ? -1 : 1; // normal exterior de una planta antihoraria: (−dz, dx)
      for (const e of b.front.edges) {
        const a = fp[e], c = fp[(e + 1) % fp.length];
        const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz);
        len += l;
        cx += ((a[0] + c[0]) / 2) * l;
        cz += ((a[1] + c[1]) / 2) * l;
        nx += -dz * sign;
        nz += dx * sign;
      }
    }
    if (len === 0) throw new Error(`frente ${faceId}: no hay lotes con aristas de frente en el mapa`);
    const n = Math.hypot(nx, nz);
    const [ux, uz] = [nx / n, nz / n];
    const pos: Vec3 = [cx / len + ux * 9, 0, cz / len + uz * 9];
    return { id: `frente-${faceId}`, pos, yaw: Math.atan2(ux, uz) }; // adelante = −normal: hacia la fachada
  });
}

export async function goTo(page: Page, stop: TourStop): Promise<void> {
  if ('place' in stop) await page.evaluate((id) => window.__adrogue.teleport(id), stop.place);
  else await page.evaluate(([p, yaw]) => window.__adrogue.placeAt(p, yaw), [stop.pos, stop.yaw] as const);
}

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
