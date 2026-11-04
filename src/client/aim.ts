// La mira (clic derecho): el fov al que va la vista y cuándo se ve la mira telescópica. Solo con la partida en juego:
// terminada (stepMatch deja `aiming` como estaba) o con el jugador muerto, la vista vuelve a la normal.
import { WEAPONS } from '../shared/combat.ts';
import type { WeaponSpec } from '../shared/combat.ts';
import type { MatchState } from '../shared/match.ts';

/** El arma con la que se apunta ahora, o null: sin arma en la mano, sin apuntar, muerto o con la partida terminada. */
function aimedWeapon(m: MatchState): WeaponSpec | null {
  const gun = m.inv.slots[m.inv.active];
  return gun && m.aiming && m.me.alive && !m.over ? WEAPONS[gun.id] : null;
}

/** El fov (grados) hacia el que va la vista: el de la mira del arma mientras se apunta; si no, `normal`. */
export function aimTarget(m: MatchState, normal: number): number {
  return aimedWeapon(m)?.aimFov ?? normal;
}

/** Se ve la mira telescópica: apuntando con un arma que la tiene y el fov ya más cerca del de la mira que del normal. */
export function scoped(m: MatchState, fov: number, normal: number): boolean {
  const w = aimedWeapon(m);
  return w !== null && w.scope === true && fov < (normal + w.aimFov) / 2;
}
