// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { BENCH_PATH, benchSeconds, createBench, formatResult, pathLength, summarize, viewAt } from '../../src/client/bench.ts';
import { pointInPolygon } from '../../src/shared/geo.ts';
import type { Vec2, Vec3 } from '../../src/shared/geo.ts';
import type { MapData } from '../../src/shared/mapdata.ts';

const map = JSON.parse(readFileSync('public/map/adrogue.map.json', 'utf8')) as MapData;

describe('parámetros de la URL', () => {
  test('?bench=1 mide 60 s; ?benchSecs=N cambia la duración', () => {
    expect(benchSeconds('?bench=1')).toBe(60);
    expect(benchSeconds('?bench=1&benchSecs=5')).toBe(5);
    expect(benchSeconds('?debug=1&bench=1&benchSecs=2.5')).toBe(2.5);
  });

  test('sin ?bench=1 no hay benchmark; una duración inválida vuelve a 60', () => {
    expect(benchSeconds('')).toBeNull();
    expect(benchSeconds('?benchSecs=5')).toBeNull();
    expect(benchSeconds('?bench=0')).toBeNull();
    for (const bad of ['abc', '-3', '0', '', 'Infinity']) expect(benchSeconds(`?bench=1&benchSecs=${bad}`), bad).toBe(60);
  });
});

describe('resultado', () => {
  test('promedio = cuadros / tiempo; peor 5 % = promedio de fps del 5 % de cuadros más lentos', () => {
    // 95 cuadros de 10 ms y 5 de 50 ms: 100 cuadros en 1,2 s
    const r = summarize([...Array(95).fill(10), ...Array(5).fill(50)]);
    expect(r.avg).toBeCloseTo(100 / 1.2, 6);
    expect(r.worst5).toBeCloseTo(20, 6);
    // con pocos cuadros, el peor 5 % es al menos el peor cuadro
    expect(summarize([10, 20, 40]).worst5).toBeCloseTo(25, 6);
    expect(summarize([])).toEqual({ avg: 0, worst5: 0 });
  });

  test('línea final en castellano con la calidad', () => {
    expect(formatResult({ avg: 58.6, worst5: 41.2 }, 'media')).toBe('Promedio: 59 fps · Peor 5 %: 41 fps · Calidad: Media');
    expect(formatResult({ avg: 30, worst5: 12.5 }, 'baja')).toBe('Promedio: 30 fps · Peor 5 %: 13 fps · Calidad: Baja');
    expect(formatResult({ avg: 144, worst5: 90 }, 'alta')).toMatch(/^Promedio: \d+ fps · Peor 5 %: \d+ fps · Calidad: Alta$/);
  });
});

describe('camino fijo', () => {
  const L = pathLength(BENCH_PATH);
  const near = (s: number, [x, z]: Vec2): number => {
    const p = viewAt(BENCH_PATH, s).pos;
    return Math.hypot(p[0] - x, p[2] - z);
  };
  /** Dónde (en metros de camino) pasa más cerca de un punto del mapa, y a qué distancia: cada 0,5 m y en cada vértice
   *  (un punto que es un vértice del camino, como el spawn de la plaza, da justo ahí y no en la muestra de al lado). */
  const closest = (q: Vec2): { s: number; d: number } => {
    let best = { s: 0, d: Infinity };
    const at = (s: number): void => {
      const d = near(s, q);
      if (d < best.d) best = { s, d };
    };
    for (let s = 0; s <= L; s += 0.5) at(s);
    BENCH_PATH.forEach((_, i) => at(pathLength(BENCH_PATH.slice(0, i + 1))));
    return best;
  };

  test('estación → Esteban Adrogué → Espora → Plaza Brown → techos, en ese orden', () => {
    const station = map.places.find((p) => p.id === 'estacion-adrogue')!;
    const plaza = map.places.find((p) => p.id === 'plaza-almirante-brown')!;
    expect(near(0, [station.spawn[0], station.spawn[2]])).toBeLessThan(1);
    const ea = closest([-180, 109.45]); // sobre la calle Esteban Adrogué
    const espora = closest([179.5, 0]); // sobre la mano este de Avenida Espora
    const pb = closest([plaza.spawn[0], plaza.spawn[2]]);
    for (const c of [ea, espora, pb]) expect(c.d).toBeLessThan(2);
    expect(ea.s).toBeLessThan(espora.s);
    expect(espora.s).toBeLessThan(pb.s);
    // termina arriba de los techos, más alto que el edificio más alto
    const top = Math.max(...map.buildings.map((b) => b.height));
    expect(viewAt(BENCH_PATH, L).pos[1]).toBeGreaterThan(top);
    expect(viewAt(BENCH_PATH, pb.s).pos[1]).toBe(0);
  });

  // Los mismos casos que punto contra planta, pero sin un expect por par: la caja de cada planta descarta lo que queda
  // afuera (ahí pointInPolygon da false) y los que caen adentro se juntan en una lista (antes tardaba ~1,9 s y en la
  // suite entera, con los workers ocupados, pasaba los 5 s del timeout).
  test('nunca atraviesa un edificio: por la calle afuera de toda planta, arriba más alto que todos', () => {
    const boxes = map.buildings.map((b) => {
      const xs = b.footprint.map((q) => q[0]), zs = b.footprint.map((q) => q[1]);
      return { b, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    });
    const inside: string[] = [];
    for (let s = 0; s <= L; s += 1) {
      const p: Vec3 = viewAt(BENCH_PATH, s).pos;
      for (const { b, minX, maxX, minZ, maxZ } of boxes) {
        if (p[1] > b.height + 1 || p[0] < minX || p[0] > maxX || p[2] < minZ || p[2] > maxZ) continue;
        if (pointInPolygon([p[0], p[2]], b.footprint)) inside.push(`s = ${s} m adentro de ${b.id}`);
      }
    }
    expect(inside).toEqual([]);
  });

  test('mira hacia donde va y es determinista', () => {
    for (const s of [10, L * 0.3, L * 0.6, L - 1, L]) {
      const a = viewAt(BENCH_PATH, s), b = viewAt(BENCH_PATH, Math.min(L, s + 3));
      expect(viewAt(BENCH_PATH, s)).toEqual(a);
      // adelante = (−sin yaw, −cos yaw): avanzar 3 m no aleja de lo que se mira
      const fwd = [-Math.sin(a.yaw), -Math.cos(a.yaw)];
      const step = [b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]];
      if (Math.hypot(...step) > 0.5) expect(fwd[0] * step[0] + fwd[1] * step[1]).toBeGreaterThan(0);
    }
    expect(viewAt(BENCH_PATH, -5).pos).toEqual(viewAt(BENCH_PATH, 0).pos);
    expect(viewAt(BENCH_PATH, L + 5).pos).toEqual(viewAt(BENCH_PATH, L).pos);
  });
});

describe('corrida', () => {
  const run = (seconds: number, frameMs: number[]) => {
    const root = document.createElement('div');
    const rerun = vi.fn(), play = vi.fn();
    const bench = createBench(root, { seconds, quality: 'media', onRerun: rerun, onPlay: play });
    let now = 1000;
    const views = [bench.frame(now)];
    bench.start(now);
    for (const dt of frameMs) views.push(bench.frame((now += dt)));
    return { root, views, rerun, play, bench };
  };
  const result = (root: HTMLElement): string | null => root.querySelector('[data-testid="bench-result"]')?.textContent ?? null;

  test('entra en calor quieto en la estación, recorre el camino en `seconds` y muestra el resultado', () => {
    // 2 s de calor a 100 ms, después 1 s a 10 ms (100 cuadros) y unos cuadros de más
    const { root, views } = run(1, [...Array(20).fill(100), ...Array(105).fill(10)]);
    const start = viewAt(BENCH_PATH, 0).pos;
    for (const v of views.slice(0, 21)) expect(v.pos).toEqual(start); // sin moverse mientras entra en calor
    expect(result(root)).toBe('Promedio: 100 fps · Peor 5 %: 100 fps · Calidad: Media');
    expect(views.at(-1)!.pos).toEqual(viewAt(BENCH_PATH, pathLength(BENCH_PATH)).pos); // y se queda al final
    // mientras mide avanza
    expect(views[60].pos).not.toEqual(start);
  });

  test('sin start() no mide nunca; antes de terminar no hay resultado', () => {
    const root = document.createElement('div');
    const bench = createBench(root, { seconds: 1, quality: 'baja', onRerun: vi.fn(), onPlay: vi.fn() });
    for (let t = 0; t < 10_000; t += 100) bench.frame(t);
    expect(result(root)).toBeNull();
    const r = run(5, Array(30).fill(100));
    expect(result(r.root)).toBeNull();
  });

  test('el resultado ofrece medir otra calidad o jugar', () => {
    const { root, rerun, play } = run(1, [...Array(20).fill(100), ...Array(12).fill(100)]);
    expect(result(root)).toMatch(/^Promedio: 10 fps · Peor 5 %: 10 fps · Calidad: Media$/);
    const buttons = [...root.querySelectorAll('button')];
    buttons.find((b) => b.textContent === 'Baja')!.click();
    expect(rerun).toHaveBeenCalledWith('baja');
    buttons.find((b) => b.textContent === 'Jugar')!.click();
    expect(play).toHaveBeenCalled();
  });
});
