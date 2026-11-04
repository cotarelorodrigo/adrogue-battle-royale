// La pared de la zona (spec 2a §6): un cilindro azul translúcido de ZONE_WALL_H m sin tapas, más el borde en el piso,
// en una sola malla y 1 draw call. No proyecta sombra ni escribe profundidad. Los vértices se rehacen en la CPU cuando
// cambia el círculo (el borde del piso tiene ancho fijo y no se puede estirar con la matriz).
//
// Niebla: la pared se ve a través de ella (la tapa a lo sumo ZONE_FOG_MAX) y se desvanece justo después de fog.far,
// antes del corte de camera.far: no aparece el borde recto del plano lejano.
import * as THREE from 'three';
import { zoneAt } from '../../shared/zone.ts';
import { FAR_PAST_FOG } from '../render/quality.ts';
import type { CombatView } from './types.ts';

export const ZONE_WALL_H = 60;
/** Lados del cilindro: con un radio de 1 km, cada uno se aparta 0,3 m del círculo. */
const SEGMENTS = 128;
/** Ancho del borde en el piso y su altura: arriba de Y_PATH (0,06), la capa más alta del suelo. */
const RING_W = 1.5;
const RING_Y = 0.08;
/** Color y opacidad: la pared es más opaca abajo; el borde del piso, más claro y más opaco. */
const WALL_COLOR = new THREE.Color('#3d8bff');
const RING_COLOR = new THREE.Color('#7ab4ff');
const WALL_ALPHA_BOTTOM = 0.45;
const WALL_ALPHA_TOP = 0.08;
const RING_ALPHA = 0.7;
/** Lo más que la niebla tapa la pared. */
const ZONE_FOG_MAX = 0.55;

export interface ZoneWallView extends CombatView {
  readonly mesh: THREE.Mesh;
}

/** Cada lado k tiene 4 vértices: pie y punta de la pared, y afuera y adentro del borde del piso. */
function wallGeometry(): THREE.BufferGeometry {
  const n = SEGMENTS + 1;
  const colors = new Float32Array(n * 4 * 4);
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    colors.set([WALL_COLOR.r, WALL_COLOR.g, WALL_COLOR.b, WALL_ALPHA_BOTTOM], (4 * k) * 4);
    colors.set([WALL_COLOR.r, WALL_COLOR.g, WALL_COLOR.b, WALL_ALPHA_TOP], (4 * k + 1) * 4);
    colors.set([RING_COLOR.r, RING_COLOR.g, RING_COLOR.b, RING_ALPHA], (4 * k + 2) * 4);
    colors.set([RING_COLOR.r, RING_COLOR.g, RING_COLOR.b, RING_ALPHA], (4 * k + 3) * 4);
    if (k === SEGMENTS) break;
    const a = 4 * k, b = 4 * (k + 1);
    idx.push(a, b, b + 1, a, b + 1, a + 1); // pared
    idx.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2); // borde del piso
  }
  const g = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', position);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 4)); // con alfa: three usa vertexAlphas
  g.setIndex(idx);
  return g;
}

/** La niebla de three, pero tapando a lo sumo ZONE_FOG_MAX y desvaneciendo la pared de fog.far a casi camera.far. Si
 *  three ya no tiene el chunk, falla a la vista en vez de dibujar la pared tapada por la niebla. */
function patchFog(shader: { fragmentShader: string }): void {
  const chunk = '#include <fog_fragment>';
  if (!shader.fragmentShader.includes(chunk)) {
    throw new Error(`zone-wall: el shader de three no tiene ${chunk}; hay que adaptar la niebla de la pared a esta versión`);
  }
  shader.fragmentShader = shader.fragmentShader.replace(chunk, `#ifdef USE_FOG
	float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor * ${ZONE_FOG_MAX.toFixed(2)} );
	gl_FragColor.a *= 1.0 - smoothstep( fogFar, fogFar + ${(FAR_PAST_FOG * 0.8).toFixed(1)}, vFogDepth );
#endif`);
}

export function createZoneWall(parent: THREE.Object3D): ZoneWallView {
  const geometry = wallGeometry();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    forceSinglePass: true, // de dos caras y transparente, three la dibujaría en dos pasadas
    toneMapped: false, // el azul tal cual, sin el ACES de la escena
  });
  material.onBeforeCompile = patchFog;
  material.customProgramCacheKey = () => 'zone-wall-fog';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'zone';
  mesh.renderOrder = -1; // primera de las transparentes: los trazadores y las marcas de cerca se ven encima
  mesh.visible = false;
  parent.add(mesh);

  let cx = NaN, cz = NaN, r = NaN;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;

  function shape(x: number, z: number, radius: number): void {
    const inner = Math.max(0, radius - RING_W);
    for (let k = 0; k <= SEGMENTS; k++) {
      const a = (k / SEGMENTS) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
      position.setXYZ(4 * k, x + radius * c, 0, z + radius * s);
      position.setXYZ(4 * k + 1, x + radius * c, ZONE_WALL_H, z + radius * s);
      position.setXYZ(4 * k + 2, x + radius * c, RING_Y, z + radius * s);
      position.setXYZ(4 * k + 3, x + inner * c, RING_Y, z + inner * s);
    }
    position.needsUpdate = true;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, ZONE_WALL_H / 2, z), Math.hypot(radius, ZONE_WALL_H / 2));
  }

  return {
    mesh,
    update({ state }) {
      const zone = zoneAt(state.zone, state.t);
      mesh.visible = zone.r > 0;
      if (!mesh.visible || (zone.center[0] === cx && zone.center[1] === cz && zone.r === r)) return;
      [cx, cz, r] = [zone.center[0], zone.center[1], zone.r];
      shape(cx, cz, r);
    },
    dispose() {
      parent.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
