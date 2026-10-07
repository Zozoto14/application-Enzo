/**
 * Personnalisation du hub : ordre, taille, masquage, épinglage, densité et
 * disposition des tuiles. Données pures, testées à part.
 *
 * Deux garde-fous :
 *  - les préférences ne sont **jamais** une autorisation. On les applique à la
 *    liste des apps que le profil peut déjà ouvrir (`appsVisibles`) : un
 *    identifiant qu'elles mentionnent et que le profil ne peut pas ouvrir est
 *    simplement ignoré ;
 *  - tout ce qui vient du stockage est revalidé : un contenu corrompu ou
 *    retouché retombe sur les valeurs par défaut, champ par champ.
 */

export type TailleTuile = 'petite' | 'moyenne' | 'grande';
export type Densite = 'aere' | 'compact';
export type Disposition = 'grille' | 'liste';

export const TAILLES: readonly TailleTuile[] = ['petite', 'moyenne', 'grande'];
export const LIBELLES_TAILLE: Record<TailleTuile, string> = { petite: 'Petite', moyenne: 'Moyenne', grande: 'Grande' };
export const TAILLE_PAR_DEFAUT: TailleTuile = 'moyenne';

export interface PrefsHub {
  version: 1;
  /** Ordre voulu, tous identifiants confondus (les inconnus sont conservés). */
  ordre: string[];
  tailles: Record<string, TailleTuile>;
  masquees: string[];
  /** Apps épinglées : toujours avant les autres. */
  epinglees: string[];
  densite: Densite;
  disposition: Disposition;
}

export const PREFS_PAR_DEFAUT: PrefsHub = {
  version: 1,
  ordre: [],
  tailles: {},
  masquees: [],
  epinglees: [],
  densite: 'aere',
  disposition: 'grille',
};

/** Une tuile prête à afficher, avec son état de personnalisation. */
export interface TuilePrefs<T extends { id: string }> {
  app: T;
  taille: TailleTuile;
  masquee: boolean;
  epinglee: boolean;
}

const MOTIF_ID = /^[a-z0-9-]{2,32}$/;

/** Anciens identifiants d'apps (avant le renommage « Portfolio » -> « Portefeuille »). */
export const IDS_HERITES: Readonly<Record<string, string>> = { portfolio: 'portefeuille' };

/** Traduit un ancien identifiant vers l'actuel ; les autres sont inchangés. */
export function migrerId(id: string): string {
  return IDS_HERITES[id] ?? id;
}

function listeIds(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) {
    return [];
  }
  return [
    ...new Set(
      valeur.filter((id): id is string => typeof id === 'string' && MOTIF_ID.test(id)).map(migrerId),
    ),
  ];
}

/** Lit des préférences enregistrées ; tout ce qui est invalide est écarté. */
export function lirePrefs(brut: string | undefined | null): PrefsHub {
  if (!brut) {
    return { ...PREFS_PAR_DEFAUT, ordre: [], tailles: {}, masquees: [], epinglees: [] };
  }
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return lirePrefs(undefined);
  }
  if (!lu || typeof lu !== 'object' || Array.isArray(lu)) {
    return lirePrefs(undefined);
  }
  const objet = lu as Record<string, unknown>;
  const tailles: Record<string, TailleTuile> = {};
  if (objet.tailles && typeof objet.tailles === 'object' && !Array.isArray(objet.tailles)) {
    for (const [id, taille] of Object.entries(objet.tailles as Record<string, unknown>)) {
      if (MOTIF_ID.test(id) && (TAILLES as readonly unknown[]).includes(taille)) {
        tailles[migrerId(id)] = taille as TailleTuile;
      }
    }
  }
  return {
    version: 1,
    ordre: listeIds(objet.ordre),
    tailles,
    masquees: listeIds(objet.masquees),
    epinglees: listeIds(objet.epinglees),
    densite: objet.densite === 'compact' ? 'compact' : 'aere',
    disposition: objet.disposition === 'liste' ? 'liste' : 'grille',
  };
}

export function ecrirePrefs(prefs: PrefsHub): string {
  return JSON.stringify(prefs);
}

export function sontParDefaut(prefs: PrefsHub): boolean {
  return ecrirePrefs(lirePrefs(ecrirePrefs(prefs))) === ecrirePrefs(lirePrefs(undefined));
}

/**
 * Applique les préférences aux apps déjà autorisées. Ordre : épinglées
 * d'abord, puis le reste ; dans chaque groupe, l'ordre choisi, et les apps
 * qu'il ne mentionne pas (nouvelles apps) à la suite, dans l'ordre du registre.
 */
export function appliquerPrefs<T extends { id: string }>(apps: readonly T[], prefs: PrefsHub): Array<TuilePrefs<T>> {
  const rang = (id: string) => {
    const index = prefs.ordre.indexOf(id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const numerotees = apps.map((app, position) => ({ app, position }));
  numerotees.sort((a, b) => {
    const epinglees = Number(prefs.epinglees.includes(b.app.id)) - Number(prefs.epinglees.includes(a.app.id));
    if (epinglees !== 0) {
      return epinglees;
    }
    return rang(a.app.id) - rang(b.app.id) || a.position - b.position;
  });
  return numerotees.map(({ app }) => ({
    app,
    taille: prefs.tailles[app.id] ?? TAILLE_PAR_DEFAUT,
    masquee: prefs.masquees.includes(app.id),
    epinglee: prefs.epinglees.includes(app.id),
  }));
}

/** Fixe l'ordre affiché, en gardant les identifiants qui n'y figurent pas. */
function avecOrdre(prefs: PrefsHub, affiches: readonly string[]): PrefsHub {
  const autres = prefs.ordre.filter(id => !affiches.includes(id));
  return { ...prefs, ordre: [...affiches, ...autres] };
}

/**
 * Déplace une app de `delta` places dans la liste affichée, sans quitter son
 * groupe (épinglées / autres) : une flèche ne change pas l'épinglage.
 */
export function deplacer(prefs: PrefsHub, affiches: readonly string[], id: string, delta: number): PrefsHub {
  const index = affiches.indexOf(id);
  if (index === -1) {
    return prefs;
  }
  const epinglee = prefs.epinglees.includes(id);
  const cible = index + delta;
  if (cible < 0 || cible >= affiches.length || prefs.epinglees.includes(affiches[cible]) !== epinglee) {
    return prefs;
  }
  const liste = [...affiches];
  liste.splice(index, 1);
  liste.splice(cible, 0, id);
  return avecOrdre(prefs, liste);
}

/** Glisser-déposer : `id` prend la place de `cibleId` (même groupe seulement). */
export function deplacerVers(prefs: PrefsHub, affiches: readonly string[], id: string, cibleId: string): PrefsHub {
  const depuis = affiches.indexOf(id);
  const vers = affiches.indexOf(cibleId);
  if (depuis === -1 || vers === -1 || depuis === vers) {
    return prefs;
  }
  if (prefs.epinglees.includes(id) !== prefs.epinglees.includes(cibleId)) {
    return prefs;
  }
  const liste = [...affiches];
  liste.splice(depuis, 1);
  liste.splice(vers, 0, id);
  return avecOrdre(prefs, liste);
}

export function definirTaille(prefs: PrefsHub, id: string, taille: TailleTuile): PrefsHub {
  return { ...prefs, tailles: { ...prefs.tailles, [id]: taille } };
}

export function basculerMasquee(prefs: PrefsHub, id: string, masquee: boolean): PrefsHub {
  const sans = prefs.masquees.filter(autre => autre !== id);
  return { ...prefs, masquees: masquee ? [...sans, id] : sans };
}

/** Épingler place aussi l'app en tête de son groupe : « en premier ». */
export function basculerEpinglee(prefs: PrefsHub, affiches: readonly string[], id: string, epinglee: boolean): PrefsHub {
  const sans = prefs.epinglees.filter(autre => autre !== id);
  const suivant = { ...prefs, epinglees: epinglee ? [id, ...sans] : sans };
  // Les épinglées se rangent par ordre d'épinglage, la dernière en premier.
  return epinglee ? avecOrdre(suivant, [id, ...affiches.filter(autre => autre !== id)]) : suivant;
}

export function definirDensite(prefs: PrefsHub, densite: Densite): PrefsHub {
  return { ...prefs, densite };
}

export function definirDisposition(prefs: PrefsHub, disposition: Disposition): PrefsHub {
  return { ...prefs, disposition };
}

export function reinitialiser(): PrefsHub {
  return lirePrefs(undefined);
}

/**
 * Colonnes occupées par une tuile : petite et moyenne tiennent sur une
 * colonne (la petite est plus basse), la grande en occupe deux quand la
 * grille en a au moins deux.
 */
export function empan(taille: TailleTuile, colonnes: number): number {
  return Math.max(1, Math.min(taille === 'grande' ? 2 : 1, colonnes));
}

/** Stockage minimal (clé/valeur) : celui des paramètres du profil, ou un faux pour les tests. */
export interface StockagePrefs {
  lire(cle: string): string | undefined | null;
  ecrire(cle: string, valeur: string): void;
}

export const CLE_PREFS = 'hub.prefs';
export const CLE_THEME = 'hub.theme';

export function chargerPrefs(stockage: StockagePrefs): PrefsHub {
  try {
    return lirePrefs(stockage.lire(CLE_PREFS));
  } catch {
    // Stockage indisponible : le hub s'affiche avec ses valeurs par défaut.
    return lirePrefs(undefined);
  }
}

/** Rend faux plutôt que de lever : perdre une préférence ne doit rien casser. */
export function enregistrerPrefs(stockage: StockagePrefs, prefs: PrefsHub): boolean {
  try {
    stockage.ecrire(CLE_PREFS, ecrirePrefs(prefs));
    return true;
  } catch {
    return false;
  }
}
