// @vitest-environment jsdom
// El menú de Esc solo aparece al soltar el pointer lock, que Chrome headless no tiene: el flujo de pantallas se prueba acá.
import sources from '../../data/sources.json';
import type { Place } from '../../src/shared/mapdata.ts';
import { COMBAT_HELP, createOverlay, HELP } from '../../src/client/ui/overlay.ts';
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
  onPlay: vi.fn(),
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

test('título con los textos exactos; el click arranca una partida y pide el pointer lock', () => {
  overlay.ready(places);
  expect(overlay.screen).toBe('title');
  expect(visibleText()).toContain('Adrogué');
  expect(visibleText()).toContain(HELP);
  expect(HELP).toBe('WASD moverse · Espacio saltar · C agacharse · Mouse mirar · M lugares · Esc menú');
  expect(visibleText()).toContain(COMBAT_HELP);
  expect(COMBAT_HELP).toBe('Clic disparar · Clic derecho apuntar · R recargar · E juntar · 1, 2 o rueda cambiar de arma · H botiquín');
  btn('Hacé click para jugar').click();
  expect(o.onPlay).toHaveBeenCalledTimes(1);
  expect(o.requestLock).toHaveBeenCalledTimes(1);
  expect(o.onPlay.mock.invocationCallOrder[0]).toBeLessThan(o.requestLock.mock.invocationCallOrder[0]);
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

test('el menú de Esc también muestra los controles', () => {
  overlay.ready(places);
  overlay.pointerLocked(true);
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('menu');
  expect(visibleText()).toContain(HELP);
  expect(visibleText()).toContain(COMBAT_HELP);
});

test('con una partida en curso, el menú de lugares avisa que elegir uno la deja', () => {
  const NOTE = 'Elegir un lugar deja la partida y pasa al modo paseo';
  overlay.ready(places);
  overlay.togglePlaces(); // desde el título, todavía sin partida
  expect(visibleText()).not.toContain(NOTE);
  overlay.togglePlaces();
  overlay.setMode('partida');
  overlay.pointerLocked(true);
  overlay.togglePlaces();
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('places');
  expect(visibleText()).toContain(NOTE);
  btn('Banco').click(); // pasa al modo paseo
  overlay.setMode('paseo');
  overlay.pointerLocked(true);
  overlay.togglePlaces();
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('places');
  expect(visibleText()).not.toContain(NOTE);
  // terminada, la partida ya no está en curso: elegir un lugar no deja nada
  btn('Volver').click();
  btn('Jugar una partida').click();
  overlay.setMode('partida');
  overlay.matchOver({ won: true, alive: 1, time: 100, kills: 11, dummies: 11 });
  overlay.togglePlaces();
  expect(overlay.screen).toBe('places');
  expect(visibleText()).not.toContain(NOTE);
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

// ---------- fin de la partida y modo paseo ----------

test('victoria: jugando suelta el puntero y muestra "¡Ganaste!" con el tiempo y las eliminaciones', () => {
  overlay.ready(places);
  overlay.pointerLocked(true);
  overlay.matchOver({ won: true, alive: 1, time: 205.4, kills: 4, dummies: 11 });
  expect(o.exitLock).toHaveBeenCalledTimes(1);
  expect(overlay.screen).toBe('playing'); // hasta que el navegador confirme que soltó el puntero
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('victoria');
  expect(visibleText()).toContain('¡Ganaste!');
  expect(visibleText()).toContain('Tiempo: 3:25 · Eliminaciones: 4'); // el tiempo jugado, para abajo
  expect(buttons().map((b) => b.textContent)).toEqual(['Jugar de nuevo']);
  overlay.back(); // Esc no la cierra
  expect(overlay.screen).toBe('victoria');
  btn('Jugar de nuevo').click();
  expect(o.onPlay).toHaveBeenCalledTimes(1);
  expect(o.requestLock).toHaveBeenCalledTimes(1);
  overlay.pointerLocked(true);
  expect(overlay.screen).toBe('playing');
  overlay.pointerLocked(false); // la partida nueva sigue: soltar el puntero vuelve al menú de Esc
  expect(overlay.screen).toBe('menu');
});

test('derrota: "Te eliminaron — quedaban N" (y "quedaba 1")', () => {
  overlay.ready(places);
  overlay.pointerLocked(true);
  overlay.matchOver({ won: false, alive: 5, time: 61, kills: 0, dummies: 11 });
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('derrota');
  expect(visibleText()).toContain('Te eliminaron — quedaban 5');
  expect(visibleText()).toContain('Tiempo: 1:01 · Eliminaciones: 0');
  expect(visibleText()).not.toContain('¡Ganaste!');
  btn('Jugar de nuevo').click();
  overlay.pointerLocked(true);
  overlay.matchOver({ won: false, alive: 1, time: 10, kills: 2, dummies: 11 });
  overlay.pointerLocked(false);
  expect(visibleText()).toContain('Te eliminaron — quedaba 1');
});

test('si el jugador y el último maniquí mueren en el mismo paso: "Te eliminaron — empate con la zona"', () => {
  overlay.ready(places);
  overlay.matchOver({ won: false, alive: 0, time: 731, kills: 1, dummies: 2 });
  expect(overlay.screen).toBe('derrota');
  expect(visibleText()).toContain('Te eliminaron — empate con la zona');
  expect(visibleText()).not.toContain('quedaban');
});

test('en la práctica libre (sin maniquíes) la derrota dice "Te eliminó la zona"', () => {
  overlay.ready(places);
  overlay.matchOver({ won: false, alive: 0, time: 400, kills: 0, dummies: 0 });
  expect(visibleText()).toContain('Te eliminó la zona');
  expect(visibleText()).not.toContain('empate');
  expect(visibleText()).not.toContain('quedaban');
});

test('si termina con el menú abierto, la pantalla de fin aparece enseguida', () => {
  overlay.ready(places);
  overlay.pointerLocked(true);
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('menu');
  overlay.matchOver({ won: true, alive: 1, time: 700, kills: 11, dummies: 11 });
  expect(o.exitLock).not.toHaveBeenCalled();
  expect(overlay.screen).toBe('victoria');
});

test('desde la pantalla de fin: M abre lugares, Volver regresa a ella y elegir un lugar sale al modo paseo', () => {
  overlay.ready(places);
  overlay.pointerLocked(true);
  overlay.matchOver({ won: false, alive: 3, time: 30, kills: 0, dummies: 11 });
  overlay.pointerLocked(false);
  overlay.togglePlaces();
  expect(overlay.screen).toBe('places');
  btn('Volver').click();
  expect(overlay.screen).toBe('derrota');
  overlay.togglePlaces();
  btn('Banco').click();
  expect(o.onPlace).toHaveBeenCalledWith('b');
  expect(o.requestLock).toHaveBeenCalledTimes(1);
  overlay.pointerLocked(true);
  overlay.pointerLocked(false);
  expect(overlay.screen).toBe('menu'); // ya no vuelve a la pantalla de fin
});

test('modo paseo: el menú de Esc ofrece "Jugar una partida"', () => {
  overlay.ready(places);
  overlay.setMode('paseo');
  overlay.pointerLocked(true);
  overlay.pointerLocked(false);
  expect(buttons().map((b) => b.textContent)).toEqual(['Seguir', 'Jugar una partida', 'Baja', 'Media', 'Alta', 'Lugares', 'Créditos']);
  btn('Jugar una partida').click();
  expect(o.onPlay).toHaveBeenCalledTimes(1);
  expect(o.requestLock).toHaveBeenCalledTimes(1);
  overlay.setMode('partida');
  expect(buttons().map((b) => b.textContent)).toEqual(['Seguir', 'Baja', 'Media', 'Alta', 'Lugares', 'Créditos']);
});
