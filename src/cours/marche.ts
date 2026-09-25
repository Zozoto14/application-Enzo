/**
 * Heures d'ouverture d'Euronext Paris, pour savoir quand actualiser les cours.
 *
 * Séance de 9 h à 17 h 30, heure de Paris, du lundi au vendredi ; on déborde
 * de dix minutes pour attraper le fixing de clôture. Les jours fériés ne sont
 * pas connus : un appel de trop un 25 décembre ne coûte rien.
 */

export function marcheOuvert(maintenant: Date = new Date()): boolean {
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(maintenant);
  const lire = (type: string) => parties.find(partie => partie.type === type)?.value ?? '';
  const jour = lire('weekday').toLowerCase();
  if (jour.startsWith('sam') || jour.startsWith('dim')) {
    return false;
  }
  const minutes = Number(lire('hour')) * 60 + Number(lire('minute'));
  return minutes >= 9 * 60 && minutes <= 17 * 60 + 40;
}

/** Intervalle entre deux actualisations pendant la séance. */
export const INTERVALLE_ACTUALISATION_MS = 5 * 60_000;
