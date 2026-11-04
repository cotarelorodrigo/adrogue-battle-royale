// Los maniquíes: todos en una InstancedMesh (1 draw call, y otro en la pasada de sombras si la calidad la pide: ver
// setShadows). Cada uno mira hacia un lado fijo sacado de su id; un impacto lo tiñe un instante; al morir se cae de
// espaldas y a los DUMMY_GONE_AFTER s desaparece.
import * as THREE from 'three';
import { hash01 } from '../../shared/geo.ts';
import { PLAYER } from '../../shared/player.ts';
import { dummyGeometry } from './models.ts';
import type { CombatView } from './types.ts';

/** Segundos (de la partida) desde la muerte hasta que deja de dibujarse. */
export const DUMMY_GONE_AFTER = 2;
/** Lo que tarda en caer, en s. */
const FALL_TIME = 0.5;
/** Tirado, la espalda queda sobre el piso y no adentro. */
const LYING_LIFT = 0.14;
const HIT_FLASH_MS = 120;
const HIT_TINT = new THREE.Color(1, 0.35, 0.3);
const WHITE = new THREE.Color(1, 1, 1);
/** Hasta 23 maniquíes por partida (?maniquis=0…23); si hacen falta más, la malla se rehace más grande. */
const START_CAPACITY = 23;

export interface DummiesView extends CombatView {
  /** La malla de los maniquíes (cambia si hace falta más capacidad). */
  readonly mesh: THREE.InstancedMesh;
  /** Si proyectan sombra (según la calidad: duplica sus triángulos). */
  setShadows(on: boolean): void;
}

export function createDummies(parent: THREE.Object3D): DummiesView {
  const geometry = dummyGeometry();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  /** id → hasta cuándo (ms) sigue teñido por el último impacto */
  const flashUntil = new Map<string, number>();
  /** id → hacia dónde mira (rad): sale del id, se calcula una vez */
  const facing = new Map<string, number>();
  const yawOf = (id: string): number => {
    let yaw = facing.get(id);
    if (yaw === undefined) {
      yaw = hash01(`maniqui:${id}`) * 2 * Math.PI;
      facing.set(id, yaw);
    }
    return yaw;
  };
  let shadows = true;
  let mesh = makeMesh(START_CAPACITY);
  parent.add(mesh);

  function makeMesh(capacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geometry, material, capacity);
    m.name = 'dummies';
    m.castShadow = shadows;
    m.receiveShadow = true;
    m.count = 0;
    m.visible = false;
    m.setColorAt(0, WHITE); // el atributo de color existe desde el principio: el primer impacto no recompila el shader
    return m;
  }

  const mat = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), fall = new THREE.Quaternion();
  const scale = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

  return {
    get mesh() { return mesh; },
    setShadows(on) {
      shadows = on;
      mesh.castShadow = on;
    },
    update({ state, now, events }) {
      for (const e of events) if (e.type === 'hit') flashUntil.set(e.id, now + HIT_FLASH_MS);
      if (state.dummies.length > mesh.instanceMatrix.count) {
        parent.remove(mesh);
        mesh.dispose();
        mesh = makeMesh(Math.max(state.dummies.length, mesh.instanceMatrix.count * 2));
        parent.add(mesh);
      }
      let n = 0;
      for (const d of state.dummies) {
        let k = 0; // 0 de pie, 1 en el piso
        if (!d.alive) {
          const dead = state.t - (d.diedAt ?? -Infinity);
          if (!(dead < DUMMY_GONE_AFTER)) continue;
          const f = Math.min(1, Math.max(0, dead) / FALL_TIME);
          k = f * f; // cae cada vez más rápido
        }
        const p = d.player.pos;
        pos.set(p[0], p[1] + LYING_LIFT * k, p[2]);
        q.setFromAxisAngle(Y, yawOf(d.id)).multiply(fall.setFromAxisAngle(X, (-Math.PI / 2) * k));
        scale.set(1, d.player.crouching ? PLAYER.crouchHeight / PLAYER.height : 1, 1);
        mesh.setMatrixAt(n, mat.compose(pos, q, scale));
        mesh.setColorAt(n, (flashUntil.get(d.id) ?? -Infinity) > now ? HIT_TINT : WHITE);
        n++;
      }
      for (const [id, until] of flashUntil) if (until <= now) flashUntil.delete(id);
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      // la esfera del frustum culling, con las instancias de ahora: three no la recalcula sola, y así reusa la misma
      if (mesh.visible) mesh.computeBoundingSphere();
    },
    dispose() {
      parent.remove(mesh);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
