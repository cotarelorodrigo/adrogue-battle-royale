// Teclado y mouse → MatchInput. Las teclas se identifican por KeyboardEvent.code: la posición física, sin importar la
// distribución del teclado. El mouse (mirar, disparar, apuntar y la rueda) solo cuenta con el puntero capturado.
//
// Estados y pulsos (el contrato de stepMatch):
// - WASD, Espacio, C, el clic izquierdo (`fire`) y el derecho (`aim`) son estados: read() dice si están apretados ahora
//   (el controlador detecta solo el flanco del salto, y la partida el del gatillo de las semiautomáticas).
// - E (`use`), R (`reload`), H (`heal`), 1 / 2 y la rueda (`slot`) son pulsos: cada toque queda guardado hasta el
//   próximo read(), que lo devuelve una sola vez. main.ts llama a read() una vez por paso de la simulación, así que
//   cada toque lo consume exactamente un paso, aunque en ese cuadro no corra ninguno.
// - Un clic más corto que un paso tampoco se pierde: `fire` da true en el read() siguiente aunque ya se haya soltado.
import type { MatchInput } from '../shared/match.ts';

/** Radianes por píxel de movimiento del mouse (con el fov normal; al apuntar se multiplica por setZoom). */
export const MOUSE_SENSITIVITY = 0.0022;
/** Mirar justo arriba o abajo deja el yaw indefinido: se frena un poco antes. */
const PITCH_LIMIT = Math.PI / 2 - 0.01;

const HELD_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC']);
/** Botones del mouse (MouseEvent.button). */
const LEFT = 0, RIGHT = 2;

export interface Input {
  /** La entrada de un paso. Consume los pulsos: llamarlo una vez por paso de la simulación. */
  read(): MatchInput;
  /** Hacia dónde se mira, sin consumir nada (para la cámara del cuadro). */
  look(): { yaw: number; pitch: number };
  /** Suelta todas las teclas y botones y descarta los pulsos (al perder el foco, esconder la pestaña o soltar el
   *  puntero: no llegan los keyup ni los mouseup). */
  reset(): void;
  /** Fija la vista (al teletransportarse); el pitch se limita igual que con el mouse. */
  setLook(yaw: number, pitch: number): void;
  /** Factor de la sensibilidad del mouse: al apuntar, el fov se cierra y la vista tiene que girar más despacio. */
  setZoom(k: number): void;
  dispose(): void;
}

const clampPitch = (p: number): number => Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, p));
const axis = (plus: boolean, minus: boolean): -1 | 0 | 1 => (plus === minus ? 0 : plus ? 1 : -1);

export function createInput(target: Window): Input {
  const doc = target.document;
  const held = new Set<string>();
  let yaw = 0;
  let pitch = 0;
  let zoom = 1;
  let fireHeld = false, aimHeld = false;
  /** pulsos guardados hasta el próximo read() */
  let firePress = false, use = false, reload = false, heal = false;
  let slot: 0 | 1 | null = null;

  const locked = (): boolean => doc.pointerLockElement !== null;
  const reset = (): void => {
    held.clear();
    fireHeld = aimHeld = false;
    firePress = use = reload = heal = false;
    slot = null;
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (HELD_KEYS.has(e.code)) held.add(e.code);
    if (e.repeat) return; // mantener E, R o H apretada no repite la acción
    switch (e.code) {
      case 'KeyE': use = true; break;
      case 'KeyR': reload = true; break;
      case 'KeyH': heal = true; break;
      case 'Digit1': slot = 0; break;
      case 'Digit2': slot = 1; break;
      default: break;
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!locked()) return;
    yaw -= e.movementX * MOUSE_SENSITIVITY * zoom; // a la derecha → gira a la derecha (yaw baja)
    pitch = clampPitch(pitch - e.movementY * MOUSE_SENSITIVITY * zoom); // hacia arriba (movementY < 0) → mira arriba
  };
  // mousedown / mouseup y no pointerdown: con un botón ya apretado, el segundo no da pointerdown.
  const onMouseDown = (e: MouseEvent): void => {
    if (!locked()) return; // el clic que captura el puntero (o el de un botón del menú) no dispara
    if (e.button === LEFT) fireHeld = firePress = true;
    else if (e.button === RIGHT) aimHeld = true;
  };
  const onMouseUp = (e: MouseEvent): void => {
    // siempre: un botón que se suelta con el menú abierto no puede quedar apretado
    if (e.button === LEFT) fireHeld = false;
    else if (e.button === RIGHT) aimHeld = false;
  };
  /** Rueda: hacia arriba la ranura 1, hacia abajo la 2 (con dos ranuras, un scroll largo no las alterna sin fin). */
  const onWheel = (e: WheelEvent): void => {
    if (!locked() || e.deltaY === 0) return;
    slot = e.deltaY < 0 ? 0 : 1;
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') reset();
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('mousemove', onMouseMove);
  target.addEventListener('mousedown', onMouseDown);
  target.addEventListener('mouseup', onMouseUp);
  target.addEventListener('wheel', onWheel, { passive: true });
  target.addEventListener('blur', reset);
  doc.addEventListener('visibilitychange', onVisibility);

  return {
    read() {
      const r: MatchInput = {
        forward: axis(held.has('KeyW'), held.has('KeyS')),
        right: axis(held.has('KeyD'), held.has('KeyA')),
        jump: held.has('Space'),
        crouch: held.has('KeyC'),
        yaw,
        pitch,
        fire: fireHeld || firePress,
        aim: aimHeld,
        reload,
        use,
        heal,
        slot,
      };
      firePress = use = reload = heal = false;
      slot = null;
      return r;
    },
    look: () => ({ yaw, pitch }),
    reset,
    setLook(y, p) {
      yaw = y;
      pitch = clampPitch(p);
    },
    setZoom(k) {
      zoom = k > 0 && Number.isFinite(k) ? k : 1;
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('mousemove', onMouseMove);
      target.removeEventListener('mousedown', onMouseDown);
      target.removeEventListener('mouseup', onMouseUp);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('blur', reset);
      doc.removeEventListener('visibilitychange', onVisibility);
      reset();
    },
  };
}
