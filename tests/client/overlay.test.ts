// @vitest-environment jsdom
// El menú de Esc solo aparece al soltar el pointer lock, que Chrome headless no tiene: el flujo de pantallas se prueba acá.
import sources from '../../data/sources.json';
import type { Place } from '../../src/shared/mapdata.ts';
import { createOverlay, HELP } from '../../src/client/ui/overlay.ts';
import type { Overlay } from '../../src/client/ui/overlay.ts';

const places = [
  { id: 'z', name: 'Zorra' },
  { id: 'a', name: 'Álamo' },
  { id: 'b', name: 'Banco' },
] as Place[];

let root: HTMLElement;
let overlay: Overlay;
const o = {
  quality: 'media' as const,
  requestLock: vi.fn(),
  exitLock: vi.fn(),
  onQuality: vi.fn(),
  onPlace: vi.fn(),
};

/** Botones visibles (sin ningún ancestro oculto) con ese texto. */
function visible(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) if ((e as HTMLElement).hidden) return false;
  return true;
}
const buttons = (): HTMLButtonElement[] => [...root.querySelectorAll('button')].filter(visible);
const btn = (text: string): HTMLButtonElement => {
  const b = buttons().find((x) => x.textContent === text);
  if (!b) throw new Error(`no hay un botón visible "${text}"; hay: ${buttons().map((x) => x.textContent).join(', ')}`);
  return b;
};
const visibleText = (): string => [...root.querySelectorAll('h1, h2, p, span, a, small')].filter(visible).map((e) => e.textContent).join(' | ');

beforeEach(() => {
  vi.clearAllMocks();
  root = document.createElement('div');
  document.body.replaceChildren(root);
  overlay = createOverlay(root, o);
});

test('mientras carga, el botón de jugar está deshabilitado y M no hace nada', () => {
  expect(overlay.screen).toBe('loading');
  expect(btn('Hacé click para jugar').disabled).toBe(true);
  overlay.togglePlaces();
  expect(overlay.screen).toBe('loading');
});

test('título con los textos exactos; el click pide el pointer lock', () => {
  overlay.ready(places);
  expect(overlay.screen).toBe('title');
  expect(visibleText()).toContain('Adrogué');
  expect(visibleText()).toContain(HELP);
  expect(HELP).toBe('WASD moverse · Espacio saltar · C agacharse · Mouse mirar · M lugares · Esc menú');
  btn('Hacé click para jugar').click();
  expect(o.requestLock).toHaveBeenCalledTimes(1);
});

test('con el puntero capturado se juega; al soltarlo aparece el menú de Esc', () => {
  overlay.ready(places);
  overlay.pointerLocked(true);
  expect(overlay.screen).toBe('playing');
  expect(buttons()).toEqual([]);
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('menu');
  expect(buttons().map((b) => b.textContent)).toEqual(['Seguir', 'Baja', 'Media', 'Alta', 'Lugares', 'Créditos']);
  expect(visibleText()).toContain('Calidad: | / | /');
  btn('Seguir').click();
  expect(o.requestLock).toHaveBeenCalledTimes(1);
});

test('benchmark: terminada la carga no se muestra nada y M / Esc / pointer lock no cambian la pantalla', () => {
  overlay.bench();
  expect(overlay.screen).toBe('bench');
  expect(buttons()).toEqual([]);
  expect(visibleText()).toBe('');
  overlay.togglePlaces();
  overlay.back();
  overlay.pointerLocked(true);
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('bench');
  expect(buttons()).toEqual([]);
  expect(o.exitLock).not.toHaveBeenCalled();
});

test('calidad: marca la elegida y avisa', () => {
  overlay.ready(places);
  overlay.pointerLocked(true);
  overlay.pointerLocked(false);
  expect(btn('Media').getAttribute('aria-pressed')).toBe('true');
  btn('Alta').click();
  expect(o.onQuality).toHaveBeenCalledWith('alta');
  expect(btn('Alta').getAttribute('aria-pressed')).toBe('true');
  expect(btn('Media').getAttribute('aria-pressed')).toBe('false');
  overlay.setQuality('baja');
  expect(btn('Baja').getAttribute('aria-pressed')).toBe('true');
});

test('lugares: ordenados por nombre, al azar primero; elegir uno teletransporta y vuelve a jugar', () => {
  overlay.ready(places);
  overlay.togglePlaces();
  expect(overlay.screen).toBe('places');
  const list = root.querySelector('[data-testid="menu-lugares"]')!;
  expect([...list.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Aparecer en un lugar al azar', 'Álamo', 'Banco', 'Zorra']);
  btn('Banco').click();
  expect(o.onPlace).toHaveBeenCalledWith('b');
  expect(o.requestLock).toHaveBeenCalledTimes(1);
  expect(overlay.screen).toBe('title');
  overlay.togglePlaces();
  btn('Aparecer en un lugar al azar').click();
  expect(o.onPlace).toHaveBeenLastCalledWith(null);
});

test('M jugando suelta el puntero y muestra lugares cuando el navegador lo confirma', () => {
  overlay.ready(places);
  overlay.pointerLocked(true);
  overlay.togglePlaces();
  expect(o.exitLock).toHaveBeenCalledTimes(1);
  expect(overlay.screen).toBe('playing');
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('places');
  overlay.togglePlaces(); // M otra vez: vuelve al menú (ya se jugó)
  expect(overlay.screen).toBe('menu');
});

test('Esc (back) y Volver cierran lugares y créditos', () => {
  overlay.ready(places);
  overlay.togglePlaces();
  overlay.back();
  expect(overlay.screen).toBe('title');
  overlay.pointerLocked(true);
  overlay.pointerLocked(false);
  btn('Lugares').click();
  btn('Volver').click();
  expect(overlay.screen).toBe('menu');
  overlay.back(); // en el menú, Esc no hace nada
  expect(overlay.screen).toBe('menu');
});

test('créditos: una entrada por fuente de data/sources.json, con link y licencia', () => {
  overlay.ready(places);
  overlay.pointerLocked(true);
  overlay.pointerLocked(false);
  btn('Créditos').click();
  expect(overlay.screen).toBe('credits');
  const items = [...root.querySelectorAll('.credits li')];
  expect(items).toHaveLength(sources.length);
  const osm = items.find((li) => li.querySelector('a')!.textContent === 'OpenStreetMap')!;
  expect(osm.querySelector('a')!.getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
  expect(osm.textContent).toContain('ODbL 1.0');
  btn('Volver').click();
  expect(overlay.screen).toBe('menu');
});

test('fatal reemplaza todo por el mensaje', () => {
  overlay.ready(places);
  overlay.fatal('Se perdió el contexto gráfico. Recargá la página.');
  expect(overlay.screen).toBe('error');
  expect(buttons()).toEqual([]);
  expect(visibleText()).toContain('Se perdió el contexto gráfico. Recargá la página.');
  overlay.pointerLocked(true);
  overlay.togglePlaces();
  expect(overlay.screen).toBe('error');
});
