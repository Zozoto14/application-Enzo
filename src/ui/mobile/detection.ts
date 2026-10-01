/**
 * Le « mode téléphone » : une seule règle, un seul endroit.
 *
 * Est un téléphone :
 *  - toute fenêtre de moins de 768 px de large (iPhone, site de secours sur téléphone, fenêtre de PC
 *    très étroite) ;
 *  - l'app native (iPhone, iPad) tenue en portrait.
 *
 * Tablette en paysage et PC : rien ne change, l'affichage actuel est gardé tel quel.
 *
 * Les tests unitaires tournent avec la fenêtre simulée de React Native (750 × 1334, « iOS ») : ils
 * seraient tous en mode téléphone. `jest.setup.js` force donc le mode « large » par défaut (les tests
 * existants décrivent l'affichage de bureau) ; un test du mode téléphone le demande explicitement par
 * `forcerModeAffichage('telephone')` ou par le fournisseur `ModeAffichage`.
 */

/** Points de rupture de toute l'application (largeur de fenêtre, en px). */
export const POINTS_RUPTURE = {
  /** En dessous : mode téléphone (une colonne, navigation basse). */
  telephone: 768,
  /** Au-dessus : cartes en plusieurs colonnes (`LARGEUR_MULTICOLONNE`). */
  multicolonne: 900,
  /** Au-dessus : barre latérale du portefeuille (`LARGEUR_NAVIGATION`). */
  navigationLaterale: 900,
  /** Au-dessus : la barre latérale affiche ses libellés. */
  libellesLateraux: 1180,
} as const;

export type ModeAffichage = 'telephone' | 'large';

export interface Fenetre {
  largeur: number;
  hauteur: number;
  /** `Platform.OS` : 'ios', 'android', 'web'… */
  os: string;
}

/** Règle pure, testée à part : vrai pour un téléphone. */
export function estTelephone({ largeur, hauteur, os }: Fenetre): boolean {
  if (largeur < POINTS_RUPTURE.telephone) {
    return true;
  }
  const natif = os === 'ios' || os === 'android';
  return natif && hauteur > largeur;
}

const CLE_GLOBALE = '__APPDASHBOARD_MODE_AFFICHAGE__';

/** Force le mode pour tout le processus (tests) ; `undefined` rend la détection automatique. */
export function forcerModeAffichage(mode: ModeAffichage | undefined): void {
  (globalThis as Record<string, unknown>)[CLE_GLOBALE] = mode;
}

/** Mode forcé, s'il y en a un. */
export function modeForce(): ModeAffichage | undefined {
  const valeur = (globalThis as Record<string, unknown>)[CLE_GLOBALE];
  return valeur === 'telephone' || valeur === 'large' ? valeur : undefined;
}
