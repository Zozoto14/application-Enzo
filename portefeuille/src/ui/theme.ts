/**
 * Jetons de style.
 *
 * Regroupés ici pour que les couleurs et les espacements ne soient pas
 * réinventés écran par écran.
 *
 * Plusieurs thèmes au choix (Paramètres › Apparence) : le sombre d'origine,
 * et quatre styles plus éditoriaux, clairs ou sombres, aux graphiques plus
 * colorés. Le thème actif est un simple état de module, comme le mode
 * discret : `palettePour()` le lit à chaque rendu.
 *
 * Le vert et le rouge ne portent jamais seuls l'information : chaque montant
 * signé affiche aussi son signe. Environ un homme sur douze distingue mal ces
 * deux couleurs.
 */

import { StyleSheet } from 'react-native';

export interface Palette {
  fond: string;
  surface: string;
  /** Surface d'un élément posé sur une carte : champ, ligne survolée. */
  surfaceHaute: string;
  bordure: string;
  texte: string;
  texteSecondaire: string;
  /** Bleu des liens, onglets et courbes : lisible sur le fond. */
  accent: string;
  /** Bleu des boutons pleins : porte un texte blanc lisible. */
  accentPlein: string;
  /** Fond teinté d'une pastille bleue. */
  accentFond: string;
  hausse: string;
  baisse: string;
  /** Fonds teintés des pastilles de variation. */
  hausseFond: string;
  baisseFond: string;
  danger: string;
  surAccent: string;
  /** Seconde série d'un graphique : l'indice de référence. */
  reference: string;
  /** Couleurs des séries et des parts, dans l'ordre d'attribution. */
  series: readonly string[];
  /** Vrai pour un thème sombre : barre d'état claire, etc. */
  sombre?: boolean;
  /** Fond de la barre latérale ; à défaut, `surface`. */
  navigation?: string;
  /** Teintes des trois cartes chiffrées du Résumé, quand le thème en a. */
  teintesCartes?: readonly [string, string, string];
  /** Police des titres et grands chiffres (bureau), et celle du texte. */
  policeTitre?: string;
  policeTexte?: string;
}

/**
 * Couleurs de séries, distinctes aussi en luminosité : bleu, jaune, orange,
 * vert, violet, rose, turquoise, gris. Le bleu et l'orange ouvrent la liste,
 * le couple le mieux distingué par tous les yeux.
 */
const SERIES = [
  '#4d8cf5',
  '#f5c542',
  '#f08a3c',
  '#3fbf7f',
  '#a78bfa',
  '#f472b6',
  '#2dd4bf',
  '#9ca3af',
] as const;

export const PALETTE_CLAIRE: Palette = {
  fond: '#f5f6f8',
  surface: '#ffffff',
  surfaceHaute: '#f0f2f5',
  bordure: '#e2e5ea',
  texte: '#14181f',
  texteSecondaire: '#616b7a',
  accent: '#2f5bd8',
  accentPlein: '#2f5bd8',
  accentFond: 'rgba(47, 91, 216, 0.12)',
  hausse: '#0f7b44',
  baisse: '#c0392b',
  hausseFond: 'rgba(15, 123, 68, 0.12)',
  baisseFond: 'rgba(192, 57, 43, 0.12)',
  danger: '#c0392b',
  surAccent: '#ffffff',
  reference: '#b7791f',
  series: SERIES,
};

export const PALETTE_SOMBRE: Palette = {
  sombre: true,
  fond: '#000000',
  surface: '#0f0f10',
  surfaceHaute: '#1a1a1c',
  bordure: '#252528',
  texte: '#f4f4f5',
  texteSecondaire: '#a1a1aa',
  accent: '#4d8cf5',
  accentPlein: '#2563eb',
  accentFond: 'rgba(77, 140, 245, 0.16)',
  hausse: '#34c77b',
  baisse: '#f05252',
  hausseFond: 'rgba(52, 199, 123, 0.14)',
  baisseFond: 'rgba(240, 82, 82, 0.14)',
  danger: '#f05252',
  surAccent: '#ffffff',
  reference: '#f5c542',
  series: SERIES,
};

export const ESPACEMENT = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
} as const;

export const RAYON = { s: 8, m: 12, l: 20 } as const;

// ---------------------------------------------------------------- Thèmes

const IVOIRE: Palette = {
  fond: '#F6F3EC',
  surface: '#FFFFFF',
  surfaceHaute: '#F3EEE4',
  bordure: '#E6DFD2',
  texte: '#1C1B18',
  texteSecondaire: '#6B665C',
  accent: '#B24C27',
  accentPlein: '#1C1B18',
  accentFond: 'rgba(194, 86, 47, 0.12)',
  hausse: '#2F7D57',
  baisse: '#B3372F',
  hausseFond: 'rgba(47, 125, 87, 0.12)',
  baisseFond: 'rgba(179, 55, 47, 0.12)',
  danger: '#B3372F',
  surAccent: '#F6F3EC',
  reference: '#3A5BA0',
  series: ['#C2562F', '#1F7A6D', '#3A5BA0', '#D69A2D', '#8A5A9E', '#5E8C3A', '#C0587E', '#8C857A'],
  sombre: false,
  navigation: '#F6F3EC',
  policeTitre: 'Fraunces',
  policeTexte: 'Manrope',
};

const NUIT_EDITORIALE: Palette = {
  fond: '#16140F',
  surface: '#1F1C16',
  surfaceHaute: '#2A261E',
  bordure: '#2E2A22',
  texte: '#F3EEE3',
  texteSecondaire: '#A89F8E',
  accent: '#F0A27D',
  accentPlein: '#F3EEE3',
  accentFond: 'rgba(224, 122, 79, 0.18)',
  hausse: '#5CC3A8',
  baisse: '#F07A6B',
  hausseFond: 'rgba(92, 195, 168, 0.16)',
  baisseFond: 'rgba(240, 122, 107, 0.16)',
  danger: '#F07A6B',
  surAccent: '#16140F',
  reference: '#E8B84A',
  series: ['#E07A4F', '#5CC3A8', '#7FA7F2', '#E8B84A', '#C58BE0', '#9BC35C', '#E57FA0', '#A89F8E'],
  sombre: true,
  navigation: '#13110D',
  policeTitre: 'Fraunces',
  policeTexte: 'Manrope',
};

const SAUGE: Palette = {
  fond: '#F8FAF6',
  surface: '#FFFFFF',
  surfaceHaute: '#F1F6F0',
  bordure: '#DCE3D8',
  texte: '#18211C',
  texteSecondaire: '#5C6B61',
  accent: '#1E6B4B',
  accentPlein: '#2E7D5B',
  accentFond: 'rgba(46, 125, 91, 0.12)',
  hausse: '#1E6B4B',
  baisse: '#B8432F',
  hausseFond: 'rgba(30, 107, 75, 0.12)',
  baisseFond: 'rgba(184, 67, 47, 0.12)',
  danger: '#B8432F',
  surAccent: '#FFFFFF',
  reference: '#E3824A',
  series: ['#2E7D5B', '#E3824A', '#4C6FD8', '#B85C9E', '#D4A72C', '#3FA7A0', '#8C6BD8', '#8A968E'],
  sombre: false,
  navigation: '#EEF2EC',
  teintesCartes: ['#DCEBDF', '#FBE6D6', '#E2E8FA'],
  policeTitre: 'DM Serif Display',
  policeTexte: 'Manrope',
};

const NUIT_VIVE: Palette = {
  fond: '#0B0F17',
  surface: '#121826',
  surfaceHaute: '#1A2233',
  bordure: '#1E2636',
  texte: '#E8ECF3',
  texteSecondaire: '#8A94A7',
  accent: '#7EA6FF',
  accentPlein: '#3D6BE0',
  accentFond: 'rgba(91, 140, 255, 0.16)',
  hausse: '#3FD49B',
  baisse: '#F0616D',
  hausseFond: 'rgba(63, 212, 155, 0.14)',
  baisseFond: 'rgba(240, 97, 109, 0.14)',
  danger: '#F0616D',
  surAccent: '#FFFFFF',
  reference: '#FFC857',
  series: ['#5B8CFF', '#FF8A4C', '#3FD49B', '#FFC857', '#C77DFF', '#2DD4BF', '#F472B6', '#8A94A7'],
  sombre: true,
  navigation: '#0E131E',
  policeTitre: 'Fraunces',
  policeTexte: 'Manrope',
};

export type CleTheme = 'classique' | 'ivoire' | 'nuit-editoriale' | 'sauge' | 'nuit-vive';

export const THEMES: Readonly<Record<CleTheme, { nom: string; description: string; palette: Palette }>> = {
  classique: { nom: 'Classique', description: 'Le sombre d’origine, noir et bleu.', palette: PALETTE_SOMBRE },
  ivoire: { nom: 'Ivoire couleur', description: 'Clair et éditorial, quatre couleurs vives.', palette: IVOIRE },
  'nuit-editoriale': { nom: 'Nuit éditoriale', description: 'Sombre et chaud, corail, menthe et or.', palette: NUIT_EDITORIALE },
  sauge: { nom: 'Sauge', description: 'Doux et moderne, cartes pastel.', palette: SAUGE },
  'nuit-vive': { nom: 'Nuit vive', description: 'Bleu nuit, couleurs vives.', palette: NUIT_VIVE },
};

export const CLES_THEMES = Object.keys(THEMES) as CleTheme[];

const MEMOIRE_THEME = 'applibourse.theme';

function themeMemorise(): CleTheme {
  try {
    const lu = (globalThis as { localStorage?: { getItem(cle: string): string | null } }).localStorage?.getItem(
      MEMOIRE_THEME,
    );
    return lu && lu in THEMES ? (lu as CleTheme) : 'classique';
  } catch {
    return 'classique';
  }
}

let themeActif: CleTheme = themeMemorise();

/**
 * Change de thème. Sur le bureau, pose aussi les polices (variables CSS lues
 * par index.html) et retient le choix pour l'écran de déverrouillage.
 */
export function definirTheme(cle: CleTheme | string | undefined): void {
  const retenu: CleTheme = cle && cle in THEMES ? (cle as CleTheme) : 'classique';
  themeActif = retenu;
  const palette = THEMES[retenu].palette;
  const doc = (globalThis as {
    document?: {
      documentElement: { style: { setProperty(n: string, v: string): void; removeProperty(n: string): void } };
      body?: { style: { backgroundColor: string; colorScheme: string } };
    };
  }).document;
  if (doc) {
    if (doc.body) {
      doc.body.style.backgroundColor = palette.fond;
      doc.body.style.colorScheme = palette.sombre ? 'dark' : 'light';
    }
    // Barre de titre de Windows assortie au thème, quand le pont le permet.
    (globalThis as { applibourse?: { systeme?: { theme?(sombre: boolean): unknown } } }).applibourse?.systeme?.theme?.(
      palette.sombre !== false,
    );
    const style = doc.documentElement.style;
    const poser = (nom: string, police?: string) =>
      police ? style.setProperty(nom, `"${police}", system-ui, sans-serif`) : style.removeProperty(nom);
    poser('--police-texte', palette.policeTexte);
    poser('--police-titre', palette.policeTitre);
  }
  try {
    (globalThis as { localStorage?: { setItem(cle: string, valeur: string): void } }).localStorage?.setItem(
      MEMOIRE_THEME,
      retenu,
    );
  } catch {
    // Stockage indisponible : le thème reviendra au déverrouillage.
  }
}

export function themeCourant(): CleTheme {
  return themeActif;
}

/**
 * Palette du thème actif. Le paramètre est conservé pour les appelants
 * existants, mais ignoré : c'est le thème choisi qui décide.
 */
export function palettePour(_sombre?: boolean): Palette {
  return THEMES[themeActif].palette;
}

/**
 * À poser sur un texte de titre ou un grand chiffre : sur le bureau, il
 * prend la police de titre du thème (serif pour les thèmes éditoriaux).
 */
export const POLICE_TITRE = { dataSet: { police: 'titre' } } as unknown as Record<string, never>;

/** Couleur d'une variation, choisie à partir de sa tendance. */
export function couleurTendance(
  palette: Palette,
  tendance: 'hausse' | 'baisse' | 'neutre',
): string {
  if (tendance === 'hausse') return palette.hausse;
  if (tendance === 'baisse') return palette.baisse;
  return palette.texteSecondaire;
}

export const stylesPartages = StyleSheet.create({
  ecran: {
    flex: 1,
  },
  contenu: {
    padding: ESPACEMENT.m,
    gap: ESPACEMENT.m,
  },
  /** Écrans d'accueil (déverrouillage, premier lancement) : étroits et centrés. */
  accueil: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  /** Colonne d'un formulaire : lisible sur grand écran, pleine largeur sur téléphone. */
  formulaire: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
