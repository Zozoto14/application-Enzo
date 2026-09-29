import { store } from './store.js';

export const currencyFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
export const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
export const monthLongFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Privacy mode keeps layout identical and only masks the glyphs, so turning it on
// never reflows the page.
export function money(amount) {
  const formatted = currencyFmt.format(amount);
  if (!store.ui.privacyMode) return escapeHtml(formatted);
  return `<span class="masked" aria-label="Montant masqué">${escapeHtml(formatted)}</span>`;
}

export function plainMoney(amount) {
  return currencyFmt.format(amount);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
