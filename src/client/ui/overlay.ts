// Pantallas sobre el juego: título, menú de Esc, lugares, créditos y errores. Decide qué se ve según el pointer lock:
// con el puntero capturado se juega; al soltarlo (Esc del navegador, cambio de ventana) aparece el menú.
import type { Place } from '../../shared/mapdata.ts';
import { QUALITY_LABEL } from '../render/quality.ts';
import type { Quality } from '../render/quality.ts';
import { createCredits } from './credits.ts';
import { createPlacesMenu } from './places-menu.ts';

export const HELP = 'WASD moverse · Espacio saltar · C agacharse · Mouse mirar · M lugares · Esc menú';
const QUALITIES = Object.entries(QUALITY_LABEL) as [Quality, string][];

export type Screen = 'loading' | 'title' | 'playing' | 'menu' | 'places' | 'credits' | 'error' | 'bench';

export interface OverlayOptions {
  quality: Quality;
  /** Capturar el puntero. Se llama solo desde un click (el navegador exige un gesto del usuario). */
  requestLock(): void;
  exitLock(): void;
  onQuality(q: Quality): void;
  /** `null` = un lugar al azar. */
  onPlace(placeId: string | null): void;
}

export interface Overlay {
  readonly screen: Screen;
  /** Terminó la carga: habilita "Hacé click para jugar" y arma el menú de lugares. */
  ready(places: Place[]): void;
  /** Terminó la carga en modo benchmark (?bench=1): no se muestra nada ni se juega; el benchmark pone su cartel. */
  bench(): void;
  /** Avisar cada pointerlockchange. */
  pointerLocked(locked: boolean): void;
  /** Tecla M. */
  togglePlaces(): void;
  /** Tecla Esc con el puntero libre: cierra lugares o créditos. */
  back(): void;
  setQuality(q: Quality): void;
  fatal(message: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void, className?: string): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Reemplaza todo lo que hay en `root` por un mensaje (sin WebGL2, contexto perdido, mapa que no carga). */
export function showFatal(root: HTMLElement, message: string): void {
  const wrap = el('div', 'overlay fatal');
  wrap.setAttribute('role', 'alert');
  const panel = el('div', 'panel');
  panel.append(el('h1', undefined, 'Adrogué'), el('p', undefined, message));
  wrap.append(panel);
  root.replaceChildren(wrap);
}

export function createOverlay(root: HTMLElement, o: OverlayOptions): Overlay {
  const wrap = el('div', 'overlay');

  const title = el('div', 'panel');
  const status = el('p', 'help', 'Cargando…');
  const play = button('Hacé click para jugar', () => o.requestLock(), 'primary');
  play.disabled = true;
  title.append(el('h1', undefined, 'Adrogué'), status, play, el('p', 'help', HELP));

  const menu = el('div', 'panel');
  const quality = el('div', 'quality');
  quality.append(el('span', undefined, 'Calidad:'));
  const qualityButtons = new Map<Quality, HTMLButtonElement>();
  QUALITIES.forEach(([q, label], i) => {
    if (i > 0) quality.append(el('span', undefined, '/'));
    const b = button(label, () => {
      setQuality(q);
      o.onQuality(q);
    });
    qualityButtons.set(q, b);
    quality.append(b);
  });
  menu.append(
    button('Seguir', () => o.requestLock(), 'primary'),
    quality,
    button('Lugares', () => show('places')),
    button('Créditos', () => show('credits')),
  );

  const credits = createCredits(() => show(home()));
  let places: HTMLElement | null = null;
  wrap.append(title, menu, credits);
  root.append(wrap);

  let screen: Screen = 'loading';
  let started = false; // ya se jugó: la pantalla de base pasa a ser el menú en vez del título
  let afterUnlock: Screen | null = null;
  const home = (): Screen => (started ? 'menu' : 'title');

  function show(s: Screen): void {
    screen = s;
    wrap.hidden = s === 'playing' || s === 'bench';
    title.hidden = s !== 'loading' && s !== 'title';
    menu.hidden = s !== 'menu';
    credits.hidden = s !== 'credits';
    if (places) places.hidden = s !== 'places';
    // Que Espacio no "apriete" el último botón con foco mientras se juega.
    if (s === 'playing' && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  function setQuality(q: Quality): void {
    for (const [k, b] of qualityButtons) b.setAttribute('aria-pressed', String(k === q));
  }

  setQuality(o.quality);
  show('loading');

  return {
    get screen() {
      return screen;
    },
    ready(list) {
      places = createPlacesMenu(
        list,
        (id) => {
          o.onPlace(id);
          show(home());
          o.requestLock();
        },
        () => show(home()),
      );
      wrap.append(places);
      status.hidden = true;
      play.disabled = false;
      show('title');
    },
    bench() {
      show('bench');
    },
    pointerLocked(locked) {
      if (screen === 'loading' || screen === 'error' || screen === 'bench') return;
      if (locked) {
        started = true;
        afterUnlock = null;
        show('playing');
      } else if (screen === 'playing') {
        show(afterUnlock ?? 'menu');
        afterUnlock = null;
      }
    },
    togglePlaces() {
      if (screen === 'loading' || screen === 'error' || screen === 'bench') return;
      if (screen === 'playing') {
        afterUnlock = 'places'; // se muestra cuando el navegador confirme que soltó el puntero
        o.exitLock();
      } else {
        show(screen === 'places' ? home() : 'places');
      }
    },
    back() {
      if (screen === 'places' || screen === 'credits') show(home());
    },
    setQuality,
    fatal(message) {
      screen = 'error';
      showFatal(root, message);
    },
  };
}
