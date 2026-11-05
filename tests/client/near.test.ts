// Las copias cercanas de una InstancedMesh (T11b): los detalles chicos de todo el mapa (durmientes, escaleras de mano) se
// dibujan solo a menos de un radio de la cámara, en la misma malla (sin draw calls nuevos).
import * as THREE from 'three';
import { inViewInstances, NEAR_STEP, nearInstances, nearOf } from '../../src/client/world/near.ts';

/** 100 copias sobre el eje x, de 0 a 990 m, con un color cada una. */
function line(): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 100);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 100; i++) {
    mesh.setMatrixAt(i, m.makeTranslation(i * 10, 0.5, 3));
    mesh.setColorAt(i, new THREE.Color(i / 100, 0, 0));
  }
  return mesh;
}
const xs = (mesh: THREE.InstancedMesh): number[] => Array.from({ length: mesh.count }, (_, k) => mesh.instanceMatrix.array[k * 16 + 12]);

test('antes del primer update, todas; después, las que están a menos del radio (en planta) del ojo, con su matriz y su color', () => {
  const mesh = line();
  const near = nearInstances(mesh, 100);
  expect(mesh.count).toBe(100);
  near.update(new THREE.Vector3(500, 40, 3)); // la altura no cuenta
  const got = xs(mesh);
  // a menos de radio + NEAR_STEP: entre updates, lo que está a menos del radio queda adentro
  expect(got.every((x) => Math.abs(x - 500) < 100 + NEAR_STEP)).toBe(true);
  expect(got.length).toBe(Array.from({ length: 100 }, (_, i) => i * 10).filter((x) => Math.abs(x - 500) < 100 + NEAR_STEP).length);
  for (let k = 0; k < mesh.count; k++) {
    const c = new THREE.Color();
    mesh.getColorAt(k, c);
    expect(c.r).toBeCloseTo(got[k] / 1000, 5);
  }
  expect(mesh.userData.near).toBe(near);
});

test('si el ojo se movió menos de NEAR_STEP no se vuelve a elegir; con un radio nuevo, sí', () => {
  const mesh = line();
  const near = nearInstances(mesh, 50);
  near.update(new THREE.Vector3(0, 0, 0));
  const v = mesh.instanceMatrix.version;
  near.update(new THREE.Vector3(NEAR_STEP * 0.9, 0, 0));
  expect(mesh.instanceMatrix.version).toBe(v);
  near.update(new THREE.Vector3(NEAR_STEP * 1.1, 0, 0));
  expect(mesh.instanceMatrix.version).toBeGreaterThan(v);
  near.radius = 200;
  near.update(new THREE.Vector3(NEAR_STEP * 1.1, 0, 0));
  expect(Math.max(...xs(mesh))).toBeGreaterThan(150);
  near.radius = Infinity;
  near.update(new THREE.Vector3(NEAR_STEP * 1.1, 0, 0));
  expect(mesh.count).toBe(100);
});

test('volviendo al principio, las primeras copias son las de ahí (no lo que quedó de la elección anterior)', () => {
  const mesh = line();
  const near = nearInstances(mesh, 20);
  near.update(new THREE.Vector3(900, 0, 3));
  near.update(new THREE.Vector3(0, 0, 3));
  expect(xs(mesh)).toEqual([0, 10, 20]);
});

test('lejos de todas: ninguna, y la malla no se dibuja (ni en la sombra); al volver, sí', () => {
  const mesh = line();
  const near = nearInstances(mesh, 30);
  near.update(new THREE.Vector3(5000, 0, 5000));
  expect(mesh.count).toBe(0);
  expect(mesh.visible).toBe(false);
  near.update(new THREE.Vector3(0, 0, 0));
  expect(mesh.count).toBeGreaterThan(0);
  expect(mesh.visible).toBe(true);
});

test('nearOf junta las de un árbol de objetos', () => {
  const g = new THREE.Group();
  const [a, b] = [line(), line()];
  g.add(a, new THREE.Group().add(b), new THREE.Mesh());
  const na = nearInstances(a), nb = nearInstances(b);
  expect(nearOf([g])).toEqual([na, nb]);
});

// Las del cuadro (los contenedores, T11b): en vez de una malla por celda de 250 m (un draw call por celda que toca el
// cuadro, con todo lo de la celda adentro), dos: `near`, las de alrededor (las que pueden dar sombra al cuadro aunque
// estén atrás; es la malla dada), y `far`, las demás que ve la cámara, que nunca dan sombra
describe('inViewInstances', () => {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.15, 300);
  const look = (x: number, z: number, tx: number, tz: number): void => {
    cam.position.set(x, 1.6, z);
    cam.lookAt(tx, 1.6, tz);
    cam.updateMatrixWorld();
  };

  test('las del cuadro (hasta camera.far) van en far; con around, las de alrededor van en near, se vean o no, sin repetirse', () => {
    const mesh = line(); // x de 0 a 990, z = 3
    mesh.castShadow = true;
    const view = inViewInstances(mesh);
    expect([view.near, mesh.count, view.far.count]).toEqual([mesh, 100, 0]); // antes del primer update, todas una vez
    expect(view.far.castShadow).toBe(false);
    look(500, 3, 1000, 3); // mirando a +x desde 500
    view.update(cam);
    const got = xs(view.far);
    expect(Math.min(...got)).toBeGreaterThanOrEqual(499);
    expect(Math.max(...got)).toBeLessThanOrEqual(800 + 1); // camera.far 300
    expect(got.length).toBeGreaterThan(25);
    expect([mesh.count, mesh.visible]).toEqual([0, false]);
    view.around = 55;
    view.update(cam);
    const near = xs(mesh), far = xs(view.far);
    expect(near.every((x) => Math.abs(x - 500) < 55)).toBe(true);
    expect(Math.min(...near)).toBeLessThan(460); // las de atrás
    expect(far.every((x) => !near.includes(x))).toBe(true);
    expect(got.every((x) => near.includes(x) || far.includes(x)), 'lo del cuadro sigue, en una de las dos').toBe(true);
    expect(mesh.userData.inView).toBe(view);
  });

  test('si la elección no cambia, no se vuelve a subir; mirando a otro lado, sí', () => {
    const mesh = line();
    const view = inViewInstances(mesh);
    look(500, 3, 1000, 3);
    view.update(cam);
    const v = view.far.instanceMatrix.version;
    cam.rotateY(0.01);
    cam.updateMatrixWorld();
    view.update(cam);
    expect(view.far.instanceMatrix.version).toBe(v);
    look(500, 3, 0, 3);
    view.update(cam);
    expect(view.far.instanceMatrix.version).toBeGreaterThan(v);
    expect(Math.max(...xs(view.far))).toBeLessThanOrEqual(501);
  });

  test('nada a la vista: las mallas no se dibujan', () => {
    const mesh = line();
    const view = inViewInstances(mesh);
    look(500, 500, 500, 1000);
    view.update(cam);
    expect([mesh.visible, view.far.count, view.far.visible]).toEqual([false, 0, false]);
  });

  test('con keep (desde adentro de un interior: lo que se ve por sus aberturas), de las del cuadro solo las que pasan', () => {
    const mesh = line();
    const view = inViewInstances(mesh);
    look(500, 3, 1000, 3);
    view.update(cam, (s) => s.center.x < 600);
    const got = xs(view.far);
    expect(got.length).toBeGreaterThan(5);
    expect(Math.max(...got)).toBeLessThan(600);
  });
});
