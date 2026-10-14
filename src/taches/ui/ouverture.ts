/** Vue d'ouverture de l'app Tâches (réglage de l'appareil) : le calendrier de la semaine par défaut. */
export type Ouverture = 'calendrier-semaine' | 'journee' | 'liste' | 'derniere';
export const LIBELLES_OUVERTURE: Record<Ouverture, string> = {
  'calendrier-semaine': 'Calendrier de la semaine (par défaut)',
  journee: 'Ma journée',
  liste: 'Toutes les tâches en liste',
  derniere: 'La dernière vue utilisée',
};
