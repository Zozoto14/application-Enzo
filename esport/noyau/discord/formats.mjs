/** Dates et délais lisibles des messages Discord, dans la langue de la team (fonctions pures). */

import { localeIntl, texte } from '../langues.mjs';

/** Date longue et heure d'un instant dans le fuseau de la team. */
export function formaterInstant(fuseau, instantIso, langue = 'fr') {
  const d = new Date(instantIso);
  if (Number.isNaN(d.getTime())) return { date: '', heure: '' };
  try {
    return {
      date: new Intl.DateTimeFormat(localeIntl(langue), { timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long' }).format(d),
      heure: new Intl.DateTimeFormat(localeIntl(langue), { timeZone: fuseau, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d),
    };
  } catch {
    return { date: d.toISOString().slice(0, 10), heure: d.toISOString().slice(11, 16) };
  }
}

/** « dans 45 min », « dans 5 h », « dans 2 jours » / « in 45 min », « in 5 h », « in 2 days ». */
export function formaterDelai(ms, langue = 'fr') {
  if (ms <= 60_000) return texte(langue, 'delai.maintenant');
  if (ms < 90 * 60_000) return texte(langue, 'delai.minutes', { n: Math.round(ms / 60_000) });
  if (ms < 48 * 3_600_000) return texte(langue, 'delai.heures', { n: Math.round(ms / 3_600_000) });
  return texte(langue, 'delai.jours', { n: Math.round(ms / 86_400_000) });
}
