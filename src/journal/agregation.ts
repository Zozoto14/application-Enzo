/**
 * Agrégation des événements d'un jour : dédoublonnage, tri, regroupement par
 * famille, compteurs (les « chiffres clés ») et choix du « fait marquant ».
 * Pur : aucune lecture, aucune horloge.
 */

import type { EvenementJournal, FamilleEvenement } from '../hub/journal/contrat';

/** Clés des compteurs d'une page (additionnées par les récapitulatifs). */
export const COMPTEURS = {
  tachesTerminees: 'taches_terminees',
  tachesCreees: 'taches_creees',
  sessions: 'sessions',
  minutesOffice: 'minutes_office',
  episodes: 'episodes',
  series: 'series',
  operations: 'operations',
  achats: 'achats',
  ventes: 'ventes',
  dividendes: 'dividendes',
  paiements: 'paiements',
  encaisse: 'encaisse',
  relances: 'relances',
  decisions: 'decisions',
  /** Variation du portefeuille (%), présente seulement si connue. */
  variation: 'variation_pct',
} as const;

export interface CandidatMarquant {
  famille: FamilleEvenement;
  /** `evenement` : un fait précis ; `taches`/`marathon` : un fait de série calculé par l'agrégation. */
  type: 'evenement' | 'taches' | 'marathon';
  poids: number;
  evenement?: EvenementJournal;
  n?: number;
  groupe?: string;
}

export interface ResumeJour {
  jour: string;
  evenements: EvenementJournal[];
  parFamille: Record<FamilleEvenement, EvenementJournal[]>;
  compteurs: Record<string, number>;
  marquant?: CandidatMarquant;
}

const FAMILLES_VIDES = (): Record<FamilleEvenement, EvenementJournal[]> => ({
  taches: [],
  office: [],
  tsuzuku: [],
  portefeuille: [],
  abonnements: [],
  prospects: [],
  decisions: [],
  meteo: [],
  autre: [],
});

/** Importance d'un événement quand sa source n'en donne pas. */
export function poidsDe(e: EvenementJournal): number {
  if (typeof e.poids === 'number') return Math.min(100, Math.max(0, e.poids));
  switch (e.genre) {
    case 'decision':
      return 70;
    case 'variation-portefeuille':
      return Math.min(95, 40 + Math.abs(e.pourcentage ?? 0) * 15);
    case 'operation-bourse':
      return e.montant ? Math.min(85, 50 + Math.log10(Math.max(1, Math.abs(e.montant))) * 5) : 55;
    case 'paiement-abonnement':
      return 55;
    case 'session-office':
      return 45 + Math.min(25, (e.nombre ?? 0) / 10);
    case 'tache-terminee':
      return 40;
    case 'relance-prospect':
      return 40;
    case 'episode-vu':
      return 35;
    case 'tache-creee':
      return 20;
    case 'meteo':
      return 5;
    default:
      return 25;
  }
}

const cle = (e: EvenementJournal) => `${e.source}|${e.id}`;

/** Un jour d'événements, dédoublonnés (même source + même identifiant) et triés (heure, puis titre). */
export function ordonner(evenements: readonly EvenementJournal[], jour: string): EvenementJournal[] {
  const vus = new Map<string, EvenementJournal>();
  for (const e of evenements) if (e.jour === jour && !vus.has(cle(e))) vus.set(cle(e), e);
  return [...vus.values()].sort((a, b) => (a.heure ?? '99:99').localeCompare(b.heure ?? '99:99') || a.titre.localeCompare(b.titre, 'fr'));
}

export function agreger(jour: string, evenements: readonly EvenementJournal[]): ResumeJour {
  const liste = ordonner(evenements, jour);
  const parFamille = FAMILLES_VIDES();
  for (const e of liste) parFamille[e.famille].push(e);
  const par = (genre: EvenementJournal['genre']) => liste.filter(e => e.genre === genre);
  const ops = par('operation-bourse');
  const variation = par('variation-portefeuille')[0];
  const series = new Set(par('episode-vu').map(e => e.groupe ?? e.titre));
  const sessions = par('session-office');
  const paiements = par('paiement-abonnement');
  const compteurs: Record<string, number> = {
    [COMPTEURS.tachesTerminees]: par('tache-terminee').length,
    [COMPTEURS.tachesCreees]: par('tache-creee').length,
    [COMPTEURS.sessions]: sessions.length,
    [COMPTEURS.minutesOffice]: Math.round(sessions.reduce((t, e) => t + (e.nombre ?? 0), 0)),
    [COMPTEURS.episodes]: par('episode-vu').length,
    [COMPTEURS.series]: series.size,
    [COMPTEURS.operations]: ops.length,
    [COMPTEURS.achats]: ops.filter(e => e.groupe === 'ACHAT').length,
    [COMPTEURS.ventes]: ops.filter(e => e.groupe === 'VENTE').length,
    [COMPTEURS.dividendes]: ops.filter(e => e.groupe === 'DIVIDENDE').length,
    [COMPTEURS.paiements]: paiements.length,
    [COMPTEURS.encaisse]: Math.round(paiements.reduce((t, e) => t + (e.montant ?? 0), 0) * 100) / 100,
    [COMPTEURS.relances]: par('relance-prospect').length,
    [COMPTEURS.decisions]: par('decision').length,
  };
  if (variation && typeof variation.pourcentage === 'number') compteurs[COMPTEURS.variation] = Math.round(variation.pourcentage * 100) / 100;
  return { jour, evenements: liste, parFamille, compteurs, marquant: choisirMarquant(liste, compteurs) };
}

/** Le fait du jour : l'événement le plus important, ou une série (beaucoup de tâches, un marathon d'épisodes) si elle pèse plus. */
export function choisirMarquant(liste: readonly EvenementJournal[], compteurs: Record<string, number>): CandidatMarquant | undefined {
  const candidats: CandidatMarquant[] = [];
  for (const e of liste) {
    // La météo et les créations de tâches ne font jamais le fait marquant seules.
    if (e.genre === 'meteo') continue;
    candidats.push({ famille: e.famille, type: 'evenement', poids: poidsDe(e), evenement: e });
  }
  const terminees = compteurs[COMPTEURS.tachesTerminees] ?? 0;
  if (terminees >= 3) candidats.push({ famille: 'taches', type: 'taches', poids: Math.min(85, 50 + terminees * 4), n: terminees });
  const parSerie = new Map<string, number>();
  for (const e of liste) if (e.genre === 'episode-vu') parSerie.set(e.groupe ?? e.titre, (parSerie.get(e.groupe ?? e.titre) ?? 0) + 1);
  for (const [groupe, n] of parSerie) if (n >= 3) candidats.push({ famille: 'tsuzuku', type: 'marathon', poids: Math.min(80, 45 + n * 5), n, groupe });
  if (candidats.length === 0) return undefined;
  // Poids décroissant ; à égalité, l'événement le plus tardif de la journée (plus frais en mémoire).
  return candidats.sort((a, b) => b.poids - a.poids || (b.evenement?.heure ?? '').localeCompare(a.evenement?.heure ?? ''))[0];
}

/** Niveau d'activité du jour, pour le ton du texte. */
export type Rythme = 'calme' | 'normal' | 'dense';
export function rythmeDe(resume: Pick<ResumeJour, 'evenements'>): Rythme {
  const n = resume.evenements.filter(e => e.genre !== 'meteo').length;
  return n === 0 ? 'calme' : n >= 12 ? 'dense' : n <= 2 ? 'calme' : 'normal';
}
