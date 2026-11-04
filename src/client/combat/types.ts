// Lo que reciben en cada cuadro los módulos que dibujan el combate (maniquíes, botín, zona, arma en mano y efectos).
import type { Vec3 } from '../../shared/geo.ts';
import type { MatchEvent, MatchState } from '../../shared/match.ts';

/** La cámara del cuadro: los ojos del jugador y hacia dónde mira (como scene.update: yaw 0 mira a −z, pitch positivo
 *  mira arriba). */
export interface ViewCam { pos: Vec3; yaw: number; pitch: number }

export interface CombatFrame {
  state: MatchState;
  cam: ViewCam;
  /** Reloj del cuadro en ms: el `now` de requestAnimationFrame. */
  now: number;
  /** Los eventos de todos los pasos que corrieron desde el update anterior, en orden. No sirve `state.events`: en un
   *  cuadro pueden correr cero pasos (y se repetirían los del anterior) o varios (y se perderían los de los primeros). */
  events: readonly MatchEvent[];
}

export interface CombatView {
  update(f: CombatFrame): void;
  /** Saca sus objetos de la escena y libera geometrías, materiales y texturas. */
  dispose(): void;
}
