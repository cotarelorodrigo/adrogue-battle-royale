// La adaptación del ojo (H2e): con la cámara adentro de un interior, la exposición del tone mapping va de a poco hacia
// la de adentro, y al salir vuelve a la de la calle. Desde adentro la calle por la puerta queda quemada: es lo real.

/** La exposición de la calle (la de siempre, la del cielo de Preetham con ACES). */
export const OUTDOOR_EXPOSURE = 0.7;
/** La de adentro: la que hace leer bien un salón (en alta, el de McDonald's da ~135 de luma sRGB). Va de la mano con
 *  INTERIOR_EXPOSURE (interiors/build.ts): adentro se ve su producto, así que si una sube, la otra baja. */
export const INDOOR_EXPOSURE = 2.8;
/** La constante de tiempo (s): en un segundo se hace el 63 % del camino. */
export const ADAPT_TIME = 1;

/** La exposición `dt` segundos después, yendo de `current` hacia `target` con constante `tau` (exponencial: no
 *  depende de los cuadros por segundo y nunca se pasa). */
export function adapt(current: number, target: number, dt: number, tau = ADAPT_TIME): number {
  if (dt <= 0) return current;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** La exposición de cada cuadro. Caminando, la rampa de `adapt`; en un salto de cámara (partida nueva, aparición,
 *  teletransporte), que no es entrar ni salir caminando, el cuadro siguiente va directo a la del lugar nuevo (N3). */
export interface Eye {
  /** La de ahora. */
  readonly value: number;
  /** Hubo un salto: el próximo `step` no hace rampa. */
  jump(): void;
  /** La del cuadro, con la cámara adentro de un interior o no, `dt` s después del anterior. */
  step(inside: boolean, dt: number): number;
}

/** Arranca como si recién hubiera saltado: el primer cuadro ya es el del lugar. */
export function createEye(): Eye {
  let value = OUTDOOR_EXPOSURE;
  let jumped = true;
  return {
    get value() {
      return value;
    },
    jump() {
      jumped = true;
    },
    step(inside, dt) {
      const target = inside ? INDOOR_EXPOSURE : OUTDOOR_EXPOSURE;
      value = jumped ? target : adapt(value, target, dt);
      jumped = false;
      return value;
    },
  };
}
