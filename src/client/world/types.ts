import type * as THREE from 'three';
import type { Mat } from '../../shared/interiors/types.ts';

/** Los materiales de los interiores: uno por Mat y el de todos los muebles. Las mallas de un interior se llaman así. */
export type InteriorKey = `in_${Mat}` | 'in_mueble';

export interface WorldMaterials extends Record<InteriorKey, THREE.Material> {
  wallGroundHouse: THREE.Material;
  wallGroundShop: THREE.Material;
  wallUpper: THREE.Material;
  brickGround: THREE.Material;
  brickUpper: THREE.Material;
  roof: THREE.Material;
  parapet: THREE.Material;
  asphalt: THREE.Material;
  cobble: THREE.Material;
  sidewalk: THREE.Material;
  grass: THREE.Material;
  path: THREE.Material;
  platform: THREE.Material;
  rail: THREE.Material;
  front: THREE.Material;
}
