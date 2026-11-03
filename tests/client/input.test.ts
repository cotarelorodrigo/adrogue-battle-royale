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
