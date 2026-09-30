/**
 * Un seul thème pour toute l'application.
 *
 * Le hub a huit thèmes ; le portefeuille en avait cinq à lui
 * (`affichage.theme`). Il n'y en a plus qu'un : celui du hub (`hub.theme`),
 * appliqué au hub, au portefeuille, à l'administration et aux apps à venir.
 * Le portefeuille garde son identité par les couleurs d'accent du thème
 * (`teintes.portefeuille`), pas par un thème distinct.
 *
 * Données pures : la migration, le cache de démarrage et la lecture de
 * l'ancien réglage sont testés à part (voir `themeUnique.test.ts`).
 */

import { CLE_THEME, type StockagePrefs } from './personnalisation';
import { THEME_HUB_DEFAUT, THEMES_HUB, type IdThemeHub } from './themes';

/** Ancien réglage du portefeuille (`PARAMETRES.theme`), gardé en lecture pour la migration. */
export const CLE_THEME_PORTEFEUILLE_ANCIEN = 'affichage.theme';

/** Anciens thèmes du portefeuille → thème du hub le plus proche. */
export const ANCIENS_THEMES: Readonly<Record<string, IdThemeHub>> = {
  classique: 'nuit',
  ivoire: 'ivoire-couleur',
  'nuit-editoriale': 'nuit-editoriale',
  sauge: 'sauge',
  'nuit-vive': 'nuit-vive',
};

export function idThemeHubValide(valeur: unknown): IdThemeHub | undefined {
  return typeof valeur === 'string' ? THEMES_HUB.find(theme => theme.id === valeur)?.id : undefined;
}

/** Thème du hub correspondant à un ancien thème du portefeuille, s'il est connu. */
export function depuisAncienTheme(valeur: unknown): IdThemeHub | undefined {
  return typeof valeur === 'string' && Object.prototype.hasOwnProperty.call(ANCIENS_THEMES, valeur) ? ANCIENS_THEMES[valeur] : undefined;
}

/**
 * Valeur retenue : le thème du hub d'abord ; à défaut l'ancien thème du
 * portefeuille converti ; à défaut « Nuit ».
 */
export function themeUnique(hub: unknown, ancien?: unknown): IdThemeHub {
  return idThemeHubValide(hub) ?? depuisAncienTheme(ancien) ?? THEME_HUB_DEFAUT;
}

/**
 * Migration idempotente, faite au déverrouillage : si le hub n'a pas encore de
 * thème mais que l'ancien réglage du portefeuille existe (ici ou reçu de la
 * synchro `prefs:theme-portefeuille`), le thème du hub l'adopte. Une fois
 * `hub.theme` posé, l'ancien réglage n'est plus jamais relu : rappeler la
 * fonction ne change rien. Ne lève jamais.
 */
export function migrerThemeUnique(stockage: StockagePrefs): { theme: IdThemeHub; migre: boolean } {
  try {
    const courant = idThemeHubValide(stockage.lire(CLE_THEME));
    if (courant) {
      return { theme: courant, migre: false };
    }
    const ancien = depuisAncienTheme(stockage.lire(CLE_THEME_PORTEFEUILLE_ANCIEN));
    if (ancien) {
      stockage.ecrire(CLE_THEME, ancien);
      return { theme: ancien, migre: true };
    }
  } catch {
    // Stockage illisible : thème par défaut, rien ne casse.
  }
  return { theme: THEME_HUB_DEFAUT, migre: false };
}

// ---------------------------------------------------- Cache de démarrage

/** Dernier thème appliqué (identifiant de thème, non sensible) : lu avant le déverrouillage. */
export const CLE_CACHE_THEME = 'applibourse.theme';
/** Dernières préférences d'affichage du hub (densité, disposition), même usage. */
export const CLE_CACHE_AFFICHAGE = 'applibourse.affichage';
/** Couleur de fond du dernier thème, pour peindre la page avant même le premier rendu (index.html). */
export const CLE_CACHE_FOND = 'applibourse.fond';

export interface StockageLocal {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
}

/** Stockage local de l'appareil (navigateur, Electron) ; absent en natif ou dans un test sans DOM. */
export function stockageLocalAppareil(): StockageLocal | undefined {
  return (globalThis as { localStorage?: StockageLocal }).localStorage;
}

/**
 * Thème mémorisé, lu de façon synchrone. Accepte aussi les identifiants de
 * l'ancien portefeuille (caches écrits avant la fusion des thèmes).
 */
export function lireThemeMemorise(stockage: StockageLocal | undefined, cle: string): IdThemeHub {
  try {
    const brut = stockage?.getItem(cle);
    return themeUnique(brut, brut);
  } catch {
    return THEME_HUB_DEFAUT;
  }
}

export interface AffichageMemorise {
  densite: 'aere' | 'compact';
  disposition: 'grille' | 'liste';
}

export function lireAffichageMemorise(stockage: StockageLocal | undefined, cle: string): AffichageMemorise | undefined {
  try {
    const brut = stockage?.getItem(cle);
    if (!brut) {
      return undefined;
    }
    const lu = JSON.parse(brut) as Partial<AffichageMemorise> | null;
    return {
      densite: lu?.densite === 'compact' ? 'compact' : 'aere',
      disposition: lu?.disposition === 'liste' ? 'liste' : 'grille',
    };
  } catch {
    return undefined;
  }
}

export function memoriserAffichage(stockage: StockageLocal | undefined, cle: string, valeur: AffichageMemorise): void {
  try {
    stockage?.setItem(cle, JSON.stringify(valeur));
  } catch {
    // Cache indisponible : le prochain démarrage relira la base après déverrouillage.
  }
}
