/**
 * Types du glisser-déposer du Drive et des dossiers de visuels (glisser.web.ts sur le site et l'app PC ;
 * glisser.ts ailleurs, sans glisser : menu « Déplacer vers… » et appui long pour sélectionner).
 */

export interface SurvolGlisser {
  /** Cible sous le pointeur (« racine » ou identifiant d'un dossier). */
  cible: string;
  /** Raison du refus (texte affiché), ou null si l'on peut lâcher ici. */
  refus: string | null;
  libelle: string;
}

export interface OptionsGlisser {
  actif: boolean;
  couleurs: { fond: string; texte: string; accent: string; critique: string };
  /** Éléments emportés quand on saisit `cle` (la sélection entière si `cle` en fait partie). */
  sources(cle: string): string[];
  /** Texte du fantôme (« 3 éléments », ou le nom de l'élément). */
  texteSources(sources: string[]): string;
  /** Peut-on lâcher ici ? `refus` : raison claire ; `note` : précision (dossier restreint…). */
  verifier(sources: string[], cible: string): { refus: string | null; libelle: string; note?: string };
  lacher(sources: string[], cible: string): void;
  /** Lâché sur une cible interdite : la raison est rappelée (message d'erreur). */
  refuse?(raison: string): void;
  /** Cadre de sélection tracé dans la zone : éléments touchés (`ajout` : Ctrl / Maj, la sélection s'étend). */
  cadre?(cles: string[], ajout: boolean): void;
  /** Clic dans le vide de la zone, sans modificateur. */
  videClique?(): void;
}

export interface Glisser {
  /** Ref du conteneur (racine de l'écran). */
  ref(n: unknown): void;
  /** Props (`dataSet`) d'une vue : élément saisissable, cible où lâcher, zone du cadre de sélection. */
  marque(m: { source?: string; cible?: string; zone?: boolean }): object;
  survol: SurvolGlisser | null;
  /** Éléments en cours de glisser (atténués). */
  glisses: string[];
  /** Modificateurs du dernier appui : Ctrl / Cmd (`ajout`), Maj (`plage`). */
  modificateurs(): { ajout: boolean; plage: boolean };
  /** Vrai juste après un glisser ou un cadre : le clic qui suit n'ouvre rien. */
  vientDeGlisser(): boolean;
  /** Glisser-déposer disponible (site et PC). */
  disponible: boolean;
}
