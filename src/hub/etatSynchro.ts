/**
 * Ce que l'indicateur de synchronisation du hub affiche, en données pures.
 *
 * Toujours un texte ET un pictogramme (jamais la seule couleur) :
 *   ✓ À jour · il y a 2 min          ⟳ Synchronisation…
 *   ⏳ 3 éléments en attente (hors ligne)   ⚠ Synchronisation impossible
 */

export type NiveauSynchro = 'ok' | 'encours' | 'attente' | 'erreur';

export interface VueSynchroHub {
  enCours: boolean;
  /** Dernier tour réussi (ISO). */
  derniere?: string;
  /** Changements locaux pas encore envoyés. */
  enAttente?: { cles: readonly string[]; depuisLe?: string; premierEchec?: string; essais: number; motif?: string };
  erreur?: string;
  /** Faux quand l'appareil se dit hors ligne. */
  enLigne?: boolean;
}

export interface ResumeSynchro {
  niveau: NiveauSynchro;
  icone: string;
  /** Texte court, toujours visible. */
  libelle: string;
  /** Explication plus longue (Paramètres, infobulle). */
  detail?: string;
}

/** « à l'instant », « il y a 2 min », « il y a 3 h », « il y a 2 j ». */
export function ilYA(iso: string | undefined, maintenant: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) {
    return 'jamais';
  }
  const secondes = Math.max(0, Math.round((maintenant - t) / 1000));
  if (secondes < 45) {
    return 'à l’instant';
  }
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) {
    return `il y a ${minutes} min`;
  }
  const heures = Math.round(minutes / 60);
  if (heures < 24) {
    return `il y a ${heures} h`;
  }
  return `il y a ${Math.round(heures / 24)} j`;
}

const elements = (n: number) => `${n} élément${n > 1 ? 's' : ''}`;

export function resumerSynchro(vue: VueSynchroHub, maintenant: number): ResumeSynchro {
  const attente = vue.enAttente?.cles.length ?? 0;
  const horsLigne = vue.enLigne === false;
  if (vue.enCours) {
    return { niveau: 'encours', icone: '⟳', libelle: 'Synchronisation…', detail: attente > 0 ? `${elements(attente)} à envoyer.` : undefined };
  }
  if (horsLigne) {
    return {
      niveau: 'attente',
      icone: '⏳',
      libelle: attente > 0 ? `${elements(attente)} en attente (hors ligne)` : 'Hors ligne',
      detail: 'Hors ligne : vous travaillez sur la copie de cet appareil. Vos modifications partiront toutes seules vers le serveur au retour de la connexion.',
    };
  }
  if (vue.erreur || (vue.enAttente && vue.enAttente.essais > 0)) {
    const motif = vue.erreur ?? vue.enAttente?.motif;
    return {
      niveau: 'erreur',
      icone: '⚠',
      libelle: attente > 0 ? `${elements(attente)} en attente · serveur injoignable` : 'Serveur injoignable',
      detail: `${motif ?? 'Le serveur ne répond pas.'} Nouvel essai automatique ; vous pouvez aussi réessayer maintenant.`,
    };
  }
  if (attente > 0) {
    return { niveau: 'attente', icone: '⏳', libelle: `${elements(attente)} à envoyer`, detail: 'Envoi dans quelques secondes.' };
  }
  return {
    niveau: 'ok',
    icone: '✓',
    libelle: vue.derniere ? `À jour · ${ilYA(vue.derniere, maintenant)}` : 'Pas encore synchronisé',
    detail: vue.derniere ? `Données enregistrées sur le serveur ; dernier échange ${ilYA(vue.derniere, maintenant)}.` : undefined,
  };
}
