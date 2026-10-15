/**
 * Objectifs (V3) : une cible avec une échéance (« Finir la v2 de Tsuzuku »).
 *
 * Progression :
 *  - « tâches » : la part des tâches liées terminées — les tâches choisies,
 *    plus toutes celles (hors sous-tâches) des projets liés ;
 *  - « manuel » : saisie (0-100 %), ou, si une cible chiffrée est donnée
 *    (« 10 articles »), la valeur atteinte sur la cible.
 *
 * État : atteint, en retard (échéance passée), à risque (le temps écoulé
 * dépasse nettement l'avancement), en cours. Les objectifs sont au
 * Fondateur : ils ne partent pas chez les membres. Pur.
 */

import { ecartJours, jourDe } from './dates';
import { changerChamps, COULEURS, ErreurTaches, estTerminee, nouvelId, tachesVivantes, vivant, type Contexte, type DonneesTaches, type Objectif, type Tache } from './modele';

export type EtatObjectif = 'atteint' | 'retard' | 'risque' | 'en-cours';
export const LIBELLES_ETAT_OBJECTIF: Record<EtatObjectif, string> = { atteint: 'Atteint', retard: 'En retard', risque: 'À risque', 'en-cours': 'En cours' };

export interface SaisieObjectif {
  titre: string;
  description?: string;
  echeance?: string;
  mode?: 'taches' | 'manuel';
  taches?: string[];
  projets?: string[];
  manuel?: number;
  cible?: number;
  unite?: string;
  atteint?: number;
}

export const objectifsVivants = (d: DonneesTaches): Objectif[] => Object.values(d.objectifs ?? {}).filter(vivant).sort((a, b) => a.ordre - b.ordre || a.id.localeCompare(b.id));

export function creerObjectif(d: DonneesTaches, s: SaisieObjectif, ctx: Contexte): { donnees: DonneesTaches; objectif: Objectif } {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Les objectifs sont au Fondateur.');
  const titre = s.titre.trim().slice(0, 300);
  if (!titre) throw new ErreurTaches('Donnez un nom à l’objectif.');
  const ordre = Math.max(0, ...Object.values(d.objectifs ?? {}).map(o => o.ordre)) + 1;
  const hh = `${new Date(ctx.maintenant).toISOString()}|f`;
  const base: Objectif = {
    id: nouvelId('o', ctx.maintenant, ctx.alea),
    h: {},
    titre,
    ...(s.description?.trim() ? { description: s.description.trim().slice(0, 2000) } : {}),
    ...(s.echeance ? { echeance: s.echeance } : {}),
    mode: s.mode ?? 'taches',
    taches: [...new Set(s.taches ?? [])],
    projets: [...new Set(s.projets ?? [])],
    ...(s.manuel !== undefined ? { manuel: Math.min(100, Math.max(0, Math.round(s.manuel))) } : {}),
    ...(s.cible ? { cible: s.cible } : {}),
    ...(s.unite?.trim() ? { unite: s.unite.trim().slice(0, 30) } : {}),
    ...(s.atteint !== undefined ? { atteint: s.atteint } : {}),
    couleur: COULEURS[Object.keys(d.objectifs ?? {}).length % COULEURS.length],
    ordre,
  };
  const h: Record<string, string> = {};
  for (const c of Object.keys(base)) if (c !== 'id' && c !== 'h') h[c] = hh;
  const objectif = { ...base, h };
  return { donnees: { ...d, objectifs: { ...(d.objectifs ?? {}), [objectif.id]: objectif } }, objectif };
}

export function modifierObjectif(d: DonneesTaches, id: string, c: Partial<SaisieObjectif> & { supprime?: boolean }, ctx: Contexte): DonneesTaches {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Les objectifs sont au Fondateur.');
  const o = d.objectifs?.[id];
  if (!o) throw new ErreurTaches('Objectif introuvable.');
  const propre: Record<string, unknown> = { ...c };
  if (c.titre !== undefined) {
    propre.titre = c.titre.trim().slice(0, 300);
    if (!propre.titre) throw new ErreurTaches('Donnez un nom à l’objectif.');
  }
  if (c.description !== undefined) propre.description = c.description.trim().slice(0, 2000) || undefined;
  if (c.manuel !== undefined) propre.manuel = Math.min(100, Math.max(0, Math.round(c.manuel)));
  if (c.taches) propre.taches = [...new Set(c.taches)];
  if (c.projets) propre.projets = [...new Set(c.projets)];
  if (c.unite !== undefined) propre.unite = c.unite.trim().slice(0, 30) || undefined;
  return { ...d, objectifs: { ...d.objectifs, [id]: changerChamps(o, propre, ctx) } };
}

export const supprimerObjectif = (d: DonneesTaches, id: string, ctx: Contexte) => modifierObjectif(d, id, { supprime: true }, ctx);

/** Tâches qui comptent pour un objectif (liées, et celles des projets liés ; sans les sous-tâches des projets). */
export function tachesDeLObjectif(d: DonneesTaches, o: Objectif): Tache[] {
  const r = new Map<string, Tache>();
  for (const id of o.taches) {
    const t = d.taches[id];
    if (vivant(t) && tachesVivantes(d, t.projetId).some(x => x.id === id)) r.set(id, t);
  }
  for (const pid of o.projets) for (const t of tachesVivantes(d, pid)) if (!t.parentId) r.set(t.id, t);
  return [...r.values()];
}

export interface Progression {
  pourcent: number;
  faites: number;
  total: number;
  etat: EtatObjectif;
  /** Texte accessible : « 3 tâches sur 5 (60 %) ». */
  texte: string;
  joursRestants?: number;
}

export function progression(d: DonneesTaches, o: Objectif, aujourdhui: string): Progression {
  let pourcent: number;
  let faites = 0;
  let total = 0;
  let texte: string;
  if (o.mode === 'manuel') {
    if (o.cible) {
      pourcent = Math.min(100, Math.round(((o.atteint ?? 0) / o.cible) * 100));
      texte = `${o.atteint ?? 0} ${o.unite ?? ''} sur ${o.cible} ${o.unite ?? ''} (${pourcent} %)`.replace(/\s+/g, ' ');
    } else {
      pourcent = o.manuel ?? 0;
      texte = `${pourcent} % (saisi)`;
    }
  } else {
    const l = tachesDeLObjectif(d, o);
    total = l.length;
    faites = l.filter(t => estTerminee(d, t)).length;
    pourcent = total ? Math.round((faites / total) * 100) : 0;
    texte = total ? `${faites} tâche${faites > 1 ? 's' : ''} sur ${total} (${pourcent} %)` : 'Aucune tâche liée';
  }
  const joursRestants = o.echeance ? ecartJours(aujourdhui, o.echeance) : undefined;
  let etat: EtatObjectif = 'en-cours';
  if (pourcent >= 100) etat = 'atteint';
  else if (o.echeance && o.echeance < aujourdhui) etat = 'retard';
  else if (o.echeance) {
    // Temps écoulé depuis la création contre avancement : plus de 25 points d'écart, c'est à risque.
    const debut = jourDe(Date.parse(o.h.titre?.split('|')[0] ?? '') || Date.now());
    const duree = Math.max(1, ecartJours(debut, o.echeance));
    const ecoule = Math.min(1, Math.max(0, ecartJours(debut, aujourdhui) / duree));
    if (ecoule * 100 - pourcent > 25) etat = 'risque';
  }
  return { pourcent, faites, total, etat, texte, ...(joursRestants !== undefined ? { joursRestants } : {}) };
}
