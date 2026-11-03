// Menú de lugares (M): los 38 lugares por nombre y la opción de aparecer en uno al azar.
import type { Place } from '../../shared/mapdata.ts';

const RANDOM_LABEL = 'Aparecer en un lugar al azar';

/** `onPick(null)` = al azar. */
export function createPlacesMenu(places: Place[], onPick: (placeId: string | null) => void, onBack: () => void): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'Lugares';
  const list = document.createElement('div');
  list.className = 'places';
  list.dataset.testid = 'menu-lugares';

  const button = (label: string, pick: string | null): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => onPick(pick));
    return b;
  };
  const random = button(RANDOM_LABEL, null);
  random.className = 'random';
  list.append(random);
  for (const p of [...places].sort((a, b) => a.name.localeCompare(b.name, 'es'))) list.append(button(p.name, p.id));

  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Volver';
  back.addEventListener('click', onBack);
  panel.append(h, list, back); // "Volver" queda fuera de la lista: la lista tiene solo los 39 lugares
  return panel;
}
