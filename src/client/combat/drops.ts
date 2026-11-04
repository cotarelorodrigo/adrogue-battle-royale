// El botín tirado en el piso: una InstancedMesh por tipo de objeto (las 4 armas, la munición, el chaleco y el
// botiquín: 7 draw calls como mucho, sin sombra). Solo se dibuja lo que está a menos de DROP_RADIUS de la cámara
// (spec 2a §5), o menos en las calidades que lo achican (setRadius). Cada objeto flota centrado en pos + dropLift, el
// punto que se mira para juntarlo, y gira despacio.
import * as THREE from 'three';
import type { AmmoId } from '../../shared/combat.ts';
import { hashIndex } from '../../shared/geo.ts';
import type { LootItem } from '../../shared/loot.ts';
import { MATCH } from '../../shared/match.ts';
import type { MatchDrop } from '../../shared/match.ts';
import { dropGeometry, DROP_KINDS } from './models.ts';
import type { DropKind } from './models.ts';
import type { CombatView } from './types.ts';

/** Más lejos que esto (m, desde la cámara hasta el centro del objeto) no se dibuja nunca. */
export const DROP_RADIUS = 120;
/** Vueltas: rad/s. Vaivén: amplitud (m) y rad/s. */
const SPIN = 0.9;
const BOB = 0.04;
const BOB_SPEED = 2.2;
/** El color de la caja de cada munición (el mismo que en el HUD, para reconocerla). */
const AMMO_COLOR: Record<AmmoId, THREE.Color> = {
  liviana: new THREE.Color('#d9b23a'),
  cartuchos: new THREE.Color('#c0392b'),
  pesada: new THREE.Color('#4f8a3a'),
};
const START_CAPACITY = 32;

export const dropKind = (item: LootItem): DropKind => (item.kind === 'arma' ? item.weapon : item.kind);

export interface DropsView extends CombatView {
  /** Una malla por tipo, en el orden de DROP_KINDS (cambian si hace falta más capacidad). */
  readonly meshes: readonly THREE.InstancedMesh[];
  /** Hasta dónde se dibuja (m), según la calidad; nunca más que DROP_RADIUS. */
  setRadius(r: number): void;
}

export function createDrops(parent: THREE.Object3D): DropsView {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const geometries = DROP_KINDS.map((k) => dropGeometry(k));
  const meshes = DROP_KINDS.map((_, i) => makeMesh(i, START_CAPACITY));
  for (const m of meshes) parent.add(m);
  /** Los objetos cerca de la cámara, por tipo: se reusan cuadro a cuadro. */
  const near: MatchDrop[][] = DROP_KINDS.map(() => []);
  let radius: number = DROP_RADIUS;

  function makeMesh(i: number, capacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geometries[i], material, capacity);
    m.name = `drop-${DROP_KINDS[i]}`;
    m.count = 0;
    m.visible = false;
    if (DROP_KINDS[i] === 'municion') m.setColorAt(0, AMMO_COLOR.liviana); // el color por instancia existe desde el principio
    return m;
  }

  const mat = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const Y = new THREE.Vector3(0, 1, 0);

  return {
    meshes,
    setRadius(r) {
      radius = Math.min(DROP_RADIUS, Math.max(0, r));
    },
    update({ state, cam, now }) {
      for (const list of near) list.length = 0;
      const r2 = radius * radius;
      for (const d of state.drops) {
        const dx = d.pos[0] - cam.pos[0], dy = d.pos[1] + MATCH.dropLift - cam.pos[1], dz = d.pos[2] - cam.pos[2];
        if (dx * dx + dy * dy + dz * dz <= r2) near[DROP_KINDS.indexOf(dropKind(d.item))].push(d);
      }
      const s = now / 1000;
      near.forEach((list, i) => {
        let m = meshes[i];
        if (list.length > m.instanceMatrix.count) {
          parent.remove(m);
          m.dispose();
          m = meshes[i] = makeMesh(i, Math.max(list.length, m.instanceMatrix.count * 2));
          parent.add(m);
        }
        list.forEach((d, j) => {
          const phase = hashIndex(d.id) * 2 * Math.PI;
          pos.set(d.pos[0], d.pos[1] + MATCH.dropLift + BOB * Math.sin(s * BOB_SPEED + phase), d.pos[2]);
          m.setMatrixAt(j, mat.compose(pos, q.setFromAxisAngle(Y, s * SPIN + phase), one));
          if (d.item.kind === 'municion') m.setColorAt(j, AMMO_COLOR[d.item.ammo]);
        });
        m.count = list.length;
        m.visible = list.length > 0;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.boundingSphere = null; // three lo recalcula con las instancias de ahora para el frustum culling
      });
    },
    dispose() {
      for (const m of meshes) {
        parent.remove(m);
        m.dispose();
      }
      for (const g of geometries) g.dispose();
      material.dispose();
    },
  };
}
