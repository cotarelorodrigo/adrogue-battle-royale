// Teclado y mouse → PlayerInput. read() devuelve las teclas apretadas en este momento (el controlador detecta solo
// el flanco del salto). Las teclas se identifican por KeyboardEvent.code: la posición física, sin importar la
// distribución del teclado. El mouse solo mueve la vista con el puntero capturado (pointer lock).
import type { PlayerInput } from '../shared/player.ts';

/** Radianes por píxel de movimiento del mouse. */
export const MOUSE_SENSITIVITY = 0.0022;
/** Mirar justo arriba o abajo deja el yaw indefinido: se frena un poco antes. */
const PITCH_LIMIT = Math.PI / 2 - 0.01;

const TRACKED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC']);

export interface Input {
  read(): PlayerInput;
  /** Suelta todas las teclas (al perder el foco o esconder la pestaña no llegan los keyup). */
  reset(): void;
  /** Fija la vista (al teletransportarse); el pitch se limita igual que con el mouse. */
  setLook(yaw: number, pitch: number): void;
  dispose(): void;
}

const clampPitch = (p: number): number => Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, p));
const axis = (plus: boolean, minus: boolean): -1 | 0 | 1 => (plus === minus ? 0 : plus ? 1 : -1);

export function createInput(target: Window): Input {
  const doc = target.document;
  const held = new Set<string>();
  let yaw = 0;
  let pitch = 0;

  const reset = (): void => held.clear();
  const onKeyDown = (e: KeyboardEvent): void => {
    if (TRACKED.has(e.code)) held.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!doc.pointerLockElement) return;
    yaw -= e.movementX * MOUSE_SENSITIVITY; // a la derecha → gira a la derecha (yaw baja)
    pitch = clampPitch(pitch - e.movementY * MOUSE_SENSITIVITY); // hacia arriba (movementY < 0) → mira arriba
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') reset();
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('mousemove', onMouseMove);
  target.addEventListener('blur', reset);
  doc.addEventListener('visibilitychange', onVisibility);

  return {
    read: () => ({
      forward: axis(held.has('KeyW'), held.has('KeyS')),
      right: axis(held.has('KeyD'), held.has('KeyA')),
      jump: held.has('Space'),
      crouch: held.has('KeyC'),
      yaw,
      pitch,
    }),
    reset,
    setLook(y, p) {
      yaw = y;
      pitch = clampPitch(p);
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('blur', reset);
      doc.removeEventListener('visibilitychange', onVisibility);
      held.clear();
    },
  };
}
