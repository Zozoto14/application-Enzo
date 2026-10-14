/**
 * Onglets d'apps du hub, en données pures (testées à part).
 *
 * Comme dans un navigateur : ouvrir une app depuis une tuile l'ajoute à la
 * barre d'onglets ; on passe d'une app à l'autre sans perdre son état ; on
 * ferme un onglet. Le hub lui-même n'est pas un onglet : `actif` vaut
 * `undefined` quand on est sur le hub.
 *
 * Côte à côte (écrans larges) : `cote` est l'onglet affiché à droite de
 * l'onglet actif, `ratio` la part de la largeur prise par le côté gauche.
 *
 * Les droits ne sont pas décidés ici : `filtrer` retire tout onglet que le
 * profil ne peut plus ouvrir (voir `permises` dans l'hôte).
 */

/** Nombre maximal d'onglets ouverts en même temps. */
export const MAX_ONGLETS = 8;
/** Bornes de la séparation côte à côte (part du côté gauche). */
export const RATIO_MIN = 0.25;
export const RATIO_MAX = 0.75;
export const RATIO_DEFAUT = 0.5;
/** Largeur minimale de la fenêtre pour afficher deux apps côte à côte. */
export const LARGEUR_COTE_A_COTE = 1280;
/** Largeur minimale d'un côté, en pixels. */
export const LARGEUR_MIN_COTE = 420;

/** Identifiant d'app acceptable dans un onglet (registre : minuscules, chiffres, tirets). */
const MOTIF_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface EtatOnglets {
  /** Onglets ouverts, dans l'ordre de la barre. */
  readonly ouverts: readonly string[];
  /** Onglet affiché ; `undefined` : le hub. */
  readonly actif?: string;
  /** Onglet affiché à droite de l'actif (côte à côte) ; jamais l'actif lui-même. */
  readonly cote?: string;
  /** Part de la largeur du côté gauche, entre `RATIO_MIN` et `RATIO_MAX`. */
  readonly ratio: number;
}

export const ONGLETS_VIDES: EtatOnglets = { ouverts: [], ratio: RATIO_DEFAUT };

export function idValide(id: unknown): id is string {
  return typeof id === 'string' && MOTIF_ID.test(id);
}

export function borneRatio(ratio: number, largeur?: number): number {
  let min = RATIO_MIN;
  let max = RATIO_MAX;
  if (largeur && largeur > 0) {
    const part = LARGEUR_MIN_COTE / largeur;
    min = Math.max(min, Math.min(part, 0.5));
    max = Math.min(max, Math.max(1 - part, 0.5));
  }
  if (!Number.isFinite(ratio)) return RATIO_DEFAUT;
  return Math.min(max, Math.max(min, ratio));
}

export interface ResultatOuverture {
  etat: EtatOnglets;
  /** Vrai quand la limite d'onglets empêche d'ouvrir l'app (rien n'a changé). */
  limite: boolean;
}

/**
 * Ouvre une app dans un onglet. Déjà ouverte : elle est seulement affichée
 * (ou rien ne change, en arrière-plan). `arrierePlan` : « ouvrir dans un
 * nouvel onglet » sans quitter l'onglet actuel.
 */
export function ouvrir(etat: EtatOnglets, id: string, options: { arrierePlan?: boolean } = {}): ResultatOuverture {
  if (!idValide(id)) {
    return { etat, limite: false };
  }
  if (etat.ouverts.includes(id)) {
    return { etat: options.arrierePlan ? etat : activer(etat, id), limite: false };
  }
  if (etat.ouverts.length >= MAX_ONGLETS) {
    return { etat, limite: true };
  }
  // Comme un navigateur : le nouvel onglet se place juste après l'onglet actif.
  const position = etat.actif ? etat.ouverts.indexOf(etat.actif) + 1 : etat.ouverts.length;
  const ouverts = [...etat.ouverts.slice(0, position), id, ...etat.ouverts.slice(position)];
  const suivant: EtatOnglets = { ...etat, ouverts };
  return { etat: options.arrierePlan ? suivant : activer(suivant, id), limite: false };
}

/**
 * Affiche un onglet (ou le hub, avec `undefined`). Côte à côte, choisir
 * l'onglet de droite échange les deux côtés ; revenir au hub quitte le côte à côte.
 */
export function activer(etat: EtatOnglets, id: string | undefined): EtatOnglets {
  if (id === undefined) {
    return etat.actif === undefined && etat.cote === undefined ? etat : { ouverts: etat.ouverts, ratio: etat.ratio };
  }
  if (!etat.ouverts.includes(id) || etat.actif === id) {
    return etat;
  }
  if (etat.cote === id) {
    return echanger(etat);
  }
  return { ...etat, actif: id };
}

/** Ferme un onglet. L'onglet voisin (à droite, sinon à gauche) prend sa place ; plus d'onglet : le hub. */
export function fermer(etat: EtatOnglets, id: string): EtatOnglets {
  const index = etat.ouverts.indexOf(id);
  if (index < 0) {
    return etat;
  }
  const ouverts = etat.ouverts.filter(o => o !== id);
  if (etat.cote === id) {
    return { ...etat, ouverts, cote: undefined };
  }
  if (etat.actif !== id) {
    return { ...etat, ouverts };
  }
  // L'onglet affiché ferme : côte à côte, l'autre côté prend toute la place.
  if (etat.cote !== undefined) {
    return { ouverts, actif: etat.cote, ratio: etat.ratio };
  }
  const voisin = ouverts[index] ?? ouverts[index - 1];
  return { ouverts, actif: voisin, ratio: etat.ratio };
}

/** Ctrl+Tab (sens 1) / Ctrl+Maj+Tab (sens -1) : onglet suivant ou précédent, en boucle. Depuis le hub : le premier ou le dernier. */
export function voisin(etat: EtatOnglets, sens: 1 | -1): EtatOnglets {
  const n = etat.ouverts.length;
  if (n === 0) {
    return etat;
  }
  const index = etat.actif === undefined ? -1 : etat.ouverts.indexOf(etat.actif);
  const suivant = index < 0 ? (sens === 1 ? 0 : n - 1) : (index + sens + n) % n;
  return activer(etat, etat.ouverts[suivant]);
}

/** Ctrl+1…8 : l'onglet de ce rang ; Ctrl+9 : le dernier (comme un navigateur). */
export function parRang(etat: EtatOnglets, rang: number): EtatOnglets {
  if (!Number.isInteger(rang) || rang < 1 || rang > 9 || etat.ouverts.length === 0) {
    return etat;
  }
  const id = rang === 9 ? etat.ouverts[etat.ouverts.length - 1] : etat.ouverts[rang - 1];
  return id === undefined ? etat : activer(etat, id);
}

/** « Afficher à côté » : l'onglet passe à droite de l'onglet actif. Sur le hub, il devient simplement l'onglet actif. */
export function afficherACote(etat: EtatOnglets, id: string): EtatOnglets {
  if (!etat.ouverts.includes(id)) {
    return etat;
  }
  if (etat.actif === undefined) {
    return activer(etat, id);
  }
  if (etat.actif === id) {
    return etat;
  }
  return { ...etat, cote: id };
}

/** Échange les deux côtés. */
export function echanger(etat: EtatOnglets): EtatOnglets {
  if (etat.actif === undefined || etat.cote === undefined) {
    return etat;
  }
  return { ...etat, actif: etat.cote, cote: etat.actif, ratio: 1 - etat.ratio };
}

/** Ferme un côté (l'onglet reste ouvert dans la barre) : l'autre prend toute la largeur. */
export function quitterCote(etat: EtatOnglets, cote: 'gauche' | 'droite'): EtatOnglets {
  if (etat.cote === undefined) {
    return etat;
  }
  return cote === 'droite' ? { ...etat, cote: undefined } : { ouverts: etat.ouverts, actif: etat.cote, ratio: etat.ratio };
}

export function redimensionner(etat: EtatOnglets, ratio: number, largeur?: number): EtatOnglets {
  const borne = borneRatio(ratio, largeur);
  return borne === etat.ratio ? etat : { ...etat, ratio: borne };
}

/** Déplace un onglet dans la barre (glisser, ou Alt + flèches). */
export function deplacer(etat: EtatOnglets, id: string, delta: number): EtatOnglets {
  const index = etat.ouverts.indexOf(id);
  const cible = index + delta;
  if (index < 0 || cible < 0 || cible >= etat.ouverts.length || delta === 0) {
    return etat;
  }
  const ouverts = [...etat.ouverts];
  ouverts.splice(index, 1);
  ouverts.splice(cible, 0, id);
  return { ...etat, ouverts };
}

/**
 * Retire les onglets que le profil ne peut pas (ou plus) ouvrir : droits par
 * rang, app désactivée ou en maintenance, app retirée du registre.
 */
export function filtrer(etat: EtatOnglets, permise: (id: string) => boolean): EtatOnglets {
  const ouverts = etat.ouverts.filter(id => idValide(id) && permise(id));
  if (ouverts.length === etat.ouverts.length && (etat.actif === undefined || ouverts.includes(etat.actif)) && (etat.cote === undefined || ouverts.includes(etat.cote))) {
    return etat;
  }
  let suivant: EtatOnglets = etat;
  for (const id of etat.ouverts) {
    if (!ouverts.includes(id)) {
      suivant = fermer(suivant, id);
    }
  }
  // Valeurs incohérentes (état restauré, retouché) : on repart proprement.
  const actif = suivant.actif !== undefined && ouverts.includes(suivant.actif) ? suivant.actif : undefined;
  const cote = actif !== undefined && suivant.cote !== undefined && suivant.cote !== actif && ouverts.includes(suivant.cote) ? suivant.cote : undefined;
  return { ouverts, actif, cote, ratio: borneRatio(suivant.ratio) };
}

/** Ce qui est réellement affiché : sans côte à côte (écran étroit, téléphone), seul l'onglet actif. */
export function affichage(etat: EtatOnglets, coteACotePossible: boolean): { gauche?: string; droite?: string; ratio: number } {
  if (etat.actif === undefined) {
    return { ratio: etat.ratio };
  }
  if (!coteACotePossible || etat.cote === undefined || etat.cote === etat.actif) {
    return { gauche: etat.actif, ratio: 1 };
  }
  return { gauche: etat.actif, droite: etat.cote, ratio: etat.ratio };
}

// ------------------------------------------------------------ mémoire de l'appareil

/** Version du format enregistré. */
const VERSION = 1;

/**
 * Ce qui est gardé sur l'appareil (jamais synchronisé) : la liste des onglets
 * et la séparation. Au redémarrage on revient sur le hub, les onglets prêts
 * dans la barre : rien ne s'ouvre tout seul avant que l'on choisisse.
 */
export function serialiser(etat: EtatOnglets): string {
  return JSON.stringify({ v: VERSION, ouverts: etat.ouverts, ratio: Math.round(etat.ratio * 1000) / 1000 });
}

export function restaurer(texte: string | null | undefined, permise: (id: string) => boolean = () => true): EtatOnglets {
  if (!texte) {
    return ONGLETS_VIDES;
  }
  try {
    const brut = JSON.parse(texte) as { v?: unknown; ouverts?: unknown; ratio?: unknown };
    if (!brut || brut.v !== VERSION || !Array.isArray(brut.ouverts)) {
      return ONGLETS_VIDES;
    }
    const vus = new Set<string>();
    const ouverts: string[] = [];
    for (const id of brut.ouverts) {
      if (idValide(id) && !vus.has(id) && permise(id) && ouverts.length < MAX_ONGLETS) {
        vus.add(id);
        ouverts.push(id);
      }
    }
    return { ouverts, ratio: borneRatio(typeof brut.ratio === 'number' ? brut.ratio : RATIO_DEFAUT) };
  } catch {
    return ONGLETS_VIDES;
  }
}

/** Clé de l'appareil (`localStorage`) des onglets ; `cleLocale` la rend propre à chaque compte. */
export const CLE_ONGLETS = 'applibourse.onglets';
