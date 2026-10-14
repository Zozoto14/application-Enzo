/**
 * Tâches récurrentes : quotidienne (tous les N jours), hebdomadaire (jours
 * choisis), mensuelle (jour N, borné au dernier jour du mois), annuelle.
 *
 * La prochaine occurrence se crée quand on TERMINE la tâche : elle part de
 * l'échéance (ou d'aujourd'hui sans échéance) et n'est jamais dans le passé.
 * Son identifiant est tiré de la tâche et de sa date : si le Fondateur et
 * l'ami terminent la même tâche chacun de leur côté, ils créent la MÊME
 * tâche suivante, que la fusion réunit (pas de doublon).
 */

import { ajouterJours, ajouterMois, jourSemaine, joursDansMois, JOURS_SEMAINE, MOIS } from './dates';
import {
  assignesDe,
  creerTache,
  elementsChecklist,
  horodatage,
  modifierTache,
  statutsDe,
  vivant,
  type Auteur,
  type Contexte,
  type DonneesTaches,
  type ElementChecklist,
  type Recurrence,
} from './modele';

/** Occurrence suivante, strictement après `jour`. */
export function occurrenceApres(r: Recurrence, jour: string): string {
  switch (r.type) {
    case 'quotidienne':
      return ajouterJours(jour, Math.max(1, r.intervalle));
    case 'hebdo': {
      for (let i = 1; i <= 7; i++) {
        const j = ajouterJours(jour, i);
        if (r.jours.includes(jourSemaine(j))) return j;
      }
      return ajouterJours(jour, 7);
    }
    case 'mensuelle': {
      const [a, m, j] = jour.split('-').map(Number);
      const ceMois = Math.min(r.jour, joursDansMois(a, m));
      if (j < ceMois) return `${a}-${String(m).padStart(2, '0')}-${String(ceMois).padStart(2, '0')}`;
      return ajouterMois(`${a}-${String(m).padStart(2, '0')}-01`, 1, r.jour);
    }
    case 'annuelle': {
      const a = Number(jour.slice(0, 4));
      for (let y = a; y <= a + 8; y++) {
        const jj = Math.min(r.jour, joursDansMois(y, r.mois));
        const c = `${y}-${String(r.mois).padStart(2, '0')}-${String(jj).padStart(2, '0')}`;
        if (c > jour) return c;
      }
      return ajouterMois(jour, 12);
    }
  }
}

/** Prochaine échéance après complétion : jamais avant aujourd'hui. */
export function prochaineEcheance(r: Recurrence, base: string, aujourdhui: string): string {
  let j = occurrenceApres(r, base);
  for (let garde = 0; j < aujourdhui && garde < 2000; garde++) j = occurrenceApres(r, j);
  return j;
}

export function decrireRecurrence(r: Recurrence | undefined): string {
  if (!r) return 'Aucune';
  switch (r.type) {
    case 'quotidienne':
      return r.intervalle === 1 ? 'Tous les jours' : `Tous les ${r.intervalle} jours`;
    case 'hebdo':
      return r.jours.length === 7 ? 'Chaque jour de la semaine' : `Chaque ${r.jours.map(j => JOURS_SEMAINE[j - 1]).join(', ')}`;
    case 'mensuelle':
      return `Chaque mois, le ${r.jour === 1 ? '1er' : r.jour}`;
    case 'annuelle':
      return `Chaque année, le ${r.jour === 1 ? '1er' : r.jour} ${MOIS[r.mois - 1]}`;
  }
}

/** Petite empreinte texte (FNV-1a, base 36) pour un identifiant déterministe. */
function hachage(texte: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

export const idOccurrence = (id: string, jour: string): string => `r${hachage(`${id}|${jour}`)}`.slice(0, 40);

/**
 * Termine une tâche (premier statut « terminé » de son projet) et crée la
 * suivante si elle est récurrente. Rend aussi l'identifiant créé.
 */
export function terminerTache(d: DonneesTaches, id: string, ctx: Contexte, aujourdhui: string, noms: Partial<Record<Auteur, string>> = {}): { donnees: DonneesTaches; suivante?: string } {
  const t = d.taches[id];
  if (!vivant(t)) return { donnees: d };
  const ferme = statutsDe(d, t.projetId).find(s => s.ferme);
  let suivant = ferme && t.statut !== ferme.id ? modifierTache(d, id, { statut: ferme.id }, ctx, noms) : d;
  if (!t.recurrence || t.suivante) return { donnees: suivant };
  const jour = prochaineEcheance(t.recurrence, t.echeance?.jour ?? aujourdhui, aujourdhui);
  const nouvelId = idOccurrence(t.id, jour);
  if (!suivant.taches[nouvelId]) {
    const cree = creerTache(
      suivant,
      {
        titre: t.titre,
        listeId: t.listeId,
        ...(t.parentId ? { parentId: t.parentId } : {}),
        description: t.description,
        priorite: t.priorite,
        echeance: { jour, ...(t.echeance?.heure ? { heure: t.echeance.heure } : {}) },
        etiquettes: t.etiquettes,
        ...(assignesDe(t).length ? { assignes: assignesDe(t) } : {}),
        recurrence: t.recurrence,
        rappels: t.rappels,
      },
      ctx,
      nouvelId,
    );
    // La checklist repart décochée (identifiants dérivés : même résultat des deux côtés).
    const checklist: Record<string, ElementChecklist> = {};
    elementsChecklist(t).forEach((e, i) => {
      const idE = `${nouvelId.slice(0, 40)}-${i}`;
      checklist[idE] = { id: idE, texte: e.texte, fait: false, ordre: e.ordre, h: horodatage(ctx.maintenant, ctx.auteur) };
    });
    suivant = { ...cree.donnees, taches: { ...cree.donnees.taches, [nouvelId]: { ...cree.tache, checklist } } };
  }
  suivant = modifierTache(suivant, id, { suivante: nouvelId }, ctx);
  return { donnees: suivant, suivante: nouvelId };
}

/** Rouvre une tâche (premier statut ouvert). La suivante déjà créée reste. */
export function rouvrirTache(d: DonneesTaches, id: string, ctx: Contexte, noms: Partial<Record<Auteur, string>> = {}): DonneesTaches {
  const t = d.taches[id];
  if (!vivant(t)) return d;
  const ouvert = statutsDe(d, t.projetId).find(s => !s.ferme);
  return ouvert ? modifierTache(d, id, { statut: ouvert.id }, ctx, noms) : d;
}
