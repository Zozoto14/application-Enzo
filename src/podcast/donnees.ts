/**
 * Rassemble ce que l'épisode raconte : chiffres du portefeuille, fiches et
 * actualités des valeurs détenues, séance des indices.
 *
 * La partie calcul est pure ; seule `preparerEpisode` touche au réseau, et
 * chaque requête qui échoue est simplement ignorée : un épisode sans les
 * actualités d'une valeur vaut mieux que pas d'épisode.
 */

import type { EtatPortefeuille } from '../core/portfolio/engine';
import type { Titre } from '../core/domain/types';
import type { Decimal } from '../core/money/decimal';
import type { CoursDate } from '../core/performance/serie';
import { totaux, valoriserPositions } from '../core/portfolio/valorisation';
import { INDICES } from '../cours/indices';
import type { Actualite } from '../fondamentaux/actualites';
import {
  chargerMedias,
  concerne,
  lireRechercheActualites,
  urlActualitesValeur,
  type ArticleMedia,
} from './medias';
import type { DonneesValeur } from '../fondamentaux/yahoo';
import { extraireResume, pageAutorisee } from './extraits';
import { EXPLICATIONS } from '../ui/vues/explications';
import {
  construireEpisode,
  sujetDuJour,
  type EntreesEpisode,
  type Episode,
  type LigneEpisode,
  type ValeurEpisode,
} from './episode';

const RECOMMANDATIONS: Record<string, string> = {
  strong_buy: 'Achat fort',
  buy: 'Achat',
  hold: 'Conserver',
  sell: 'Vente',
  underperform: 'Vente',
  strong_sell: 'Vente forte',
};

/** Nombre de valeurs racontées : les plus grosses lignes. */
export const VALEURS_RACONTEES = 5;

export interface EntreesPortefeuille {
  etat: EtatPortefeuille;
  titres: readonly Titre[];
  cours: ReadonlyMap<string, Decimal>;
  historique: ReadonlyMap<string, readonly CoursDate[]>;
  indices: ReadonlyMap<string, readonly CoursDate[]>;
  aujourdhui: string;
}

function variationSeance(serie: readonly CoursDate[] | undefined): number | null {
  if (!serie || serie.length < 2) {
    return null;
  }
  const veille = serie[serie.length - 2].cloture.toNumber();
  const dernier = serie[serie.length - 1].cloture.toNumber();
  return veille > 0 ? (dernier / veille - 1) * 100 : null;
}

/** Variation sur cinq séances : la dernière clôture face à celle d'il y a une semaine. */
export function variationSemaine(serie: readonly CoursDate[] | undefined): number | null {
  if (!serie || serie.length < 6) {
    return null;
  }
  const avant = serie[serie.length - 6].cloture.toNumber();
  const dernier = serie[serie.length - 1].cloture.toNumber();
  return avant > 0 ? (dernier / avant - 1) * 100 : null;
}

/** Positions triées de la plus grosse à la plus petite, avec leur symbole. */
export function lignesDuPortefeuille(
  entrees: EntreesPortefeuille,
): Array<LigneEpisode & { titreId: string; symbole?: string; valeur: number }> {
  const titres = new Map(entrees.titres.map(titre => [titre.id, titre]));
  const { valorisees } = valoriserPositions(entrees.etat.positions, entrees.cours);
  const total = valorisees.reduce((somme, position) => somme + position.valeurMarche.toNumber(), 0);
  return valorisees
    .map(position => {
      const titre = titres.get(position.titreId);
      const valeur = position.valeurMarche.toNumber();
      return {
        titreId: position.titreId,
        symbole: titre?.ticker?.trim() || undefined,
        nom: titre?.nom ?? position.titreId,
        valeur,
        variationJour: variationSeance(entrees.historique.get(position.titreId)),
        latentPct: position.plusValueLatentePct?.toNumber() ?? null,
        poids: total > 0 ? (valeur / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.valeur - a.valeur);
}

/** Tout sauf les données réseau : fiches et actualités sont passées à part. */
export function entreesEpisode(
  entrees: EntreesPortefeuille,
  fiches: ReadonlyMap<string, DonneesValeur>,
  actualites: ReadonlyMap<string, readonly Actualite[]>,
  actualitesMarche: readonly Actualite[],
  presse: readonly ArticleMedia[] = [],
  cibleMinutes = 10,
  articlesParValeur: ReadonlyMap<string, readonly ArticleMedia[]> = new Map(),
): EntreesEpisode {
  const lignes = lignesDuPortefeuille(entrees);
  const { valorisees } = valoriserPositions(entrees.etat.positions, entrees.cours);
  const somme = totaux(valorisees, entrees.etat.comptes.values());

  // Séance : ce que chaque ligne a gagné ou perdu depuis la veille.
  let montantSeance = 0;
  let connue = false;
  for (const ligne of lignes) {
    if (ligne.variationJour !== null) {
      connue = true;
      montantSeance += ligne.valeur - ligne.valeur / (1 + ligne.variationJour / 100);
    }
  }
  const baseSeance = somme.valeurTotale.toNumber() - montantSeance;

  const valeurs: ValeurEpisode[] = lignes.slice(0, VALEURS_RACONTEES).map(ligne => {
    const donnees = ligne.symbole ? fiches.get(ligne.symbole) : undefined;
    const fiche = donnees?.fiche;
    const recommandation = fiche?.analystes.recommandation;
    return {
      nom: ligne.nom,
      actualites: (ligne.symbole ? actualites.get(ligne.symbole) : undefined) ?? [],
      consensus: recommandation ? RECOMMANDATIONS[recommandation] : undefined,
      objectifMoyen: fiche?.analystes.objectifMoyen,
      cours: fiche?.cours,
      devise: fiche?.devise,
      prochainsResultats: fiche?.resultats.prochaineDate,
      detachement: fiche?.dividende.dateDetachement,
      paiement: fiche?.dividende.datePaiement,
      // D'abord les articles résumés des grands médias, puis ceux de la
      // recherche par valeur, sans doublon de titre.
      articles: dedoublonner([
        ...presse.filter(article => concerne(article, fiche?.nom ?? ligne.nom) || concerne(article, ligne.nom)),
        ...(articlesParValeur.get(ligne.nom) ?? []),
      ]),
      per: fiche?.valorisation.per,
      rendementDividende:
        fiche?.dividende.rendement !== null && fiche?.dividende.rendement !== undefined
          ? fiche.dividende.rendement * 100
          : null,
      plusHaut52: fiche?.marche.plusHaut52,
      plusBas52: fiche?.marche.plusBas52,
    };
  });

  // Semaine : même calcul que la séance, sur cinq séances.
  let montantSemaine = 0;
  let semaineConnue = false;
  const lignesSemaine: Array<{ nom: string; pourcentage: number }> = [];
  for (const ligne of lignes) {
    const pct = variationSemaine(entrees.historique.get(ligne.titreId));
    if (pct !== null) {
      semaineConnue = true;
      montantSemaine += ligne.valeur - ligne.valeur / (1 + pct / 100);
      lignesSemaine.push({ nom: ligne.nom, pourcentage: pct });
    }
  }
  const baseSemaine = somme.valeurTotale.toNumber() - montantSemaine;

  return {
    semaine:
      semaineConnue && baseSemaine > 0
        ? {
            montant: montantSemaine,
            pourcentage: (montantSemaine / baseSemaine) * 100,
            lignes: lignesSemaine,
            indices: INDICES.map(indice => ({ nom: indice.court, pourcentage: variationSemaine(entrees.indices.get(indice.id)) }))
              .filter((indice): indice is { nom: string; pourcentage: number } => indice.pourcentage !== null),
          }
        : undefined,
    aujourdhui: entrees.aujourdhui,
    valeurTotale: somme.valeurTotale.toNumber(),
    totalReturn: somme.plusValueLatente.toNumber(),
    totalReturnPct: somme.plusValueLatentePct?.toNumber() ?? null,
    seance:
      connue && baseSeance > 0
        ? { montant: montantSeance, pourcentage: (montantSeance / baseSeance) * 100 }
        : undefined,
    lignes,
    valeurs,
    indices: INDICES.filter(indice => entrees.indices.get(indice.id)?.length).map(indice => ({
      nom: indice.court,
      seancePct: variationSeance(entrees.indices.get(indice.id)),
    })),
    actualitesMarche,
    sujet: sujetDuJour(Object.values(EXPLICATIONS), entrees.aujourdhui),
    presse,
    cibleMinutes,
  };
}

function dedoublonner(articles: readonly ArticleMedia[]): ArticleMedia[] {
  const vus = new Set<string>();
  return articles.filter(article => {
    const cle = article.titre.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ').trim();
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

export interface Chargeurs {
  valeur(symbole: string): Promise<DonneesValeur>;
  actualites(requete: string): Promise<Actualite[]>;
  /** Texte d'un flux RSS ; absent hors de l'application de bureau. */
  flux?(url: string): Promise<string>;
  /** HTML d'une page d'article d'un média connu ; absent hors du bureau. */
  page?(url: string): Promise<string>;
}

/** Articles lus en entier au plus, pour garder une préparation rapide. */
export const PAGES_LUES = 14;

/**
 * Donne un résumé aux articles qui n'ont qu'un titre, en lisant leur page
 * chez les médias connus. Les éléments sont traités dans l'ordre donné :
 * le plus important d'abord. Une page qui ne répond pas est ignorée.
 */
export async function enrichirResumes<T extends { lien?: string; resume?: string }>(
  elements: readonly T[],
  page: (url: string) => Promise<string>,
  maximum = PAGES_LUES,
  parallele = 4,
): Promise<T[]> {
  const resultat = elements.map(element => ({ ...element }));
  const aLire = resultat.filter(element => !element.resume && pageAutorisee(element.lien)).slice(0, maximum);
  let suivant = 0;
  const ouvrier = async () => {
    while (suivant < aLire.length) {
      const element = aLire[suivant++];
      try {
        const resume = extraireResume(await page(element.lien!));
        if (resume) element.resume = resume;
      } catch {
        // Page payante, lente ou absente : l'article garde son seul titre.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallele, aLire.length) }, ouvrier));
  return resultat;
}

/**
 * Prépare l'épisode du jour. Les fiches déjà chargées (ouvertes dans
 * l'application) sont reprises telles quelles.
 */
export async function preparerEpisode(
  entrees: EntreesPortefeuille,
  chargeurs: Chargeurs,
  cache: Map<string, DonneesValeur>,
  surEtape?: (texte: string) => void,
  cibleMinutes = 10,
): Promise<{ episode: Episode; manques: number }> {
  const symboles = lignesDuPortefeuille(entrees)
    .slice(0, VALEURS_RACONTEES)
    .map(ligne => ligne.symbole)
    .filter((symbole): symbole is string => Boolean(symbole));

  let manques = 0;
  const actualites = new Map<string, Actualite[]>();
  surEtape?.('Lecture des actualités de vos valeurs…');
  await Promise.all(
    symboles.map(async symbole => {
      const [fiche, nouvelles] = await Promise.allSettled([
        cache.has(symbole) ? Promise.resolve(cache.get(symbole)!) : chargeurs.valeur(symbole),
        chargeurs.actualites(symbole),
      ]);
      if (fiche.status === 'fulfilled') {
        cache.set(symbole, fiche.value);
      } else {
        manques += 1;
      }
      if (nouvelles.status === 'fulfilled') {
        actualites.set(symbole, nouvelles.value);
      } else {
        manques += 1;
      }
    }),
  );

  surEtape?.('Revue de presse…');
  const presse = chargeurs.flux ? await chargerMedias(chargeurs.flux) : { articles: [], echecs: 0 };
  manques += presse.echecs;

  // Actualités de chacune de vos plus grosses lignes, tous médias confondus.
  const articlesParValeur = new Map<string, ArticleMedia[]>();
  if (chargeurs.flux) {
    surEtape?.('Actualités de vos valeurs dans la presse…');
    const flux = chargeurs.flux;
    await Promise.all(
      lignesDuPortefeuille(entrees)
        .slice(0, VALEURS_RACONTEES)
        .map(async ligne => {
          const url = urlActualitesValeur(ligne.nom);
          if (!url) return;
          try {
            articlesParValeur.set(ligne.nom, lireRechercheActualites(await flux(url)).slice(0, 8));
          } catch {
            manques += 1;
          }
        }),
    );
  }

  surEtape?.('Tour des marchés…');
  const marche = await chargeurs.actualites('bourse marchés actions').catch(() => {
    manques += 1;
    return [] as Actualite[];
  });

  // Les titres seuls ne disent pas grand-chose : on lit l'essentiel des
  // articles, vos valeurs d'abord, puis les marchés et la presse.
  let marcheLu = marche;
  let presseLue = presse.articles;
  if (chargeurs.page) {
    surEtape?.('Lecture des articles…');
    const page = chargeurs.page;
    for (const [symbole, liste] of actualites) {
      actualites.set(symbole, await enrichirResumes(liste, page, 3));
    }
    marcheLu = await enrichirResumes(marche, page, 3);
    presseLue = await enrichirResumes(presse.articles, page, 6);
  }

  surEtape?.('Écriture de l’épisode…');
  return {
    episode: construireEpisode(
      entreesEpisode(entrees, cache, actualites, marcheLu, presseLue, cibleMinutes, articlesParValeur),
    ),
    manques,
  };
}
