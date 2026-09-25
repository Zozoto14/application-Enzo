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
  const une: Segment[] = [];
  for (const valeur of entrees.valeurs) {
    const titres = valeur.actualites.filter(a => recente(a, entrees.aujourdhui)).slice(0, 2);
    const phrases: Segment[] = [];
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
      phrases.push(fr(titres.length > 0 ? `${phrase}.` : `${valeur.nom} : ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}.`));
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
  if (entrees.sujet) {
    const sujet = entrees.sujet;
    chapitres.push({
      titre: `Le sujet du jour : ${sujet.titre}`,
      segments: [
        fr(`Pour finir, le sujet du jour : ${sujet.titre}.`),
        fr(sujet.court),
        fr(sujet.detail),
        ...(sujet.piege ? [fr(`Attention au piège : ${sujet.piege}`)] : []),
      ],
    });
  }

  chapitres.push({
    titre: 'Clôture',
    segments: [fr('C’est tout pour aujourd’hui. Bonne journée, et à demain pour un nouveau point.')],
  });

  // Environ 160 mots par minute à vitesse normale.
  const mots = chapitres.flatMap(c => c.segments).reduce((total, s) => total + s.texte.split(/\s+/).length, 0);
  return {
    titre: `Votre point bourse du ${dateParlee(entrees.aujourdhui, false)}`,
    date,
    chapitres,
    duree: Math.max(1, Math.round(mots / 160)),
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
