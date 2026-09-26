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
import { autresSources, mediaReconnu, statutSource, type ArticleMedia, type StatutSource } from './medias';
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
  /** Durée visée, en minutes : 5, 10 ou 15. Dix par défaut. */
  cibleMinutes?: number;
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

/**
 * Un article raconté : la source, le titre, le résumé s'il y en a un, puis
 * — si l'on sait le dire — ce que la nouvelle change pour vos lignes.
 */
function raconterArticle(
  article: ArticleMedia,
  introduction: string,
  expose?: ExpositionPortefeuille,
): Segment[] {
  // Un site inconnu est annoncé comme tel : l'auditeur pèse l'information.
  const prudence = article.source && !mediaReconnu(article.source) ? ', un site que l’application ne connaît pas' : '';
  const segments: Segment[] = [fr(`${introduction}${article.source ? ` ${article.source}` : ''}${prudence} :`)];
  segments.push({ texte: titreFini(article.titre), langue: article.langue });
  if (article.resume) {
    segments.push({ texte: titreFini(article.resume), langue: article.langue });
  }
  const impact = expose ? impactPourVous(article, expose) : undefined;
  if (impact) {
    segments.push(fr(impact));
  }
  return segments;
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

export function construireEpisode(entrees: EntreesEpisode): Episode {
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

  // --- Vos valeurs à la une
  const cible = entrees.cibleMinutes ?? 10;
  const une: Segment[] = [];
  const articlesUtilises = new Set<ArticleMedia>();
  for (const valeur of entrees.valeurs.slice(0, cible <= 5 ? 3 : 5)) {
    const titres = valeur.actualites.filter(a => recente(a, entrees.aujourdhui)).slice(0, 2);
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
    const recents = (valeur.articles ?? []).filter(a => recente(a, entrees.aujourdhui));
    // Les articles résumés sont racontés ; les autres, cités en titres.
    const resumes = recents.filter(a => a.resume).slice(0, cible >= 15 ? 3 : 2);
    for (const article of resumes) {
      articlesUtilises.add(article);
      phrases.push(...raconterArticle(article, 'Dans la presse, chez'));
    }
    const titresSeuls = recents
      .filter(a => !resumes.includes(a))
      .slice(0, cible >= 15 ? 5 : cible >= 10 ? 3 : 1);
    if (titresSeuls.length > 0) {
      phrases.push(fr(resumes.length > 0 ? 'D’autres titres cette semaine :' : `Cette semaine, ${valeur.nom} fait parler d’elle :`));
      for (const article of titresSeuls) {
        articlesUtilises.add(article);
        phrases.push({ texte: titreFini(article.titre), langue: article.langue });
        if (article.source) {
          phrases.push(fr(`C’était chez ${article.source}${mediaReconnu(article.source) ? '' : ', une source non vérifiée'}.`));
        }
      }
    }
    if (titres.length > 0) {
      phrases.push(fr(`${valeur.nom}. ${titres.length > 1 ? 'Deux titres' : 'Un titre'} dans la presse${titres[0].source ? `, notamment chez ${titres[0].source}` : ''} :`));
      for (const actualite of titres) {
        phrases.push({ texte: titreFini(actualite.titre), langue: actualite.langue });
      }
    }
    if (valeur.consensus && RECOMMANDATIONS[valeur.consensus]) {
      let phrase = `Les analystes ${RECOMMANDATIONS[valeur.consensus]}`;
      if (valeur.objectifMoyen && valeur.cours) {
        const potentiel = (valeur.objectifMoyen / valeur.cours - 1) * 100;
        phrase += `, avec un objectif moyen ${potentiel >= 0 ? 'supérieur' : 'inférieur'} de ${pourcentParle(Math.abs(potentiel), false)} au cours actuel`;
      }
      phrases.push(fr(titres.length > 0 || ligne ? `${phrase}.` : `${valeur.nom} : ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}.`));
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
  const generales = entrees.actualitesMarche.filter(a => recente(a, entrees.aujourdhui)).slice(0, 3);
  if (generales.length > 0) {
    marches.push(fr('Dans l’actualité économique :'));
    for (const actualite of generales) {
      marches.push({ texte: titreFini(actualite.titre), langue: actualite.langue });
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
  const presse = (entrees.presse ?? []).filter(a => !articlesUtilises.has(a) && recente(a, entrees.aujourdhui));
  const expose = expositionDe(entrees.lignes.map(ligne => ({ nom: ligne.nom, poids: ligne.poids })));
  const choisir = (langue: 'fr' | 'en', maximum: number, introduction: string) => {
    const segments: Segment[] = [];
    let nombre = 0;
    // Les articles qui touchent vos lignes passent en premier.
    const candidats = alterner(presse.filter(a => a.langue === langue));
    const ordonnes = [
      ...candidats.filter(a => impactPourVous(a, expose)),
      ...candidats.filter(a => !impactPourVous(a, expose)),
    ];
    for (const article of ordonnes) {
      if (nombre >= maximum) break;
      const raconte = raconterArticle(article, introduction, expose);
      const cout = compterMots(raconte);
      if (mots + cout > budget) continue;
      segments.push(...raconte);
      articlesUtilises.add(article);
      mots += cout;
      nombre += 1;
    }
    return segments;
  };
  const revue = choisir('fr', cible >= 15 ? 36 : cible >= 10 ? 24 : 8, 'Selon');
  if (revue.length > 0) {
    chapitres.push({
      titre: 'La revue de presse',
      segments: [fr('Passons à la revue de presse économique.'), ...revue],
    });
  }
  const international = choisir('en', cible >= 15 ? 10 : cible >= 10 ? 6 : 2, 'On lit chez');
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

  const tousLesArticles = [
    ...(entrees.presse ?? []),
    ...entrees.valeurs.flatMap(valeur => valeur.articles ?? []),
  ];
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
