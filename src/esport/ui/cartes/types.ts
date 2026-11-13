/**
 * Carte d'un jeu rendue en plateau (composant réutilisable `CarteJeu`) : propriétés communes au web et au natif.
 *
 * Même rendu que l'atelier de strats : minimap à fond transparent redessinée (sol teinté, liseré clair, ombre
 * intérieure, fond sombre et vignettage), vue de dessus opaque gardée et au besoin atténuée, zones nommées en aplats
 * doux, repères en pastilles avec leur lettre, callouts en petites capitales à halo sombre. Les couleurs et tailles
 * viennent des jetons de design (esport/noyau/strats/plateau.json).
 *
 * Pour d'autres écrans (lineups, plans de match, miniatures) :
 *
 *   <CarteJeu theme={theme} carte={carteAsset} images={cacheImages} taille={320}>
 *     {({ px }) => <Pin style={{ position: 'absolute', left: px(420), top: px(310) }} />}
 *   </CarteJeu>
 *
 * Le contenu (`children`) est posé par-dessus, dans un cadre de la taille de la carte ; `px` convertit une
 * coordonnée du repère (carré de 1000 unités, comme les strats et les callouts du profil) en pixels.
 */

import type React from 'react';
import type { ThemeHub } from '../../../hub/themes';
import type { CacheImages, CarteAsset } from '../../strats/assets';
import type { Attenuation, IdThemeCarte } from '../../strats/plateau';

/** Ce que reçoit le contenu posé sur la carte. */
export interface RepereCarteJeu {
  /** Côté de la carte à l'écran (px). */
  taille: number;
  /** Coordonnée du repère (0 à 1000) → pixels dans la carte. */
  px(unite: number): number;
}

export interface PropsCarteJeu {
  theme: ThemeHub;
  /** Map du profil de jeu (image, dimensions, zones, repères) ; absente : fond du plateau et nom seulement. */
  carte?: Pick<CarteAsset, 'nom' | 'minimap' | 'largeurImage' | 'hauteurImage' | 'zones' | 'reperes'> | null;
  /** Image à la place de `carte.minimap` : une adresse, ou les sources dans l'ordre (`sourcesImage`). */
  image?: string | ReadonlyArray<string> | null;
  /** Cache d'images (web : lecture par `fetch` puis blob: local) ; absent : l'adresse est chargée telle quelle. */
  images?: CacheImages;
  /** Côté de la carte (px) ; absent : toute la largeur disponible (carrée). */
  taille?: number;
  /** Thème de la map (défaut : « Tactique sombre ») et atténuation des images de type photo. */
  themeCarte?: IdThemeCarte;
  attenuation?: Attenuation;
  /** Zones nommées, repères et callouts du profil (défaut : oui) ; étiquettes des callouts (défaut : oui dès 280 px). */
  reperes?: boolean;
  etiquettes?: boolean;
  /** Étage affiché (The Finals) : les repères des autres étages sont estompés. */
  niveau?: number | null;
  /** Map retournée (défense) : 180°. */
  rotation?: 0 | 180;
  /** Coins arrondis (px ; défaut : 10). */
  rayon?: number;
  /** Nom de la map en filigrane quand il n'y a pas d'image (défaut : oui). */
  filigrane?: boolean;
  /** Contenu posé sur la carte (pins, tracés) : nœud, ou fonction recevant le repère. */
  children?: React.ReactNode | ((repere: RepereCarteJeu) => React.ReactNode);
  testID?: string;
  accessibilityLabel?: string;
}
