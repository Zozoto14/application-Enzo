/**
 * Contrat du canevas de l'éditeur de strats (types seuls, sans DOM ni Konva) : partagé par le canevas web
 * (CanevasStrat.web.tsx) et par l'atelier (état et mise en page, testables sans canevas).
 */

import type { AgentAsset, CacheImages, CapaciteAsset, CarteAsset } from '../../../strats/assets';
import type { Action, DocumentStrat, FormeZone, UsageTrace, Vue } from '../../../strats/document';
import type { Marges } from '../../../strats/geometrie';
import type { GenreMarqueur } from '../../../strats/modeles';
import type { Attenuation, IdThemeCarte } from '../../../strats/plateau';

export type Outil = 'selection' | 'main' | 'agent' | 'capacite' | 'fleche' | 'ligne' | 'forme' | 'texte' | 'marqueur' | 'vision' | 'gomme';

/** Ce que l'on pose en le déposant depuis le dock (glisser un portrait ou une capacité sur la map). */
export type Depot =
  | { type: 'agent'; agent: AgentAsset; joueur: number | null; couleur: string }
  | { type: 'capacite'; agent: AgentAsset; capacite: CapaciteAsset; joueur: number | null; couleur: string };

export interface ExportCanevas {
  /** PNG de l'étape affichée (1000 × 1000 × `ratio`), en data URL. */
  png(ratio?: number): string;
  /** Miniature JPEG (320 px) pour la grille. */
  miniature(): string;
  /** Point de l'écran (coordonnées de la page) → point du document ; undefined hors du canevas. */
  versDocument(clientX: number, clientY: number): { x: number; y: number } | undefined;
  /** Pose un pion ou une capacité au point de l'écran donné (dépôt depuis le dock) ; faux hors du canevas. */
  deposer(clientX: number, clientY: number, quoi: Depot): boolean;
}

/** Menu contextuel demandé (clic droit, appui long) : position à l'écran, objets visés, point du document. */
export interface MenuCanevas {
  x: number;
  y: number;
  ids: string[];
  point?: { x: number; y: number };
}

export interface PropsCanevas {
  doc: DocumentStrat;
  /** Map du profil (image déposée ou minimap, échelle, callouts, repères). */
  carte?: CarteAsset;
  /** Image de fond (repli : celle du document). */
  fond: string | null;
  etape: number;
  /** Côté d'un canevas carré (comparaison, aperçus) ; sinon `largeur` et `hauteur`. */
  taille?: number;
  largeur?: number;
  hauteur?: number;
  /** Bords occupés par l'interface (barre d'outils, dock, tiroir) : la map est cadrée dans le reste. */
  marges?: Marges;
  outil: Outil;
  couleur: string;
  joueur: number | null;
  agent?: AgentAsset;
  capacite?: CapaciteAsset;
  /** Agents du jeu (portraits et icônes à jour, caractéristiques et accents des capacités posées). */
  agents?: AgentAsset[];
  /** Forme de la zone posée : « auto » = celle des caractéristiques de la capacité. */
  formeZone: FormeZone | 'aucune' | 'auto';
  formeDessin: 'rect' | 'ellipse';
  texte: string;
  tirets: boolean;
  epaisseur: number;
  /** Usage des flèches et lignes dessinées (style du trait). */
  usage?: UsageTrace;
  /** Flèche = trajet du joueur courant (minuté sur la durée de l'étape). */
  trajetJoueur?: boolean;
  marqueur?: { genre: GenreMarqueur; equipe: number | null; etiquette: string };
  vision?: { ouverture: number; portee: number };
  /** Étage courant (The Finals) : les objets posés le reçoivent, ceux des autres étages sont estompés. */
  niveau?: number | null;
  /** Aimantation sur une grille (unités ; 0 : aucune). */
  aimant?: number;
  rotation?: 0 | 180;
  /** Lecture animée : temps (s) dans l'étape ; absent : édition. */
  temps?: number;
  /** Lecture enchaînée : les pions glissent depuis leur position finale de l'étape précédente. */
  enchaine?: boolean;
  /** Prochain numéro d'ordre des utilitaires. */
  ordreSuivant?: number;
  selection?: readonly string[];
  onSelection(ids: string[]): void;
  onMenu?(m: MenuCanevas): void;
  /** Callout (zone nommée du profil) sous le pointeur. */
  onCallout?(nom: string | undefined): void;
  /** Cote du geste en cours (ligne d'état) : « 60 m · 45° (max 60 m) ». */
  onInfo?(texte: string | undefined): void;
  /** Un geste est en cours (glisser, poignée) : l'enregistrement automatique attend. */
  onOccupe?(occupe: boolean): void;
  vue: Vue;
  onVue(v: Vue): void;
  onAction(a: Action): void;
  images: CacheImages;
  onPret?(e: ExportCanevas): void;
  testID?: string;
  // ---- Affichage
  themeCarte?: IdThemeCarte;
  attenuation?: Attenuation;
  /** Nom du joueur sous son pion. */
  noms?: boolean;
  /** Fantôme de l'étape précédente (pions à leur dernière position, utilitaires). */
  fantome?: boolean;
  /** Joueur mis en avant (« mon rôle ») : le reste est estompé. */
  surligne?: number | null;
  /** Pointeur laser (présentation) : traînée pendant l'appui, ou au simple survol (touche tenue). */
  laser?: 'appui' | 'libre';
  /** Déplacement temporaire de la vue (Espace tenu). */
  panTemporaire?: boolean;
  /** Ni pose ni sélection (présentation, comparaison) : la vue reste manipulable. */
  lectureSeule?: boolean;
  /** Animations réduites (préférence du système). */
  mouvementReduit?: boolean;
}
