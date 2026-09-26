/**
 * Écriture d'un épisode du podcast quotidien.
 *
 * Un épisode est un texte fait pour être écouté : phrases courtes, nombres
 * arrondis, dates en toutes lettres. Il se découpe en chapitres, eux-mêmes
 * en segments ; chaque segment porte sa langue, pour qu'un titre d'actualité
 * anglais soit lu par une voix anglaise plutôt qu'écorché par une voix
 * française.
 *
 * Rien n'est inventé : chaque phrase vient d'un chiffre du portefeuille,
 * d'une donnée Yahoo Finance ou d'une explication de l'application. Quand
 * une donnée manque, la phrase qui en dépend saute, simplement.
 */

import type { Actualite } from '../fondamentaux/actualites';
import {
  autresSources,
  mediaReconnu,
  memeSource,
  memeSujet,
  statutSource,
  type ArticleMedia,
  type StatutSource,
} from './medias';
import { expositionDe, impactPourVous, type ExpositionPortefeuille } from './impacts';

export interface Segment {
  texte: string;
  langue: 'fr' | 'en';
}

export interface Chapitre {
  titre: string;
  segments: Segment[];
}

export interface Episode {
  titre: string;
  date: string;
  chapitres: Chapitre[];
  /** Durée approximative d'écoute, en minutes. */
  duree: number;
  /** Articles racontés, pour les retrouver après l'écoute. */
  sources: Array<{
    titre: string;
    source: string;
    lien?: string;
    /** Recoupée par un autre média, signée par un média reconnu, ou non vérifiée. */
    statut: StatutSource;
    /** Médias qui rapportent la même information. */
    confirmations: string[];
  }>;
}

export interface LigneEpisode {
  nom: string;
  /** Variation de la dernière séance, en pourcentage. */
  variationJour: number | null;
  /** Plus-value latente, en pourcentage. */
  latentPct: number | null;
  /** Poids dans le portefeuille, en pourcentage. */
  poids: number;
}

export interface ValeurEpisode {
  nom: string;
  actualites: readonly Actualite[];
  consensus?: string;
  objectifMoyen?: number | null;
  cours?: number | null;
  devise?: string;
  prochainsResultats?: string;
  detachement?: string;
  paiement?: string;
  /** Articles de la revue de presse qui citent la valeur. */
  articles?: readonly ArticleMedia[];
  per?: number | null;
  /** Rendement du dividende, en pourcentage. */
  rendementDividende?: number | null;
  plusHaut52?: number | null;
  plusBas52?: number | null;
}

export interface EntreesEpisode {
  aujourdhui: string;
  valeurTotale: number | null;
  totalReturn: number | null;
  totalReturnPct: number | null;
  seance?: { montant: number; pourcentage: number };
  lignes: readonly LigneEpisode[];
  valeurs: readonly ValeurEpisode[];
  indices: ReadonlyArray<{ nom: string; seancePct: number | null }>;
  actualitesMarche: readonly Actualite[];
  sujet?: { titre: string; court: string; detail: string; piege?: string };
  /** Revue de presse : articles des médias, du plus récent au plus ancien. */
  presse?: readonly ArticleMedia[];
  /** Durée visée, en minutes : 2 (flash), 5, 10 ou 15. Dix par défaut. */
  cibleMinutes?: number;
  /** Bilan des cinq dernières séances, raconté le vendredi. */
  semaine?: {
    montant: number;
    pourcentage: number;
    lignes: ReadonlyArray<{ nom: string; pourcentage: number }>;
    indices: ReadonlyArray<{ nom: string; pourcentage: number }>;
  };
}

/**
 * Les articles, une source après l'autre : la revue passe des Echos au
 * Monde puis au Figaro, au lieu d'enchaîner dix titres du même journal.
 */
function alterner(articles: readonly ArticleMedia[]): ArticleMedia[] {
  const parSource = new Map<string, ArticleMedia[]>();
  for (const article of articles) {
    parSource.set(article.source, [...(parSource.get(article.source) ?? []), article]);
  }
  const files = [...parSource.values()];
  const resultat: ArticleMedia[] = [];
  for (let rang = 0; resultat.length < articles.length; rang++) {
    for (const file of files) {
      if (rang < file.length) {
        resultat.push(file[rang]);
      }
    }
  }
  return resultat;
}

/** Débit d'une voix de synthèse posée, en mots par minute. */
export const MOTS_PAR_MINUTE = 150;

function compterMots(segments: readonly Segment[]): number {
  return segments.reduce((total, segment) => total + segment.texte.split(/\s+/).filter(Boolean).length, 0);
}

const nombreParle = (valeur: number, decimales = 1) =>
  valeur.toLocaleString('fr-FR', { maximumFractionDigits: decimales });

/** Une actualité Yahoo devient un article comme les autres. */
function versArticle(actualite: Actualite): ArticleMedia {
  return {
    titre: actualite.titre,
    resume: actualite.resume ?? '',
    source: actualite.source,
    date: actualite.date,
    lien: actualite.lien,
    langue: actualite.langue,
  };
}

/**
 * Regroupe les articles qui rapportent la même information : elle sera dite
 * une fois, avec les médias qui la confirment, au lieu d'être répétée.
 */
export function regrouper(articles: readonly ArticleMedia[]): ArticleMedia[][] {
  const groupes: ArticleMedia[][] = [];
  for (const article of articles) {
    const groupe = groupes.find(candidat => candidat.some(autre => memeSujet(autre, article)));
    if (groupe) groupe.push(article);
    else groupes.push([article]);
  }
  return groupes;
}

/** L'article qui raconte le mieux le groupe : un résumé, puis un média connu. */
function representant(groupe: readonly ArticleMedia[]): ArticleMedia {
  const note = (article: ArticleMedia) =>
    (article.resume ? 4 : 0) + (mediaReconnu(article.source) ? 2 : 0) + (article.langue === 'fr' ? 1 : 0);
  return [...groupe].sort((a, b) => note(b) - note(a))[0];
}

function listeParlee(noms: readonly string[]): string {
  if (noms.length <= 1) return noms[0] ?? '';
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}

/**
 * « Selon Le Figaro, » + « La BCE… » donne « Selon Le Figaro, la BCE… » ;
 * « rapporte que » + « Air Liquide… » donne « rapporte qu’Air Liquide… ».
 */
export function enchainer(introduction: string, titre: string): string {
  if (introduction.endsWith(':')) return `${introduction} ${titre}`;
  const suite = /^(Le|La|Les|L’|L'|Un|Une|Des|Du|Ce|Cet|Cette|Ces)\b/.test(titre)
    ? titre.charAt(0).toLowerCase() + titre.slice(1)
    : titre;
  if (/ que$/.test(introduction) && /^[AEIOUYÉÈÊÀÂÎÔaeiouyéèêàâîôh]/.test(suite) && !/^h/i.test(suite)) {
    return `${introduction.slice(0, -1)}’${suite}`;
  }
  return `${introduction} ${suite}`;
}

/**
 * Le fil du récit : fait varier les tournures d'un article à l'autre, pour
 * que l'oreille n'entende pas dix fois « Selon ».
 */
class Narrateur {
  private rang = 0;
  constructor(private readonly tous: readonly ArticleMedia[]) {}

  private tour<T>(variantes: readonly T[]): T {
    return variantes[this.rang % variantes.length];
  }

  introduction(source: string): string {
    if (!source) return this.tour(['À noter :', 'Autre information :', 'Dans l’actualité :']);
    return this.tour([
      `Selon ${source},`,
      `D’après ${source},`,
      `${source} rapporte que`,
      `On lit chez ${source} que`,
      `Chez ${source},`,
    ]);
  }

  /** Recoupée, reconnue ou non vérifiée : dit à chaque information. */
  verification(groupe: readonly ArticleMedia[], article: ArticleMedia): string {
    const confirmations = new Set<string>();
    for (const autre of groupe) {
      if (autre.source && !memeSource(autre.source, article.source)) confirmations.add(autre.source);
    }
    for (const source of autresSources(article, this.tous)) confirmations.add(source);
    const noms = [...confirmations].slice(0, 3);
    if (noms.length > 0) {
      const pluriel = noms.length > 1;
      return this.tour([
        `Information vérifiée : ${listeParlee(noms)} ${pluriel ? 'la confirment' : 'la confirme'}.`,
        `C’est recoupé, ${listeParlee(noms)} ${pluriel ? 'disent' : 'dit'} la même chose.`,
        `${listeParlee(noms)} ${pluriel ? 'rapportent' : 'rapporte'} aussi cette information : elle est recoupée.`,
      ]);
    }
    if (mediaReconnu(article.source)) {
      return this.tour([
        'Source reconnue, mais pas encore recoupée par un autre média.',
        `Une seule source pour l’instant, mais ${article.source} est un média reconnu.`,
        'Média fiable, information pas encore confirmée ailleurs.',
      ]);
    }
    return this.tour([
      `Prudence : ${article.source || 'cette source'} n’est pas un média que l’application connaît, l’information n’est pas vérifiée.`,
      'À prendre avec des pincettes : source non vérifiée, et personne d’autre ne le rapporte.',
    ]);
  }

  /**
   * Une information racontée : qui la rapporte, ce qu'elle dit — le résumé
   * de l'article quand on l'a —, si elle est vérifiée, et ce qu'elle change
   * pour vos lignes.
   */
  raconter(groupe: readonly ArticleMedia[], expose?: ExpositionPortefeuille): Segment[] {
    const article = representant(groupe);
    const segments: Segment[] = [];
    const introduction = this.introduction(article.source);
    if (article.langue === 'fr') {
      // En français, l'introduction et le titre forment une seule phrase.
      segments.push(fr(enchainer(introduction, titreFini(article.titre))));
    } else {
      segments.push(fr(`${introduction.replace(/(,| que)$/, '')} :`));
      segments.push({ texte: titreFini(article.titre), langue: 'en' });
    }
    if (article.resume && !article.resume.startsWith(article.titre.slice(0, 40))) {
      segments.push({ texte: titreFini(article.resume), langue: article.langue });
    }
    segments.push(fr(this.verification(groupe, article)));
    const impact = expose ? impactPourVous(article, expose) : undefined;
    if (impact) segments.push(fr(impact));
    this.rang += 1;
    return segments;
  }
}

// ------------------------------------------------------------- À l'oral

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** « 2026-09-25 » devient « vendredi 25 septembre ». */
export function dateParlee(iso: string, avecJour = true): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const jour = date.getUTCDate();
  const texte = `${jour === 1 ? '1er' : jour} ${MOIS[date.getUTCMonth()]}`;
  return avecJour ? `${JOURS[date.getUTCDay()]} ${texte}` : texte;
}

/** Montant arrondi à l'euro, sans séparateur que la voix lirait mal. */
export function eurosParles(valeur: number): string {
  const arrondi = Math.round(Math.abs(valeur));
  return `${arrondi} euro${arrondi > 1 ? 's' : ''}`;
}

/** « plus 1,2 pour cent », « moins 0,4 pour cent ». */
export function pourcentParle(valeur: number, signe = true): string {
  const texte = Math.abs(valeur).toLocaleString('fr-FR', { maximumFractionDigits: Math.abs(valeur) < 10 ? 1 : 0 });
  if (!signe) {
    return `${texte} pour cent`;
  }
  if (Math.abs(valeur) < 0.05) {
    return 'stable';
  }
  return `${valeur > 0 ? 'plus' : 'moins'} ${texte} pour cent`;
}

const fr = (texte: string): Segment => ({ texte, langue: 'fr' });

/** Un titre de presse, ponctué pour que la voix marque la pause. */
function titreFini(titre: string): string {
  const texte = titre.replace(/\s+/g, ' ').trim();
  return /[.!?…»"]$/.test(texte) ? texte : `${texte}.`;
}

function joursEntre(debut: string, fin: string): number {
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86_400_000);
}

/** Une actualité récente, de moins d'une semaine. */
function recente(actualite: Actualite, aujourdhui: string): boolean {
  return !actualite.date || joursEntre(actualite.date, aujourdhui) <= 7;
}

// ------------------------------------------------------------ Épisode

const RECOMMANDATIONS: Record<string, string> = {
  'Achat fort': 'recommandent franchement l’achat',
  Achat: 'penchent pour l’achat',
  Conserver: 'conseillent plutôt de conserver',
  Vente: 'penchent pour la vente',
  'Vente forte': 'recommandent franchement la vente',
};

function estVendredi(iso: string): boolean {
  return new Date(`${iso}T12:00:00Z`).getUTCDay() === 5;
}

/** Le bilan de la semaine : le portefeuille, ses extrêmes, les indices. */
function chapitreSemaine(semaine: NonNullable<EntreesEpisode['semaine']>): Chapitre {
  const segments: Segment[] = [
    fr(
      Math.abs(semaine.pourcentage) < 0.05
        ? 'Sur la semaine, votre portefeuille termine stable.'
        : `Sur la semaine, votre portefeuille a ${semaine.montant > 0 ? 'gagné' : 'perdu'} ${eurosParles(semaine.montant)}, soit ${pourcentParle(semaine.pourcentage)}.`,
    ),
  ];
  const triees = [...semaine.lignes].sort((a, b) => b.pourcentage - a.pourcentage);
  const meilleure = triees[0];
  const pire = triees[triees.length - 1];
  if (meilleure && meilleure.pourcentage >= 0.05) {
    segments.push(fr(`La meilleure de la semaine : ${meilleure.nom}, ${pourcentParle(meilleure.pourcentage)}.`));
  }
  if (pire && pire !== meilleure && pire.pourcentage <= -0.05) {
    segments.push(fr(`La plus en retrait : ${pire.nom}, ${pourcentParle(pire.pourcentage)}.`));
  }
  if (semaine.indices.length > 0) {
    segments.push(
      fr(`Côté indices, sur cinq séances : ${semaine.indices.slice(0, 3).map(indice => `${indice.nom} ${pourcentParle(indice.pourcentage)}`).join(', ')}.`),
    );
  }
  return { titre: 'La semaine en bref', segments };
}

/**
 * Le flash : deux minutes pour l'essentiel. Valeur et séance, les deux
 * lignes qui ont le plus bougé, les indices, et les deux informations les
 * plus reprises par la presse, avec leur vérification.
 */
function construireFlash(entrees: EntreesEpisode): Episode {
  const date = dateParlee(entrees.aujourdhui);
  const chapitres: Chapitre[] = [
    { titre: 'Ouverture', segments: [fr(`Bonjour, voici votre flash bourse du ${date}.`)] },
  ];

  const essentiel: Segment[] = [];
  if (entrees.valeurTotale !== null) {
    essentiel.push(
      fr(
        entrees.seance && Math.abs(entrees.seance.pourcentage) >= 0.05
          ? `Votre portefeuille vaut environ ${eurosParles(entrees.valeurTotale)}, ${pourcentParle(entrees.seance.pourcentage)} sur la dernière séance.`
          : `Votre portefeuille vaut environ ${eurosParles(entrees.valeurTotale)}.`,
      ),
    );
  }
  const mobiles = entrees.lignes.filter(ligne => ligne.variationJour !== null && Math.abs(ligne.variationJour) >= 0.05);
  const haut = [...mobiles].sort((a, b) => b.variationJour! - a.variationJour!)[0];
  const bas = [...mobiles].sort((a, b) => a.variationJour! - b.variationJour!)[0];
  if (haut && haut.variationJour! > 0) essentiel.push(fr(`En tête, ${haut.nom}, ${pourcentParle(haut.variationJour!)}.`));
  if (bas && bas !== haut && bas.variationJour! < 0) essentiel.push(fr(`En queue, ${bas.nom}, ${pourcentParle(bas.variationJour!)}.`));
  const indices = entrees.indices.filter(indice => indice.seancePct !== null).slice(0, 2);
  if (indices.length > 0) {
    essentiel.push(fr(`${indices.map(indice => `${indice.nom} ${pourcentParle(indice.seancePct!)}`).join(', ')}.`));
  }
  if (estVendredi(entrees.aujourdhui) && entrees.semaine) {
    essentiel.push(
      fr(`Sur la semaine, votre portefeuille fait ${pourcentParle(entrees.semaine.pourcentage)}.`),
    );
  }
  if (essentiel.length > 0) chapitres.push({ titre: 'L’essentiel', segments: essentiel });

  // Les deux informations les plus reprises, celles qui touchent vos lignes d'abord.
  const tous = [
    ...(entrees.presse ?? []),
    ...entrees.valeurs.flatMap(valeur => [...(valeur.articles ?? []), ...valeur.actualites.map(versArticle)]),
    ...entrees.actualitesMarche.map(versArticle),
  ].filter(article => recente(article, entrees.aujourdhui));
  const expose = expositionDe(entrees.lignes.map(ligne => ({ nom: ligne.nom, poids: ligne.poids })));
  const narrateur = new Narrateur(tous);
  const retenus = regrouper(tous)
    .map((groupe, rang) => ({
      groupe,
      rang,
      poids:
        (groupe.some(article => impactPourVous(article, expose)) ? 100 : 0) +
        new Set(groupe.map(article => article.source)).size * 10 +
        (representant(groupe).resume ? 5 : 0),
    }))
    .sort((a, b) => b.poids - a.poids || a.rang - b.rang)
    .slice(0, 2)
    .map(({ groupe }) => groupe);
  const aRetenir = retenus.flatMap(groupe => narrateur.raconter(groupe, expose));
  if (aRetenir.length > 0) chapitres.push({ titre: 'À retenir', segments: aRetenir });

  chapitres.push({
    titre: 'Clôture',
    segments: [fr('C’était votre flash. Pas un conseil : vos chiffres et l’actualité. Bonne journée.')],
  });

  const utilises = retenus.flat();
  const total = compterMots(chapitres.flatMap(chapitre => chapitre.segments));
  return {
    titre: `Votre flash bourse du ${dateParlee(entrees.aujourdhui, false)}`,
    date,
    chapitres,
    duree: Math.max(1, Math.round(total / MOTS_PAR_MINUTE)),
    sources: utilises.map(article => ({
      titre: article.titre,
      source: article.source,
      lien: article.lien,
      statut: statutSource(article, tous),
      confirmations: autresSources(article, tous),
    })),
  };
}

export function construireEpisode(entrees: EntreesEpisode): Episode {
  if ((entrees.cibleMinutes ?? 10) <= 2) {
    return construireFlash(entrees);
  }
  const chapitres: Chapitre[] = [];
  const date = dateParlee(entrees.aujourdhui);

  // --- Ouverture
  chapitres.push({
    titre: 'Ouverture',
    segments: [
      fr(`Bonjour, nous sommes ${date}. Voici votre point bourse, préparé à partir de votre portefeuille.`),
    ],
  });

  // --- Le portefeuille
  const portefeuille: Segment[] = [];
  if (entrees.valeurTotale !== null) {
    portefeuille.push(fr(`Votre portefeuille vaut environ ${eurosParles(entrees.valeurTotale)}.`));
  }
  if (entrees.seance) {
    const { montant, pourcentage } = entrees.seance;
    portefeuille.push(
      fr(
        Math.abs(pourcentage) < 0.05
          ? 'Sur la dernière séance, il est resté stable.'
          : `Sur la dernière séance, il a ${montant > 0 ? 'gagné' : 'perdu'} ${eurosParles(montant)}, soit ${pourcentParle(pourcentage)}.`,
      ),
    );
  }
  if (entrees.totalReturn !== null && entrees.totalReturnPct !== null) {
    portefeuille.push(
      fr(
        `Depuis vos premiers versements, votre gain total est de ${entrees.totalReturn >= 0 ? '' : 'moins '}${eurosParles(entrees.totalReturn)}, soit ${pourcentParle(entrees.totalReturnPct)}.`,
      ),
    );
  }
  if (portefeuille.length > 0) {
    chapitres.push({ titre: 'Votre portefeuille', segments: portefeuille });
  }

  // --- Les mouvements du jour
  const mobiles = entrees.lignes
    .filter(ligne => ligne.variationJour !== null)
    .sort((a, b) => Math.abs(b.variationJour!) - Math.abs(a.variationJour!));
  if (mobiles.length > 0) {
    const mouvements: Segment[] = [];
    const hausses = mobiles.filter(l => l.variationJour! >= 0.05).sort((a, b) => b.variationJour! - a.variationJour!);
    const baisses = mobiles.filter(l => l.variationJour! <= -0.05).sort((a, b) => a.variationJour! - b.variationJour!);
    if (hausses.length === 0 && baisses.length === 0) {
      mouvements.push(fr('Aucune de vos lignes n’a vraiment bougé sur la dernière séance.'));
    }
    if (hausses.length > 0) {
      const [premiere, ...autres] = hausses;
      mouvements.push(fr(`Côté hausse, ${premiere.nom} progresse de ${pourcentParle(premiere.variationJour!, false)}.`));
      if (autres.length > 0) {
        mouvements.push(fr(`Suivent ${autres.slice(0, 2).map(l => `${l.nom}, ${pourcentParle(l.variationJour!)}`).join(', et ')}.`));
      }
    }
    if (baisses.length > 0) {
      const [premiere, ...autres] = baisses;
      mouvements.push(fr(`Côté baisse, ${premiere.nom} recule de ${pourcentParle(premiere.variationJour!, false)}.`));
      if (autres.length > 0) {
        mouvements.push(fr(`Également en repli : ${autres.slice(0, 2).map(l => `${l.nom}, ${pourcentParle(l.variationJour!)}`).join(', et ')}.`));
      }
    }
    const lourde = [...entrees.lignes].sort((a, b) => b.poids - a.poids)[0];
    if (lourde && lourde.poids >= 40) {
      mouvements.push(
        fr(`Pour rappel, ${lourde.nom} pèse à elle seule ${pourcentParle(lourde.poids, false)} de vos titres : c’est elle qui donne le ton.`),
      );
    }
    chapitres.push({ titre: 'Les mouvements du jour', segments: mouvements });
  }

  // --- Le vendredi, le bilan de la semaine
  if (estVendredi(entrees.aujourdhui) && entrees.semaine) {
    chapitres.push(chapitreSemaine(entrees.semaine));
  }

  // --- Vos valeurs à la une
  const cible = entrees.cibleMinutes ?? 10;
  const une: Segment[] = [];
  const articlesUtilises = new Set<ArticleMedia>();
  const tousLesArticles = [
    ...(entrees.presse ?? []),
    ...entrees.valeurs.flatMap(valeur => [...(valeur.articles ?? []), ...valeur.actualites.map(versArticle)]),
    ...entrees.actualitesMarche.map(versArticle),
  ];
  const narrateur = new Narrateur(tousLesArticles);
  /** Déjà raconté ailleurs dans l'épisode, fût-ce par un autre média ? */
  const dejaDit = (article: ArticleMedia) =>
    [...articlesUtilises].some(utilise => utilise === article || memeSujet(utilise, article));
  for (const valeur of entrees.valeurs.slice(0, cible <= 5 ? 3 : 5)) {
    const phrases: Segment[] = [];
    const ligne = entrees.lignes.find(candidate => candidate.nom === valeur.nom);
    if (ligne) {
      phrases.push(
        fr(
          `Parlons de ${valeur.nom}, qui représente ${pourcentParle(ligne.poids, false)} de vos titres${
            ligne.latentPct !== null
              ? `, ${ligne.latentPct >= 0 ? 'en plus-value' : 'en moins-value'} de ${pourcentParle(Math.abs(ligne.latentPct), false)}`
              : ''
          }.`,
        ),
      );
    }
    // Presse et dépêches réunies, puis regroupées par information : une
    // nouvelle reprise par trois journaux est dite une fois, et c'est elle
    // qui passe en premier.
    const recents = [...(valeur.articles ?? []), ...valeur.actualites.map(versArticle)].filter(
      a => recente(a, entrees.aujourdhui) && !dejaDit(a),
    );
    const groupes = regrouper(recents).sort(
      (a, b) => Number(Boolean(representant(b).resume)) - Number(Boolean(representant(a).resume)) || b.length - a.length,
    );
    const racontes = groupes.slice(0, cible >= 15 ? 4 : cible >= 10 ? 3 : 1);
    if (racontes.length > 0 && !ligne) {
      phrases.push(fr(`Du côté de ${valeur.nom}.`));
    }
    for (const groupe of racontes) {
      groupe.forEach(article => articlesUtilises.add(article));
      phrases.push(...narrateur.raconter(groupe));
    }
    if (valeur.consensus && RECOMMANDATIONS[valeur.consensus]) {
      let phrase = `Les analystes ${RECOMMANDATIONS[valeur.consensus]}`;
      if (valeur.objectifMoyen && valeur.cours) {
        const potentiel = (valeur.objectifMoyen / valeur.cours - 1) * 100;
        phrase += `, avec un objectif moyen ${potentiel >= 0 ? 'supérieur' : 'inférieur'} de ${pourcentParle(Math.abs(potentiel), false)} au cours actuel`;
      }
      phrases.push(fr(racontes.length > 0 || ligne ? `${phrase}.` : `${valeur.nom} : ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}.`));
    }
    const valorisation: string[] = [];
    if (valeur.per && valeur.per > 0) {
      valorisation.push(`le titre se paie ${nombreParle(valeur.per, 0)} fois ses bénéfices`);
    }
    if (valeur.rendementDividende && valeur.rendementDividende > 0) {
      valorisation.push(`son dividende rapporte ${pourcentParle(valeur.rendementDividende, false)} par an`);
    }
    if (valorisation.length > 0) {
      phrases.push(fr(`Côté valorisation, ${valorisation.join(', et ')}.`));
    }
    if (valeur.cours && valeur.plusHaut52 && valeur.plusBas52 && valeur.plusHaut52 > valeur.plusBas52) {
      const ecartHaut = (1 - valeur.cours / valeur.plusHaut52) * 100;
      phrases.push(
        fr(
          ecartHaut < 2
            ? 'Le cours évolue tout près de son plus haut de l’année.'
            : `Le cours se situe ${pourcentParle(ecartHaut, false)} sous son plus haut sur un an, et ${pourcentParle((valeur.cours / valeur.plusBas52 - 1) * 100, false)} au-dessus de son plus bas.`,
        ),
      );
    }
    une.push(...phrases);
  }
  if (une.length > 0) {
    chapitres.push({ titre: 'Vos valeurs à la une', segments: une });
  }

  // --- L'agenda
  const agenda: Segment[] = [];
  const prochain = (iso: string | undefined) => {
    if (!iso) return undefined;
    const ecart = joursEntre(entrees.aujourdhui, iso);
    return ecart >= 0 && ecart <= 45 ? ecart : undefined;
  };
  for (const valeur of entrees.valeurs) {
    const resultats = prochain(valeur.prochainsResultats);
    if (resultats !== undefined) {
      agenda.push(
        fr(`${valeur.nom} publiera ses résultats ${resultats === 0 ? 'aujourd’hui' : resultats === 1 ? 'demain' : `le ${dateParlee(valeur.prochainsResultats!, false)}`}.`),
      );
    }
    const detachement = prochain(valeur.detachement);
    if (detachement !== undefined) {
      agenda.push(fr(`Le dividende de ${valeur.nom} se détache le ${dateParlee(valeur.detachement!, false)}.`));
    }
    const paiement = prochain(valeur.paiement);
    if (paiement !== undefined) {
      agenda.push(fr(`${valeur.nom} versera son dividende le ${dateParlee(valeur.paiement!, false)}.`));
    }
  }
  if (agenda.length > 0) {
    chapitres.push({ titre: 'L’agenda', segments: agenda });
  }

  // --- Les marchés
  const marches: Segment[] = [];
  const indices = entrees.indices.filter(indice => indice.seancePct !== null);
  if (indices.length > 0) {
    marches.push(
      fr(`Sur les marchés, ${indices.map(indice => `${indice.nom} ${Math.abs(indice.seancePct!) < 0.05 ? 'est stable' : `termine à ${pourcentParle(indice.seancePct!)}`}`).join(', et ')} sur la dernière séance.`),
    );
  }
  const generales = regrouper(
    entrees.actualitesMarche.map(versArticle).filter(a => recente(a, entrees.aujourdhui) && !dejaDit(a)),
  ).slice(0, 2);
  if (generales.length > 0) {
    marches.push(fr('Dans l’actualité économique.'));
    for (const groupe of generales) {
      groupe.forEach(article => articlesUtilises.add(article));
      marches.push(...narrateur.raconter(groupe));
    }
  }
  if (marches.length > 0) {
    chapitres.push({ titre: 'Les marchés', segments: marches });
  }

  // --- Le sujet du jour
  const sujetChapitre: Chapitre | undefined = entrees.sujet
    ? {
        titre: `Le sujet du jour : ${entrees.sujet.titre}`,
        segments: [
          fr(`Place au sujet du jour : ${entrees.sujet.titre}.`),
          fr(entrees.sujet.court),
          fr(entrees.sujet.detail),
          ...(entrees.sujet.piege ? [fr(`Attention au piège : ${entrees.sujet.piege}`)] : []),
        ],
      }
    : undefined;

  const cloture: Chapitre = {
    titre: 'Clôture',
    segments: [
      fr('C’est la fin de ce point bourse. Rien de ce qui a été dit n’est un conseil d’investissement : ce sont vos chiffres et l’actualité, racontés.'),
      fr('Bonne journée, et à demain.'),
    ],
  };

  // --- Revue de presse et international : elles remplissent le temps qui reste.
  const budget = cible * MOTS_PAR_MINUTE;
  let mots = compterMots([...chapitres, ...(sujetChapitre ? [sujetChapitre] : []), cloture].flatMap(c => c.segments)) + 60;
  const presse = (entrees.presse ?? []).filter(a => !dejaDit(a) && recente(a, entrees.aujourdhui));
  const expose = expositionDe(entrees.lignes.map(ligne => ({ nom: ligne.nom, poids: ligne.poids })));
  const choisir = (langue: 'fr' | 'en', maximum: number) => {
    const segments: Segment[] = [];
    let nombre = 0;
    // Une information par groupe d'articles. Passent d'abord celles qui
    // touchent vos lignes, puis les plus reprises — les plus importantes —,
    // puis celles qu'on peut vraiment raconter, avec un résumé.
    const groupes = regrouper(alterner(presse.filter(a => a.langue === langue)));
    const poids = (groupe: ArticleMedia[]) =>
      (groupe.some(a => impactPourVous(a, expose)) ? 100 : 0) +
      Math.min(groupe.length, 4) * 10 +
      (representant(groupe).resume ? 5 : 0);
    const ordonnes = groupes
      .map((groupe, rang) => ({ groupe, rang }))
      .sort((a, b) => poids(b.groupe) - poids(a.groupe) || a.rang - b.rang)
      .map(({ groupe }) => groupe);
    for (const groupe of ordonnes) {
      if (nombre >= maximum) break;
      if (groupe.some(dejaDit)) continue;
      const raconte = narrateur.raconter(groupe, expose);
      const cout = compterMots(raconte);
      if (mots + cout > budget) continue;
      segments.push(...raconte);
      groupe.forEach(article => articlesUtilises.add(article));
      mots += cout;
      nombre += 1;
    }
    return segments;
  };
  const revue = choisir('fr', cible >= 15 ? 36 : cible >= 10 ? 24 : 8);
  if (revue.length > 0) {
    chapitres.push({
      titre: 'La revue de presse',
      segments: [fr('Passons à la revue de presse économique.'), ...revue],
    });
  }
  const international = choisir('en', cible >= 15 ? 10 : cible >= 10 ? 6 : 2);
  if (international.length > 0) {
    chapitres.push({
      titre: 'À l’international',
      segments: [fr('Direction l’international, avec la presse anglo-saxonne.'), ...international],
    });
  }
  if (sujetChapitre) {
    chapitres.push(sujetChapitre);
  }
  chapitres.push(cloture);

  // --- Le sommaire, dit en ouverture.
  const sommaire = chapitres
    .slice(1, -1)
    .map(chapitre =>
      chapitre.titre
        .replace(/^L[’']/, 'l’')
        .replace(/^À /, 'à ')
        .replace(/^(Les|La|Le|Vos|Votre)\b/, mot => mot.toLowerCase()),
    );
  if (sommaire.length > 1) {
    chapitres[0].segments.push(
      fr(`Au programme : ${sommaire.slice(0, -1).join(', ')}, et ${sommaire[sommaire.length - 1]}.`),
    );
  }

  const total = compterMots(chapitres.flatMap(c => c.segments));
  return {
    titre: `Votre point bourse du ${dateParlee(entrees.aujourdhui, false)}`,
    date,
    chapitres,
    duree: Math.max(1, Math.round(total / MOTS_PAR_MINUTE)),
    sources: [...articlesUtilises].map(article => ({
      titre: article.titre,
      source: article.source,
      lien: article.lien,
      statut: statutSource(article, tousLesArticles),
      confirmations: autresSources(article, tousLesArticles),
    })),
  };
}

/** Le sujet du jour tourne : un par jour de l'année, dans l'ordre de la liste. */
export function sujetDuJour<T>(sujets: readonly T[], aujourdhui: string): T | undefined {
  if (sujets.length === 0) {
    return undefined;
  }
  const debut = Date.parse(`${aujourdhui.slice(0, 4)}-01-01T00:00:00Z`);
  const rang = Math.floor((Date.parse(`${aujourdhui}T00:00:00Z`) - debut) / 86_400_000);
  return sujets[((rang % sujets.length) + sujets.length) % sujets.length];
}

/** Découpe un texte en phrases, pour que la lecture puisse avancer et reprendre. */
export function phrases(texte: string): string[] {
  return texte
    .split(/(?<=[.!?:])\s+(?=[A-ZÀ-ÖØ-Ý0-9«"])/)
    .map(phrase => phrase.trim())
    .filter(Boolean);
}
