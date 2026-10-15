/**
 * Moteur du journal : lit les sources, agrège, rédige, enregistre.
 *
 * - `ecrireJournee` : écrit (ou réécrit) la page d'un jour. Une source qui
 *   échoue ou tarde est notée dans la page (`sourcesEnEchec`), les autres
 *   sont écrites quand même.
 * - `executerEcheances` : écrit les pages dues (soir ou rattrapage) ; ne
 *   réécrit jamais une page déjà rédigée.
 *
 * Aucune écriture hors de la base du profil : le relais n'est jamais appelé.
 */

import type { EvenementJournal, RedacteurExterne, SourceJournal } from '../hub/journal/contrat';
import type { ContexteHub } from '../hub/types';
import { agreger } from './agregation';
import { ajouterJours, jourDe } from './dates';
import { joursDus, MAX_RATTRAPAGE } from './echeance';
import {
  ecrirePage,
  ecrireReglages,
  lireIndex,
  lireMois,
  lirePage,
  lireReglages,
  reglagesParDefaut,
  type BaseJournal,
  type PageJournal,
  type ReglagesJournal,
} from './modele';
import { redigerAvecExterne, rediger } from './redaction';
import { evenementValide } from '../hub/journal/boite';

/** Temps accordé à une source (Claude Office lit un journal ou le relais). */
export const DELAI_SOURCE_MS = 12_000;

export interface Lecture {
  evenements: EvenementJournal[];
  /** Noms des sources qui ont échoué ou dépassé le délai. */
  enEchec: string[];
}

export async function lireSources(jour: string, sources: readonly SourceJournal[], contexte: ContexteHub, delai = DELAI_SOURCE_MS): Promise<Lecture> {
  const evenements: EvenementJournal[] = [];
  const enEchec: string[] = [];
  await Promise.all(
    sources.map(async source => {
      let minuterie: ReturnType<typeof setTimeout> | undefined;
      try {
        const lus = await Promise.race<EvenementJournal[] | undefined>([
          Promise.resolve().then(() => source.lire(jour, contexte)),
          new Promise<undefined>(ok => {
            minuterie = setTimeout(() => ok(undefined), delai);
          }),
        ]);
        if (!lus) {
          enEchec.push(source.nom);
          return;
        }
        // Une source ne peut ni tromper la famille ni le jour : tout est revalidé et rattaché à elle.
        for (const brut of lus) {
          const e = evenementValide({ ...brut, source: source.id });
          if (e && e.jour === jour) evenements.push({ ...e, famille: source.famille === 'autre' ? e.famille : source.famille });
        }
      } catch {
        enEchec.push(source.nom);
      } finally {
        if (minuterie) clearTimeout(minuterie);
      }
    }),
  );
  return { evenements, enEchec: enEchec.sort() };
}

export interface OptionsJournee {
  base: BaseJournal;
  sources: readonly SourceJournal[];
  contexte: ContexteHub;
  maintenant: number;
  /** Rédacteur externe : seulement utilisé si `reglages.ia` est vrai. */
  redacteur?: RedacteurExterne;
  reglages?: ReglagesJournal;
  /** Écriture demandée avant la fin de la journée : le texte le précise. */
  enCours?: boolean;
}

/** Écrit la page d'un jour (la note, l'humeur et l'épingle déjà saisies sont conservées). */
export async function ecrireJournee(jour: string, o: OptionsJournee): Promise<PageJournal> {
  const lecture = await lireSources(jour, o.sources, o.contexte);
  const resume = agreger(jour, lecture.evenements);
  let auto = rediger(resume, { enCours: o.enCours });
  if (o.reglages?.ia && o.redacteur) {
    const externe = await redigerAvecExterne(resume, auto, o.redacteur);
    if (externe) auto = externe;
  }
  // La page est relue au dernier moment : une note tapée pendant la lecture des sources n'est pas écrasée.
  const existante = lirePage(o.base, jour);
  const page: PageJournal = {
    v: 1,
    jour,
    auto,
    compteurs: resume.compteurs,
    nbEvenements: resume.evenements.length,
    ...(lecture.enEchec.length ? { sourcesEnEchec: lecture.enEchec } : {}),
    ...(existante?.note ? { note: existante.note } : {}),
    ...(existante?.humeur ? { humeur: existante.humeur } : {}),
    ...(existante?.epingle ? { epingle: true } : {}),
    ecritLe: new Date(o.maintenant).toISOString(),
    ...(existante?.modifieLe ? { modifieLe: existante.modifieLe } : {}),
  };
  ecrirePage(o.base, page);
  return page;
}

/** Jours qui ont une page rédigée entre deux dates (une page créée par une simple note ne compte pas) : seuls les mois concernés sont lus. */
export function joursEcrits(base: Pick<BaseJournal, 'lire'>, du?: string, au?: string): Set<string> {
  const jours = new Set<string>();
  for (const mois of lireIndex(base)) {
    if ((du && mois < du.slice(0, 7)) || (au && mois > au.slice(0, 7))) continue;
    for (const p of Object.values(lireMois(base, mois))) if (p.auto.moteur !== 'vide') jours.add(p.jour);
  }
  return jours;
}

/** Réglages du profil, créés (journal actif, couvrant à partir d'aujourd'hui) à la première utilisation. */
export function reglagesOuCreer(base: BaseJournal, maintenant: number): ReglagesJournal {
  const existants = lireReglages(base);
  if (existants) return existants;
  const neufs = reglagesParDefaut(jourDe(maintenant));
  try {
    ecrireReglages(base, neufs);
  } catch {
    // Base indisponible : les réglages par défaut servent pour cette fois.
  }
  return neufs;
}

/**
 * Écrit les pages dues (échéance du soir ou rattrapage à l'ouverture).
 * Renvoie les jours écrits, du plus ancien au plus récent.
 */
export async function executerEcheances(o: Omit<OptionsJournee, 'reglages'>): Promise<string[]> {
  const reglages = reglagesOuCreer(o.base, o.maintenant);
  const aujourdhui = jourDe(o.maintenant);
  const dus = joursDus(o.maintenant, reglages, joursEcrits(o.base, ajouterJours(aujourdhui, -MAX_RATTRAPAGE), aujourdhui));
  const ecrits: string[] = [];
  for (const jour of dus) {
    await ecrireJournee(jour, { ...o, reglages });
    ecrits.push(jour);
  }
  return ecrits;
}
