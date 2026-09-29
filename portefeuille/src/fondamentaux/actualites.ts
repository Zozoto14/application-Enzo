/**
 * Actualités d'une valeur ou d'un sujet, depuis la recherche Yahoo Finance.
 *
 * Les titres arrivent tels que les éditeurs les publient : en français pour
 * beaucoup de valeurs parisiennes, en anglais pour les autres. On les garde
 * dans leur langue et on le signale, pour qu'ils soient lus avec la bonne voix.
 */

export interface Actualite {
  titre: string;
  source: string;
  /** Date ISO de publication. */
  date: string;
  lien?: string;
  langue: 'fr' | 'en';
  /** L'essentiel de l'article, tiré de sa page quand on a pu la lire. */
  resume?: string;
}

type Recuperer = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const URL_RECHERCHE = 'https://query1.finance.yahoo.com/v1/finance/search';

const MOTS_ANGLAIS = /\b(the|and|of|to|in|for|on|with|is|are|as|stock|shares|says|after|its|from|at|by|how|why|what|will)\b/gi;

/** Anglais ou français, à la louche : assez pour choisir une voix. */
export function langueProbable(texte: string): 'fr' | 'en' {
  if (/[éèêàùçôî]/i.test(texte)) {
    return 'fr';
  }
  const anglais = (texte.match(MOTS_ANGLAIS) ?? []).length;
  const mots = texte.split(/\s+/).length;
  return anglais >= 2 || anglais / Math.max(1, mots) > 0.15 ? 'en' : 'fr';
}

export function lireActualites(json: unknown): Actualite[] {
  const brutes = (json as { news?: unknown })?.news;
  if (!Array.isArray(brutes)) {
    return [];
  }
  const actualites: Actualite[] = [];
  for (const brute of brutes) {
    const ligne = (brute && typeof brute === 'object' ? brute : {}) as Record<string, unknown>;
    const titre = typeof ligne.title === 'string' ? ligne.title.trim() : '';
    if (!titre) {
      continue;
    }
    const secondes = typeof ligne.providerPublishTime === 'number' ? ligne.providerPublishTime : undefined;
    actualites.push({
      titre,
      source: typeof ligne.publisher === 'string' ? ligne.publisher : '',
      date: secondes ? new Date(secondes * 1000).toISOString().slice(0, 10) : '',
      lien: typeof ligne.link === 'string' ? ligne.link : undefined,
      langue: langueProbable(titre),
    });
  }
  return actualites;
}

export async function chargerActualites(
  requete: string,
  nombre = 5,
  recuperer: Recuperer = fetch as unknown as Recuperer,
): Promise<Actualite[]> {
  const url = `${URL_RECHERCHE}?q=${encodeURIComponent(requete)}&quotesCount=0&newsCount=${nombre}`;
  const reponse = await recuperer(url);
  if (!reponse.ok) {
    throw new Error(`Yahoo Finance a répondu ${reponse.status}.`);
  }
  return lireActualites(await reponse.json());
}
