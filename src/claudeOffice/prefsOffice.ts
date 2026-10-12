/**
 * Claude Office : petits réglages PROPRES À L'APPAREIL (rangés sous le profil
 * ouvert, jamais envoyés au relais) : vue Scène ou Liste, délai de la salle
 * d'attente, fins de tâche déjà vues, notification « attend ta réponse ».
 */

import type { BasePrefs } from '../tsuzuku/plateforme/stockage';

export const CLE_PREFS_OFFICE = 'claude-office.bureau';
/** Délais proposés pour la salle d'attente (minutes) ; `vu` : jusqu'à ce que je l'aie vu. */
export const DELAIS_SALLE = [1, 5, 10, 30, 'vu'] as const;
export type DelaiSalle = (typeof DELAIS_SALLE)[number];
/** Au plus ce nombre de fins « vues » gardées (les plus récentes). */
export const MAX_VUS = 300;

export interface PrefsOffice {
  vue: 'scene' | 'liste';
  delaiSalle: DelaiSalle;
  vus: string[];
  /** PC : notification système quand Claude attend ta réponse (désactivée par défaut). */
  notifierAttente: boolean;
}

export const PREFS_DEFAUT: PrefsOffice = { vue: 'scene', delaiSalle: 5, vus: [], notifierAttente: false };

export function lirePrefsOffice(base: BasePrefs | undefined): PrefsOffice {
  try {
    const o = JSON.parse(base?.lire(CLE_PREFS_OFFICE) ?? '{}') as Partial<PrefsOffice>;
    return {
      vue: o.vue === 'liste' ? 'liste' : 'scene',
      delaiSalle: (DELAIS_SALLE as readonly unknown[]).includes(o.delaiSalle) ? (o.delaiSalle as DelaiSalle) : 5,
      vus: Array.isArray(o.vus) ? o.vus.filter((v): v is string => typeof v === 'string' && v.length < 300).slice(-MAX_VUS) : [],
      notifierAttente: o.notifierAttente === true,
    };
  } catch {
    return { ...PREFS_DEFAUT };
  }
}

export function ecrirePrefsOffice(base: BasePrefs | undefined, prefs: PrefsOffice): void {
  try {
    base?.ecrire(CLE_PREFS_OFFICE, JSON.stringify({ ...prefs, vus: prefs.vus.slice(-MAX_VUS) }));
  } catch {
    // Stockage indisponible (navigation privée…) : le réglage vaut pour cette fois.
  }
}

/** Délai en millisecondes pour la logique du bureau (`null` : jusqu'à ce qu'il soit vu). */
export const delaiSalleMs = (d: DelaiSalle): number | null => (d === 'vu' ? null : d * 60_000);
