/** Dates et délais lisibles des messages Discord (fonctions pures). */

/** Date longue et heure d'un instant dans le fuseau de la team. */
export function formaterInstant(fuseau, instantIso) {
  const d = new Date(instantIso);
  if (Number.isNaN(d.getTime())) return { date: '', heure: '' };
  try {
    return {
      date: new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long' }).format(d),
      heure: new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d),
    };
  } catch {
    return { date: d.toISOString().slice(0, 10), heure: d.toISOString().slice(11, 16) };
  }
}

/** « dans 45 min », « dans 5 h », « dans 2 jours ». */
export function formaterDelai(ms) {
  if (ms <= 60_000) return 'maintenant';
  if (ms < 90 * 60_000) return `dans ${Math.round(ms / 60_000)} min`;
  if (ms < 48 * 3_600_000) return `dans ${Math.round(ms / 3_600_000)} h`;
  return `dans ${Math.round(ms / 86_400_000)} jours`;
}
