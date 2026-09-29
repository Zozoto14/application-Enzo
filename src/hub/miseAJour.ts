/**
 * Bouton « Mettre à jour » du hub, en données pures.
 *
 * Il ne réinvente rien : il pilote le mécanisme existant de chaque plateforme.
 *
 *  - **Bureau (Electron)** : le pont `applibourse.maj` (voir
 *    `bureau/electron/prechargement.cjs`) — `chercher()` interroge GitHub,
 *    `redemarrer()` récupère le code puis relance l'app, comme la carte
 *    « Mises à jour » des Paramètres ;
 *  - **Web (site de secours)** : pas d'auto-mise à jour ; on vide les caches
 *    du navigateur (et un éventuel service worker) puis on recharge la page,
 *    qui reprend la dernière version publiée ;
 *  - **iPhone / iPad** : les mises à jour signées s'installent depuis les
 *    Paramètres du portefeuille (fichier copié sur l'appareil) ; le bouton le
 *    dit, avec la version en service.
 */

export type PlateformeMaj = 'bureau' | 'web' | 'appareil';

export type EtatMaj =
  | { phase: 'repos' }
  | { phase: 'verification' }
  | { phase: 'a-jour'; commit?: string }
  | { phase: 'disponible'; nouveautes: string[]; commit?: string }
  | { phase: 'telechargement' }
  | { phase: 'redemarrage' }
  | { phase: 'rechargement' }
  | { phase: 'info'; message: string }
  | { phase: 'erreur'; motif: string };

/** Réponse de `applibourse.maj.chercher()` (même forme que dans les Paramètres). */
export type ReponseVerification =
  | { etat: 'a-jour'; commit?: string }
  | { etat: 'disponible'; commit?: string; nouveautes: string[]; echecPrecedent?: string }
  | { etat: 'erreur'; motif: string }
  | { etat: string; [cle: string]: unknown };

export type EvenementMaj =
  | { type: 'verifier' }
  | { type: 'reponse'; reponse: ReponseVerification }
  | { type: 'installer' }
  | { type: 'installe'; ok: boolean; motif?: string }
  | { type: 'recharger' }
  | { type: 'info'; message: string }
  | { type: 'echec'; motif: string }
  | { type: 'fermer' };

export function transition(etat: EtatMaj, evenement: EvenementMaj): EtatMaj {
  switch (evenement.type) {
    case 'verifier':
      return etat.phase === 'verification' || etat.phase === 'telechargement' || etat.phase === 'redemarrage' ? etat : { phase: 'verification' };
    case 'reponse': {
      const r = evenement.reponse;
      if (r.etat === 'a-jour') {
        return { phase: 'a-jour', commit: typeof r.commit === 'string' && r.commit ? r.commit : undefined };
      }
      if (r.etat === 'disponible') {
        const nouveautes = Array.isArray(r.nouveautes) ? r.nouveautes.filter((n): n is string => typeof n === 'string') : [];
        return { phase: 'disponible', nouveautes, commit: typeof r.commit === 'string' && r.commit ? r.commit : undefined };
      }
      if (r.etat === 'erreur') {
        return { phase: 'erreur', motif: typeof r.motif === 'string' ? r.motif : 'Vérification impossible.' };
      }
      return { phase: 'erreur', motif: 'Réponse inattendue du système de mise à jour.' };
    }
    case 'installer':
      return etat.phase === 'disponible' ? { phase: 'telechargement' } : etat;
    case 'installe':
      return evenement.ok ? { phase: 'redemarrage' } : { phase: 'erreur', motif: evenement.motif ?? 'La mise à jour n’a pas pu être récupérée.' };
    case 'recharger':
      return { phase: 'rechargement' };
    case 'info':
      return { phase: 'info', message: evenement.message };
    case 'echec':
      return { phase: 'erreur', motif: evenement.motif };
    case 'fermer':
      return etat.phase === 'telechargement' || etat.phase === 'redemarrage' || etat.phase === 'rechargement' ? etat : { phase: 'repos' };
  }
}

/** Libellé court du bouton, selon l'état. */
export function libelleBouton(etat: EtatMaj): string {
  switch (etat.phase) {
    case 'verification':
      return 'Vérification…';
    case 'disponible':
      return 'Nouvelle version';
    case 'telechargement':
      return 'Téléchargement…';
    case 'redemarrage':
      return 'Redémarrage…';
    case 'rechargement':
      return 'Actualisation…';
    case 'a-jour':
      return 'À jour';
    case 'erreur':
      return 'Mise à jour : erreur';
    default:
      return 'Mettre à jour';
  }
}

/** Phrase d'état, pour le panneau et les lecteurs d'écran. */
export function messageEtat(etat: EtatMaj, plateforme: PlateformeMaj): string {
  switch (etat.phase) {
    case 'repos':
      return plateforme === 'bureau'
        ? 'Vérifie sur GitHub si une nouvelle version est disponible.'
        : plateforme === 'web'
          ? 'Recharge l’app depuis le site pour prendre la dernière version publiée.'
          : 'Les mises à jour de l’app s’installent depuis les Paramètres du portefeuille.';
    case 'verification':
      return 'Recherche d’une nouvelle version…';
    case 'a-jour':
      return `Vous avez la dernière version${etat.commit ? ` (${etat.commit})` : ''}.`;
    case 'disponible':
      return `Nouvelle version disponible : ${etat.nouveautes.length} nouveauté${etat.nouveautes.length > 1 ? 's' : ''}.`;
    case 'telechargement':
      return 'Récupération de la nouvelle version…';
    case 'redemarrage':
      return 'Redémarrer pour appliquer : l’application se ferme et se rouvre à jour (une ou deux minutes). Vos données ne sont pas touchées.';
    case 'rechargement':
      return 'Actualisation de l’app…';
    case 'info':
      return etat.message;
    case 'erreur':
      return `Mise à jour impossible : ${etat.motif}`;
  }
}

/** Plateforme d'après les ponts présents. */
export function plateformeMaj(globalObj: unknown, estWeb: boolean): PlateformeMaj {
  const maj = (globalObj as { applibourse?: { maj?: { chercher?: unknown } } } | undefined)?.applibourse?.maj;
  if (maj && typeof maj.chercher === 'function') {
    return 'bureau';
  }
  return estWeb ? 'web' : 'appareil';
}
