/**
 * Thèmes du hub, repris de la maquette (hub-mockup.html) : huit ambiances,
 * « Nuit » par défaut.
 *
 * Ils ne s'appliquent qu'au hub et aux apps qui n'ont pas d'identité propre
 * (l'Administration). Le portefeuille garde ses thèmes à lui (Paramètres ›
 * Apparence) : le hub reste cohérent, le portefeuille reste reconnaissable.
 */

import { Platform } from 'react-native';

export type IdThemeHub =
  | 'nuit'
  | 'ivoire'
  | 'ivoire-couleur'
  | 'nuit-editoriale'
  | 'sauge'
  | 'nuit-vive'
  | 'blocs'
  | 'terminal';

/** Emplacements de couleur que les apps du registre se partagent. */
export type TeinteApp = 'anime' | 'portefeuille' | 'admin' | 'quatre';

export interface ThemeHub {
  id: IdThemeHub;
  nom: string;
  sombre: boolean;
  fond: string;
  surface: string;
  texte: string;
  attenue: string;
  ligne: string;
  /** Accent de la marque, des boutons pleins. */
  accent: string;
  /** Texte posé sur un accent. */
  surAccent: string;
  teintes: Record<TeinteApp, string>;
  /** Fond propre à la tuile d'une app (Sauge) ; à défaut, `surface`. */
  fondsTuiles?: Partial<Record<TeinteApp | 'nouveau', string>>;
  /** Le haut des tuiles est rempli de la couleur de l'app (Blocs de couleur). */
  blocs?: boolean;
  ok: string;
  critique: string;
  alerte: string;
  rayonMoyen: number;
  rayonGrand: number;
  /** Titres en capitales (Terminal). */
  majuscules?: boolean;
  poidsTitre: '400' | '500' | '600' | '800';
  /** Familles de polices, pour le web (ailleurs, la police du système). */
  policeTitre?: string;
  policeTexte?: string;
  policeChiffres?: string;
}

const MANROPE = 'Manrope, system-ui, sans-serif';
const FRAUNCES = 'Fraunces, Georgia, serif';
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const CLAIR = { ok: '#1B7A4A', critique: '#B3261E', alerte: '#8A5A00' };
const SOMBRE = { ok: '#5FD394', critique: '#FF8A80', alerte: '#E8B654' };

const NUIT: ThemeHub = {
  id: 'nuit',
  nom: 'Nuit',
  sombre: true,
  fond: '#0B0F17',
  surface: '#121826',
  texte: '#E8ECF3',
  attenue: '#8A94A7',
  ligne: '#1B2332',
  accent: '#5B8CFF',
  surAccent: '#0B0F17',
  teintes: { anime: '#5B8CFF', portefeuille: '#3FD49B', admin: '#B78CFF', quatre: '#F0A04B' },
  ...SOMBRE,
  rayonMoyen: 12,
  rayonGrand: 20,
  poidsTitre: '600',
  policeTitre: '"Sora", Manrope, system-ui, sans-serif',
  policeTexte: MANROPE,
  policeChiffres: MONO,
};

const IVOIRE: ThemeHub = {
  id: 'ivoire',
  nom: 'Ivoire',
  sombre: false,
  fond: '#F6F3EC',
  surface: '#FFFFFF',
  texte: '#1C1B18',
  attenue: '#6B665C',
  ligne: '#E4DED2',
  accent: '#C2562F',
  surAccent: '#FFFFFF',
  teintes: { anime: '#C2562F', portefeuille: '#2E5E4E', admin: '#3A5BA0', quatre: '#8A5A9E' },
  ...CLAIR,
  rayonMoyen: 10,
  rayonGrand: 16,
  poidsTitre: '500',
  policeTitre: FRAUNCES,
  policeTexte: MANROPE,
  policeChiffres: MONO,
};

export const THEMES_HUB: readonly ThemeHub[] = [
  NUIT,
  IVOIRE,
  {
    ...IVOIRE,
    id: 'ivoire-couleur',
    nom: 'Ivoire couleur',
    teintes: { anime: '#C2562F', portefeuille: '#1F7A6D', admin: '#3A5BA0', quatre: '#D69A2D' },
    rayonMoyen: 18,
    rayonGrand: 18,
  },
  {
    id: 'nuit-editoriale',
    nom: 'Nuit éditoriale',
    sombre: true,
    fond: '#16140F',
    surface: '#1F1C16',
    texte: '#F3EEE3',
    attenue: '#A89F8E',
    ligne: '#2B2720',
    accent: '#E07A4F',
    surAccent: '#16140F',
    teintes: { anime: '#E07A4F', portefeuille: '#5CC3A8', admin: '#7FA7F2', quatre: '#E8B84A' },
    ...SOMBRE,
    rayonMoyen: 10,
    rayonGrand: 18,
    poidsTitre: '500',
    policeTitre: FRAUNCES,
    policeTexte: MANROPE,
    policeChiffres: MONO,
  },
  {
    id: 'sauge',
    nom: 'Sauge',
    sombre: false,
    fond: '#EEF2EC',
    surface: '#F8FAF6',
    texte: '#18211C',
    attenue: '#5C6B61',
    ligne: '#D5DDD2',
    accent: '#2E7D5B',
    surAccent: '#FFFFFF',
    teintes: { anime: '#2E7D5B', portefeuille: '#E3824A', admin: '#4C6FD8', quatre: '#B85C9E' },
    fondsTuiles: { anime: '#DCEBDF', portefeuille: '#FBE6D6', admin: '#E2E8FA', nouveau: '#FFFFFF' },
    ...CLAIR,
    rayonMoyen: 22,
    rayonGrand: 28,
    poidsTitre: '400',
    policeTitre: '"DM Serif Display", Georgia, serif',
    policeTexte: MANROPE,
    policeChiffres: MONO,
  },
  {
    ...NUIT,
    id: 'nuit-vive',
    nom: 'Nuit vive',
    attenue: '#A7B0C0',
    teintes: { anime: '#FF8A4C', portefeuille: '#3FD49B', admin: '#5B8CFF', quatre: '#FFC857' },
    poidsTitre: '800',
    policeTitre: FRAUNCES,
  },
  {
    id: 'blocs',
    nom: 'Blocs de couleur',
    sombre: false,
    fond: '#FBFAF7',
    surface: '#FFFFFF',
    texte: '#17171A',
    attenue: '#6B665C',
    ligne: '#ECE8DF',
    accent: '#B94E2B',
    surAccent: '#FFFFFF',
    teintes: { anime: '#B94E2B', portefeuille: '#1E5E4A', admin: '#22346B', quatre: '#B94E2B' },
    blocs: true,
    ...CLAIR,
    rayonMoyen: 10,
    rayonGrand: 18,
    poidsTitre: '600',
    policeTitre: FRAUNCES,
    policeTexte: MANROPE,
    policeChiffres: MONO,
  },
  {
    id: 'terminal',
    nom: 'Terminal',
    sombre: true,
    fond: '#0A0A0A',
    surface: '#111111',
    texte: '#EDEDED',
    attenue: '#8C8C8C',
    ligne: '#262626',
    accent: '#FFB020',
    surAccent: '#0A0A0A',
    teintes: { anime: '#FFB020', portefeuille: '#3DDC84', admin: '#4FA3FF', quatre: '#FF7A45' },
    ...SOMBRE,
    rayonMoyen: 0,
    rayonGrand: 0,
    majuscules: true,
    poidsTitre: '600',
    policeTitre: '"IBM Plex Sans", system-ui, sans-serif',
    policeTexte: '"IBM Plex Sans", system-ui, sans-serif',
    policeChiffres: MONO,
  },
];

export const THEME_HUB_DEFAUT: IdThemeHub = 'nuit';

/** Thème enregistré, ou « Nuit » s'il est absent ou inconnu. */
export function themeHub(id: string | undefined): ThemeHub {
  return THEMES_HUB.find(theme => theme.id === id) ?? THEMES_HUB[0];
}

/** Police pour le web uniquement : ailleurs, une famille inconnue casserait le rendu. */
export function police(famille: string | undefined): { fontFamily?: string } {
  return Platform.OS === 'web' && famille ? { fontFamily: famille } : {};
}

/** Couleur avec transparence, depuis un « #RRGGBB ». */
export function teinteTransparente(hexa: string, opacite: number): string {
  const valeur = Number.parseInt(hexa.slice(1), 16);
  // eslint-disable-next-line no-bitwise -- extraction des composantes RVB.
  return `rgba(${(valeur >> 16) & 255}, ${(valeur >> 8) & 255}, ${valeur & 255}, ${opacite})`;
}
