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

/**
 * Une place où vos valeurs cotent est-elle ouverte ? Paris, ou New York
 * (15 h 30 à 22 h, heure de Paris) pour les valeurs américaines.
 */
export function seanceEnCours(maintenant: Date = new Date()): boolean {
  if (marcheOuvert(maintenant)) {
    return true;
  }
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/New_York',
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
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60 + 10;
}

/** Intervalles proposés dans les paramètres, en secondes ; 0 : jamais. */
export const INTERVALLES_ACTUALISATION = [10, 30, 60, 300, 0] as const;

/** Par défaut : toutes les dix secondes, fenêtre ouverte. */
export const INTERVALLE_PAR_DEFAUT_S = 10;

/** Lit le réglage enregistré ; une valeur inconnue revient au défaut. */
export function intervalleActualisation(enregistre: string | undefined): number {
  const valeur = Number(enregistre);
  return enregistre !== undefined && (INTERVALLES_ACTUALISATION as readonly number[]).includes(valeur)
    ? valeur
    : INTERVALLE_PAR_DEFAUT_S;
}

/** « 10 s », « 1 min », « Jamais ». */
export function libelleIntervalle(secondes: number): string {
  if (secondes === 0) return 'Jamais';
  return secondes < 60 ? `${secondes} s` : `${secondes / 60} min`;
}
