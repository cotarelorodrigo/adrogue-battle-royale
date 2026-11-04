// El arma en primera persona (spec 2a §4), en una escena aparte con su propia cámara (fov VIEW_FOV). render() la
// dibuja encima del mundo, después de scene.render() y en el mismo cuadro: limpia solo la profundidad (el arma nunca se
// mete en una pared) y no toca el color. Sus draw calls se suman a los del mundo en renderer.info, que scene.ts pone
// en cero una sola vez por cuadro. Cada arma son 2 o 3 mallas (cuerpo con las manos, cargador y, en la escopeta y el
// rifle, la culata) más el fogonazo: 4 draw calls como mucho.
//
// Movimiento: sube al sacarla, va al centro al apuntar (sin la culata, que taparía la pantalla; la del francotirador se
// esconde entera: con la mira telescópica la vista es la del HUD), retrocede y cabecea con cada tiro, se balancea al
// caminar y en la recarga se inclina mientras el cargador sale y vuelve. Los tiempos de la recarga salen del estado de
// la partida (gun.reloadUntil); el resto, del reloj del cuadro.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS } from '../../shared/combat.ts';
import type { WeaponId } from '../../shared/combat.ts';
import { PLAYER } from '../../shared/player.ts';
import { weaponModel } from './models.ts';
import type { WeaponModel } from './models.ts';
import type { CombatView } from './types.ts';

export const VIEW_FOV = 70;

/** Lo que usa del WebGLRenderer (los tests le pasan uno de mentira). */
export type ViewRenderer = Pick<THREE.WebGLRenderer, 'autoClear' | 'clearDepth' | 'getSize' | 'render'>;

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
/** Desde la cadera: la empuñadura abajo a la derecha, y la culata y los codos fuera de cuadro. Apenas girada hacia el
 *  centro. */
const HIP: Record<WeaponId, THREE.Vector3> = {
  pistola: new THREE.Vector3(0.16, -0.17, -0.45),
  escopeta: new THREE.Vector3(0.2, -0.22, -0.55),
  rifle: new THREE.Vector3(0.2, -0.22, -0.55),
  francotirador: new THREE.Vector3(0.2, -0.23, -0.55),
};
const HIP_YAW = 0.05;
/** Apuntando: la línea de mira en el centro de la pantalla, con la empuñadura a esta distancia del ojo (más cerca, la
 *  culata tapa media pantalla). */
const ADS_Z: Record<WeaponId, number> = { pistola: -0.45, escopeta: -0.42, rifle: -0.42, francotirador: -0.4 };
/** Rapidez (1/s) con la que va y vuelve de la mira. */
const AIM_RATE = 14;
/** Retroceso por tiro: hacia atrás (m) y cabeceo (rad); vuelve a su lugar con RECOIL_RETURN (1/s). */
const KICK: Record<WeaponId, { back: number; rise: number }> = {
  pistola: { back: 0.035, rise: 0.12 },
  escopeta: { back: 0.07, rise: 0.22 },
  rifle: { back: 0.018, rise: 0.04 },
  francotirador: { back: 0.08, rise: 0.25 },
};
const RECOIL_RETURN = 12;
const RECOIL_MAX = { back: 0.12, rise: 0.4 };
/** Fogonazo: cuánto dura (ms) y su radio por arma (m). */
const FLASH_MS = 50;
const FLASH_SIZE: Record<WeaponId, number> = { pistola: 0.07, escopeta: 0.13, rifle: 0.08, francotirador: 0.14 };
/** Al sacarla: lo que tarda en subir (ms). */
const RAISE_MS = 250;
/** Recarga: cuánto viaja el cargador y en qué parte de la recarga (0…1) sale y vuelve. */
const MAG_TRAVEL = 0.22;
const MAG_OUT: [number, number] = [0.12, 0.35];
const MAG_IN: [number, number] = [0.55, 0.82];
/** Balanceo al caminar: rad de fase por metro y amplitud (m) a toda carrera. */
const BOB_RATE = 1.6;
const BOB = 0.007;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface ViewmodelView extends CombatView {
  /** Dibuja el arma encima de lo que ya está en pantalla. Va después de scene.render(), en el mismo cuadro. Sin arma
   *  a la vista no hace ninguna pasada. */
  render(): void;
  /** Su escena (para los tests). */
  readonly scene: THREE.Scene;
}

interface Gun {
  group: THREE.Group; mag: THREE.Mesh; stock: THREE.Mesh | null;
  model: Pick<WeaponModel, 'muzzle' | 'sight' | 'magOut'>;
}

/** Estrella de 8 puntas en el plano xy, de radio 1: blanca y opaca en el centro, naranja y transparente en las puntas. */
function flashGeometry(): THREE.BufferGeometry {
  const pos = [0, 0, 0], col = [1, 0.95, 0.75, 1], idx: number[] = [];
  const tips = 8;
  for (let i = 0; i < tips; i++) {
    const a = (i / tips) * 2 * Math.PI, r = i % 2 === 0 ? 1 : 0.45;
    pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
    col.push(1, 0.6, 0.2, 0);
    idx.push(0, 1 + i, 1 + ((i + 1) % tips));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

export function createViewmodel(renderer: ViewRenderer): ViewmodelView {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VIEW_FOV, 16 / 9, 0.01, 10);
  // la misma luz que el mundo (scene.ts), fija respecto de la cámara
  scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x80705a, 2.0));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
  sun.position.set(0.5, 1, 0.6);
  scene.add(sun);

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const pose = new THREE.Group();
  pose.name = 'pose';
  pose.visible = false;
  scene.add(pose);

  const guns = {} as Record<WeaponId, Gun>;
  for (const id of WEAPON_IDS) {
    const model = weaponModel(id);
    const merged = mergeGeometries([model.body, model.hands], false);
    if (!merged) throw new Error('viewmodel: mergeGeometries falló');
    model.body.dispose();
    model.hands.dispose();
    const group = new THREE.Group();
    group.name = `arma-${id}`;
    group.visible = false;
    const body = new THREE.Mesh(merged, material);
    body.name = `body-${id}`;
    const mag = new THREE.Mesh(model.mag, material);
    mag.name = `mag-${id}`;
    group.add(body, mag);
    const stock = model.stock ? new THREE.Mesh(model.stock, material) : null;
    if (stock) {
      stock.name = `stock-${id}`;
      group.add(stock);
    }
    pose.add(group);
    guns[id] = { group, mag, stock, model: { muzzle: model.muzzle, sight: model.sight, magOut: model.magOut } };
  }

  const flashMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    forceSinglePass: true, toneMapped: false,
  });
  const flash = new THREE.Mesh(flashGeometry(), flashMaterial);
  flash.name = 'muzzle-flash';
  flash.visible = false;
  pose.add(flash);

  let active: WeaponId | null = null;
  let last = NaN;
  let aimK = 0;
  let raise = 0; // 1 recién sacada, 0 arriba
  let back = 0, rise = 0;
  let flashUntil = -Infinity;
  let shots = 0;
  let bobPhase = 0;
  const size = new THREE.Vector2();

  return {
    scene,
    update({ state, now, events }) {
      const dt = Number.isFinite(last) ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 0;
      last = now;
      const gun = state.inv.slots[state.inv.active];
      if (!gun || !state.me.alive) {
        pose.visible = false;
        if (active) guns[active].group.visible = false;
        active = null; // la próxima que aparezca, sube
        return;
      }
      if (gun.id !== active) {
        if (active) guns[active].group.visible = false;
        active = gun.id;
        guns[active].group.visible = true;
        raise = 1;
      }
      const g = guns[active];
      for (const e of events) {
        if (e.type !== 'shot') continue;
        back = Math.min(RECOIL_MAX.back, back + KICK[e.weapon].back);
        rise = Math.min(RECOIL_MAX.rise, rise + KICK[e.weapon].rise);
        flashUntil = now + FLASH_MS;
        shots++;
      }
      const decay = Math.exp(-RECOIL_RETURN * dt);
      back *= decay;
      rise *= decay;
      aimK += ((state.aiming ? 1 : 0) - aimK) * (1 - Math.exp(-AIM_RATE * dt));
      raise = Math.max(0, raise - (dt * 1000) / RAISE_MS);
      // con la mira telescópica no se ve el arma; con las otras miras, la culata
      pose.visible = !(WEAPONS[active].scope && aimK > 0.5);
      if (!pose.visible) return;
      if (g.stock) g.stock.visible = aimK < 0.5;

      // recarga: 0…1 según el estado de la partida
      const k = gun.reloadUntil === null ? 0 : Math.min(1, Math.max(0, 1 - (gun.reloadUntil - state.t) / WEAPONS[active].reload));
      const env = gun.reloadUntil === null ? 0 : smooth(0, 0.15, k) * (1 - smooth(0.85, 1, k));
      const out = smooth(MAG_OUT[0], MAG_OUT[1], k) * (1 - smooth(MAG_IN[0], MAG_IN[1], k));
      const m = g.model.magOut;
      g.mag.position.set(m[0], m[1], m[2]).multiplyScalar(out * MAG_TRAVEL);

      // balanceo: avanza con lo que se camina por el piso
      const p = state.me.player;
      const speed = p.onGround ? Math.hypot(p.vel[0], p.vel[2]) : 0;
      bobPhase += speed * dt * BOB_RATE;
      const bob = BOB * Math.min(1, speed / PLAYER.runSpeed) * (1 - 0.8 * aimK);

      const a = smooth(0, 1, aimK);
      const r = smooth(0, 1, raise);
      const hip = HIP[active];
      pose.position.set(
        hip.x * (1 - a) + bob * Math.sin(bobPhase),
        hip.y * (1 - a) - g.model.sight * a + bob * 0.7 * Math.sin(2 * bobPhase) - 0.04 * env - 0.2 * r,
        hip.z * (1 - a) + ADS_Z[active] * a + back,
      );
      pose.rotation.set(rise + 0.2 * env - 0.6 * r, HIP_YAW * (1 - a), 0.45 * env);

      flash.visible = now < flashUntil;
      if (flash.visible) {
        const mz = g.model.muzzle;
        flash.position.set(mz[0], mz[1], mz[2]);
        flash.rotation.set(0, 0, shots * 2.4); // cada fogonazo girado distinto
        flash.scale.setScalar(FLASH_SIZE[active]);
      }
    },
    render() {
      if (!pose.visible) return;
      renderer.getSize(size);
      const aspect = size.x / Math.max(1, size.y);
      if (aspect !== camera.aspect) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
    },
    dispose() {
      for (const id of WEAPON_IDS) {
        for (const o of guns[id].group.children) (o as THREE.Mesh).geometry.dispose();
      }
      flash.geometry.dispose();
      material.dispose();
      flashMaterial.dispose();
      scene.clear();
    },
  };
}
