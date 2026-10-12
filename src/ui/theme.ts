/**
 * Jetons de style.
 *
 * Regroupés ici pour que les couleurs et les espacements ne soient pas
 * réinventés écran par écran.
 *
 * Un seul thème pour toute l'application (Paramètres › Général), celui du
 * hub. Le thème actif est un simple état de module, comme le mode discret :
 * `palettePour()` le lit à chaque rendu.
 *
 * Le vert et le rouge ne portent jamais seuls l'information : chaque montant
 * signé affiche aussi son signe. Environ un homme sur douze distingue mal ces
 * deux couleurs.
 */

import { StyleSheet } from 'react-native';
import { cleLocale, profilCourant } from '../profils/espace';
import { themeHub, teinteTransparente, type IdThemeHub, type ThemeHub } from '../hub/themes';
import { CLE_CACHE_FOND, CLE_CACHE_THEME, lireThemeMemorise, stockageLocalAppareil, themeUnique } from '../hub/themeUnique';

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

/**
 * Il n'y a qu'un thème pour toute l'application : celui du hub (huit au
 * choix, Paramètres › Général). La palette du portefeuille en est déduite :
 * mêmes fonds, mêmes textes, et l'identité du portefeuille passe par la
 * couleur d'accent `teintes.portefeuille` du thème (première série des
 * graphiques), pas par un thème distinct.
 */

/** Mélange deux « #RRGGBB » ; `ratio` = part de `b`. */
function melanger(a: string, b: string, ratio: number): string {
  const lire = (hexa: string) => [1, 3, 5].map(i => Number.parseInt(hexa.slice(i, i + 2), 16));
  const [ra, ga, ba] = lire(a);
  const [rb, gb, bb] = lire(b);
  const composante = (x: number, y: number) => Math.round(x + (y - x) * ratio).toString(16).padStart(2, '0');
  return `#${composante(ra, rb)}${composante(ga, gb)}${composante(ba, bb)}`;
}

/** Premier nom de famille d'une liste CSS (« "Sora", Manrope, sans-serif » → Sora). */
function premiereFamille(liste: string | undefined): string | undefined {
  return liste?.split(',')[0]?.trim().replace(/^["']|["']$/g, '') || undefined;
}

const SERIES_COMPLEMENT = ['#f472b6', '#2dd4bf', '#a78bfa', '#9ca3af'] as const;

/** Palette du portefeuille déduite d'un thème du hub. */
export function paletteDepuisTheme(theme: ThemeHub): Palette {
  const serie = [theme.teintes.portefeuille, theme.accent, theme.teintes.admin, theme.teintes.quatre, ...SERIES_COMPLEMENT];
  const uniques = serie.filter((couleur, rang) => serie.findIndex(autre => autre.toLowerCase() === couleur.toLowerCase()) === rang);
  const tuiles = theme.fondsTuiles;
  return {
    fond: theme.fond,
    surface: theme.surface,
    surfaceHaute: melanger(theme.surface, theme.texte, 0.06),
    bordure: theme.ligne,
    texte: theme.texte,
    texteSecondaire: theme.attenue,
    accent: theme.accent,
    accentPlein: theme.accent,
    accentFond: teinteTransparente(theme.accent, 0.14),
    hausse: theme.ok,
    baisse: theme.critique,
    hausseFond: teinteTransparente(theme.ok, 0.14),
    baisseFond: teinteTransparente(theme.critique, 0.14),
    danger: theme.critique,
    surAccent: theme.surAccent,
    reference: theme.teintes.quatre,
    series: uniques,
    sombre: theme.sombre,
    navigation: melanger(theme.fond, theme.surface, 0.5),
    teintesCartes: tuiles?.portefeuille && tuiles.anime && tuiles.admin ? [tuiles.portefeuille, tuiles.anime, tuiles.admin] : undefined,
    policeTitre: premiereFamille(theme.policeTitre),
    policeTexte: premiereFamille(theme.policeTexte),
  };
}

const PALETTES = new Map<IdThemeHub, Palette>();

const stockageLocal = stockageLocalAppareil;

/** Dernier thème appliqué pour le profil ouvert, lu de façon synchrone (valable avant tout déverrouillage). */
export function themeMemorise(): IdThemeHub {
  return lireThemeMemorise(stockageLocal(), cleLocale(CLE_CACHE_THEME));
}

let themeActif: IdThemeHub | undefined;
let profilDuTheme: string | undefined;

/**
 * Thème actif. Au démarrage, et à chaque changement de compte, il est relu
 * du cache de l'appareil : l'écran de connexion est déjà au bon thème, avant
 * que le coffre ne soit ouvert. Après déverrouillage, l'application le
 * réconcilie avec la valeur du profil (`definirTheme`).
 */
export function themeCourant(): IdThemeHub {
  if (themeActif === undefined || profilDuTheme !== profilCourant()) {
    themeActif = themeMemorise();
    profilDuTheme = profilCourant();
  }
  return themeActif;
}

/** Oublie le thème en mémoire : le prochain appel relit le cache de l'appareil (démarrage à froid, tests). */
export function relireThemeMemorise(): void {
  themeActif = undefined;
  profilDuTheme = undefined;
}

/**
 * Change de thème. Retient le choix dans le cache de l'appareil (par profil ;
 * le thème n'est pas un secret) et, sur le bureau, pose aussi les polices
 * (variables CSS lues par index.html) et la barre de titre.
 */
export function definirTheme(id: IdThemeHub | string | undefined): void {
  const retenu = themeUnique(id, id);
  themeActif = retenu;
  profilDuTheme = profilCourant();
  const theme = themeHub(retenu);
  appliquerAuDocument(theme);
  try {
    const stockage = stockageLocal();
    stockage?.setItem(cleLocale(CLE_CACHE_THEME), retenu);
    stockage?.setItem(CLE_CACHE_FOND, theme.fond);
  } catch {
    // Stockage indisponible : le thème sera relu de la base au déverrouillage.
  }
}

/** Thème dont le document (web) porte déjà le fond, les polices et la couleur de barre. */
let themeDuDocument: IdThemeHub | undefined;

interface DocumentTheme {
  documentElement: { style: { setProperty(n: string, v: string): void; removeProperty(n: string): void } };
  body?: { style: { backgroundColor: string; colorScheme: string } };
  querySelectorAll?(selecteur: string): ArrayLike<{ setAttribute(n: string, v: string): void }>;
}

/**
 * Pose le thème sur le document (site et bureau) : fond, schéma de couleurs, polices (variables CSS
 * lues par index.html) et couleur de la barre du navigateur (`theme-color` : barre d'état de l'app
 * ajoutée à l'écran d'accueil, barre d'outils de Safari). Sans document (app native), ne fait rien.
 */
function appliquerAuDocument(theme: ThemeHub): void {
  themeDuDocument = theme.id;
  const doc = (globalThis as { document?: DocumentTheme }).document;
  if (!doc) {
    return;
  }
  if (doc.body) {
    doc.body.style.backgroundColor = theme.fond;
    doc.body.style.colorScheme = theme.sombre ? 'dark' : 'light';
  }
  for (const meta of Array.from(doc.querySelectorAll?.('meta[name="theme-color"]') ?? [])) {
    meta.setAttribute('content', theme.fond);
  }
  // Barre de titre de Windows assortie au thème, quand le pont le permet.
  (globalThis as { applibourse?: { systeme?: { theme?(sombre: boolean): unknown } } }).applibourse?.systeme?.theme?.(theme.sombre);
  const style = doc.documentElement.style;
  // La liste complète du thème : si sa première police n'est pas embarquée (« Sora »), le texte
  // retombe sur la suivante (Manrope), pas sur la police du système.
  const poser = (nom: string, police?: string) => (police ? style.setProperty(nom, police) : style.removeProperty(nom));
  poser('--police-texte', theme.policeTexte);
  poser('--police-titre', theme.policeTitre ?? theme.policeTexte);
}

/**
 * Garantit que le document porte le thème affiché. Tant que l'utilisateur garde le thème par
 * défaut, `definirTheme` n'est jamais appelé : sans ceci, ni les polices du thème ni la couleur de
 * barre ne seraient posées (tout le site en police du système). Ne refait rien si c'est déjà fait.
 */
export function assurerThemeDocument(id: IdThemeHub = themeCourant()): void {
  if (themeDuDocument !== id) {
    appliquerAuDocument(themeHub(id));
  }
}

/**
 * Palette du thème actif. Le paramètre est conservé pour les appelants
 * existants, mais ignoré : c'est le thème choisi qui décide.
 */
export function palettePour(_sombre?: boolean): Palette {
  const id = themeCourant();
  let palette = PALETTES.get(id);
  if (!palette) {
    palette = paletteDepuisTheme(themeHub(id));
    PALETTES.set(id, palette);
  }
  return palette;
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
