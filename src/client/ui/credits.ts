// Pantalla de Créditos: se arma con data/sources.json (todo dato o imagen de terceros tiene que figurar ahí).
import sources from '../../../data/sources.json';

export interface Source { id: string; title: string; author: string; license: string; url: string }

export function createCredits(onBack: () => void, list: Source[] = sources): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.dataset.testid = 'creditos';
  const h = document.createElement('h2');
  h.textContent = 'Créditos';
  const ul = document.createElement('ul');
  ul.className = 'credits';
  for (const s of list) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = s.title;
    const small = document.createElement('small');
    small.textContent = `${s.author} · ${s.license}`;
    li.append(a, small);
    ul.append(li);
  }
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Volver';
  back.addEventListener('click', onBack);
  panel.append(h, ul, back);
  return panel;
}
