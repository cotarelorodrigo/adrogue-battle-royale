// Renderer, escena, cámara, cielo, luces, niebla, sombras, siluetas de las afueras y culling por chunk.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { ensureCCW } from '../../shared/geo.ts';
import type { Vec3 } from '../../shared/geo.ts';
import type { OutskirtBuilding } from '../../shared/mapdata.ts';
import { CHUNK } from '../world/chunks.ts';
import type { WorldMaterials } from '../world/types.ts';
import { OUTDOOR_EXPOSURE } from './exposure.ts';
import { FAR_PAST_FOG, QUALITY } from './quality.ts';
import type { Quality } from './quality.ts';
import { SUN_DIR } from './sun.ts';

export { SUN_DIR };

/** Color de la niebla, parecido al horizonte del cielo. También es el de las siluetas de las afueras. */
export const FOG_COLOR = 0xc6d3dc;
/** El cielo se funde con la niebla de la altura del horizonte para abajo (seno del ángulo de elevación): lo que la
 *  niebla tapa del todo y lo que corta camera.far quedan del mismo color que el cielo que tienen atrás. */
const HORIZON_BLEND = 0.1;
/** fov vertical (grados) sin apuntar. */
export const FOV = 75;
/** Cerca de la cámara (R15: con las capas del suelo a 2 cm no hay z-fighting a distancia). */
const NEAR = 0.15;
/** La luz se ubica a esta distancia del centro de la sombra, en la dirección del sol. */
const SUN_DISTANCE = 250;
/** El centro de la sombra salta de a 4 m: moverlo de a poco hace titilar los bordes. */
const SHADOW_SNAP = 4;
/** Un chunk se dibuja si su centro está a menos de drawDistance + media diagonal. */
const CULL_PAD = CHUNK * 0.71;

export interface GameScene {
  readonly renderer: THREE.WebGLRenderer;
  /** La cámara del mundo (la mueve update): la miran las vistas de los interiores. */
  readonly camera: THREE.PerspectiveCamera;
  addChunks(groups: THREE.Group[]): void;
  /** Objetos de todo el mapa (estación, plazas, árboles, carteles, props): sin culling por chunk, solo el de three. */
  addStatic(objects: THREE.Object3D[]): void;
  /** En chunks y objetos estáticos, cambia el material de cada malla cuyo nombre es una clave de WorldMaterials. */
  setMaterials(m: WorldMaterials): void;
  /** pixelRatio, niebla, camera.far, culling y sombras según el preset. */
  applyQuality(q: Quality): void;
  /** Cámara en los ojos del jugador, culling de chunks y sombra centrada en él. */
  update(feet: Vec3, eye: number, yaw: number, pitch: number): void;
  /** fov vertical de la cámara (grados): al apuntar se cierra. */
  setFov(deg: number): void;
  /** Un punto del mundo en píxeles CSS de la ventana con la cámara de ahora, o null si queda detrás. */
  project(p: Vec3): [number, number] | null;
  /** Dibuja el mundo y pone en cero renderer.info: las pasadas que siguen en el mismo cuadro se suman. */
  render(): void;
  /** Compila de antemano los programas de los materiales de `object`, que ya está en la escena (aunque esté escondido:
   *  three los recorre todos), para que mostrarlo después no dé un tirón (H9). */
  compile(object: THREE.Object3D): Promise<void>;
}

interface Chunk { group: THREE.Group; cx: number; cz: number }

export function createScene(canvas: HTMLCanvasElement, outskirts: OutskirtBuilding[], q: Quality): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // el cielo de Preetham está pensado para tone mapping
  renderer.toneMappingExposure = OUTDOOR_EXPOSURE; // adentro de un interior la cambia la adaptación del ojo (main)
  // Las estadísticas (renderer.info.render) se ponen en cero una sola vez por cuadro, en render(): lo que se dibuja
  // después en el mismo cuadro (el arma en mano, combat/viewmodel.ts, en una pasada aparte) se suma, y el HUD y los
  // presupuestos de e2e/perf.spec.ts ven el cuadro entero y no solo la última pasada.
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const fog = new THREE.Fog(FOG_COLOR, 1, 2);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(FOV, 1, NEAR, 1000);
  camera.rotation.order = 'YXZ';

  const sky = new Sky();
  sky.scale.setScalar(5000); // el shader lo dibuja siempre en el plano lejano: alcanza con que envuelva el mapa
  const u = sky.material.uniforms;
  u.turbidity.value = 3;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.cloudCoverage.value = 0.35;
  (u.sunPosition.value as THREE.Vector3).copy(SUN_DIR);
  fadeHorizonToFog(sky.material);
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x80705a, 2.0));
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = SUN_DISTANCE * 2;
  scene.add(sun, sun.target);

  scene.add(buildOutskirts(outskirts));

  const chunks: Chunk[] = [];
  const statics: THREE.Object3D[] = [];
  let cullRadius = Infinity;
  let shadowsOn = false;
  let shadowX = NaN, shadowZ = NaN;
  const projected = new THREE.Vector3();

  function placeSun(x: number, z: number): void {
    const sx = Math.round(x / SHADOW_SNAP) * SHADOW_SNAP;
    const sz = Math.round(z / SHADOW_SNAP) * SHADOW_SNAP;
    if (sx === shadowX && sz === shadowZ) return;
    shadowX = sx;
    shadowZ = sz;
    sun.target.position.set(sx, 0, sz);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, SUN_DISTANCE);
  }

  function resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function applyQuality(level: Quality): void {
    const p = QUALITY[level];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatioMax));
    resize();
    fog.near = p.drawDistance * 0.5;
    fog.far = p.drawDistance;
    camera.far = p.drawDistance + FAR_PAST_FOG;
    camera.updateProjectionMatrix();
    cullRadius = p.drawDistance + CULL_PAD;

    shadowsOn = p.shadows !== false;
    renderer.shadowMap.enabled = shadowsOn;
    sun.castShadow = shadowsOn;
    if (!p.shadows) {
      sun.shadow.map?.dispose(); // sin sombras no hace falta ocupar la memoria del mapa (se recrea al volver)
      sun.shadow.map = null;
    } else {
      const { mapSize, range } = p.shadows;
      if (sun.shadow.mapSize.x !== mapSize) {
        sun.shadow.map?.dispose(); // se vuelve a crear con el tamaño nuevo
        sun.shadow.map = null;
        sun.shadow.mapSize.set(mapSize, mapSize);
      }
      const cam = sun.shadow.camera;
      cam.left = -range;
      cam.right = range;
      cam.top = range;
      cam.bottom = -range;
      cam.updateProjectionMatrix();
    }
  }

  applyQuality(q);

  return {
    renderer,
    camera,
    addChunks(groups) {
      for (const group of groups) {
        const [i, j] = group.userData.chunk as [number, number];
        chunks.push({ group, cx: (i + 0.5) * CHUNK, cz: (j + 0.5) * CHUNK });
        scene.add(group);
      }
    },
    addStatic(objects) {
      for (const o of objects) {
        statics.push(o);
        scene.add(o);
      }
    },
    setMaterials(m) {
      const swap = (o: THREE.Object3D): void => {
        if (o instanceof THREE.Mesh && Object.hasOwn(m, o.name)) o.material = m[o.name as keyof WorldMaterials];
      };
      for (const { group } of chunks) group.traverse(swap);
      for (const o of statics) o.traverse(swap);
    },
    applyQuality,
    update(feet, eye, yaw, pitch) {
      camera.position.set(feet[0], feet[1] + eye, feet[2]);
      camera.rotation.set(pitch, yaw, 0);
      for (const c of chunks) c.group.visible = Math.hypot(c.cx - feet[0], c.cz - feet[2]) <= cullRadius;
      if (shadowsOn) placeSun(feet[0], feet[2]);
    },
    setFov(deg) {
      if (camera.fov === deg) return;
      camera.fov = deg;
      camera.updateProjectionMatrix();
    },
    project(p) {
      camera.updateMatrixWorld(); // la de este cuadro, aunque todavía no se haya dibujado
      projected.set(p[0], p[1], p[2]).project(camera);
      if (!(projected.z > -1 && projected.z < 1)) return null; // detrás de la cámara (o más allá de camera.far)
      return [((projected.x + 1) / 2) * window.innerWidth, ((1 - projected.y) / 2) * window.innerHeight];
    },
    render() {
      renderer.info.reset();
      renderer.render(scene, camera);
    },
    async compile(object) {
      // sin KHR_parallel_shader_compile (SwiftShader, algunos navegadores) compileAsync avisa por consola y espera igual:
      // ahí se compila de una, durante la carga
      if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(object, camera, scene);
      else renderer.compile(object, camera, scene);
    },
  };
}

/** La niebla de three se mezcla después de pasar a sRGB (fog.color llega al shader en el espacio de salida): acá se
 *  mezcla igual, así un objeto con niebla total y el cielo detrás dan exactamente el mismo color. */
function fadeHorizonToFog(material: THREE.ShaderMaterial): void {
  const c = new THREE.Color(FOG_COLOR).getRGB(new THREE.Color(), THREE.SRGBColorSpace);
  const fs = material.fragmentShader;
  const blend = `gl_FragColor.rgb = mix( horizonColor, gl_FragColor.rgb, smoothstep( 0.0, ${HORIZON_BLEND.toFixed(2)}, direction.y ) );`;
  const patched = fs.replace('#include <colorspace_fragment>', `#include <colorspace_fragment>\n\t${blend}`);
  if (patched === fs) {
    console.warn('Sky: no se pudo fundir el horizonte con la niebla (¿cambió el shader de three?)');
    return;
  }
  material.uniforms.horizonColor = { value: new THREE.Vector3(c.r, c.g, c.b) };
  material.fragmentShader = `uniform vec3 horizonColor;\n${patched}`;
}

/** Siluetas de las afueras: paredes y techo planos, sin textura ni colisión, en una sola malla del color de la niebla. */
function buildOutskirts(list: OutskirtBuilding[]): THREE.Mesh {
  const pos: number[] = [];
  for (const { footprint, height: h } of list) {
    const fp = ensureCCW(footprint);
    const n = fp.length;
    for (let i = 0; i < n; i++) {
      const a = fp[i], c = fp[(i + 1) % n];
      // Mismo orden que las paredes de geometry.ts: antihorario visto desde afuera.
      pos.push(a[0], 0, a[1], c[0], 0, c[1], c[0], h, c[1]);
      pos.push(a[0], 0, a[1], c[0], h, c[1], a[0], h, a[1]);
    }
    const contour = fp.map(([x, z]) => new THREE.Vector2(x, -z));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const cross = (fp[j][0] - fp[i][0]) * (fp[k][1] - fp[i][1]) - (fp[j][1] - fp[i][1]) * (fp[k][0] - fp[i][0]);
      const [b, c] = cross < 0 ? [j, k] : [k, j]; // normal hacia +y
      pos.push(fp[i][0], h, fp[i][1], fp[b][0], h, fp[b][1], fp[c][0], h, fp[c][1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: FOG_COLOR }));
  mesh.name = 'outskirts';
  mesh.matrixAutoUpdate = false;
  return mesh;
}
