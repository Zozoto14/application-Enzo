/**
 * Visuels CM : types miroirs du serveur (esport/noyau/cm/visuels/document.mjs) — document par format,
 * calques, charte graphique, données des champs dynamiques. Voir docs/esport/visuels.md.
 */

export type Langue = 'fr' | 'en';
export type CleFormat = 'carre' | 'portrait' | 'story' | 'paysage';
export type TypeVisuel = 'annonce' | 'jour_match' | 'lineup' | 'resultat' | 'classement' | 'mvp' | 'recrue' | 'depart' | 'programme' | 'banniere' | 'libre';
export type CleCouleur = 'fond' | 'fond2' | 'primaire' | 'secondaire' | 'accent' | 'texte' | 'attenue' | 'victoire' | 'defaite';
export type RolePolice = 'titre' | 'sousTitre' | 'texte' | 'chiffres';
export type Police = 'Orbitron' | 'Chakra Petch' | 'Share Tech Mono' | 'Manrope';
/** « #rrggbb », « #rrggbbaa » ou « charte:<cle> ». */
export type Couleur = string;
/** Police embarquée ou « charte:<rôle> ». */
export type RefPolice = Police | `charte:${RolePolice}`;

export const FORMATS: Readonly<Record<CleFormat, { largeur: number; hauteur: number; ratio: string }>> = {
  carre: { largeur: 1080, hauteur: 1080, ratio: '1:1' },
  portrait: { largeur: 1080, hauteur: 1350, ratio: '4:5' },
  story: { largeur: 1080, hauteur: 1920, ratio: '9:16' },
  paysage: { largeur: 1920, hauteur: 1080, ratio: '16:9' },
};
export const CLES_FORMATS: readonly CleFormat[] = ['carre', 'portrait', 'story', 'paysage'];
export const TYPES_VISUEL: readonly TypeVisuel[] = ['annonce', 'jour_match', 'lineup', 'resultat', 'classement', 'mvp', 'recrue', 'depart', 'programme', 'banniere', 'libre'];
export const POLICES: readonly Police[] = ['Orbitron', 'Chakra Petch', 'Share Tech Mono', 'Manrope'];
export const ROLES_POLICES: readonly RolePolice[] = ['titre', 'sousTitre', 'texte', 'chiffres'];
export const CLES_COULEURS: readonly CleCouleur[] = ['fond', 'fond2', 'primaire', 'secondaire', 'accent', 'texte', 'attenue', 'victoire', 'defaite'];
export const GRAISSES = [300, 400, 500, 600, 700, 800, 900] as const;
export type Graisse = (typeof GRAISSES)[number];

export type Remplissage = { type: 'uni'; couleur: Couleur } | { type: 'degrade'; couleurs: Couleur[]; angle: number; radial: boolean };
export interface Bilingue {
  fr: string;
  en: string;
}
export interface Ombre {
  couleur: Couleur;
  flou: number;
  dx: number;
  dy: number;
  opacite: number;
}
export interface Contour {
  couleur: Couleur;
  epaisseur: number;
}
export interface Lueur {
  couleur: Couleur;
  force: number;
}

interface CalqueCommun {
  id: string;
  nom: string;
  x: number;
  y: number;
  l: number;
  h: number;
  rotation: number;
  opacite: number;
  verrouille: boolean;
  masque: boolean;
  /** Condition d'affichage : « serie », « classement », « champ:<nom> » (non vide), précédée de « ! » pour l'inverse. */
  si: string | null;
  ombre: Ombre | null;
  contour: Contour | null;
  lueur: Lueur | null;
}
export type Alignement = 'gauche' | 'centre' | 'droite';
export interface CalqueTexte extends CalqueCommun {
  type: 'texte';
  texte: Bilingue;
  police: RefPolice;
  taille: number;
  graisse: Graisse;
  italique: boolean;
  couleur: Remplissage;
  align: Alignement;
  valign: 'haut' | 'milieu' | 'bas';
  interligne: number;
  espacement: number;
  majuscules: boolean;
  ajuster: boolean;
  glitch: boolean;
}
export type ChampImage = 'logo_club' | 'logo_team' | 'logo_adversaire' | 'map_1' | 'map_2' | 'map_3' | 'map_4' | 'map_5' | 'agent_mvp';
export const CHAMPS_IMAGE: readonly ChampImage[] = ['logo_club', 'logo_team', 'logo_adversaire', 'map_1', 'map_2', 'map_3', 'map_4', 'map_5', 'agent_mvp'];
export type SourceImage = { fichier: string } | { champ: ChampImage } | { asset: string };
export interface CalqueImage extends CalqueCommun {
  type: 'image';
  source: SourceImage;
  ajustement: 'couvrir' | 'contenir';
  rayon: number;
  filtre: 'normal' | 'gris' | 'duotone';
}
export type Forme = 'rect' | 'ellipse' | 'ligne' | 'losange' | 'hexagone' | 'chanfrein';
export const FORMES: readonly Forme[] = ['rect', 'ellipse', 'ligne', 'losange', 'hexagone', 'chanfrein'];
export interface CalqueForme extends CalqueCommun {
  type: 'forme';
  forme: Forme;
  remplissage: Remplissage | null;
  rayon: number;
  coupe: number;
}
export interface CalqueLogo extends CalqueCommun {
  type: 'logo';
  cible: 'club' | 'team' | 'adversaire';
}
export type SourceListe = 'manches' | 'classement' | 'roster' | 'programme' | 'parcours';
export const SOURCES_LISTE: readonly SourceListe[] = ['manches', 'classement', 'roster', 'programme', 'parcours'];
export interface CalqueListe extends CalqueCommun {
  type: 'liste';
  source: SourceListe;
  ligne: Bilingue;
  police: RefPolice;
  taille: number;
  graisse: Graisse;
  couleur: Remplissage;
  align: Alignement;
  /** Hauteur d'une ligne (px). */
  pas: number;
  max: number;
  majuscules: boolean;
  /** Couleur du bandeau derrière notre ligne (classement) ou une manche gagnée. */
  surligne: Couleur | null;
}
export type Calque = CalqueTexte | CalqueImage | CalqueForme | CalqueLogo | CalqueListe;
export type TypeCalque = Calque['type'];

export interface Effets {
  scanlines: number;
  grain: number;
  vignette: number;
}

export interface DocumentVisuel {
  v: 1;
  format: CleFormat;
  fond: Remplissage | null;
  /** null : les effets de la charte. */
  effets: Effets | null;
  calques: Calque[];
}

export interface Charte {
  nom: string;
  club: string;
  couleurs: Record<CleCouleur, string>;
  polices: Record<RolePolice, Police>;
  effets: { neon: number; glitch: boolean; scanlines: number; grain: number };
  logos: { club: string | null; teams: Record<string, string> };
}

/** Une ligne d'une liste (manche, équipe du classement, joueur, match du programme, tour du parcours). */
export type LigneListe = Record<string, string | boolean>;
export interface DonneesLangue {
  champs: Record<string, string>;
  listes: Partial<Record<SourceListe, LigneListe[]>>;
}
export interface DonneesVisuel {
  publiable?: boolean;
  systeme: 'serie' | 'classement' | null;
  jeu: { cle: string; base: string | null } | null;
  team: { id: string; nom: string } | null;
  fr: DonneesLangue;
  en: DonneesLangue;
  images: Partial<Record<ChampImage, SourceImage>>;
  empreinte: string;
}

export type GenreSource = 'resultat' | 'annonce' | 'tournoi' | 'membre' | 'equipe' | 'semaine' | 'libre';
export interface SourceVisuel {
  genre: GenreSource;
  teamId: string | null;
  id: string | null;
  date: string | null;
}
