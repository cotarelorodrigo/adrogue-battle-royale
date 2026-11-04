// Efectos de los disparos (spec 2a §4), 1 draw call cada uno: los trazadores (una LineSegments con todos, cada uno dura
// TRACER_MS) y las marcas de impacto en el mundo (una InstancedMesh de cuadraditos, a lo sumo DECAL_MAX: la más vieja
// deja lugar a la nueva, y cada una se achica en su último segundo y se borra a los DECAL_MS).
import * as THREE from 'three';
import { hashIndex } from '../../shared/geo.ts';
import { smooth } from './ease.ts';
import type { CombatView } from './types.ts';

export const TRACER_MS = 80;
export const DECAL_MAX = 64;
export const DECAL_MS = 10_000;

/** Trazadores a la vez (un tiro de escopeta son 8). */
const TRACER_MAX = 64;
/** Arrancan en la boca del arma, más o menos donde la dibuja el viewmodel: a la derecha, abajo y adelante del ojo (m),
 *  o abajo en el centro al apuntar. */
const MUZZLE_HIP = { right: 0.13, up: -0.11, fwd: 0.5 };
const MUZZLE_AIM = { right: 0, up: -0.06, fwd: 0.5 };
/** Largo de la estela: una parte del tiro, con un mínimo (m). */
const STREAK_SHARE = 0.35;
const STREAK_MIN = 2;
const TRACER_COLOR = new THREE.Color('#ffe2a0');
/** Lado de la marca (m) y separación de la superficie. */
const DECAL_SIZE = 0.14;
const DECAL_LIFT = 0.015;
/** Las marcas en el piso (y = 0 para el hitscan) van arriba de las capas del suelo dibujado (Y_PATH, 0,06). */
const GROUND_DECAL_Y = 0.075;
const DECAL_FADE_MS = 1000;

export interface EffectsView extends CombatView {
  /** Cuántos trazadores y cuántas marcas hay ahora (para los contadores de debug). */
  readonly tracers: number;
  readonly decals: number;
  /** Borra todo (al volver a jugar). */
  clear(): void;
}

interface Tracer { from: THREE.Vector3; to: THREE.Vector3; born: number }
interface Decal { pos: THREE.Vector3; quat: THREE.Quaternion; born: number }

/** Agujero de bala: oscuro y opaco en el centro, con el borde desparejo y transparente. */
function holeTexture(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x + 0.5) / (n / 2) - 1, (y + 0.5) / (n / 2) - 1) + 0.18 * (hashIndex(y * n + x) - 0.5);
      const a = r < 0.3 ? 1 : Math.max(0, 1 - (r - 0.3) / 0.6);
      const shade = 18 + 50 * Math.min(1, r);
      data.set([shade, shade * 0.95, shade * 0.9, Math.round(255 * a * a)], (y * n + x) * 4);
    }
  }
  const t = new THREE.DataTexture(data, n, n);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function createEffects(parent: THREE.Object3D): EffectsView {
  // trazadores
  const tracerGeo = new THREE.BufferGeometry();
  const tPos = new THREE.BufferAttribute(new Float32Array(TRACER_MAX * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const tCol = new THREE.BufferAttribute(new Float32Array(TRACER_MAX * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
  tracerGeo.setAttribute('position', tPos);
  tracerGeo.setAttribute('color', tCol); // con alfa: la cola transparente
  const tracerMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
  const lines = new THREE.LineSegments(tracerGeo, tracerMat);
  lines.name = 'tracers';
  lines.frustumCulled = false; // cambia en cada cuadro: no vale la pena recalcular su esfera
  lines.visible = false;

  // marcas
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const decalTex = holeTexture();
  const decalMat = new THREE.MeshBasicMaterial({
    map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const decalMesh = new THREE.InstancedMesh(decalGeo, decalMat, DECAL_MAX);
  decalMesh.name = 'decals';
  decalMesh.count = 0;
  decalMesh.visible = false;
  parent.add(lines, decalMesh);

  const tracers: Tracer[] = [];
  const decals: Decal[] = [];
  let decalSeq = 0;

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), dir = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  const mat = new THREE.Matrix4(), roll = new THREE.Quaternion(), scale = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);

  function drawTracers(now: number): void {
    for (let i = 0; i < tracers.length; i++) {
      const t = tracers[i];
      const k = (now - t.born) / TRACER_MS;
      dir.subVectors(t.to, t.from);
      const len = dir.length();
      dir.divideScalar(len || 1);
      const head = Math.min(1, 0.25 + 1.5 * k) * len; // en el primer cuadro ya se ve un tramo
      const tail = Math.max(0, head - Math.max(STREAK_MIN, len * STREAK_SHARE));
      a.copy(t.from).addScaledVector(dir, tail);
      b.copy(t.from).addScaledVector(dir, head);
      tPos.setXYZ(2 * i, a.x, a.y, a.z);
      tPos.setXYZ(2 * i + 1, b.x, b.y, b.z);
      tCol.setXYZW(2 * i, TRACER_COLOR.r, TRACER_COLOR.g, TRACER_COLOR.b, 0);
      tCol.setXYZW(2 * i + 1, TRACER_COLOR.r, TRACER_COLOR.g, TRACER_COLOR.b, 0.9 * (1 - smooth(0.6, 1, k)));
    }
    tPos.needsUpdate = true;
    tCol.needsUpdate = true;
    tracerGeo.setDrawRange(0, tracers.length * 2);
    lines.visible = tracers.length > 0;
  }

  function drawDecals(now: number): void {
    for (let i = 0; i < decals.length; i++) {
      const d = decals[i];
      const left = DECAL_MS - (now - d.born);
      scale.setScalar(DECAL_SIZE * Math.min(1, left / DECAL_FADE_MS));
      decalMesh.setMatrixAt(i, mat.compose(d.pos, d.quat, scale));
    }
    decalMesh.count = decals.length;
    decalMesh.visible = decals.length > 0;
    decalMesh.instanceMatrix.needsUpdate = true;
    // la esfera del frustum culling, con las marcas de ahora: three no la recalcula sola, y así reusa la misma
    if (decalMesh.visible) decalMesh.computeBoundingSphere();
  }

  /** Cuántos de adelante (los más viejos) ya vencieron, sin armar una función por cuadro. */
  function expired<T extends { born: number }>(list: readonly T[], now: number, ttl: number): number {
    let n = 0;
    while (n < list.length && now - list[n].born >= ttl) n++;
    return n;
  }

  return {
    get tracers() { return tracers.length; },
    get decals() { return decals.length; },
    update({ state, cam, now, events }) {
      for (const e of events) {
        if (e.type === 'shot') {
          const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
          fwd.set(-sy * cp, sp, -cy * cp);
          right.set(cy, 0, -sy);
          up.set(sy * sp, cp, cy * sp);
          const o = state.aiming ? MUZZLE_AIM : MUZZLE_HIP;
          const from = new THREE.Vector3(...e.from)
            .addScaledVector(right, o.right).addScaledVector(up, o.up).addScaledVector(fwd, o.fwd);
          for (const to of e.to) tracers.push({ from, to: new THREE.Vector3(...to), born: now });
        } else if (e.type === 'impact') {
          n.set(...e.normal).normalize();
          const pos = new THREE.Vector3(...e.point).addScaledVector(n, DECAL_LIFT);
          if (n.y > 0.9 && e.point[1] < 0.01) pos.y = GROUND_DECAL_Y;
          const quat = new THREE.Quaternion().setFromUnitVectors(Z, n).multiply(roll.setFromAxisAngle(Z, decalSeq++ * 2.39996));
          decals.push({ pos, quat, born: now });
        }
      }
      if (tracers.length > TRACER_MAX) tracers.splice(0, tracers.length - TRACER_MAX);
      if (decals.length > DECAL_MAX) decals.splice(0, decals.length - DECAL_MAX);
      // vencidos: los más viejos están adelante
      tracers.splice(0, expired(tracers, now, TRACER_MS));
      decals.splice(0, expired(decals, now, DECAL_MS));
      drawTracers(now);
      drawDecals(now);
    },
    clear() {
      tracers.length = 0;
      decals.length = 0;
      lines.visible = false;
      decalMesh.count = 0;
      decalMesh.visible = false;
    },
    dispose() {
      parent.remove(lines, decalMesh);
      decalMesh.dispose();
      tracerGeo.dispose();
      tracerMat.dispose();
      decalGeo.dispose();
      decalMat.dispose();
      decalTex.dispose();
    },
  };
}
