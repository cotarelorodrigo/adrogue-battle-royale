// La adaptación del ojo (H2e): con la cámara adentro de un interior, la exposición del tone mapping va de a poco hacia
// la de adentro, y al salir vuelve a la de la calle. Lo horneado de adentro lleva además una ganancia (T11c): el ojo se
// adapta a la luz de la sala más de lo que da la exposición sola, como una adaptación local. Así una pared blanca de
// adentro se lee ~220 sin quemar lo que se ve por las ventanas (la calle, a la exposición de adentro) ni lo que brilla
// (calibrado a INDOOR_EXPOSURE), y desde la calle el interior queda oscuro, como en las fotos.

/** La exposición de la calle (la de siempre, la del cielo de Preetham con ACES). */
export const OUTDOOR_EXPOSURE = 0.7;
/** La de adentro: la del mundo que se ve por las ventanas y la de lo que brilla (los colores de glow están calibrados a
 *  esta, tests/client/aces.ts). Lo horneado de adentro se ve a INDOOR_EXPOSURE · INTERIOR_EXPOSURE · INDOOR_GAIN. */
export const INDOOR_EXPOSURE = 2.8;
/** La ganancia de lo horneado de adentro, ya adaptado: con INTERIOR_EXPOSURE (0,078), la pared blanca de un banco a luz
 *  plena (el liso de 0,85 de luma) se lee ~224 y su mediana ~207 (tests/client/aspecto.test.ts, I1 de la T11c). El
 *  producto INTERIOR_EXPOSURE · INDOOR_GAIN (0,546) es ~5 % menos que antes (0,576): la pared a luz plena deja lugar a un
 *  ventanal 20 más claro sin quemarse (el blanco que brilla da 246). Desde la vereda lo de adentro queda ~13 % más
 *  oscuro (lo más claro de un banco, ≤ 46). Lo que imita lo horneado en un mueble que brilla (models.ts, `horneado`) va
 *  con INTERIOR_EXPOSURE: no depende de esta. */
export const INDOOR_GAIN = 7.0;
/** La ganancia de lo horneado de adentro con la exposición `exposure`: 1 con la de afuera, INDOOR_GAIN con la de adentro y,
 *  en la rampa de la adaptación, en proporción geométrica (sin saltos al entrar ni al salir). */
export function interiorGain(exposure: number): number {
  const t = Math.min(1, Math.max(0, (exposure - OUTDOOR_EXPOSURE) / (INDOOR_EXPOSURE - OUTDOOR_EXPOSURE)));
  return INDOOR_GAIN ** t;
}
/** La ganancia del cuadro, compartida por los materiales de lo horneado (interiors/baked.ts): la pone main en cada cuadro. */
export const INTERIOR_GAIN = { value: 1 };
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
