// Pantallas sobre el juego: título, menú de Esc, lugares, créditos, victoria, derrota y errores. Decide qué se ve según
// el pointer lock: con el puntero capturado se juega; al soltarlo (Esc del navegador, cambio de ventana) aparece el menú.
// "Hacé click para jugar", "Jugar de nuevo" y "Jugar una partida" arrancan una partida; elegir un lugar arranca el modo
// paseo (sin partida, como en la etapa 1): con una partida en curso, el menú de lugares lo avisa.
import type { Place } from '../../shared/mapdata.ts';
import { QUALITY_LABEL } from '../render/quality.ts';
import type { Quality } from '../render/quality.ts';
import { createCredits } from './credits.ts';
import { createPlacesMenu } from './places-menu.ts';

export const HELP = 'WASD moverse · Espacio saltar · C agacharse · Mouse mirar · M lugares · Esc menú';
export const COMBAT_HELP = 'Clic disparar · Clic derecho apuntar · R recargar · E juntar · 1, 2 o rueda cambiar de arma · H botiquín';
/** En el menú de lugares, con una partida en curso (en la etapa 1 solo teletransportaba). */
export const LEAVES_MATCH = 'Elegir un lugar deja la partida y pasa al modo paseo';
const QUALITIES = Object.entries(QUALITY_LABEL) as [Quality, string][];

export type Screen = 'loading' | 'title' | 'playing' | 'menu' | 'places' | 'credits' | 'victoria' | 'derrota' | 'error' | 'bench';

/** Cómo terminó la partida, para la pantalla de fin. */
export interface MatchResult {
  won: boolean;
  /** cuántos quedaban vivos (en la derrota, sin contar al jugador: 0 si el último maniquí murió en el mismo paso) */
  alive: number;
  /** cuántos maniquíes tuvo la partida (0: práctica libre, donde solo mata la zona) */
  dummies: number;
  /** segundos jugados */
  time: number;
  kills: number;
}

export interface OverlayOptions {
  quality: Quality;
  /** Capturar el puntero. Se llama solo desde un click (el navegador exige un gesto del usuario). */
  requestLock(): void;
  exitLock(): void;
  onQuality(q: Quality): void;
  /** Arranca el modo paseo en ese lugar; `null` = un lugar al azar. */
  onPlace(placeId: string | null): void;
  /** Partida nueva ("Hacé click para jugar", "Jugar de nuevo", "Jugar una partida"); después se pide el puntero. */
  onPlay(): void;
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
  /** Hay partida o se está paseando: en el modo paseo el menú de Esc ofrece "Jugar una partida". */
  setMode(mode: 'partida' | 'paseo'): void;
  /** Terminó la partida: la pantalla de victoria o de derrota, cuando el navegador suelte el puntero (si se estaba
   *  jugando) o enseguida. Queda como pantalla de base hasta que arranque otra partida o el modo paseo. */
  matchOver(r: MatchResult): void;
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

/** "Te eliminaron — quedaban N"; si el último maniquí murió en el mismo paso, empate; sin maniquíes, la zona. */
function defeatTitle(r: MatchResult): string {
  if (r.dummies === 0) return 'Te eliminó la zona';
  if (r.alive === 0) return 'Te eliminaron — empate con la zona';
  return `Te eliminaron — ${r.alive === 1 ? 'quedaba 1' : `quedaban ${r.alive}`}`;
}

export function createOverlay(root: HTMLElement, o: OverlayOptions): Overlay {
  const wrap = el('div', 'overlay');

  const title = el('div', 'panel');
  const status = el('p', 'help', 'Cargando…');
  const startMatch = (): void => {
    ended = null;
    o.onPlay();
    o.requestLock();
  };
  const play = button('Hacé click para jugar', startMatch, 'primary');
  play.disabled = true;
  title.append(el('h1', undefined, 'Adrogué'), status, play, el('p', 'help', HELP), el('p', 'help', COMBAT_HELP));

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
  const playFromWalk = button('Jugar una partida', startMatch); // solo en el modo paseo
  playFromWalk.hidden = true;
  menu.append(
    button('Seguir', () => o.requestLock(), 'primary'),
    playFromWalk,
    quality,
    button('Lugares', () => show('places')),
    button('Créditos', () => show('credits')),
    el('p', 'help', HELP),
    el('p', 'help', COMBAT_HELP),
  );

  const end = el('div', 'panel end');
  const endTitle = el('h2');
  const endStats = el('p', 'help');
  end.append(endTitle, endStats, button('Jugar de nuevo', startMatch, 'primary'));

  const credits = createCredits(() => show(home()));
  let places: HTMLElement | null = null;
  const leavesMatch = el('p', 'help', LEAVES_MATCH);
  wrap.append(title, menu, end, credits);
  root.append(wrap);

  let screen: Screen = 'loading';
  let started = false; // ya se jugó: la pantalla de base pasa a ser el menú en vez del título
  let ended: 'victoria' | 'derrota' | null = null; // la partida terminó: la pantalla de base es la de fin
  let afterUnlock: Screen | null = null;
  let mode: 'partida' | 'paseo' | null = null; // null: todavía no se jugó (el fondo del título es un paseo)
  const home = (): Screen => ended ?? (started ? 'menu' : 'title');

  function show(s: Screen): void {
    screen = s;
    wrap.hidden = s === 'playing' || s === 'bench';
    title.hidden = s !== 'loading' && s !== 'title';
    menu.hidden = s !== 'menu';
    end.hidden = s !== 'victoria' && s !== 'derrota';
    credits.hidden = s !== 'credits';
    if (places) places.hidden = s !== 'places';
    showLeavesMatch();
    // Que Espacio no "apriete" el último botón con foco mientras se juega.
    if (s === 'playing' && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  /** El aviso de lugares, solo con una partida en curso (ni antes de la primera, ni en el paseo, ni terminada). */
  function showLeavesMatch(): void {
    leavesMatch.hidden = !(mode === 'partida' && ended === null);
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
          ended = null;
          o.onPlace(id);
          show(home());
          o.requestLock();
        },
        () => show(home()),
        leavesMatch,
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
    setMode(m) {
      mode = m;
      playFromWalk.hidden = m !== 'paseo';
      showLeavesMatch();
    },
    matchOver(r) {
      if (screen === 'loading' || screen === 'error' || screen === 'bench') return;
      ended = r.won ? 'victoria' : 'derrota';
      endTitle.textContent = r.won ? '¡Ganaste!' : defeatTitle(r);
      const secs = Math.max(0, Math.floor(r.time)); // el tiempo jugado, para abajo
      endStats.textContent = `Tiempo: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · Eliminaciones: ${r.kills}`;
      if (screen === 'playing') {
        afterUnlock = ended; // se muestra cuando el navegador confirme que soltó el puntero
        o.exitLock();
      } else if (screen === 'menu' || screen === 'title') {
        show(ended);
      }
    },
    fatal(message) {
      screen = 'error';
      showFatal(root, message);
    },
  };
}
