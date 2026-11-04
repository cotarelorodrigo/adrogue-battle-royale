// El vidrio de los interiores (H2c): no se hornea. Es un reflejo de cielo tipo Fresnel, con un shader de MeshBasic
// tocado en onBeforeCompile: casi transparente de frente (GLASS_F0) y más opaco en los cantos (hasta GLASS_F90), como
// un vidrio de verdad. El color por vértice no es luz: es el lado de la cara (GLASS_OUTSIDE en las que miran a la
// calle o a un patio, GLASS_INSIDE en las de adentro), que multiplica la opacidad. Las dos caras de un paño van en
// una sola pasada (forceSinglePass) y la de atrás se descarta: de afuera se ve la de afuera y de adentro la de adentro,
// sin sumar velos ni draw calls.
import * as THREE from 'three';
import { pointInPolygon } from '../../../shared/geo.ts';
import type { Vec3 } from '../../../shared/geo.ts';
import type { Interior } from '../../../shared/interiors/types.ts';

/** Lo que multiplica la opacidad de una cara que mira afuera (a la calle o a un patio). */
export const GLASS_OUTSIDE = 1;
/** Lo mismo para una que mira adentro: desde el salón el vidrio casi no se ve. */
export const GLASS_INSIDE = 0.3;
/** Opacidad de frente y de canto (Schlick): 0,08 de frente; a 74° (BBVA a 60 m por la calle), ~0,18. */
const GLASS_F0 = 0.08;
const GLASS_F90 = 0.5;
/** El cielo que refleja: un poco más oscuro que el horizonte (FOG_COLOR), como el de enfrente en un vidrio. */
const GLASS_SKY = '#a9bfcf';
/** Se mira el lado de una cara esto (m) más allá, en su normal. */
const PROBE = 0.3;

/** El tono (GLASS_OUTSIDE o GLASS_INSIDE) de una cara de vidrio del interior `i` que pasa por `p` con normal `n`. */
export function glassTone(i: Interior, p: Vec3, n: Vec3): number {
  const q: [number, number] = [p[0] + n[0] * PROBE, p[2] + n[2] * PROBE];
  const out = !pointInPolygon(q, i.footprint) || i.patios.some((r) => pointInPolygon(q, r));
  return out ? GLASS_OUTSIDE : GLASS_INSIDE;
}

const VARYINGS = 'varying vec3 vGlassPos;\nvarying vec3 vGlassNormal;';

/** El material de `in_vidrio` (uno por juego de materiales). */
export function glassMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    name: 'in_vidrio', color: GLASS_SKY, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VARYINGS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  vGlassPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vGlassNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${VARYINGS}`)
      .replace('#include <color_fragment>', `if (!gl_FrontFacing) discard; // la cara de atrás: la dibuja el otro lado del paño
  float glassSide = vColor.r;
  float glassFacing = abs(dot(normalize(vGlassNormal), normalize(cameraPosition - vGlassPos)));
  diffuseColor.a = opacity * glassSide * mix(${GLASS_F0.toFixed(3)}, ${GLASS_F90.toFixed(3)}, pow(1.0 - glassFacing, 5.0));`);
  };
  m.customProgramCacheKey = () => 'in_vidrio:fresnel';
  return m;
}
