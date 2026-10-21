/**
 * Style « pour cet appareil uniquement ».
 *
 * Le thème d'un compte est synchronisé sur le serveur (`hub.theme`, entité `prefs:theme`) et suit
 * le compte sur tous ses appareils ; son NOM est aussi publié pour l'écran de connexion
 * (`/v9/theme/<h>`), qui l'applique dès qu'on tape l'identifiant. Un appareil peut garder un style
 * à lui : il est rangé dans le stockage local de CET appareil (par compte), jamais envoyé, et prend
 * le dessus ici seulement — à l'écran de connexion comme une fois connecté.
 */

import { cleLocale } from '../profils/espace';
import { idThemeHubValide } from './themeUnique';
import type { IdThemeHub } from './themes';

export const CLE_THEME_APPAREIL = 'applibourse.theme.appareil';

type Local = { getItem(c: string): string | null; setItem(c: string, v: string): void; removeItem?(c: string): void };
const local = (): Local | undefined => (globalThis as { localStorage?: Local }).localStorage;

/** Thème propre à cet appareil pour le compte `profil` (le compte ouvert par défaut), s'il y en a un. */
export function lireThemeAppareil(profil?: string, stockage: Local | undefined = local()): IdThemeHub | undefined {
  try {
    return idThemeHubValide(stockage?.getItem(cleLocale(CLE_THEME_APPAREIL, profil)));
  } catch {
    return undefined;
  }
}

/** Fixe (ou retire, `undefined`) le thème propre à cet appareil. */
export function definirThemeAppareil(id: IdThemeHub | undefined, profil?: string, stockage: Local | undefined = local()): void {
  try {
    if (id) stockage?.setItem(cleLocale(CLE_THEME_APPAREIL, profil), id);
    else stockage?.removeItem?.(cleLocale(CLE_THEME_APPAREIL, profil));
  } catch {
    // Stockage interdit (navigation privée) : le thème synchronisé s'applique.
  }
}

/** Thème à afficher : celui de l'appareil s'il existe, sinon celui du compte. */
export const themeEffectif = (duCompte: IdThemeHub, deLAppareil: IdThemeHub | undefined): IdThemeHub => deLAppareil ?? duCompte;
