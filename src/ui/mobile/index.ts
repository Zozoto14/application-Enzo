/**
 * Système de design du mode téléphone. Documentation : docs/mobile/design-system.md ;
 * procédure d'application aux écrans : docs/mobile/guide-ecrans.md.
 */

export { POINTS_RUPTURE, estTelephone, forcerModeAffichage, modeForce, type ModeAffichage } from './detection';
export { ModeAffichageForce, useMobile, useModeAffichage } from './useMobile';
export { CONTROLE, DUREE, ESPACE, EXEMPTE_TEXTE, GOUTTIERE, TEXTE, TEXTE_MIN, rayonCarte, rayonControle, tailleTexte, themeActif } from './jetons';
export { ZoneSecurite, margesSecurite, type Cote } from './ZoneSecurite';
export { EnTeteMobile, BoutonIcone, type ActionEnTete } from './EnTeteMobile';
export { BarreOnglets, MAX_ONGLETS, type EntreeOnglet } from './BarreOnglets';
export { FeuilleBasse } from './FeuilleBasse';
export { Cellule, GroupeCellules, type CelluleProps } from './ListeCellules';
export { SectionRepliable } from './SectionRepliable';
export { BoutonPrincipal, PiedCollant } from './BoutonPrincipal';
export { ChampMobile, prereglagesClavier, type ChampMobileProps, type NatureChamp } from './ChampMobile';
export { EcranMobile } from './EcranMobile';
export { BORD_BALAYAGE, SEUIL_BALAYAGE, estBalayageRetour, useBalayageRetour } from './gestes';
export { BarreBasseHub, FeuilleCompte, NavigationMobileContexte, entreesBarreHub, useNavigationMobile, type EntreeHub, type NavigationMobile } from './NavigationMobile';
