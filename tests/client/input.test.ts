// @vitest-environment jsdom
import { createInput, MOUSE_SENSITIVITY } from '../../src/client/input.ts';

let input: ReturnType<typeof createInput>;

const key = (type: 'keydown' | 'keyup', code: string): void => {
  window.dispatchEvent(new KeyboardEvent(type, { code }));
};
const press = (code: string): void => key('keydown', code);
const release = (code: string): void => key('keyup', code);

/** jsdom no tiene Pointer Lock ni movementX/Y: se simulan. */
const setLocked = (locked: boolean): void => {
  Object.defineProperty(document, 'pointerLockElement', { value: locked ? document.body : null, configurable: true });
};
const moveMouse = (dx: number, dy: number): void => {
  const e = new MouseEvent('mousemove');
  Object.defineProperty(e, 'movementX', { value: dx });
  Object.defineProperty(e, 'movementY', { value: dy });
  window.dispatchEvent(e);
};
const setHidden = (hidden: boolean): void => {
  Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
};

beforeEach(() => {
  setLocked(false);
  setHidden(false);
  input = createInput(window);
});
afterEach(() => input.dispose());

test('blur suelta todas las teclas', () => {
  press('KeyW');
  press('KeyD');
  press('Space');
  press('KeyC');
  window.dispatchEvent(new Event('blur'));
  expect(input.read()).toMatchObject({ forward: 0, right: 0, jump: false, crouch: false });
});

test('W/S/A/D → forward/right', () => {
  press('KeyW');
  press('KeyD');
  expect(input.read()).toMatchObject({ forward: 1, right: 1 });
});

test('S y A dan −1; W+S se anulan', () => {
  press('KeyS');
  press('KeyA');
  expect(input.read()).toMatchObject({ forward: -1, right: -1 });
  press('KeyW');
  press('KeyD');
  expect(input.read()).toMatchObject({ forward: 0, right: 0 });
  release('KeyS');
  expect(input.read().forward).toBe(1);
});

test('Espacio y C se reportan mientras están apretadas', () => {
  press('Space');
  press('KeyC');
  expect(input.read()).toMatchObject({ jump: true, crouch: true });
  expect(input.read()).toMatchObject({ jump: true, crouch: true }); // read() no consume: el salto lo detecta el controlador
  release('Space');
  release('KeyC');
  expect(input.read()).toMatchObject({ jump: false, crouch: false });
});

test('pestaña oculta (visibilitychange) suelta todas las teclas', () => {
  press('KeyW');
  setHidden(true);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(input.read().forward).toBe(0);
});

test('volver a la pestaña no suelta lo que se aprieta después', () => {
  setHidden(false);
  press('KeyW');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(input.read().forward).toBe(1);
});

test('reset() suelta todo', () => {
  press('KeyW');
  press('Space');
  input.reset();
  expect(input.read()).toMatchObject({ forward: 0, jump: false });
});

test('mouse con pointer lock: derecha baja el yaw, arriba sube el pitch', () => {
  setLocked(true);
  moveMouse(100, -50);
  const r = input.read();
  expect(r.yaw).toBeCloseTo(-100 * MOUSE_SENSITIVITY, 9);
  expect(r.pitch).toBeCloseTo(50 * MOUSE_SENSITIVITY, 9);
});

test('el pitch se limita a ±(π/2 − 0,01)', () => {
  setLocked(true);
  moveMouse(0, -1e6);
  expect(input.read().pitch).toBeCloseTo(Math.PI / 2 - 0.01, 9);
  moveMouse(0, 2e6);
  expect(input.read().pitch).toBeCloseTo(-(Math.PI / 2 - 0.01), 9);
});

test('sin pointer lock el mouse no mueve la vista', () => {
  moveMouse(300, 300);
  expect(input.read()).toMatchObject({ yaw: 0, pitch: 0 });
});

test('setLook fija la vista (con el pitch limitado) y el mouse sigue desde ahí', () => {
  input.setLook(1, 5);
  expect(input.read().yaw).toBe(1);
  expect(input.read().pitch).toBeCloseTo(Math.PI / 2 - 0.01, 9);
  setLocked(true);
  moveMouse(10, 0);
  expect(input.read().yaw).toBeCloseTo(1 - 10 * MOUSE_SENSITIVITY, 9);
});

test('dispose saca los listeners', () => {
  input.dispose();
  press('KeyW');
  expect(input.read().forward).toBe(0);
});

test('teclas ajenas no cuentan y la distribución del teclado no importa (code, no key)', () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'w' }));
  expect(input.read().forward).toBe(0);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'z' })); // AZERTY: la tecla de W dice 'z'
  expect(input.read().forward).toBe(1);
});

// ---------- botones del mouse, rueda y pulsos de la partida ----------

const mouse = (type: 'mousedown' | 'mouseup', button: number): void => {
  window.dispatchEvent(new MouseEvent(type, { button }));
};
const wheel = (deltaY: number): void => {
  window.dispatchEvent(new WheelEvent('wheel', { deltaY }));
};

test('fire es true mientras el botón izquierdo está apretado', () => {
  setLocked(true);
  mouse('mousedown', 0);
  expect(input.read().fire).toBe(true);
  expect(input.read().fire).toBe(true);
  expect(input.read().fire).toBe(true);
  mouse('mouseup', 0);
  expect(input.read().fire).toBe(false);
});

test('un clic más corto que un paso igual dispara una vez', () => {
  setLocked(true);
  mouse('mousedown', 0);
  mouse('mouseup', 0);
  expect(input.read().fire).toBe(true);
  expect(input.read().fire).toBe(false);
});

test('aim es true mientras el botón derecho está apretado, aunque se dispare a la vez', () => {
  setLocked(true);
  mouse('mousedown', 2);
  mouse('mousedown', 0);
  expect(input.read()).toMatchObject({ aim: true, fire: true });
  mouse('mouseup', 0);
  expect(input.read()).toMatchObject({ aim: true, fire: false });
  mouse('mouseup', 2);
  expect(input.read().aim).toBe(false);
});

test('sin el puntero capturado los botones no disparan ni apuntan, pero soltarlos siempre cuenta', () => {
  mouse('mousedown', 0);
  mouse('mousedown', 2);
  expect(input.read()).toMatchObject({ fire: false, aim: false });
  setLocked(true);
  mouse('mousedown', 0);
  setLocked(false); // Esc con el botón apretado: el mouseup llega con el menú abierto
  mouse('mouseup', 0);
  input.read();
  expect(input.read().fire).toBe(false);
});

test('use es true un solo read por toque de E (aunque se mantenga apretada)', () => {
  setLocked(true);
  press('KeyE');
  expect(input.read().use).toBe(true);
  expect(input.read().use).toBe(false);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', repeat: true })); // la repetición del teclado
  expect(input.read().use).toBe(false);
  release('KeyE');
  expect(input.read().use).toBe(false);
  press('KeyE');
  release('KeyE'); // el toque se guarda hasta el próximo read, aunque ya se haya soltado
  expect(input.read().use).toBe(true);
});

test('R recarga y H usa el botiquín, un read por toque', () => {
  setLocked(true);
  press('KeyR');
  press('KeyH');
  expect(input.read()).toMatchObject({ reload: true, heal: true });
  expect(input.read()).toMatchObject({ reload: false, heal: false });
});

test('1 y 2 eligen la ranura, un read por toque', () => {
  setLocked(true);
  press('Digit2');
  expect(input.read().slot).toBe(1);
  expect(input.read().slot).toBeNull();
  press('Digit1');
  expect(input.read().slot).toBe(0);
});

test('la rueda: arriba la ranura 1, abajo la 2 (solo con el puntero capturado)', () => {
  wheel(100);
  expect(input.read().slot).toBeNull();
  setLocked(true);
  wheel(100);
  wheel(120);
  expect(input.read().slot).toBe(1);
  expect(input.read().slot).toBeNull();
  wheel(-100);
  expect(input.read().slot).toBe(0);
});

test('look() da la vista sin consumir los pulsos', () => {
  setLocked(true);
  input.setLook(0.5, 0.2);
  press('KeyE');
  expect(input.look()).toEqual({ yaw: 0.5, pitch: 0.2 });
  expect(input.read()).toMatchObject({ use: true, yaw: 0.5, pitch: 0.2 });
});

test('reset() descarta los pulsos y suelta los botones', () => {
  setLocked(true);
  mouse('mousedown', 0);
  mouse('mousedown', 2);
  press('KeyE');
  press('Digit2');
  input.reset();
  expect(input.read()).toMatchObject({ fire: false, aim: false, use: false, slot: null });
});

test('E, R, H, 1 y 2 con el puntero libre (menús, pantalla de fin) no cuentan, tampoco después de capturarlo', () => {
  press('KeyE');
  press('KeyR');
  press('KeyH');
  press('Digit2');
  const none = { use: false, reload: false, heal: false, slot: null };
  expect(input.read()).toMatchObject(none);
  press('KeyE');
  press('KeyH');
  setLocked(true); // "Seguir" o "Jugar de nuevo"
  expect(input.read()).toMatchObject(none);
});

test('WASD, Espacio y C apretadas con el puntero libre siguen contando al capturarlo (como antes)', () => {
  press('KeyW');
  press('Space');
  setLocked(true);
  expect(input.read()).toMatchObject({ forward: 1, jump: true });
});

test('reset() descarta un pulso guardado', () => {
  setLocked(true);
  press('KeyH');
  input.reset();
  expect(input.read().heal).toBe(false);
});

test('clearPulses() descarta los pulsos guardados pero no suelta lo que sigue apretado', () => {
  setLocked(true);
  press('KeyW');
  mouse('mousedown', 2);
  mouse('mousedown', 0);
  mouse('mouseup', 0); // un clic guardado
  press('KeyE');
  press('KeyR');
  press('KeyH');
  press('Digit2');
  input.clearPulses();
  expect(input.read()).toMatchObject({ forward: 1, aim: true, fire: false, use: false, reload: false, heal: false, slot: null });
  mouse('mousedown', 0);
  input.clearPulses();
  expect(input.read().fire).toBe(true); // el botón sigue apretado: es un estado, no un pulso
});

test('setZoom achica lo que gira el mouse', () => {
  setLocked(true);
  input.setZoom(0.25);
  moveMouse(100, 0);
  expect(input.read().yaw).toBeCloseTo(-25 * MOUSE_SENSITIVITY, 9);
});
