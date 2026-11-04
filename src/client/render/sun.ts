// La dirección del sol (fija: es media mañana todo el día). Aparte de scene.ts para que el mundo la use sin traerse la
// escena: la cáscara de sombra de los edificios con interior depende de qué paredes miran al sol (geometry.ts).
import * as THREE from 'three';

/** Sol de media mañana, del noreste (en Adrogué el sol va por el norte): ilumina la fachada de la estación, que mira
 *  al este. Azimut desde el norte (−z) hacia el este (+x). */
const SUN_ELEVATION = THREE.MathUtils.degToRad(50);
const SUN_AZIMUTH = THREE.MathUtils.degToRad(40);
/** Hacia el sol (unitario). */
export const SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  -Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
);
