// Los materiales de lo horneado de los interiores (los bloques, los muebles y los carteles): MeshBasic con la luz en el
// color por vértice (bake.ts). Lo de adentro lleva además la ganancia de la adaptación del ojo (render/exposure.ts,
// INTERIOR_GAIN) y va marcado con el signo: un color por vértice negativo es lo horneado de adentro y se dibuja su valor
// absoluto por la ganancia; uno positivo, lo que brilla y lo que está al aire libre (un patio, la terraza), que se ve
// como el resto del mundo, sin ganancia. El signo sobrevive a la interpolación (las tres esquinas de un triángulo son de
// la misma clase), a juntar mallas y al color de una instancia (el del modelo es positivo).
import * as THREE from 'three';
import { INTERIOR_GAIN } from '../../render/exposure.ts';

/** El material de lo horneado, con la textura `map` (o sin). */
export function bakedMaterial(map: THREE.Texture | null): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.interiorGain = INTERIOR_GAIN;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float interiorGain;')
      .replace('#include <color_fragment>', `#if defined( USE_COLOR )
  diffuseColor.rgb *= abs( vColor.rgb ) * ( any( lessThan( vColor.rgb, vec3( 0.0 ) ) ) ? interiorGain : 1.0 );
#endif`);
  };
  m.customProgramCacheKey = () => 'in_baked:ganancia';
  return m;
}

/** `c` marcado como horneado de adentro (lleva la ganancia): negativo. */
export const adentro = (c: THREE.Color): THREE.Color => c.setRGB(-c.r, -c.g, -c.b);
