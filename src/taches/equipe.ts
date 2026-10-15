/**
 * Menu « Équipe » de Tâches : qui a l'app, avec quel accès, sur quels
 * projets et quelle charge ; droits en masse (matrice membres × projets),
 * retrait d'un projet ou de tous (révocation et rotation de clé existantes,
 * `membres.ts`), réassignation des tâches d'un membre retiré, fiche d'un
 * membre (ses tâches, son activité récente, ses débriefings).
 *
 * L'accès à l'app reste UNE vérité : la liste des apps du profil du hub
 * (Administration) ; inviter l'ouvre, retirer la ferme (`etat.ts`).
 *
 * Pur : horloge, auteur et aléa passés en paramètre.
 */

import { debutSemaine, ajouterJours } from './dates';
import { changerDroit, droitDe, listeMembres, membreDe, type DroitOuAucun, type Membre, type ProfilAcces } from './membres';
import {
  assignesDe,
  ErreurTaches,
  estTerminee,
  idMembreValide,
  modifierTache,
  projetsDe,
  suffixeAuteur,
  tachesVivantes,
  vivant,
  type Auteur,
  type Contexte,
  type DonneesTaches,
  type DroitMembre,
  type EntreeJournal,
  type Tache,
} from './modele';

export type EtatAcces = 'ouvert' | 'ferme' | 'desactive' | 'supprime' | 'inconnu';
export const LIBELLES_ACCES: Record<EtatAcces, string> = {
  ouvert: 'Accès ouvert',
  ferme: 'Accès fermé',
  desactive: 'Profil désactivé',
  supprime: 'Profil supprimé du hub',
  inconnu: 'Accès : annuaire non chargé',
};

/** Profil du hub tel que l'annuaire le donne (avec sa dernière connexion). */
export interface ProfilEquipe extends ProfilAcces {
  derniereConnexion?: string;
}

export interface ChargeMembre {
  ouvertes: number;
  enRetard: number;
  /** Temps suivi cette semaine (lundi → dimanche), en minutes. */
  minutesSemaine: number;
}

/** Charge actuelle d'une personne : tâches ouvertes qui lui sont assignées, en retard, temps suivi cette semaine. */
export function chargeDe(d: DonneesTaches, code: Auteur, aujourdhui: string): ChargeMembre {
  const lundi = debutSemaine(aujourdhui);
  const dimanche = ajouterJours(lundi, 6);
  let ouvertes = 0;
  let enRetard = 0;
  let minutesSemaine = 0;
  for (const t of tachesVivantes(d)) {
    for (const e of Object.values(t.temps ?? {})) if (!e.supprime && e.auteur === code && e.jour >= lundi && e.jour <= dimanche) minutesSemaine += e.minutes;
    if (estTerminee(d, t) || !assignesDe(t).includes(code)) continue;
    ouvertes++;
    if (t.echeance && t.echeance.jour < aujourdhui) enRetard++;
  }
  return { ouvertes, enRetard, minutesSemaine };
}

const instant = (h: string | undefined) => h?.split('|')[0];

/** Dernière trace d'une personne dans les données (champ, commentaire, temps, journal, historique), ISO. */
export function derniereActivite(d: DonneesTaches, code: Auteur): string | undefined {
  const s = suffixeAuteur(code);
  let max = '';
  const voir = (h: string | undefined) => {
    if (h && h.endsWith(s)) {
      const i = instant(h)!;
      if (i > max) max = i;
    }
  };
  for (const t of Object.values(d.taches)) {
    for (const h of Object.values(t.h)) voir(h);
    for (const e of Object.values(t.checklist)) voir(e.h);
    for (const c of Object.values(t.commentaires)) voir(c.h);
    for (const e of Object.values(t.temps ?? {})) voir(e.h);
    for (const e of t.historique) if (e.auteur === code && e.date > max) max = e.date;
  }
  for (const e of Object.values(d.journal ?? {})) voir(e.h);
  return max || undefined;
}

export interface ProjetMembre {
  id: string;
  nom: string;
  couleur: string;
  icone?: string;
  droit: DroitMembre;
}

export interface LigneEquipe {
  membre: Membre;
  profil?: ProfilEquipe;
  acces: EtatAcces;
  projets: ProjetMembre[];
  charge: ChargeMembre;
  derniere?: string;
}

/** État de l'accès d'un membre, d'après l'annuaire du hub (une seule vérité : les apps du profil). */
export function etatAcces(compte: string, profils: readonly ProfilEquipe[] | undefined): { acces: EtatAcces; profil?: ProfilEquipe } {
  if (!profils || !profils.some(p => !p.admin)) return { acces: 'inconnu' };
  const profil = profils.find(p => p.id === compte);
  if (!profil) return { acces: 'supprime' };
  if (profil.actif === false) return { acces: 'desactive', profil };
  return { acces: (profil.apps ?? []).includes('taches') ? 'ouvert' : 'ferme', profil };
}

/** Projets (non auto) où un membre a un droit. */
export function projetsDuMembre(d: DonneesTaches, compte: string): ProjetMembre[] {
  return projetsDe(d)
    .filter(p => !p.auto)
    .map(p => ({ id: p.id, nom: p.nom, couleur: p.couleur, ...(p.icone ? { icone: p.icone } : {}), droit: droitDe(d, p.id, compte) }))
    .filter((p): p is ProjetMembre => p.droit !== 'aucun');
}

/** Les membres de Tâches (Fondateur), avec accès, projets, charge et dernière activité. */
export function lignesEquipe(d: DonneesTaches, profils: readonly ProfilEquipe[] | undefined, aujourdhui: string): LigneEquipe[] {
  return listeMembres(d).map(m => {
    const { acces, profil } = etatAcces(m.compte, profils);
    const derniere = [derniereActivite(d, m.code), profil?.derniereConnexion].filter((x): x is string => Boolean(x)).sort().pop();
    return { membre: m, ...(profil ? { profil } : {}), acces, projets: projetsDuMembre(d, m.compte), charge: chargeDe(d, m.code, aujourdhui), ...(derniere ? { derniere } : {}) };
  });
}

/** Profils du hub qu'on peut inviter dans Tâches (amis, gestionnaires, administrateurs actifs, pas encore membres). */
export function invitables(d: DonneesTaches, profils: readonly ProfilEquipe[]): ProfilEquipe[] {
  return profils.filter(p => !p.admin && p.actif !== false && idMembreValide(p.id) && !membreDe(d, p.id) && (!p.role || ['ami', 'gestionnaire', 'administrateur'].includes(p.role))).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** Membres dont le profil n'existe plus dans le hub (annuaire chargé) : à nettoyer. */
export const profilsSupprimes = (d: DonneesTaches, profils: readonly ProfilEquipe[] | undefined): Membre[] => lignesEquipe(d, profils, '2000-01-01').filter(l => l.acces === 'supprime').map(l => l.membre);

// ------------------------------------------------------------------ Filtres

export interface FiltresEquipe {
  recherche: string;
  acces: EtatAcces | 'tous';
  projet?: string;
  rang?: 'ami' | 'gestionnaire' | 'administrateur';
  /** Seulement ceux qui ont des tâches en retard. */
  retard?: boolean;
}

export const FILTRES_EQUIPE: FiltresEquipe = { recherche: '', acces: 'tous' };

const plat = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filtrerEquipe(lignes: readonly LigneEquipe[], f: FiltresEquipe): LigneEquipe[] {
  const q = plat(f.recherche.trim());
  return lignes.filter(
    l =>
      (!q || plat(`${l.membre.nom} ${l.projets.map(p => p.nom).join(' ')}`).includes(q)) &&
      (f.acces === 'tous' || l.acces === f.acces) &&
      (!f.projet || l.projets.some(p => p.id === f.projet)) &&
      (!f.rang || (l.membre.rang ?? 'ami') === f.rang) &&
      (!f.retard || l.charge.enRetard > 0),
  );
}

// ------------------------------------------------------------------ Droits en masse

export interface ChangementDroit {
  projetId: string;
  compte: string;
  droit: DroitOuAucun;
}

/** Matrice membres × projets : droit actuel de chacun (projets non tenus par une autre app). */
export function matriceDroits(d: DonneesTaches): { projets: Array<{ id: string; nom: string; couleur: string }>; membres: Membre[]; droits: Record<string, Record<string, DroitOuAucun>> } {
  const projets = projetsDe(d).filter(p => !p.auto).map(p => ({ id: p.id, nom: p.nom, couleur: p.couleur }));
  const membres = listeMembres(d);
  const droits: Record<string, Record<string, DroitOuAucun>> = {};
  for (const m of membres) droits[m.compte] = Object.fromEntries(projets.map(p => [p.id, droitDe(d, p.id, m.compte)]));
  return { projets, membres, droits };
}

/**
 * Applique plusieurs changements de droits d'un coup (Fondateur). Retirer un
 * droit fait tourner la clé du projet (une fois par projet et par geste :
 * `changerDroit`). Rend le nombre de changements effectifs.
 */
export function appliquerMatrice(d: DonneesTaches, changements: readonly ChangementDroit[], ctx: Contexte & { aleaOctets: (n: number) => Uint8Array }): { donnees: DonneesTaches; nb: number } {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur gère les droits.');
  let x = d;
  let nb = 0;
  for (const c of changements) {
    const suivant = changerDroit(x, c.projetId, c.compte, c.droit, ctx);
    if (suivant !== x) nb++;
    x = suivant;
  }
  return { donnees: x, nb };
}

/** Retire un membre d'un ou plusieurs projets (ou de tous) : droit « aucun », clé de chaque projet tournée. Il reste membre de Tâches. */
export function retirerDesProjets(d: DonneesTaches, compte: string, projets: readonly string[] | 'tous', ctx: Contexte & { aleaOctets: (n: number) => Uint8Array }): DonneesTaches {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur retire un membre d’un projet.');
  const ids = projets === 'tous' ? projetsDuMembre(d, compte).map(p => p.id) : projets;
  return appliquerMatrice(d, ids.map(projetId => ({ projetId, compte, droit: 'aucun' as const })), ctx).donnees;
}

/** Peut-on assigner une tâche de ce projet à cette personne (le Fondateur, ou un membre qui voit le projet) ? */
export function assignable(d: DonneesTaches, projetId: string, code: Auteur): boolean {
  if (code === 'fondateur') return true;
  const compte = code === 'ami' ? d.reglages.ami : code;
  return Boolean(compte && droitDe(d, projetId, compte) !== 'aucun');
}

/**
 * Réassigne les tâches de `de` à `vers` (ou à personne) : seulement les
 * ouvertes par défaut, et seulement dans `projets` si donné. Une tâche dont
 * le projet n'est pas visible de `vers` reste sans lui (comptée à part).
 */
export function reassignerTaches(
  d: DonneesTaches,
  de: Auteur,
  vers: Auteur | undefined,
  ctx: Contexte,
  o: { projets?: readonly string[]; toutes?: boolean } = {},
  noms: Partial<Record<Auteur, string>> = {},
): { donnees: DonneesTaches; nb: number; ignorees: number } {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Seul le Fondateur réassigne les tâches d’un membre.');
  if (vers === de) return { donnees: d, nb: 0, ignorees: 0 };
  let x = d;
  let nb = 0;
  let ignorees = 0;
  for (const t of tachesVivantes(d)) {
    const l = assignesDe(t);
    if (!l.includes(de) || (o.projets && !o.projets.includes(t.projetId)) || (!o.toutes && estTerminee(d, t))) continue;
    const sans = l.filter(c => c !== de);
    let suivants = sans;
    if (vers && !sans.includes(vers)) {
      if (assignable(d, t.projetId, vers)) suivants = [...sans, vers];
      else ignorees++;
    }
    x = modifierTache(x, t.id, { assignes: suivants }, ctx, noms);
    nb++;
  }
  return { donnees: x, nb, ignorees };
}

// ------------------------------------------------------------------ Fiche d'un membre

/** Tâches assignées à une personne : ouvertes d'abord (échéance la plus proche), puis terminées récemment. */
export function tachesDuMembre(d: DonneesTaches, code: Auteur): Tache[] {
  return tachesVivantes(d)
    .filter(t => assignesDe(t).includes(code))
    .sort((a, b) => Number(estTerminee(d, a)) - Number(estTerminee(d, b)) || (a.echeance?.jour ?? '9999').localeCompare(b.echeance?.jour ?? '9999') || a.titre.localeCompare(b.titre, 'fr'));
}

export interface Activite {
  date: string;
  texte: string;
  tacheId?: string;
  projetId?: string;
}

/** Activité récente d'une personne : historique des tâches, commentaires, entrées de journal (les plus récentes d'abord). */
export function activiteRecente(d: DonneesTaches, code: Auteur, n = 20): Activite[] {
  const r: Activite[] = [];
  for (const t of Object.values(d.taches)) {
    if (!vivant(t) || !vivant(d.projets[t.projetId])) continue;
    for (const e of t.historique) if (e.auteur === code) r.push({ date: e.date, texte: `${e.texte} — « ${t.titre} »`, tacheId: t.id, projetId: t.projetId });
    for (const c of Object.values(t.commentaires)) if (!c.supprime && c.auteur === code) r.push({ date: c.date, texte: `A commenté « ${t.titre} » : ${c.texte.slice(0, 80)}`, tacheId: t.id, projetId: t.projetId });
  }
  for (const e of Object.values(d.journal ?? {})) if (!e.supprime && e.auteur === code && vivant(d.projets[e.projetId])) r.push({ date: e.creeLe, texte: `Journal : ${e.texte.slice(0, 100)}`, ...(e.tacheId ? { tacheId: e.tacheId } : {}), projetId: e.projetId });
  return r.sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
}

/** Débriefings d'une personne : ses entrées de journal, par jour et par projet (les jours les plus récents d'abord). */
export function debriefingsDe(d: DonneesTaches, code: Auteur, depuis: string): Array<{ jour: string; projetId: string; entrees: EntreeJournal[] }> {
  const groupes = new Map<string, { jour: string; projetId: string; entrees: EntreeJournal[] }>();
  for (const e of Object.values(d.journal ?? {})) {
    if (e.supprime || e.auteur !== code || e.jour < depuis || !vivant(d.projets[e.projetId])) continue;
    const cle = `${e.jour}|${e.projetId}`;
    const g = groupes.get(cle) ?? { jour: e.jour, projetId: e.projetId, entrees: [] };
    g.entrees.push(e);
    groupes.set(cle, g);
  }
  return [...groupes.values()].map(g => ({ ...g, entrees: g.entrees.sort((a, b) => a.creeLe.localeCompare(b.creeLe)) })).sort((a, b) => b.jour.localeCompare(a.jour) || a.projetId.localeCompare(b.projetId));
}

// ------------------------------------------------------------------ Vue d'un membre (lecture seule)

export interface PersonneEquipe {
  code: Auteur;
  nom: string;
  /** Projets partagés avec moi où cette personne est, et son droit (« fondateur » : propriétaire). */
  projets: Array<{ id: string; nom: string; couleur: string; droit: DroitMembre | 'proprietaire' }>;
  charge: ChargeMembre;
}

/** Ce qu'un membre (non Fondateur) voit de l'équipe : les personnes des projets partagés avec lui, en lecture seule. */
export function equipeVueMembre(d: DonneesTaches, noms: Partial<Record<Auteur, string>>, aujourdhui: string): PersonneEquipe[] {
  const projets = projetsDe(d).filter(vivant);
  const parCode = new Map<Auteur, PersonneEquipe>();
  const ajouter = (code: Auteur, p: (typeof projets)[number], droit: DroitMembre | 'proprietaire') => {
    const x = parCode.get(code) ?? { code, nom: noms[code] ?? (code === 'fondateur' ? 'Fondateur' : 'Membre'), projets: [], charge: chargeDe(d, code, aujourdhui) };
    x.projets.push({ id: p.id, nom: p.nom, couleur: p.couleur, droit });
    parCode.set(code, x);
  };
  for (const p of projets) {
    ajouter('fondateur', p, 'proprietaire');
    for (const [code, droit] of Object.entries(p.acces ?? {})) ajouter(code, p, droit);
  }
  return [...parCode.values()].sort((a, b) => (a.code === 'fondateur' ? -1 : b.code === 'fondateur' ? 1 : a.nom.localeCompare(b.nom, 'fr')));
}
