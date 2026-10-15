/**
 * Déplacer des tâches : changer leur emplacement (espace › projet › liste,
 * ou tâche parente pour une sous-tâche), une ou plusieurs à la fois, et
 * convertir une tâche en sous-tâche (ou l'inverse).
 *
 * Règles :
 *  - une tâche part avec ses sous-tâches (un seul niveau : devenue
 *    sous-tâche, ses propres sous-tâches sont rattachées à la nouvelle
 *    tâche parente) ;
 *  - statut inconnu dans le projet d'arrivée : celui choisi (proposé :
 *    l'équivalent — même identifiant, même nom, sinon le premier du même
 *    genre, ouvert ou terminé) ;
 *  - étiquettes absentes des étiquettes du projet d'arrivée : conservées
 *    sur la tâche, ou créées dans le projet (qui peut gérer le projet) ;
 *  - tout le reste suit la tâche, qui garde son identifiant : dépendances,
 *    jalon, objectifs, temps suivi, journal (lié par l'identifiant),
 *    commentaires, liens (Claude Office, Prospects…), historique ;
 *  - droits : le Fondateur partout (sauf vers un projet tenu par une autre
 *    app) ; un membre seulement depuis et vers des projets où il écrit ;
 *  - visibilité : vers un projet partagé, ses membres la verront ; hors d'un
 *    projet partagé, elle disparaît chez ceux qui ne voient pas l'arrivée
 *    (`anciensProjets`, puis `partis` dans leur dépôt) ;
 *  - historique « Déplacée de X vers Y » ; « Annuler » rend les valeurs
 *    d'avant (`annulerDeplacement`).
 *
 * Pur : horloge, auteur et aléa passés en paramètre.
 */

import { sansAccents } from './dates';
import { statutEquivalent, type Retour } from './corbeille';
import { membresDuProjet } from './membres';
import {
  anciensApres,
  borneHistorique,
  changerChamps,
  ErreurTaches,
  evenement,
  listesDe,
  modifierProjet,
  normaliserEtiquette,
  projetsDe,
  statutsDe,
  vivant,
  type Auteur,
  type Contexte,
  type DonneesTaches,
  type DroitMembre,
  type Tache,
} from './modele';
import { modeProjet } from './partage';

/** Qui déplace : le Fondateur (ou un membre dans SES projets personnels), ou un membre dans les projets partagés. */
export interface Cote {
  role: 'fondateur' | 'ami';
  moi: Auteur;
}

export interface Destination {
  listeId: string;
  /** Tâche parente (la tâche devient sa sous-tâche) ; `null` : une tâche principale ; absent : sous-tâche gardée si sa parente est dans la liste d'arrivée. */
  parentId?: string | null;
}

export interface OptionsDeplacement {
  /** Statut d'arrivée de chaque statut inconnu dans le projet d'arrivée (clé « projet|statut »). */
  statuts?: Record<string, string>;
  /** Étiquettes absentes du projet d'arrivée : conservées (défaut) ou créées dans le projet. */
  etiquettes?: 'conserver' | 'creer';
}

// ------------------------------------------------------------------ Droits

/** Peut-on déplacer des tâches DEPUIS ce projet ? */
export function peutDeplacerDepuis(d: DonneesTaches, projetId: string, cote: Cote): boolean {
  const p = d.projets[projetId];
  if (!vivant(p)) return false;
  return cote.role === 'fondateur' || modeProjet(d, projetId) === 'ecriture';
}

/** Peut-on déplacer des tâches VERS ce projet ? (un projet tenu par une autre app ne reçoit que ses propres tâches) */
export function peutDeplacerVers(d: DonneesTaches, projetId: string, cote: Cote, taches: readonly Tache[] = []): boolean {
  const p = d.projets[projetId];
  if (!vivant(p)) return false;
  if (p.auto && taches.some(t => t.source?.app !== p.auto)) return false;
  return cote.role === 'fondateur' || modeProjet(d, projetId) === 'ecriture';
}

/** Peut-on ajouter des étiquettes au projet (Fondateur, ou membre admin du projet) ? */
export const peutGererProjet = (d: DonneesTaches, projetId: string, cote: Cote): boolean =>
  cote.role === 'fondateur' || (modeProjet(d, projetId) === 'ecriture' && d.projets[projetId]?.acces?.[cote.moi] === 'admin');

// ------------------------------------------------------------------ Lecture

const cleStatut = (projetId: string, statut: string) => `${projetId}|${statut}`;

/** « Espace › Projet › Liste » d'une tâche (ou d'une liste). */
export function cheminListe(d: DonneesTaches, listeId: string): string {
  const l = d.listes[listeId];
  const p = l ? d.projets[l.projetId] : undefined;
  const e = p ? d.espaces[p.espaceId] : undefined;
  return [e?.nom, p?.nom, listesDe(d, l?.projetId ?? '').length > 1 || !p ? l?.nom : undefined].filter(Boolean).join(' › ');
}

export function cheminTache(d: DonneesTaches, t: Tache): string {
  const base = cheminListe(d, t.listeId);
  const parent = t.parentId ? d.taches[t.parentId] : undefined;
  return parent ? `${base} › ↳ ${parent.titre}` : base;
}

/** Une destination proposée par le sélecteur « Emplacement ». */
export interface EntreeDestination {
  listeId: string;
  projetId: string;
  /** Tâche parente (sous-tâche de…) ; absente : une liste. */
  parentId?: string;
  libelle: string;
  detail: string;
  couleur?: string;
}

/**
 * Listes où l'on peut déplacer, et tâches dont on peut devenir sous-tâche
 * (dès qu'on cherche, ou toujours en mode « parents »), filtrées par la
 * recherche (sans accents ni casse).
 */
export function destinations(d: DonneesTaches, cote: Cote, recherche = '', taches: readonly Tache[] = [], max = 60, mode: 'auto' | 'parents' = 'auto'): EntreeDestination[] {
  const q = sansAccents(recherche.trim());
  const exclus = new Set(taches.flatMap(t => [t.id, ...Object.values(d.taches).filter(s => s.parentId === t.id).map(s => s.id)]));
  const r: EntreeDestination[] = [];
  for (const p of mode === 'parents' ? [] : projetsDe(d)) {
    if (!peutDeplacerVers(d, p.id, cote, taches)) continue;
    const e = d.espaces[p.espaceId];
    const listes = listesDe(d, p.id);
    for (const l of listes) {
      const libelle = listes.length > 1 ? `${p.nom} › ${l.nom}` : p.nom;
      const detail = e?.nom ?? '';
      if (!q || sansAccents(`${detail} ${p.nom} ${l.nom}`).includes(q)) r.push({ listeId: l.id, projetId: p.id, libelle: `${p.icone ? `${p.icone} ` : ''}${libelle}`, detail, couleur: p.couleur });
    }
  }
  if (q || mode === 'parents') {
    for (const t of Object.values(d.taches)) {
      if (!vivant(t) || t.parentId || exclus.has(t.id) || !vivant(d.listes[t.listeId]) || !peutDeplacerVers(d, t.projetId, cote, taches)) continue;
      if (q && !sansAccents(t.titre).includes(q)) continue;
      r.push({ listeId: t.listeId, projetId: t.projetId, parentId: t.id, libelle: `↳ Sous-tâche de « ${t.titre} »`, detail: cheminListe(d, t.listeId), couleur: d.projets[t.projetId]?.couleur });
    }
  }
  return r.slice(0, max);
}

/** Les tâches choisies, sans celles dont la parente est aussi choisie (elles suivent). */
export function racinesDe(d: DonneesTaches, ids: readonly string[]): Tache[] {
  const choisis = new Set(ids);
  return [...choisis].map(id => d.taches[id]).filter((t): t is Tache => vivant(t) && !(t.parentId && choisis.has(t.parentId)));
}

const sousDe = (d: DonneesTaches, id: string): Tache[] => Object.values(d.taches).filter(s => s.parentId === id && !s.efface);

/** Qui voit un projet, à part le Fondateur (chez le Fondateur : ses membres ; chez un membre : les personnes publiées). */
export function personnesQuiVoient(d: DonneesTaches, projetId: string, cote: Cote, noms: Partial<Record<Auteur, string>> = {}): Array<{ code: Auteur; nom: string; droit: DroitMembre }> {
  const p = d.projets[projetId];
  if (!p || p.auto) return [];
  if (cote.role === 'fondateur') {
    // Un membre dans ses projets personnels : personne d'autre ne les voit.
    if (cote.moi !== 'fondateur') return [];
    return membresDuProjet(d, projetId).map(m => ({ code: m.code, nom: m.nom, droit: m.droit }));
  }
  return Object.entries(p.acces ?? {})
    .filter(([code]) => code !== cote.moi)
    .map(([code, droit]) => ({ code, nom: noms[code] ?? 'Membre', droit }));
}

export interface StatutAChoisir {
  cle: string;
  projetId: string;
  statutId: string;
  nom: string;
  nb: number;
  propose: string;
}

export interface Analyse {
  racines: Tache[];
  /** Tâches qui bougent, sous-tâches comprises. */
  total: number;
  projetCible: string;
  listeCible: string;
  parentCible?: string;
  statuts: StatutAChoisir[];
  /** Étiquettes des tâches absentes des étiquettes du projet d'arrivée. */
  etiquettes: string[];
  peutCreerEtiquettes: boolean;
  /** Personnes qui la verront en plus (projet d'arrivée partagé). */
  visibles: Array<{ code: Auteur; nom: string; droit: DroitMembre }>;
  /** Personnes chez qui elle disparaîtra (elles voyaient le projet de départ, pas celui d'arrivée). */
  disparus: Array<{ code: Auteur; nom: string }>;
  /** Tâches venues d'une autre app : jamais montrées aux membres, même dans un projet partagé. */
  appsCachees: number;
  /** Pourquoi c'est impossible. */
  refus?: string;
  /** Rien ne changerait. */
  rien: boolean;
}

function parentNormalise(d: DonneesTaches, parentId: string | null | undefined): string | null | undefined {
  if (!parentId) return parentId;
  const p = d.taches[parentId];
  return p?.parentId ?? parentId;
}

/** Ce que ferait le déplacement (statuts à choisir, étiquettes, visibilité, refus) — rien n'est écrit. */
export function analyserDeplacement(d: DonneesTaches, ids: readonly string[], dest: Destination, cote: Cote, noms: Partial<Record<Auteur, string>> = {}): Analyse {
  const racines = racinesDe(d, ids);
  const l = d.listes[dest.listeId];
  const projetCible = l?.projetId ?? '';
  const vide: Analyse = { racines, total: 0, projetCible, listeCible: dest.listeId, statuts: [], etiquettes: [], peutCreerEtiquettes: false, visibles: [], disparus: [], appsCachees: 0, rien: true };
  if (!racines.length) return { ...vide, refus: 'Aucune tâche à déplacer.' };
  if (!vivant(l) || !vivant(d.projets[projetCible])) return { ...vide, refus: 'Liste de destination introuvable.' };
  const parentCible = parentNormalise(d, dest.parentId);
  if (parentCible) {
    const parent = d.taches[parentCible];
    if (!vivant(parent)) return { ...vide, refus: 'Tâche parente introuvable.' };
    if (parent.listeId !== dest.listeId) return { ...vide, refus: 'La tâche parente n’est pas dans cette liste.' };
    const bouge = new Set(racines.flatMap(t => [t.id, ...sousDe(d, t.id).map(s => s.id)]));
    if (bouge.has(parentCible)) return { ...vide, refus: 'Une tâche ne peut pas devenir sous-tâche d’elle-même ni d’une de ses sous-tâches.' };
  }
  for (const t of racines) {
    if (!peutDeplacerDepuis(d, t.projetId, cote)) return { ...vide, refus: `Vous ne pouvez pas modifier « ${d.projets[t.projetId]?.nom ?? 'ce projet'} ».` };
  }
  if (!peutDeplacerVers(d, projetCible, cote, racines)) {
    return { ...vide, refus: d.projets[projetCible].auto ? 'Ce projet est tenu par une autre app : on n’y déplace pas de tâches.' : `Vous ne pouvez pas écrire dans « ${d.projets[projetCible].nom} ».` };
  }
  const bougent = racines.flatMap(t => [t, ...sousDe(d, t.id)]);
  const cibles = statutsDe(d, projetCible);
  const statuts = new Map<string, StatutAChoisir>();
  for (const t of bougent) {
    if (t.projetId === projetCible || cibles.some(s => s.id === t.statut)) continue;
    const cle = cleStatut(t.projetId, t.statut);
    const x = statuts.get(cle);
    if (x) x.nb++;
    else statuts.set(cle, { cle, projetId: t.projetId, statutId: t.statut, nom: statutsDe(d, t.projetId).find(s => s.id === t.statut)?.nom ?? t.statut, nb: 1, propose: statutEquivalent(d, t, projetCible) });
  }
  const proposees = new Set(d.projets[projetCible].etiquettes ?? []);
  const sources = new Set(racines.map(t => t.projetId));
  // Étiquettes « du projet » : celles qu'un projet propose. Une tâche qui change de projet en apporte peut-être de nouvelles.
  const etiquettes = [...new Set(bougent.filter(t => t.projetId !== projetCible).flatMap(t => t.etiquettes))].filter(e => !proposees.has(e) && (proposees.size > 0 || [...sources].some(s => (d.projets[s]?.etiquettes ?? []).includes(e))));
  const voientCible = personnesQuiVoient(d, projetCible, cote, noms);
  const codesCible = new Set(voientCible.map(p => p.code));
  const voientSource = new Map<Auteur, string>();
  for (const s of sources) for (const p of personnesQuiVoient(d, s, cote, noms)) voientSource.set(p.code, p.nom);
  // Nouveaux lecteurs : ceux qui voient l'arrivée sans voir chacun des projets de départ.
  const visibles = voientCible.filter(p => ![...sources].every(s => personnesQuiVoient(d, s, cote, noms).some(x => x.code === p.code)));
  const disparus = [...voientSource].filter(([code]) => !codesCible.has(code)).map(([code, nom]) => ({ code, nom }));
  const rien = racines.every(t => t.listeId === dest.listeId && (dest.parentId === undefined ? !t.parentId || d.taches[t.parentId]?.listeId === dest.listeId : (t.parentId ?? null) === (parentCible ?? null)));
  return {
    racines,
    total: bougent.filter(t => !t.supprime).length,
    projetCible,
    listeCible: dest.listeId,
    ...(parentCible ? { parentCible } : {}),
    statuts: [...statuts.values()],
    etiquettes,
    peutCreerEtiquettes: peutGererProjet(d, projetCible, cote),
    visibles,
    disparus,
    appsCachees: voientCible.length ? racines.filter(t => t.source).length : 0,
    rien,
  };
}

// ------------------------------------------------------------------ Déplacer

export interface ResultatDeplacement {
  donnees: DonneesTaches;
  /** Valeurs d'avant : « Annuler » les remet. */
  retours: Retour[];
  /** Texte de l'avis : « 3 tâches déplacées vers « Appli › Liste ». » */
  texte: string;
  nb: number;
}

const CHAMPS_RETOUR = ['projetId', 'listeId', 'parentId', 'statut', 'ordre', 'anciensProjets', 'etiquettes'] as const;

/** Déplace des tâches (et leurs sous-tâches) vers une liste, ou sous une tâche parente. */
export function deplacerTaches(d: DonneesTaches, ids: readonly string[], dest: Destination, ctx: Contexte, cote: Cote, o: OptionsDeplacement = {}, noms: Partial<Record<Auteur, string>> = {}): ResultatDeplacement {
  const an = analyserDeplacement(d, ids, dest, cote, noms);
  if (an.refus) throw new ErreurTaches(an.refus);
  if (an.rien) return { donnees: d, retours: [], texte: 'Rien à déplacer : déjà à cet endroit.', nb: 0 };
  const cible = an.projetCible;
  const statutsCible = statutsDe(d, cible);
  const choix = (t: Tache): string => {
    if (t.projetId === cible || statutsCible.some(s => s.id === t.statut)) return t.statut;
    const voulu = o.statuts?.[cleStatut(t.projetId, t.statut)];
    return voulu && statutsCible.some(s => s.id === voulu) ? voulu : statutEquivalent(d, t, cible);
  };
  const nomStatut = (projetId: string, id: string) => statutsDe(d, projetId).find(s => s.id === id)?.nom ?? id;
  const retours: Retour[] = [];
  const taches = { ...d.taches };
  let ordre = Math.max(0, ...Object.values(d.taches).filter(t => t.listeId === dest.listeId).map(t => t.ordre));
  const vers = cheminListe(d, dest.listeId);
  const parent = an.parentCible ? d.taches[an.parentCible] : undefined;
  const bouger = (t: Tache, parentId: string | undefined, raison?: string) => {
    const changement: Record<string, unknown> = { listeId: dest.listeId, projetId: cible, parentId, statut: choix(t) };
    if (t.listeId !== dest.listeId) changement.ordre = ++ordre;
    if (t.projetId !== cible) changement.anciensProjets = anciensApres(t, cible);
    const suivante = changerChamps(t, changement, ctx);
    if (suivante === t) return;
    retours.push({ c: 'taches', id: t.id, valeurs: Object.fromEntries(CHAMPS_RETOUR.map(c => [c, (t as unknown as Record<string, unknown>)[c]])) });
    const evts = [];
    if (t.listeId !== dest.listeId) evts.push(evenement(ctx, `${raison ?? 'Déplacée'} de « ${cheminListe(d, t.listeId)} » vers « ${vers} »`));
    if ((t.parentId ?? '') !== (parentId ?? '')) evts.push(evenement(ctx, parentId ? `Devenue sous-tâche de « ${d.taches[parentId]?.titre ?? ''} »` : 'Devenue une tâche principale'));
    if (changement.statut !== t.statut) evts.push(evenement(ctx, `Statut : ${nomStatut(t.projetId, t.statut)} → ${nomStatut(cible, changement.statut as string)}`));
    taches[t.id] = t.supprime || !evts.length ? suivante : { ...suivante, historique: borneHistorique([...suivante.historique, ...evts]) };
  };
  for (const t of an.racines) {
    const parentId = dest.parentId === null ? undefined : an.parentCible ? an.parentCible : t.parentId && d.taches[t.parentId]?.listeId === dest.listeId ? t.parentId : undefined;
    bouger(t, parentId);
    // Ses sous-tâches suivent (devenue sous-tâche : elles sont rattachées à sa nouvelle parente, un seul niveau).
    for (const s of sousDe(d, t.id)) bouger(s, parentId ?? t.id, `Déplacée avec « ${t.titre} »`);
  }
  let x: DonneesTaches = { ...d, taches };
  if (o.etiquettes === 'creer' && an.etiquettes.length && an.peutCreerEtiquettes) {
    const p = x.projets[cible];
    retours.push({ c: 'projets', id: cible, valeurs: { etiquettes: p.etiquettes } });
    x = modifierProjet(x, cible, { etiquettes: [...(p.etiquettes ?? []), ...an.etiquettes.map(normaliserEtiquette)] }, ctx);
  }
  const nb = an.racines.length;
  const quoi = nb === 1 ? `« ${an.racines[0].titre} »` : `${nb} tâches`;
  const texte = parent
    ? `${quoi} ${nb === 1 ? 'devient sous-tâche' : 'deviennent sous-tâches'} de « ${parent.titre} ».`
    : dest.parentId === null && an.racines.every(t => t.parentId && t.listeId === dest.listeId)
      ? `${quoi} ${nb === 1 ? 'devient une tâche principale' : 'deviennent des tâches principales'}.`
      : `${quoi} ${nb === 1 ? 'déplacée' : 'déplacées'} vers « ${vers} ».`;
  return { donnees: x, retours, texte, nb };
}

/** « Annuler » : chaque tâche (et le projet, si des étiquettes y ont été créées) reprend ses valeurs d'avant. */
export function annulerDeplacement(d: DonneesTaches, retours: readonly Retour[], ctx: Contexte): DonneesTaches {
  let x = d;
  for (const { c, id, valeurs } of [...retours].reverse()) {
    const e = x[c][id];
    if (!e) continue;
    let suivante = changerChamps(e, valeurs, ctx);
    if (c === 'taches' && suivante !== e) {
      const t = suivante as unknown as Tache;
      suivante = { ...t, historique: borneHistorique([...t.historique, evenement(ctx, 'Déplacement annulé')]) } as unknown as typeof e;
    }
    x = { ...x, [c]: { ...x[c], [id]: suivante } };
  }
  return x;
}
