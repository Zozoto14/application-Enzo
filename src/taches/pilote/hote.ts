/**
 * Pilote de semaine, côté hôte : remplit les contrats du hub
 * (`src/hub/pilote/contrats.ts`) à partir des données locales déjà
 * synchronisées, et applique le résultat dans Tâches.
 *
 *  - Tâches : seulement celles qui sont assignées à l'utilisateur (le Fondateur
 *    compte aussi celles de personne dans ses projets non partagés), ouvertes,
 *    dans un projet où il peut modifier. Un membre ne lit que sa copie ; il ne
 *    planifie jamais ce qu'il ne peut pas écrire. Les tâches venues de
 *    Prospects, Abonnements et Portefeuille ne sont pas reprises : leur
 *    événement d'origine est planifié à leur place.
 *  - Prospects et Abonnements : Fondateur seul (mêmes règles que les liens de
 *    Tâches). Portefeuille : les rappels que l'hôte donne déjà. Tsuzuku : la
 *    bibliothèque du profil, si l'app lui est ouverte.
 *  - Aucune lecture du relais, aucune écriture hors de Tâches : « Valider » est
 *    UNE seule modification des données de Tâches (donc un seul dépôt par la
 *    synchronisation existante).
 */

import { chargerDonnees } from '../../hub/admin/donnees';
import { comptesSuivis, peutVoirAbonnements } from '../../hub/abonnements/actionsAbo';
import { lignesAbo } from '../../hub/abonnements/abonnements';
import { peutOuvrir } from '../../hub/permissions';
import {
  lireReglagesPilote,
  type EntreePilote,
  type EpisodeRecompense,
  type EvenementFixe,
  type ReglagesPilote,
  type Semaine,
  type TachePlanifiable,
} from '../../hub/pilote/contrats';
import { ajouterJours, jourValide, septJours } from '../../hub/pilote/jours';
import type { ContexteHub } from '../../hub/types';
import { accesProspects, lireCarnet } from '../../prospects/acces';
import { STATUTS_CLOS, type Prospect } from '../../prospects/prospects';
import { migrerBibliotheque } from '../../tsuzuku/moteur/bibliotheque';
import { CLES as CLES_TSUZUKU } from '../../tsuzuku/plateforme/stockage';
import { droitsProjet, type RoleTaches } from '../acces';
import {
  assignesDe,
  estTerminee,
  modifierTache,
  vivant,
  type Auteur,
  type Contexte,
  type DonneesTaches,
  type Echeance,
  type Tache,
} from '../modele';
import { projetPartage } from '../membres';
import { occurrenceApres } from '../recurrence';
import { tempsPasse } from '../temps';

export const CLE_PILOTE = 'taches.pilote';
export const ID_TSUZUKU = 'tsuzuku';

/** Ce que l'hôte sait des autres apps au moment de planifier. */
export type SourcesPilote = Pick<ContexteHub, 'profil' | 'profils' | 'admin' | 'portefeuille' | 'baseProfil'>;

// ------------------------------------------------------------------ État local (appareil)

export interface AnnulationTache {
  tacheId: string;
  /** Échéance avant la validation (absente : aucune). */
  avant?: Echeance;
  /** Échéance posée par la validation. */
  apres: Echeance;
}

export interface ValidationPilote {
  /** Lundi de la semaine validée. */
  debut: string;
  /** Instant de la validation (ms). */
  le: number;
  annulation: AnnulationTache[];
  semaine: Semaine;
}

export interface EtatPilote {
  v: 1;
  reglages: ReglagesPilote;
  /** Semaine en cours d'arrangement (non validée). */
  brouillon?: Semaine;
  valide?: ValidationPilote;
  /** Semaines (lundis) dont la notification est déjà partie. */
  notifiees: string[];
}

const dict = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function lireSemaine(v: unknown): Semaine | undefined {
  const o = dict(v);
  if (!jourValide(o.debut) || !Array.isArray(o.elements)) return undefined;
  const liste = (x: unknown) => (Array.isArray(x) ? x.filter(e => e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string').slice(0, 400) : []);
  return {
    debut: o.debut,
    genereLe: typeof o.genereLe === 'number' ? o.genereLe : 0,
    elements: liste(o.elements) as Semaine['elements'],
    nonPlaces: liste(o.nonPlaces) as Semaine['nonPlaces'],
    retires: liste(o.retires) as Semaine['retires'],
  };
}

function lireEcheance(v: unknown): Echeance | undefined {
  const o = dict(v);
  if (!jourValide(o.jour)) return undefined;
  return typeof o.heure === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.heure) ? { jour: o.jour, heure: o.heure } : { jour: o.jour };
}

export function lireEtatPilote(brut: string | null | undefined): EtatPilote {
  let o: Record<string, unknown> = {};
  try {
    o = brut ? dict(JSON.parse(brut)) : {};
  } catch {
    o = {};
  }
  const semaine = lireSemaine(o.brouillon);
  const val = dict(o.valide);
  const vs = lireSemaine(val.semaine);
  const annulation = (Array.isArray(val.annulation) ? val.annulation : [])
    .map(dict)
    .map(a => ({ tacheId: a.tacheId, avant: lireEcheance(a.avant), apres: lireEcheance(a.apres) }))
    .filter((a): a is { tacheId: string; avant: Echeance | undefined; apres: Echeance } => typeof a.tacheId === 'string' && a.apres !== undefined)
    .slice(0, 400)
    .map(a => ({ tacheId: a.tacheId, ...(a.avant ? { avant: a.avant } : {}), apres: a.apres }));
  return {
    v: 1,
    reglages: lireReglagesPilote(o.reglages),
    ...(semaine ? { brouillon: semaine } : {}),
    ...(vs && jourValide(val.debut) && typeof val.le === 'number' ? { valide: { debut: val.debut, le: val.le, annulation, semaine: vs } } : {}),
    notifiees: (Array.isArray(o.notifiees) ? o.notifiees : []).filter((x): x is string => typeof x === 'string' && jourValide(x)).slice(-12),
  };
}

type Base = { lire(cle: string): string | undefined | null; ecrire(cle: string, valeur: string): void };

export const lireEtatBase = (base: Pick<Base, 'lire'> | undefined): EtatPilote => {
  try {
    return lireEtatPilote(base?.lire(CLE_PILOTE));
  } catch {
    return lireEtatPilote(undefined);
  }
};

export function ecrireEtatBase(base: Pick<Base, 'ecrire'> | undefined, etat: EtatPilote): void {
  try {
    base?.ecrire(CLE_PILOTE, JSON.stringify(etat));
  } catch {
    // Base indisponible : l'écran garde son état en mémoire.
  }
}

// ------------------------------------------------------------------ Tâches

const MAX_TACHES = 80;
const MAX_REPETITIONS = 400;

/** Jours de la semaine où une tâche récurrente revient, après son échéance. */
function repetitionsDe(t: Tache, debut: string, aujourdhui: string): string[] {
  if (!t.recurrence) return [];
  const fin = ajouterJours(debut, 6);
  const sortie: string[] = [];
  let j = t.echeance?.jour ?? ajouterJours(aujourdhui, -1);
  for (let i = 0; i < MAX_REPETITIONS; i++) {
    j = occurrenceApres(t.recurrence, j);
    if (j > fin) break;
    if (j >= debut && j >= aujourdhui) sortie.push(j);
  }
  return sortie;
}

/** Cette tâche est-elle à moi et puis-je la modifier ? (rangs et partage d'équipe respectés) */
export function peutPlanifier(d: DonneesTaches, t: Tache, role: RoleTaches, moi: Auteur): boolean {
  if (!vivant(t) || t.parentId || estTerminee(d, t)) return false;
  const projet = d.projets[t.projetId];
  if (!vivant(projet) || !vivant(d.listes[t.listeId])) return false;
  if (t.source && t.source.app !== 'office') return false;
  if (!droitsProjet(role, d, t.projetId, moi).modifier) return false;
  const assignes = assignesDe(t);
  if (assignes.length > 0) return assignes.includes(moi);
  // Sans personne d'assignée : au Fondateur, seulement dans ses projets non partagés.
  return role === 'fondateur' && !projetPartage(d, projet);
}

export function tachesPlanifiables(d: DonneesTaches, role: RoleTaches, moi: Auteur, debut: string, aujourdhui: string): TachePlanifiable[] {
  const fin = ajouterJours(debut, 6);
  const horizon = ajouterJours(fin, 7);
  const liste: TachePlanifiable[] = [];
  for (const t of Object.values(d.taches)) {
    if (!peutPlanifier(d, t, role, moi)) continue;
    const ech = t.echeance?.jour;
    const repetitions = repetitionsDe(t, debut, aujourdhui);
    const dansLaSemaine = (j?: string) => j !== undefined && j >= debut && j <= fin;
    const pertinente = (ech !== undefined && ech <= horizon) || t.priorite === 'urgente' || t.priorite === 'haute' || dansLaSemaine(t.debut) || dansLaSemaine(t.pourAujourdhui) || repetitions.length > 0;
    if (!pertinente) continue;
    const reste = t.estimation ? Math.max(15, t.estimation - tempsPasse(t, moi)) : undefined;
    liste.push({
      id: t.id,
      titre: t.titre,
      priorite: t.priorite,
      ...(ech ? { echeance: ech } : {}),
      ...(t.debut ? { debut: t.debut } : {}),
      ...(reste ? { dureeMin: reste } : {}),
      ...(repetitions.length ? { repetitions } : {}),
      projet: d.projets[t.projetId]?.nom,
    });
  }
  return liste
    .sort((a, b) => (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999') || a.id.localeCompare(b.id))
    .slice(0, MAX_TACHES);
}

// ------------------------------------------------------------------ Autres apps

const nomProspect = (p: Prospect) => p.nom || p.entreprise || p.email || 'un prospect';

function evenementsProspects(s: SourcesPilote, debut: string, aujourdhui: string): EvenementFixe[] {
  const fin = ajouterJours(debut, 6);
  const carnet = lireCarnet(s);
  if (!carnet) return [];
  return Object.values(carnet.prospects)
    .filter(p => p.relance && jourValide(p.relance) && p.relance <= fin && !STATUTS_CLOS.includes(p.statut) && !p.nePlusContacter)
    .sort((a, b) => a.relance!.localeCompare(b.relance!) || a.id.localeCompare(b.id))
    .slice(0, 60)
    .map(p => ({
      id: p.id,
      genre: 'relance' as const,
      titre: `Relancer ${nomProspect(p)}`,
      ...(p.entreprise && p.nom ? { detail: p.entreprise } : {}),
      jour: p.relance!,
      ...(p.relance! < aujourdhui ? { retard: true } : {}),
    }));
}

function evenementsAbonnements(s: SourcesPilote, debut: string, aujourdhui: string): EvenementFixe[] {
  if (!s.admin || !s.profil || !peutVoirAbonnements(s.profil)) return [];
  const fin = ajouterJours(debut, 6);
  const abo = chargerDonnees(s.admin.stockage).abonnements;
  const suivis = comptesSuivis(s.profil, s.profils?.tous ?? []);
  return lignesAbo(suivis, abo, aujourdhui)
    .filter(l => l.statut !== 'offert' && l.statut !== 'suspendu' && l.echeance && jourValide(l.echeance) && l.echeance <= fin)
    .sort((a, b) => a.echeance!.localeCompare(b.echeance!) || a.id.localeCompare(b.id))
    .slice(0, 60)
    .map(l => ({
      id: `${l.id}|${l.echeance}`,
      genre: 'paiement' as const,
      titre: l.statut === 'en-retard' ? `Abonnement de ${l.nom} en retard` : `Paiement attendu : abonnement de ${l.nom}`,
      jour: l.echeance!,
      ...(l.echeance! < aujourdhui ? { retard: true } : {}),
    }));
}

function evenementsPortefeuille(s: SourcesPilote, debut: string, aujourdhui: string): EvenementFixe[] {
  const r = s.portefeuille?.rappelsTaches;
  if (!r) return [];
  const jours = septJours(debut);
  const sortie: EvenementFixe[] = [];
  const v = r.versement;
  if (v?.actif && v.jour >= 1 && v.jour <= 28) {
    const jour = jours.find(j => Number(j.slice(8)) === v.jour);
    if (jour) sortie.push({ id: `versement|${jour.slice(0, 7)}`, genre: 'versement', titre: `Versement mensuel : ${v.montant} €`, jour });
  }
  const fin = jours[6];
  for (const dv of r.dividendes) {
    if (!jourValide(dv.date) || dv.date > fin || dv.date < ajouterJours(aujourdhui, -30)) continue;
    sortie.push({ id: `dividende|${dv.nom}|${dv.date}`.slice(0, 120), genre: 'dividende', titre: `Vérifier le dividende de ${dv.nom}`, ...(dv.montant ? { detail: `≈ ${dv.montant}` } : {}), jour: dv.date, ...(dv.date < aujourdhui ? { retard: true } : {}) });
  }
  return sortie.slice(0, 30);
}

export function evenementsPilote(s: SourcesPilote, reglages: ReglagesPilote, debut: string, aujourdhui: string): EvenementFixe[] {
  const essayer = (f: () => EvenementFixe[]) => {
    try {
      return f();
    } catch {
      return [];
    }
  };
  return [
    ...(accesProspects(s) ? essayer(() => evenementsProspects(s, debut, aujourdhui)) : []),
    ...essayer(() => evenementsAbonnements(s, debut, aujourdhui)),
    ...(reglages.portefeuille ? essayer(() => evenementsPortefeuille(s, debut, aujourdhui)) : []),
  ];
}

/** Épisodes à regarder en récompense : la suite des animés suivis (en cours ou à reprendre), si Tsuzuku est ouvert au profil. */
export function episodesPilote(s: SourcesPilote, max = 14): EpisodeRecompense[] {
  try {
    if (!peutOuvrir({ id: ID_TSUZUKU }, s.profil)) return [];
    const brut = s.baseProfil?.lire(CLES_TSUZUKU.bibliotheque);
    if (!brut) return [];
    const db = migrerBibliotheque(JSON.parse(brut));
    const suivis = db.anime
      .filter(a => a.status === 'en_cours' || a.status === 'a_reprendre')
      .sort((a, b) => String(b.lastWatched ?? '').localeCompare(String(a.lastWatched ?? '')) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const sortie: EpisodeRecompense[] = [];
    for (const a of suivis) {
      const vu = Math.max(0, Math.floor(a.currentEpisode || 0));
      const total = a.totalEpisodes && a.totalEpisodes > 0 ? a.totalEpisodes : vu + 1;
      const duree = a.runtime && a.runtime >= 5 && a.runtime <= 120 ? Math.round(a.runtime) : 24;
      for (let n = vu + 1; n <= Math.min(total, vu + 3); n++) {
        sortie.push({ id: `${a.id}-${n}`.slice(0, 80), animeId: a.id, titre: a.title, episode: n, dureeMin: duree });
        if (sortie.length >= max) return sortie;
      }
    }
    return sortie;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ Entrée complète

export interface DonneesHote {
  role: RoleTaches;
  moi: Auteur;
  donnees: DonneesTaches;
}

export function construireEntree(s: SourcesPilote, h: DonneesHote, reglages: ReglagesPilote, debut: string, aujourdhui: string): EntreePilote {
  return {
    debut,
    aujourdhui,
    reglages,
    taches: tachesPlanifiables(h.donnees, h.role, h.moi, debut, aujourdhui),
    evenements: evenementsPilote(s, reglages, debut, aujourdhui),
    episodes: reglages.recompenses ? episodesPilote(s) : [],
  };
}

// ------------------------------------------------------------------ Validation et annulation

export interface BilanValidation {
  donnees: DonneesTaches;
  annulation: AnnulationTache[];
  appliquees: number;
  /** Tâches terminées, supprimées ou devenues non modifiables depuis la proposition. */
  ignorees: number;
}

const memeEcheance = (a: Echeance | undefined, b: Echeance | undefined) => a?.jour === b?.jour && a?.heure === b?.heure;

/**
 * Applique la semaine : le jour et le créneau de chaque tâche placée deviennent
 * son échéance dans Tâches (l'ancienne échéance reste dans l'historique de la
 * tâche et dans `annulation`). Une seule modification des données, donc un seul
 * enregistrement. Les récurrences, relances, paiements et épisodes ne touchent
 * rien : seuls les éléments de genre « tâche » sont écrits.
 */
export function validerSemaine(d: DonneesTaches, semaine: Semaine, ctx: Contexte, role: RoleTaches, moi: Auteur): BilanValidation {
  let x = d;
  const annulation: AnnulationTache[] = [];
  let appliquees = 0;
  let ignorees = 0;
  const jours = new Set(septJours(semaine.debut));
  for (const el of semaine.elements) {
    if (el.genre !== 'tache' || !jours.has(el.jour)) continue;
    const t = x.taches[el.refId];
    if (!t || !peutPlanifier(x, t, role, moi)) {
      ignorees++;
      continue;
    }
    const apres: Echeance = { jour: el.jour, ...(el.debut ? { heure: el.debut } : {}) };
    appliquees++;
    if (memeEcheance(t.echeance, apres)) continue;
    x = modifierTache(x, t.id, { echeance: apres }, ctx);
    annulation.push({ tacheId: t.id, ...(t.echeance ? { avant: t.echeance } : {}), apres });
  }
  return { donnees: x, annulation, appliquees, ignorees };
}

export interface BilanAnnulation {
  donnees: DonneesTaches;
  restaurees: number;
  /** Tâches modifiées depuis la validation : on n'y touche pas. */
  conservees: number;
}

export function annulerValidation(d: DonneesTaches, v: ValidationPilote, ctx: Contexte): BilanAnnulation {
  let x = d;
  let restaurees = 0;
  let conservees = 0;
  for (const a of v.annulation) {
    const t = x.taches[a.tacheId];
    if (!t || !vivant(t) || !memeEcheance(t.echeance, a.apres)) {
      conservees++;
      continue;
    }
    x = modifierTache(x, t.id, { echeance: a.avant }, ctx);
    restaurees++;
  }
  return { donnees: x, restaurees, conservees };
}

/** Tâches de la semaine qui ne sont plus à faire (terminées, supprimées) : elles ne bloquent aucune récompense. */
export function tachesFaites(d: DonneesTaches, semaine: Semaine): Set<string> {
  const faites = new Set<string>();
  for (const el of semaine.elements) {
    if (el.genre !== 'tache') continue;
    const t = d.taches[el.refId];
    if (!t || !vivant(t) || estTerminee(d, t)) faites.add(el.refId);
  }
  return faites;
}
