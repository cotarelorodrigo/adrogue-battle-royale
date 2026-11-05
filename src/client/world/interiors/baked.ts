// Los materiales de lo horneado de los interiores (los bloques, los muebles y los carteles): MeshBasic con la luz en el
// color por vértice (bake.ts). Lo de adentro lleva además la ganancia de la adaptación del ojo (render/exposure.ts,
// INTERIOR_GAIN) y va marcado con el signo: un color por vértice negativo es lo horneado de adentro y se dibuja su valor
// absoluto por la ganancia; uno positivo, lo que brilla y lo que está al aire libre (un patio, la terraza), que se ve
// como el resto del mundo, sin ganancia. El signo sobrevive a la interpolación (las tres esquinas de un triángulo son de
// la misma clase), a juntar mallas y al color de una instancia (el del modelo es positivo).
// Los bloques (build.ts) llevan además la ganancia de cada vértice en el alfa del color (de 0, sin ganancia, a 1, entera):
// una cara bajo techo con una esquina al aire libre (el canto de afuera de una jamba o de un umbral) lleva en esa esquina
// la luz de afuera sin ganancia, y se ve igual desde la vereda que desde adentro (M4 de la T11c).
import * as THREE from 'three';
import { INTERIOR_GAIN } from '../../render/exposure.ts';

/** El material de lo horneado, con la textura `map` (o sin). */
export function bakedMaterial(map: THREE.Texture | null): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.interiorGain = INTERIOR_GAIN;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float interiorGain;')
      .replace('#include <color_fragment>', `#if defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= abs( vColor.rgb ) * mix( 1.0, interiorGain, vColor.a );
#elif defined( USE_COLOR )
  diffuseColor.rgb *= abs( vColor.rgb ) * ( any( lessThan( vColor.rgb, vec3( 0.0 ) ) ) ? interiorGain : 1.0 );
#endif`);
  };
  m.customProgramCacheKey = () => 'in_baked:ganancia';
  return m;
}

/** `c` marcado como horneado de adentro (lleva la ganancia): negativo. */
export const adentro = (c: THREE.Color): THREE.Color => c.setRGB(-c.r, -c.g, -c.b);

/** `g` con la ganancia de cada vértice en el alfa del color (RGBA), si no la tenía: 1 en lo marcado (negativo), 0 en lo
 *  demás. Para juntarla con los bloques, que la llevan. */
export function withGain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const col = g.getAttribute('color');
  if (!col || col.itemSize === 4) return g;
  const out = new Float32Array(col.count * 4);
  for (let k = 0; k < col.count; k++) {
    const [r, gr, b] = [col.getX(k), col.getY(k), col.getZ(k)];
    out.set([r, gr, b, r < 0 || gr < 0 || b < 0 ? 1 : 0], k * 4);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(out, 4));
  return g;
}
