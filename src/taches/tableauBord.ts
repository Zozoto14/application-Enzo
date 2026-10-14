/**
 * Tableau de bord de Tâches (V3) : chiffres calculés, purs, par projet ou
 * pour tout ce que l'on voit.
 *
 *  - avancement (% des tâches terminées, sous-tâches non comptées) ;
 *  - tâches terminées par semaine (8 dernières semaines) ;
 *  - en retard ; répartition par statut ;
 *  - charge par personne (tâches ouvertes assignées, estimation restante) ;
 *  - temps passé contre estimé (tâches estimées, V2) ;
 *  - burndown simple : tâches restantes jour par jour, et la ligne idéale
 *    jusqu'à la fin du projet (ou la dernière échéance).
 */

import { ajouterJours, debutSemaine, ecartJours, jourDe } from './dates';
import { assignesDe, estTerminee, statutsDe, tachesVivantes, type Auteur, type DonneesTaches, type Tache } from './modele';
import { tempsPasse } from './temps';

export interface Stats {
  total: number;
  faites: number;
  pourcent: number;
  retard: Tache[];
  parStatut: Array<{ id: string; nom: string; couleur: string; nombre: number }>;
  parSemaine: Array<{ semaine: string; nombre: number }>;
  charge: Array<{ qui: Auteur | 'personne'; ouvertes: number; estimation: number }>;
  temps: { estime: number; passe: number; passeEstimees: number; nbEstimees: number; depassees: number };
  burndown: { jours: string[]; restantes: number[]; ideal: number[]; cible?: string };
}

const termineeLe = (t: Tache) => (t.termineLe ? jourDe(Date.parse(t.termineLe)) : undefined);
const creeeLe = (t: Tache) => jourDe(Date.parse(t.creeLe));

export function statistiques(d: DonneesTaches, aujourdhui: string, projetId?: string, toutes: readonly Tache[] = tachesVivantes(d, projetId)): Stats {
  const taches = toutes.filter(t => !t.parentId);
  const faites = taches.filter(t => estTerminee(d, t));
  const ouvertes = taches.filter(t => !estTerminee(d, t));
  const retard = ouvertes.filter(t => t.echeance && t.echeance.jour < aujourdhui).sort((a, b) => a.echeance!.jour.localeCompare(b.echeance!.jour));

  // Par statut : ceux du projet (ou, sans projet, regroupés par nom).
  const parStatut = new Map<string, { id: string; nom: string; couleur: string; nombre: number }>();
  for (const t of taches) {
    const s = statutsDe(d, t.projetId).find(x => x.id === t.statut) ?? statutsDe(d, t.projetId)[0];
    const cle = projetId ? s.id : s.ferme ? '~ferme' : s.nom.toLowerCase();
    const x = parStatut.get(cle) ?? { id: cle, nom: s.ferme && !projetId ? 'Terminé' : s.nom, couleur: s.couleur, nombre: 0 };
    x.nombre++;
    parStatut.set(cle, x);
  }
  if (projetId) for (const s of statutsDe(d, projetId)) if (!parStatut.has(s.id)) parStatut.set(s.id, { id: s.id, nom: s.nom, couleur: s.couleur, nombre: 0 });
  const ordre = projetId ? statutsDe(d, projetId).map(s => s.id) : [];
  const statuts = [...parStatut.values()].sort((a, b) => (projetId ? ordre.indexOf(a.id) - ordre.indexOf(b.id) : a.id === '~ferme' ? 1 : b.id === '~ferme' ? -1 : b.nombre - a.nombre));

  // Terminées par semaine : 8 semaines jusqu'à celle-ci.
  const semaineCourante = debutSemaine(aujourdhui);
  const parSemaine = Array.from({ length: 8 }, (_, i) => ({ semaine: ajouterJours(semaineCourante, (i - 7) * 7), nombre: 0 }));
  for (const t of faites) {
    const j = termineeLe(t);
    if (!j) continue;
    const s = parSemaine.find(x => j >= x.semaine && j <= ajouterJours(x.semaine, 6));
    if (s) s.nombre++;
  }

  // Charge par personne.
  const charge = new Map<Auteur | 'personne', { qui: Auteur | 'personne'; ouvertes: number; estimation: number }>();
  for (const t of ouvertes) {
    const qui = assignesDe(t);
    for (const q of qui.length ? qui : (['personne'] as const)) {
      const x = charge.get(q) ?? { qui: q, ouvertes: 0, estimation: 0 };
      x.ouvertes++;
      x.estimation += Math.max(0, (t.estimation ?? 0) - tempsPasse(t)) / Math.max(1, qui.length);
      charge.set(q, x);
    }
  }

  // Temps.
  const estimees = taches.filter(t => t.estimation);
  const temps = {
    estime: estimees.reduce((n, t) => n + (t.estimation ?? 0), 0),
    passe: toutes.reduce((n, t) => n + tempsPasse(t), 0),
    passeEstimees: estimees.reduce((n, t) => n + tempsPasse(t), 0),
    nbEstimees: estimees.length,
    depassees: estimees.filter(t => tempsPasse(t) > (t.estimation ?? 0)).length,
  };

  // Burndown : du début du projet (ou de la plus ancienne tâche, 6 semaines au plus) à aujourd'hui.
  const p = projetId ? d.projets[projetId] : undefined;
  const premier = [p?.debut, ...taches.map(creeeLe)].filter((x): x is string => Boolean(x)).sort()[0] ?? aujourdhui;
  const debut = premier < ajouterJours(aujourdhui, -42) ? ajouterJours(aujourdhui, -42) : premier > aujourdhui ? aujourdhui : premier;
  const echeances = ouvertes.map(t => t.echeance?.jour).filter((x): x is string => Boolean(x)).sort();
  const cible = p?.fin ?? echeances.at(-1);
  const n = Math.max(1, ecartJours(debut, aujourdhui) + 1);
  const jours = Array.from({ length: n }, (_, i) => ajouterJours(debut, i));
  const restantes = jours.map(j => taches.filter(t => creeeLe(t) <= j && !(estTerminee(d, t) && (termineeLe(t) ?? '9999') <= j)).length);
  const depart = restantes[0] ?? 0;
  const duree = cible && cible > debut ? ecartJours(debut, cible) : n - 1;
  const ideal = jours.map((_, i) => Math.max(0, Math.round((depart * (1 - (duree > 0 ? i / duree : 1))) * 10) / 10));

  return {
    total: taches.length,
    faites: faites.length,
    pourcent: taches.length ? Math.round((faites.length / taches.length) * 100) : 0,
    retard,
    parStatut: statuts,
    parSemaine,
    charge: [...charge.values()].sort((a, b) => b.ouvertes - a.ouvertes),
    temps,
    burndown: { jours, restantes, ideal, ...(cible ? { cible } : {}) },
  };
}

/** Avancement de chaque projet (pour la vue globale). */
export function avancementProjets(d: DonneesTaches, projets: ReadonlyArray<{ id: string; nom: string; couleur: string }>): Array<{ id: string; nom: string; couleur: string; total: number; faites: number; pourcent: number }> {
  return projets.map(p => {
    const t = tachesVivantes(d, p.id).filter(x => !x.parentId);
    const f = t.filter(x => estTerminee(d, x)).length;
    return { ...p, total: t.length, faites: f, pourcent: t.length ? Math.round((f / t.length) * 100) : 0 };
  });
}
