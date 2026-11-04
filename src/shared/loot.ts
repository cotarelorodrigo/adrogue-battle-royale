import { WEAPONS } from './combat.ts';
import type { AmmoId, WeaponId } from './combat.ts';
import type { Vec3 } from './geo.ts';
import type { LootSpot, LootTier } from './mapdata.ts';
import { createRng, pick } from './rng.ts';

export type LootItem = { kind: 'arma'; weapon: WeaponId } | { kind: 'municion'; ammo: AmmoId } | { kind: 'chaleco' } | { kind: 'botiquin' };

/** Qué sale en cada nivel, en % (spec 2a §5). Un arma trae al lado una caja de su munición. */
export const LOOT_TABLE: Record<LootTier, readonly (readonly [LootItem['kind'] | 'nada', number])[]> = {
  calle: [['nada', 40], ['arma', 25], ['municion', 20], ['chaleco', 7], ['botiquin', 8]],
  techo: [['nada', 20], ['arma', 35], ['municion', 20], ['chaleco', 13], ['botiquin', 12]],
  lugar: [['nada', 0], ['arma', 50], ['municion', 15], ['chaleco', 20], ['botiquin', 15]],
};

/** Qué arma sale, en %: en la calle, y en lo alto (los techos y los lugares). */
export const WEAPON_TABLE: Record<'calle' | 'alto', readonly (readonly [WeaponId, number])[]> = {
  calle: [['pistola', 40], ['escopeta', 30], ['rifle', 22], ['francotirador', 8]],
  alto: [['pistola', 20], ['escopeta', 25], ['rifle', 35], ['francotirador', 20]],
};

/** Un objeto tirado en el mapa. `pos`: el piso donde se apoya. */
export interface Drop { id: number; pos: Vec3; item: LootItem }

/** La caja de munición de un arma queda a esta distancia, en una dirección sorteada. */
export const AMMO_BESIDE = 0.6;

/**
 * Sortea qué sale en cada punto, en orden, con una sola secuencia de la semilla: la misma semilla y los mismos puntos
 * dan los mismos drops. Un arma suma un segundo drop con una caja de su munición a AMMO_BESIDE m. La munición suelta sale
 * del mismo reparto que las armas del nivel (en la calle, la liviana de la pistola y del rifle es la más común). Los `id`
 * son correlativos desde 1.
 */
export function rollLoot(spots: readonly LootSpot[], seed: number): Drop[] {
  const rng = createRng(seed);
  const drops: Drop[] = [];
  const add = (pos: Vec3, item: LootItem): void => { drops.push({ id: drops.length + 1, pos, item }); };
  for (const s of spots) {
    const weapons = WEAPON_TABLE[s.tier === 'calle' ? 'calle' : 'alto'];
    const kind = pick(rng, LOOT_TABLE[s.tier]);
    const pos: Vec3 = [s.pos[0], s.pos[1], s.pos[2]];
    switch (kind) {
      case 'nada': break;
      case 'arma': {
        const weapon = pick(rng, weapons);
        add(pos, { kind: 'arma', weapon });
        const a = rng.next() * 2 * Math.PI;
        add([pos[0] + AMMO_BESIDE * Math.cos(a), pos[1], pos[2] + AMMO_BESIDE * Math.sin(a)], { kind: 'municion', ammo: WEAPONS[weapon].ammo });
        break;
      }
      case 'municion': add(pos, { kind: 'municion', ammo: WEAPONS[pick(rng, weapons)].ammo }); break;
      case 'chaleco': add(pos, { kind: 'chaleco' }); break;
      case 'botiquin': add(pos, { kind: 'botiquin' }); break;
    }
  }
  return drops;
}
